/**
 * Motor da auditoria de receitas — só cálculo, sem I/O (o index.ts lê e grava o banco;
 * por isso este arquivo também roda fora do Deno, nos testes).
 *
 * Compara a foto de uma venda na conferência anterior com a de hoje e responde duas
 * perguntas de natureza diferente:
 *   • O QUE mudou (`tipo`) — fato tirado da comparação: produto cancelado, receita
 *     ajustada, data trocada, venda reaberta... Não é palpite.
 *   • POR QUE mudou (`motivo`) — hipótese. Começa por uma regra (distribuição a priori
 *     por tipo + sinais da venda) e é corrigida pelas revisões feitas na aba Auditoria:
 *     cada revisão vale um voto nas chaves de contexto da alteração (tipo, direção,
 *     setor, produto, fornecedor, vendedor). A regra pesa PESO_REGRA votos: duas
 *     revisões concordantes num contexto superam qualquer regra; uma só já pesa no
 *     contexto específico (mesmo produto ou vendedor).
 *
 * A receita de cada produto é RATEADA pelo sync (receita da venda × valor do produto /
 * soma dos valores). Por isso a unidade que importa para receita é a venda; os
 * produtos explicam o porquê. Ex.: um produto cancelado sem mudar a receita total da
 * venda só redistribui a receita entre os itens que ficaram.
 *
 * Tipos e motivos espelham AUDITORIA_TIPOS / AUDITORIA_MOTIVOS de lib/schemas.ts —
 * mudou um, mude o outro.
 */

// ─── Parâmetros ───────────────────────────────────────────────────────────────

/** Diferença de receita/valor abaixo disso é arredondamento do rateio. */
export const TOLERANCIA_RS = 0.05
/** Venda que entra nas Fechadas com data até N dias atrás é fluxo normal, não alteração. */
export const DIAS_TOLERANCIA = 7
/** Quantas revisões a regra vale no cálculo do motivo. */
export const PESO_REGRA = 2

// ─── Vocabulário ──────────────────────────────────────────────────────────────

export const TIPOS = [
  'VENDA_CANCELADA', 'CANCELAMENTO_MANUAL', 'VENDA_EXCLUIDA', 'PRODUTOS_CANCELADOS',
  'PRODUTO_CANCELADO', 'PRODUTO_INCLUIDO', 'TROCA_PRODUTO', 'ALTERACAO_VALOR',
  'AJUSTE_RECEITA', 'MUDANCA_DATA', 'MUDANCA_VENDEDOR', 'MUDANCA_SETOR',
  'RECLASSIFICACAO_PRODUTO', 'VENDA_REABERTA', 'VENDA_REFECHADA', 'FECHAMENTO_TARDIO',
  'LANCAMENTO_RETROATIVO', 'VENDA_REATIVADA', 'DIVERGENCIA_SYNC',
] as const
export type Tipo = (typeof TIPOS)[number]

export const MOTIVOS = [
  'CANCELAMENTO_CLIENTE', 'REMARCACAO_REEMISSAO', 'AJUSTE_COMISSAO', 'DESCONTO_NEGOCIACAO',
  'TAXA_FEE', 'VARIACAO_CAMBIAL', 'CORRECAO_LANCAMENTO', 'DUPLICIDADE',
  'VENDA_COMPLEMENTAR', 'REATRIBUICAO', 'LANCAMENTO_ATRASADO', 'FALHA_INTEGRACAO', 'OUTRO',
] as const
export type Motivo = (typeof MOTIVOS)[number]

export const MOTIVO_LABEL: Record<Motivo, string> = {
  CANCELAMENTO_CLIENTE: 'Cancelamento / desistência do cliente',
  REMARCACAO_REEMISSAO: 'Remarcação, troca ou reemissão',
  AJUSTE_COMISSAO: 'Ajuste de comissão / incentivo do fornecedor',
  DESCONTO_NEGOCIACAO: 'Desconto ou renegociação com o cliente',
  TAXA_FEE: 'Taxa ou fee incluída/removida',
  VARIACAO_CAMBIAL: 'Variação cambial / tarifa',
  CORRECAO_LANCAMENTO: 'Correção de lançamento',
  DUPLICIDADE: 'Lançamento duplicado removido',
  VENDA_COMPLEMENTAR: 'Serviço adicional vendido depois',
  REATRIBUICAO: 'Venda transferida de vendedor/setor',
  LANCAMENTO_ATRASADO: 'Lançamento ou fechamento atrasado',
  FALHA_INTEGRACAO: 'Falha de integração (não é alteração real)',
  OUTRO: 'Outro',
}

const TIPOS_CANCELAMENTO = new Set<Tipo>([
  'VENDA_CANCELADA', 'CANCELAMENTO_MANUAL', 'VENDA_EXCLUIDA', 'PRODUTOS_CANCELADOS',
])

// ─── Fotos ────────────────────────────────────────────────────────────────────

/** Linha de `vendas` como o index.ts lê. */
export interface LinhaBanco {
  venda_numero: number
  data_venda: string
  situacao: string | null
  vendedor: string | null
  setor_grupo: string | null
  setor_bruto: string | null
  pagante: string | null
  produto: string | null
  fornecedor: string | null
  valor_total: number | string | null
  receitas: number | string | null
}

export interface Linha {
  produto: string | null
  fornecedor: string | null
  valor: number
  receita: number
}

/** A venda numa conferência. Vendedor, setor, data e situação são da venda (o sync grava iguais em todas as linhas). */
export interface Foto {
  venda_numero: number
  data_venda: string
  situacao: string
  vendedor: string | null
  setor_grupo: string | null
  setor_bruto: string | null
  pagante: string | null
  valor: number
  receita: number
  linhas: Linha[]
  hash: string
}

export function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function ordemLinha(a: Linha, b: Linha): number {
  return (a.produto ?? '').localeCompare(b.produto ?? '') ||
    (a.fornecedor ?? '').localeCompare(b.fornecedor ?? '') ||
    b.valor - a.valor || b.receita - a.receita
}

/** cyrb53: hash de 53 bits, suficiente para dizer "esta venda mudou desde ontem". */
function hash53(str: string): string {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

export function hashFoto(f: Omit<Foto, 'hash'>): string {
  return hash53(JSON.stringify([
    f.data_venda, f.situacao, f.vendedor, f.setor_grupo, f.setor_bruto, f.pagante,
    f.linhas.map((l) => [l.produto, l.fornecedor, l.valor, l.receita]),
  ]))
}

/** Agrupa as linhas de `vendas` em uma foto por venda. */
export function montarFotos(rows: LinhaBanco[]): Map<number, Foto> {
  const grupos = new Map<number, LinhaBanco[]>()
  for (const r of rows) {
    const g = grupos.get(r.venda_numero)
    if (g) g.push(r)
    else grupos.set(r.venda_numero, [r])
  }
  const out = new Map<number, Foto>()
  for (const [numero, rs] of grupos) {
    const p = rs[0]
    const linhas = rs
      .map((r) => ({
        produto: r.produto ?? null,
        fornecedor: r.fornecedor ?? null,
        valor: round2(num(r.valor_total)),
        receita: round2(num(r.receitas)),
      }))
      .sort(ordemLinha)
    const semHash = {
      venda_numero: numero,
      data_venda: p.data_venda,
      situacao: p.situacao ?? 'Fechada',
      vendedor: p.vendedor ?? null,
      setor_grupo: p.setor_grupo ?? null,
      setor_bruto: p.setor_bruto ?? null,
      pagante: p.pagante ?? null,
      valor: round2(linhas.reduce((s, l) => s + l.valor, 0)),
      receita: round2(linhas.reduce((s, l) => s + l.receita, 0)),
      linhas,
    }
    out.set(numero, { ...semHash, hash: hashFoto(semHash) })
  }
  return out
}

// ─── Comparação produto a produto ─────────────────────────────────────────────

export type Mudanca = 'igual' | 'alterado' | 'reclassificado' | 'cancelado' | 'incluido' | 'saiu'

export interface LinhaDiff {
  produto: string | null
  fornecedor: string | null
  /** Só em 'reclassificado': o nome que o produto/fornecedor tinha antes. */
  produto_antes?: string | null
  fornecedor_antes?: string | null
  mudanca: Mudanca
  valor_antes: number
  valor_depois: number
  receita_antes: number
  receita_depois: number
}

/**
 * Casa os produtos de antes e de depois. `vendas` não tem id de produto, então o
 * casamento é em passes, do mais forte para o mais fraco:
 *   1. mesmo produto, fornecedor e valor → igual (a receita pode ter mudado pelo rateio);
 *   2. mesmo produto e fornecedor        → valor alterado (pareia pelo valor mais próximo);
 *   3. mesmo valor e mesmo produto OU mesmo fornecedor → reclassificado (um nome mudou);
 *   o que sobra de antes foi cancelado, o que sobra de depois foi incluído.
 */
export function casarLinhas(antes: Linha[], depois: Linha[]): LinhaDiff[] {
  const a = antes.map((l) => ({ l, usado: false }))
  const d = depois.map((l) => ({ l, usado: false }))
  const out: LinhaDiff[] = []
  const mesmoNome = (x: Linha, y: Linha) => x.produto === y.produto && x.fornecedor === y.fornecedor
  const mesmoValor = (x: Linha, y: Linha) => Math.abs(x.valor - y.valor) < 0.01

  const par = (x: { l: Linha; usado: boolean }, y: { l: Linha; usado: boolean }, mudanca: Mudanca) => {
    x.usado = true
    y.usado = true
    const diff: LinhaDiff = {
      produto: y.l.produto, fornecedor: y.l.fornecedor, mudanca,
      valor_antes: x.l.valor, valor_depois: y.l.valor,
      receita_antes: x.l.receita, receita_depois: y.l.receita,
    }
    if (mudanca === 'reclassificado') {
      diff.produto_antes = x.l.produto
      diff.fornecedor_antes = x.l.fornecedor
    }
    out.push(diff)
  }

  for (const y of d) {
    const x = a.find((x) => !x.usado && mesmoNome(x.l, y.l) && mesmoValor(x.l, y.l))
    if (x) par(x, y, 'igual')
  }
  for (const y of d) {
    if (y.usado) continue
    const cands = a.filter((x) => !x.usado && mesmoNome(x.l, y.l))
    if (cands.length === 0) continue
    cands.sort((p, q) => Math.abs(p.l.valor - y.l.valor) - Math.abs(q.l.valor - y.l.valor))
    par(cands[0], y, 'alterado')
  }
  for (const y of d) {
    if (y.usado) continue
    const x = a.find((x) => !x.usado && mesmoValor(x.l, y.l) &&
      (x.l.produto === y.l.produto || x.l.fornecedor === y.l.fornecedor))
    if (x) par(x, y, 'reclassificado')
  }
  for (const x of a) {
    if (x.usado) continue
    out.push({
      produto: x.l.produto, fornecedor: x.l.fornecedor, mudanca: 'cancelado',
      valor_antes: x.l.valor, valor_depois: 0, receita_antes: x.l.receita, receita_depois: 0,
    })
  }
  for (const y of d) {
    if (y.usado) continue
    out.push({
      produto: y.l.produto, fornecedor: y.l.fornecedor, mudanca: 'incluido',
      valor_antes: 0, valor_depois: y.l.valor, receita_antes: 0, receita_depois: y.l.receita,
    })
  }
  return out
}

// ─── Contexto vindo do banco ──────────────────────────────────────────────────

/** A venda no índice do sync (`monde_v3_vendas`): o que o Monde diz hoje. */
export interface Indice {
  status: string | null
  linhas_ativas: number | null
  revenue: number | null
  detail_at: string | null
}

/** Para onde foi uma venda que sumiu da janela. */
export interface Paradeiro {
  /** A venda continua em `vendas`, mas com data fora da janela. */
  foto: Foto | null
  /** null = a venda não está mais no índice (o Monde devolveu 404). */
  indice: Indice | null
  /** Está na lista de cancelamentos manuais do dashboard (`vendas_canceladas`). */
  manual: { motivo: string | null } | null
}

export interface HistoricoVenda {
  tipo: string
  detectado_em: string
  receita_antes: number
  receita_depois: number
}

export interface Contexto {
  hoje: string
  inicioJanela: string
  indice?: Indice | null
  paradeiro?: Paradeiro
  /** Alterações anteriores desta venda, da mais recente para a mais antiga. */
  historico?: HistoricoVenda[]
  /** Venda da mesma conferência com mesmo cliente, vendedor e valor parecido (cancelada ↔ nova). */
  parecida?: number | null
}

// ─── Detecção ─────────────────────────────────────────────────────────────────

export interface Deteccao {
  venda_numero: number
  tipo: Tipo
  data_venda: string | null
  data_venda_antes: string | null
  situacao: string | null
  situacao_antes: string | null
  vendedor: string | null
  vendedor_antes: string | null
  setor_grupo: string | null
  setor_grupo_antes: string | null
  setor_bruto: string | null
  pagante: string | null
  receita_antes: number
  receita_depois: number
  delta_receita: number
  valor_antes: number
  valor_depois: number
  delta_valor: number
  produtos: LinhaDiff[]
  /** Frases do que mudou (fatos). */
  fatos: string[]
  /** Contexto que ajuda a entender (releitura do Monde, histórico, sinais). */
  evidencias: string[]
  /** Sinais usados pela regra do motivo. */
  sinais: Record<string, boolean>
  /** Contextos de aprendizado, do mais específico para o mais geral. */
  chaves: string[]
}

const brlFmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
export const brl = (n: number) => brlFmt.format(round2(n))
const brlSinal = (n: number) => (n > 0 ? '+' : n < 0 ? '−' : '') + brlFmt.format(Math.abs(round2(n)))
const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n * 100).toFixed(1).replace('.', ',')}%`
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const dataBR = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const mesBR = (iso: string) => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(0, 4)}`

/** Dias entre duas datas ISO (YYYY-MM-DD), sem fuso. */
export function diasEntre(de: string, ate: string): number {
  const [y1, m1, d1] = de.split('-').map(Number)
  const [y2, m2, d2] = ate.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

function nomeLinha(l: { produto: string | null; fornecedor: string | null }): string {
  const p = l.produto ?? 'Produto sem nome'
  return l.fornecedor ? `${p} · ${l.fornecedor}` : p
}

function listarLinhas(ls: LinhaDiff[], campo: 'valor_antes' | 'valor_depois'): string {
  const ord = [...ls].sort((a, b) => b[campo] - a[campo])
  const txt = ord.slice(0, 3).map((l) => `${nomeLinha(l)} (${brl(l[campo])})`).join('; ')
  return ord.length > 3 ? `${txt} e mais ${ord.length - 3}` : txt
}

function frase(x: number, y: number): string {
  const d = round2(y - x)
  if (Math.abs(d) < TOLERANCIA_RS) return `ficou em ${brl(y)}`
  const rel = x !== 0 ? `, ${pct(d / x)}` : ''
  return `${d > 0 ? 'subiu' : 'caiu'} de ${brl(x)} para ${brl(y)} (${brlSinal(d)}${rel})`
}

const margem = (receita: number, valor: number) =>
  valor > 0 ? `${((receita / valor) * 100).toFixed(1).replace('.', ',')}%` : '—'

/** Produto mais relevante da alteração: é ele que entra nas chaves de aprendizado. */
function principal(ls: LinhaDiff[]): LinhaDiff | null {
  const peso = (l: LinhaDiff) =>
    l.mudanca === 'cancelado' || l.mudanca === 'saiu' ? l.valor_antes
      : l.mudanca === 'incluido' ? l.valor_depois
        : l.mudanca === 'alterado' ? Math.abs(l.valor_depois - l.valor_antes)
          : l.mudanca === 'reclassificado' ? l.valor_depois
            : 0
  const mudadas = ls.filter((l) => l.mudanca !== 'igual')
  const base = mudadas.length > 0 ? mudadas : ls
  if (base.length === 0) return null
  return [...base].sort((a, b) => peso(b) - peso(a) || Math.max(b.receita_antes, b.receita_depois) - Math.max(a.receita_antes, a.receita_depois))[0]
}

export function montarChaves(tipo: Tipo, delta: number, setor: string | null, vendedor: string | null, item: LinhaDiff | null): string[] {
  const dir = delta >= TOLERANCIA_RS ? 'alta' : delta <= -TOLERANCIA_RS ? 'queda' : 'neutra'
  const t = `T:${tipo}|D:${dir}`
  const s = `S:${setor ?? 'INDEFINIDO'}`
  const chaves: string[] = []
  if (item?.produto) {
    if (item.fornecedor) chaves.push(`${t}|${s}|P:${item.produto}|F:${item.fornecedor}`)
    chaves.push(`${t}|${s}|P:${item.produto}`)
  }
  if (vendedor) chaves.push(`${t}|V:${vendedor}`)
  chaves.push(`${t}|${s}`, t, `T:${tipo}`)
  return chaves
}

/**
 * Compara antes × depois de uma venda. Devolve null quando não há o que reportar:
 * venda que nunca foi Fechada, venda nova no fluxo normal, só arredondamento, ou venda
 * que saiu da janela porque o tempo passou.
 */
export function detectar(antes: Foto | null, depois: Foto | null, ctx: Contexto): Deteccao | null {
  // Sumiu da janela: ou a data mudou para fora dela (a venda ainda está no banco), ou saiu do banco.
  if (antes && !depois) {
    if (antes.data_venda < ctx.inicioJanela) return null
    if (ctx.paradeiro?.foto) {
      return detectar(antes, ctx.paradeiro.foto, { ...ctx, indice: ctx.indice ?? ctx.paradeiro.indice, paradeiro: undefined })
    }
  }

  const fechAntes = antes?.situacao === 'Fechada'
  const fechDepois = depois?.situacao === 'Fechada'
  if (!fechAntes && !fechDepois) return null

  const ref = (depois ?? antes) as Foto
  const receitaAntes = fechAntes ? antes!.receita : 0
  const receitaDepois = fechDepois ? depois!.receita : 0
  const valorAntes = fechAntes ? antes!.valor : 0
  const valorDepois = fechDepois ? depois!.valor : 0

  const det: Deteccao = {
    venda_numero: ref.venda_numero,
    tipo: 'AJUSTE_RECEITA',
    data_venda: depois?.data_venda ?? null,
    data_venda_antes: antes?.data_venda ?? null,
    situacao: depois?.situacao ?? null,
    situacao_antes: antes?.situacao ?? null,
    vendedor: ref.vendedor,
    vendedor_antes: antes?.vendedor ?? null,
    setor_grupo: ref.setor_grupo,
    setor_grupo_antes: antes?.setor_grupo ?? null,
    setor_bruto: ref.setor_bruto,
    pagante: ref.pagante,
    receita_antes: round2(receitaAntes),
    receita_depois: round2(receitaDepois),
    delta_receita: round2(receitaDepois - receitaAntes),
    valor_antes: round2(valorAntes),
    valor_depois: round2(valorDepois),
    delta_valor: round2(valorDepois - valorAntes),
    produtos: [],
    fatos: [],
    evidencias: [],
    sinais: {},
    chaves: [],
  }

  const dataRef = ref.data_venda
  const idade = diasEntre(dataRef, ctx.hoje)
  let deltaChave = det.delta_receita

  if (antes && !depois) {
    // ── Saiu do banco ──
    const p = ctx.paradeiro
    const ativas = p?.indice?.linhas_ativas ?? null
    if (p?.manual) det.tipo = 'CANCELAMENTO_MANUAL'
    else if (p && !p.indice) det.tipo = 'VENDA_EXCLUIDA'
    else if (p?.indice?.status === 'canceled') det.tipo = 'VENDA_CANCELADA'
    else if (ativas === 0) det.tipo = 'PRODUTOS_CANCELADOS'
    else det.tipo = 'DIVERGENCIA_SYNC'

    const cancelamento = TIPOS_CANCELAMENTO.has(det.tipo)
    det.produtos = antes.linhas.map((l) => ({
      produto: l.produto, fornecedor: l.fornecedor, mudanca: cancelamento ? 'cancelado' : 'saiu',
      valor_antes: l.valor, valor_depois: 0, receita_antes: l.receita, receita_depois: 0,
    }))
    const n = antes.linhas.length
    const prods = `${n} produto${n > 1 ? 's' : ''} (${brl(antes.valor)} de valor) ${n > 1 ? 'saíram' : 'saiu'}`
    switch (det.tipo) {
      case 'CANCELAMENTO_MANUAL':
        det.fatos.push(`Venda marcada como cancelada na lista de cancelamentos manuais do dashboard${p?.manual?.motivo ? ` ("${p.manual.motivo}")` : ''}: ${prods} do relatório de Fechadas, com ${brl(antes.receita)} de receita.`)
        break
      case 'VENDA_EXCLUIDA':
        det.fatos.push(`A venda não existe mais no Monde (excluída): ${prods} do relatório de Fechadas, com ${brl(antes.receita)} de receita.`)
        break
      case 'VENDA_CANCELADA':
        det.fatos.push(`Venda cancelada no Monde: ${prods} do relatório de Fechadas, com ${brl(antes.receita)} de receita.`)
        break
      case 'PRODUTOS_CANCELADOS':
        det.fatos.push(`Todos os produtos da venda foram cancelados no Monde (a venda segue ${p?.indice?.status === 'opened' ? 'aberta' : 'fechada'} lá, sem produto ativo): ${prods} do relatório, com ${brl(antes.receita)} de receita.`)
        break
      default:
        det.fatos.push(`A venda sumiu do banco, mas o Monde ainda a mostra ${p?.indice?.status === 'opened' ? 'aberta' : 'fechada'}${ativas ? ` com ${ativas} produto${ativas > 1 ? 's' : ''} ativo${ativas > 1 ? 's' : ''}` : ''}. Provável falha do sync, não alteração no Monde: a próxima releitura deve recolocá-la (${brl(antes.receita)} de receita fora do relatório enquanto isso).`)
    }
    if (ctx.parecida) {
      det.sinais.parecida = true
      det.evidencias.push(`Apareceu na mesma conferência a venda nº ${ctx.parecida}, do mesmo cliente e vendedor e com valor parecido — sinal de cancelamento para relançamento.`)
    }
  } else if (!antes && depois) {
    // ── Venda que a conferência anterior não tinha ──
    if (!fechDepois) return null
    // Já saiu do relatório antes (falha do sync, cancelamento) e voltou: registra a volta,
    // senão a saída fica no relatório sem contrapartida.
    const saida = (ctx.historico ?? [])[0]
    const voltou = !!saida && (saida.tipo === 'DIVERGENCIA_SYNC' || TIPOS_CANCELAMENTO.has(saida.tipo as Tipo)) && saida.receita_depois === 0
    if (!voltou && idade <= DIAS_TOLERANCIA) return null
    det.produtos = depois.linhas.map((l) => ({
      produto: l.produto, fornecedor: l.fornecedor, mudanca: 'incluido',
      valor_antes: 0, valor_depois: l.valor, receita_antes: 0, receita_depois: l.receita,
    }))
    if (voltou && saida.tipo === 'DIVERGENCIA_SYNC') {
      det.tipo = 'DIVERGENCIA_SYNC'
      det.fatos.push(`A venda voltou ao banco depois da falha do sync registrada em ${dataBR(saida.detectado_em)}: ${brl(depois.receita)} de receita de volta ao relatório` +
        (Math.abs(depois.receita - saida.receita_antes) >= TOLERANCIA_RS ? ` (antes da falha eram ${brl(saida.receita_antes)}).` : ', a mesma de antes da falha.'))
    } else if (voltou) {
      det.tipo = 'VENDA_REATIVADA'
      det.fatos.push(`Venda registrada como "${TIPO_LABEL[saida.tipo as Tipo] ?? saida.tipo}" em ${dataBR(saida.detectado_em)} voltou ao relatório de Fechadas com ${brl(depois.receita)} de receita` +
        (Math.abs(depois.receita - saida.receita_antes) >= TOLERANCIA_RS ? ` (antes de sair eram ${brl(saida.receita_antes)}).` : ', a mesma de antes.'))
    } else {
      det.tipo = 'LANCAMENTO_RETROATIVO'
      det.fatos.push(`Venda que não constava na conferência anterior apareceu já Fechada, com data de ${dataBR(depois.data_venda)} (${idade} dias atrás): acrescentou ${brl(depois.receita)} de receita a ${mesBR(depois.data_venda)}.`)
    }
    if (ctx.parecida && !voltou) {
      det.sinais.parecida = true
      det.evidencias.push(`Na mesma conferência saiu do relatório a venda nº ${ctx.parecida}, do mesmo cliente e vendedor e com valor parecido — sinal de venda relançada.`)
    }
  } else if (antes && depois) {
    det.produtos = casarLinhas(antes.linhas, depois.linhas)
    const mudouData = antes.data_venda !== depois.data_venda
    const mudouVendedor = (antes.vendedor ?? '') !== (depois.vendedor ?? '')
    const mudouSetor = (antes.setor_grupo ?? '') !== (depois.setor_grupo ?? '') ||
      (antes.setor_bruto ?? '') !== (depois.setor_bruto ?? '')
    const historico = ctx.historico ?? []

    if (fechAntes && !fechDepois) {
      det.tipo = 'VENDA_REABERTA'
      det.fatos.push(`Venda voltou de Fechada para Aberta no Monde: ${brl(antes.receita)} de receita saem do relatório de Fechadas até ela ser fechada de novo.`)
      if (Math.abs(depois.receita - antes.receita) >= TOLERANCIA_RS) {
        det.fatos.push(`Na reabertura a receita da venda já ${frase(antes.receita, depois.receita)}.`)
      }
    } else if (!fechAntes && fechDepois) {
      const reabertura = historico.find((h) => h.tipo === 'VENDA_REABERTA' || h.tipo === 'VENDA_REFECHADA')
      if (reabertura?.tipo === 'VENDA_REABERTA') {
        det.tipo = 'VENDA_REFECHADA'
        const antesDaReabertura = reabertura.receita_antes
        deltaChave = round2(depois.receita - antesDaReabertura)
        det.fatos.push(`Venda reaberta em ${dataBR(reabertura.detectado_em)} foi fechada de novo e voltou ao relatório com ${brl(depois.receita)} de receita` +
          (Math.abs(deltaChave) >= TOLERANCIA_RS
            ? ` — antes da reabertura eram ${brl(antesDaReabertura)} (${brlSinal(deltaChave)}).`
            : ', a mesma de antes da reabertura.'))
      } else {
        if (idade <= DIAS_TOLERANCIA) return null
        det.tipo = 'FECHAMENTO_TARDIO'
        det.fatos.push(`Venda de ${dataBR(depois.data_venda)} estava Aberta e só foi fechada agora, ${idade} dias depois: entrou no relatório de Fechadas de ${mesBR(depois.data_venda)} com ${brl(depois.receita)} de receita.`)
      }
    } else {
      // ── Fechada antes e depois: o que mudou dentro da venda ──
      const canc = det.produtos.filter((l) => l.mudanca === 'cancelado')
      const inc = det.produtos.filter((l) => l.mudanca === 'incluido')
      const alt = det.produtos.filter((l) => l.mudanca === 'alterado')
      const recl = det.produtos.filter((l) => l.mudanca === 'reclassificado')
      const dRec = det.delta_receita
      const dVal = det.delta_valor
      const receitaMudou = Math.abs(dRec) >= TOLERANCIA_RS

      if (mudouData) det.tipo = 'MUDANCA_DATA'
      else if (canc.length && inc.length) det.tipo = 'TROCA_PRODUTO'
      else if (canc.length) det.tipo = 'PRODUTO_CANCELADO'
      else if (inc.length) det.tipo = 'PRODUTO_INCLUIDO'
      else if (alt.length) det.tipo = 'ALTERACAO_VALOR'
      else if (receitaMudou) det.tipo = 'AJUSTE_RECEITA'
      else if (mudouSetor) det.tipo = 'MUDANCA_SETOR'
      else if (mudouVendedor) det.tipo = 'MUDANCA_VENDEDOR'
      else if (recl.length) det.tipo = 'RECLASSIFICACAO_PRODUTO'
      else return null // só o pagante mudou, ou centavos de rateio

      const receitaTxt = receitaMudou
        ? `A receita da venda ${frase(antes.receita, depois.receita)}.`
        : `A receita total da venda não mudou (${brl(depois.receita)}).`

      switch (det.tipo) {
        case 'MUDANCA_DATA': {
          const fora = depois.data_venda < ctx.inicioJanela
          det.fatos.push(`Data da venda alterada de ${dataBR(antes.data_venda)} para ${dataBR(depois.data_venda)}` +
            (mesBR(antes.data_venda) !== mesBR(depois.data_venda)
              ? `: a receita (${brl(depois.receita)}) passou de ${mesBR(antes.data_venda)} para ${mesBR(depois.data_venda)}`
              : '') +
            (fora ? ' — a nova data fica fora da janela de conferência' : '') + '.')
          if (receitaMudou) det.fatos.push(`Além disso, a receita ${frase(antes.receita, depois.receita)}.`)
          break
        }
        case 'TROCA_PRODUTO':
          det.fatos.push(`Produtos trocados depois do fechamento — saiu: ${listarLinhas(canc, 'valor_antes')}; entrou: ${listarLinhas(inc, 'valor_depois')}. ${receitaTxt}`)
          break
        case 'PRODUTO_CANCELADO':
          det.fatos.push(`${canc.length > 1 ? `${canc.length} produtos cancelados ou excluídos` : 'Produto cancelado ou excluído'} da venda: ${listarLinhas(canc, 'valor_antes')}.`)
          det.fatos.push(receitaMudou
            ? receitaTxt
            : `${receitaTxt} A parte ${canc.length > 1 ? 'desses produtos' : 'desse produto'} foi redistribuída entre os itens que ficaram — o dash rateia a receita da venda pelo valor de cada produto.`)
          break
        case 'PRODUTO_INCLUIDO':
          det.fatos.push(`${inc.length > 1 ? `${inc.length} produtos incluídos` : 'Produto incluído'} na venda depois do fechamento: ${listarLinhas(inc, 'valor_depois')}. ${receitaTxt}`)
          break
        case 'ALTERACAO_VALOR': {
          const itens = [...alt].sort((a, b) => Math.abs(b.valor_depois - b.valor_antes) - Math.abs(a.valor_depois - a.valor_antes))
          const txt = itens.slice(0, 3).map((l) => `${nomeLinha(l)} de ${brl(l.valor_antes)} para ${brl(l.valor_depois)}`).join('; ')
          det.fatos.push(`Valor alterado em ${alt.length > 1 ? `${alt.length} produtos` : '1 produto'}: ${txt}${itens.length > 3 ? ` e mais ${itens.length - 3}` : ''}. ${receitaMudou ? receitaTxt : 'A receita da venda não mudou.'}`)
          break
        }
        case 'AJUSTE_RECEITA':
          det.fatos.push(`Receita alterada sem mudança de produto nem de valor: ${frase(antes.receita, depois.receita)}. Margem da venda: ${margem(antes.receita, antes.valor)} → ${margem(depois.receita, depois.valor)}.`)
          break
        case 'MUDANCA_SETOR':
          det.fatos.push(`Setor alterado de ${antes.setor_bruto ?? antes.setor_grupo ?? 'sem setor'} (${antes.setor_grupo ?? '—'}) para ${depois.setor_bruto ?? depois.setor_grupo ?? 'sem setor'} (${depois.setor_grupo ?? '—'}): a receita da venda (${brl(depois.receita)}) mudou de setor no dashboard.`)
          break
        case 'MUDANCA_VENDEDOR':
          det.fatos.push(`Vendedor trocado de ${antes.vendedor ?? '—'} para ${depois.vendedor ?? '—'}: a receita da venda (${brl(depois.receita)}) passou a contar para ${depois.vendedor ?? '—'}.`)
          break
        case 'RECLASSIFICACAO_PRODUTO': {
          const txt = recl.slice(0, 3).map((l) => `${nomeLinha({ produto: l.produto_antes ?? null, fornecedor: l.fornecedor_antes ?? null })} → ${nomeLinha(l)}`).join('; ')
          det.fatos.push(`Produto ou fornecedor renomeado sem mudar valor: ${txt}. ${receitaTxt}`)
          break
        }
      }

      det.sinais.receitaEstavel = !receitaMudou
      det.sinais.valorCaiu = dVal <= -TOLERANCIA_RS
      det.sinais.valorSubiu = dVal >= TOLERANCIA_RS
      det.sinais.zerou = antes.receita > 0 && depois.receita === 0
      det.sinais.taxa = [...canc, ...inc].some((l) => /taxa|fee|servi[cç]o/i.test(l.produto ?? ''))
      det.sinais.fornecedorTrocado = recl.some((l) => !!l.fornecedor && !!l.fornecedor_antes && l.fornecedor !== l.fornecedor_antes)
      // Produto cancelado que tinha um gêmeo idêntico que ficou na venda: lançamento em dobro.
      det.sinais.duplicidade = canc.some((c) => det.produtos.some((l) =>
        l.mudanca === 'igual' && l.produto === c.produto && l.fornecedor === c.fornecedor && Math.abs(l.valor_depois - c.valor_antes) < 0.01))
      if (det.sinais.duplicidade) {
        det.evidencias.push('O produto cancelado tinha um gêmeo idêntico na venda (mesmo produto, fornecedor e valor) que continua lá — sinal de lançamento em dobro.')
      }
    }

    if (det.tipo !== 'MUDANCA_VENDEDOR' && mudouVendedor) {
      det.fatos.push(`Também mudou o vendedor: ${antes.vendedor ?? '—'} → ${depois.vendedor ?? '—'}.`)
    }
    if (det.tipo !== 'MUDANCA_SETOR' && mudouSetor) {
      det.fatos.push(`Também mudou o setor: ${antes.setor_bruto ?? antes.setor_grupo ?? '—'} → ${depois.setor_bruto ?? depois.setor_grupo ?? '—'}.`)
    }
    if (det.tipo !== 'MUDANCA_DATA' && mudouData) {
      det.fatos.push(`Também mudou a data da venda: ${dataBR(antes.data_venda)} → ${dataBR(depois.data_venda)}.`)
    }
  } else {
    return null
  }

  // ── Contexto comum ──
  const idx = ctx.indice ?? ctx.paradeiro?.indice ?? null
  det.evidencias.push(`Venda de ${dataBR(dataRef)}, ${idade} dia${idade === 1 ? '' : 's'} antes da detecção.`)
  if (idx?.detail_at) {
    const dt = new Date(idx.detail_at)
    const quando = dt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    det.evidencias.push(`Última releitura da venda no Monde pelo sync: ${quando}.`)
  }
  if (idx?.revenue !== null && idx?.revenue !== undefined && idx.revenue < 0) {
    det.sinais.negativaMonde = true
    det.evidencias.push(`O Monde registra receita negativa nesta venda (${brl(idx.revenue)}); o dash grava zero.`)
  } else if (idx?.revenue !== null && idx?.revenue !== undefined && fechDepois && depois &&
    Math.abs(idx.revenue - depois.receita) >= TOLERANCIA_RS && idx.status !== 'canceled') {
    det.evidencias.push(`O índice do Monde já mostra receita de ${brl(idx.revenue)} — diferente do banco (${brl(depois.receita)}); o sync ainda vai reler a venda.`)
  }
  const hist = ctx.historico ?? []
  if (hist.length > 0) {
    det.sinais.recorrente = true
    const ult = hist.slice(0, 3).map((h) => `${TIPO_LABEL[h.tipo as Tipo] ?? h.tipo} em ${dataBR(h.detectado_em)}`).join('; ')
    det.evidencias.push(`${hist.length + 1}ª alteração registrada nesta venda (anteriores: ${ult}${hist.length > 3 ? '…' : ''}).`)
  }

  det.chaves = montarChaves(det.tipo, deltaChave, det.setor_grupo, det.vendedor, principal(det.produtos))
  return det
}

export const TIPO_LABEL: Record<Tipo, string> = {
  VENDA_CANCELADA: 'Venda cancelada',
  CANCELAMENTO_MANUAL: 'Cancelamento manual',
  VENDA_EXCLUIDA: 'Venda excluída',
  PRODUTOS_CANCELADOS: 'Todos os produtos cancelados',
  PRODUTO_CANCELADO: 'Produto cancelado',
  PRODUTO_INCLUIDO: 'Produto incluído',
  TROCA_PRODUTO: 'Troca de produto',
  ALTERACAO_VALOR: 'Valor alterado',
  AJUSTE_RECEITA: 'Receita ajustada',
  MUDANCA_DATA: 'Data alterada',
  MUDANCA_VENDEDOR: 'Vendedor alterado',
  MUDANCA_SETOR: 'Setor alterado',
  RECLASSIFICACAO_PRODUTO: 'Produto reclassificado',
  VENDA_REABERTA: 'Venda reaberta',
  VENDA_REFECHADA: 'Venda fechada de novo',
  FECHAMENTO_TARDIO: 'Fechamento tardio',
  LANCAMENTO_RETROATIVO: 'Lançamento retroativo',
  VENDA_REATIVADA: 'Venda reativada',
  DIVERGENCIA_SYNC: 'Divergência do sync',
}

// ─── Motivo: regra + aprendizado ──────────────────────────────────────────────

type Dist = Partial<Record<Motivo, number>>

/** Distribuição a priori do motivo, por tipo e sinais. É o ponto de partida antes de qualquer revisão. */
export function regra(det: Pick<Deteccao, 'tipo' | 'sinais' | 'delta_receita'>): Dist {
  const s = det.sinais
  const queda = det.delta_receita <= -TOLERANCIA_RS
  switch (det.tipo) {
    case 'VENDA_CANCELADA':
      return s.parecida
        ? { CORRECAO_LANCAMENTO: 0.7, CANCELAMENTO_CLIENTE: 0.15, DUPLICIDADE: 0.15 }
        : { CANCELAMENTO_CLIENTE: 0.7, CORRECAO_LANCAMENTO: 0.15, DUPLICIDADE: 0.1, OUTRO: 0.05 }
    case 'CANCELAMENTO_MANUAL':
      return { CANCELAMENTO_CLIENTE: 0.6, CORRECAO_LANCAMENTO: 0.3, OUTRO: 0.1 }
    case 'VENDA_EXCLUIDA':
      return s.parecida
        ? { CORRECAO_LANCAMENTO: 0.6, DUPLICIDADE: 0.3, CANCELAMENTO_CLIENTE: 0.1 }
        : { CORRECAO_LANCAMENTO: 0.45, DUPLICIDADE: 0.3, CANCELAMENTO_CLIENTE: 0.25 }
    case 'PRODUTOS_CANCELADOS':
      return { CANCELAMENTO_CLIENTE: 0.6, REMARCACAO_REEMISSAO: 0.2, CORRECAO_LANCAMENTO: 0.2 }
    case 'DIVERGENCIA_SYNC':
      return { FALHA_INTEGRACAO: 0.9, OUTRO: 0.1 }
    case 'PRODUTO_CANCELADO':
      if (s.duplicidade) return { DUPLICIDADE: 0.7, CANCELAMENTO_CLIENTE: 0.2, CORRECAO_LANCAMENTO: 0.1 }
      if (s.taxa) return { TAXA_FEE: 0.6, CANCELAMENTO_CLIENTE: 0.25, CORRECAO_LANCAMENTO: 0.15 }
      return { CANCELAMENTO_CLIENTE: 0.55, REMARCACAO_REEMISSAO: 0.2, DUPLICIDADE: 0.1, CORRECAO_LANCAMENTO: 0.15 }
    case 'PRODUTO_INCLUIDO':
      if (s.taxa) return { TAXA_FEE: 0.7, VENDA_COMPLEMENTAR: 0.2, CORRECAO_LANCAMENTO: 0.1 }
      return { VENDA_COMPLEMENTAR: 0.6, CORRECAO_LANCAMENTO: 0.25, TAXA_FEE: 0.15 }
    case 'TROCA_PRODUTO':
      return { REMARCACAO_REEMISSAO: 0.7, CORRECAO_LANCAMENTO: 0.2, OUTRO: 0.1 }
    case 'ALTERACAO_VALOR':
      if (s.valorCaiu) return { DESCONTO_NEGOCIACAO: 0.35, REMARCACAO_REEMISSAO: 0.25, CORRECAO_LANCAMENTO: 0.2, VARIACAO_CAMBIAL: 0.2 }
      return { REMARCACAO_REEMISSAO: 0.4, VARIACAO_CAMBIAL: 0.25, CORRECAO_LANCAMENTO: 0.2, TAXA_FEE: 0.15 }
    case 'AJUSTE_RECEITA':
      if (s.negativaMonde || s.zerou) return { CORRECAO_LANCAMENTO: 0.4, AJUSTE_COMISSAO: 0.35, DESCONTO_NEGOCIACAO: 0.25 }
      return queda
        ? { AJUSTE_COMISSAO: 0.45, DESCONTO_NEGOCIACAO: 0.25, CORRECAO_LANCAMENTO: 0.2, TAXA_FEE: 0.1 }
        : { AJUSTE_COMISSAO: 0.55, TAXA_FEE: 0.2, CORRECAO_LANCAMENTO: 0.25 }
    case 'MUDANCA_DATA':
      return { CORRECAO_LANCAMENTO: 0.8, REMARCACAO_REEMISSAO: 0.2 }
    case 'MUDANCA_VENDEDOR':
    case 'MUDANCA_SETOR':
      return { REATRIBUICAO: 0.75, CORRECAO_LANCAMENTO: 0.25 }
    case 'RECLASSIFICACAO_PRODUTO':
      return s.fornecedorTrocado
        ? { REMARCACAO_REEMISSAO: 0.45, CORRECAO_LANCAMENTO: 0.45, FALHA_INTEGRACAO: 0.1 }
        : { CORRECAO_LANCAMENTO: 0.6, FALHA_INTEGRACAO: 0.4 }
    case 'VENDA_REABERTA':
      return { CORRECAO_LANCAMENTO: 0.65, REMARCACAO_REEMISSAO: 0.2, VENDA_COMPLEMENTAR: 0.15 }
    case 'VENDA_REFECHADA':
      return { CORRECAO_LANCAMENTO: 0.6, REMARCACAO_REEMISSAO: 0.2, VENDA_COMPLEMENTAR: 0.2 }
    case 'FECHAMENTO_TARDIO':
      return { LANCAMENTO_ATRASADO: 0.85, CORRECAO_LANCAMENTO: 0.15 }
    case 'VENDA_REATIVADA':
      return { CORRECAO_LANCAMENTO: 0.6, REMARCACAO_REEMISSAO: 0.2, OUTRO: 0.2 }
    case 'LANCAMENTO_RETROATIVO':
      return s.parecida
        ? { CORRECAO_LANCAMENTO: 0.75, LANCAMENTO_ATRASADO: 0.25 }
        : { LANCAMENTO_ATRASADO: 0.75, CORRECAO_LANCAMENTO: 0.25 }
  }
}

/** Uma alteração já revisada: o voto humano para cada chave dela. */
export interface Revisao {
  venda_numero: number
  chaves: string[]
  motivo_real: string
  nota: string | null
}

interface Votos {
  total: number
  motivos: Map<string, number>
  /** Notas das revisões, da mais recente para a mais antiga. */
  exemplos: Array<{ motivo: string; nota: string; venda: number }>
}

export type Conhecimento = Map<string, Votos>

/** Recebe as revisões da mais recente para a mais antiga. */
export function montarConhecimento(revisoes: Revisao[]): Conhecimento {
  const k: Conhecimento = new Map()
  for (const r of revisoes) {
    for (const chave of r.chaves ?? []) {
      let v = k.get(chave)
      if (!v) { v = { total: 0, motivos: new Map(), exemplos: [] }; k.set(chave, v) }
      v.total++
      v.motivos.set(r.motivo_real, (v.motivos.get(r.motivo_real) ?? 0) + 1)
      if (r.nota && v.exemplos.length < 5) v.exemplos.push({ motivo: r.motivo_real, nota: r.nota, venda: r.venda_numero })
    }
  }
  return k
}

/** "T:AJUSTE_RECEITA|D:queda|S:TRIPS|P:Passagem Aérea" → "receita ajustada, queda, setor TRIPS, produto Passagem Aérea". */
export function descreverChave(chave: string): string {
  return chave.split('|').map((parte) => {
    const [k, ...resto] = parte.split(':')
    const v = resto.join(':')
    switch (k) {
      case 'T': return (TIPO_LABEL[v as Tipo] ?? v).toLowerCase()
      case 'D': return v === 'alta' ? 'receita subiu' : v === 'queda' ? 'receita caiu' : 'receita estável'
      case 'S': return `setor ${v}`
      case 'P': return `produto ${v}`
      case 'F': return `fornecedor ${v}`
      case 'V': return `vendedor ${v}`
      default: return parte
    }
  }).join(', ')
}

export interface Sugestao {
  motivo: Motivo
  confianca: number
  aprendido: boolean
  frase: string
  base: {
    chave: string | null
    descricao: string | null
    revisoes: number
    votos: Record<string, number>
    regra: Dist
  }
}

function argmax(d: Partial<Record<string, number>>): string {
  let melhor = 'OUTRO'
  let v = -1
  for (const [k, x] of Object.entries(d)) if ((x ?? 0) > v) { v = x ?? 0; melhor = k }
  return melhor
}

/**
 * Motivo = regra + revisões. Usa a chave mais específica com ≥ 2 revisões (ou, sem
 * nenhuma assim, a de produto/vendedor com 1) e combina:
 *     P(motivo) = (votos(motivo) + PESO_REGRA × regra(motivo)) / (revisões + PESO_REGRA)
 */
export function sugerirMotivo(det: Deteccao, conhecimento: Conhecimento): Sugestao {
  const r = regra(det)
  const somaRegra = Object.values(r).reduce((s, x) => s + (x ?? 0), 0) || 1
  const prior: Dist = {}
  for (const [m, x] of Object.entries(r)) prior[m as Motivo] = Math.round(((x ?? 0) / somaRegra) * 1000) / 1000

  let chave: string | null = null
  let votos: Votos | null = null
  for (const c of det.chaves) {
    const v = conhecimento.get(c)
    if (v && v.total >= 2) { chave = c; votos = v; break }
  }
  // Uma revisão só já conta no contexto específico (mesmo produto ou vendedor); num
  // contexto geral ("toda receita ajustada em queda") um caso isolado não muda a regra.
  if (!votos) {
    for (const c of det.chaves) {
      const v = conhecimento.get(c)
      if (v && v.total >= 1 && /\|[PV]:/.test(c)) { chave = c; votos = v; break }
    }
  }

  const total = votos?.total ?? 0
  const post: Record<string, number> = {}
  for (const m of MOTIVOS) {
    const p = ((votos?.motivos.get(m) ?? 0) + PESO_REGRA * (prior[m] ?? 0)) / (total + PESO_REGRA)
    if (p > 0) post[m] = p
  }
  const motivo = argmax(post) as Motivo
  const confianca = Math.round((post[motivo] ?? 0) * 100)
  const aprendido = total > 0 && (motivo !== argmax(prior) || total >= 2)

  let frase = `Motivo provável: ${MOTIVO_LABEL[motivo]} (${confianca}%)`
  if (!votos) {
    frase += ' — sugestão pela regra; ainda não há revisão de caso parecido.'
  } else {
    const iguais = votos.motivos.get(motivo) ?? 0
    frase += ` — ${total} revis${total > 1 ? 'ões' : 'ão'} de casos parecidos (${descreverChave(chave!)})` +
      (iguais > 0 ? `, ${iguais} confirmando este motivo.` : ', nenhuma com este motivo; a regra ainda prevalece.')
    const ex = votos.exemplos.find((e) => e.motivo === motivo)
    if (ex) frase += ` Ex.: venda ${ex.venda} — "${ex.nota}".`
  }

  const votosObj: Record<string, number> = {}
  for (const [m, n] of votos?.motivos ?? []) votosObj[m] = n
  return {
    motivo, confianca, aprendido, frase,
    base: { chave, descricao: chave ? descreverChave(chave) : null, revisoes: total, votos: votosObj, regra: prior },
  }
}

// ─── Relançamento: cancelada ↔ nova parecida ──────────────────────────────────

/** Mesmo cliente e vendedor, valor até 5% diferente. */
export function parecidas(a: Foto, b: Foto): boolean {
  if (!a.pagante || !b.pagante || a.pagante === 'Sem cliente') return false
  if (a.pagante !== b.pagante || (a.vendedor ?? '') !== (b.vendedor ?? '')) return false
  const maior = Math.max(Math.abs(a.valor), Math.abs(b.valor))
  return maior === 0 ? true : Math.abs(a.valor - b.valor) / maior <= 0.05
}

// ─── Totais da conferência ────────────────────────────────────────────────────

export interface TotalMes {
  receita: number
  valor: number
  vendas: number
  linhas: number
  setores: Record<string, number>
}

/** Receita das Fechadas por mês de venda (e setor) — a "foto" do relatório no dia. */
export function totaisPorMes(fotos: Iterable<Foto>): Record<string, TotalMes> {
  const out: Record<string, TotalMes> = {}
  for (const f of fotos) {
    if (f.situacao !== 'Fechada') continue
    const mes = f.data_venda.slice(0, 7)
    const t = out[mes] ?? (out[mes] = { receita: 0, valor: 0, vendas: 0, linhas: 0, setores: {} })
    t.receita = round2(t.receita + f.receita)
    t.valor = round2(t.valor + f.valor)
    t.vendas++
    t.linhas += f.linhas.length
    const s = f.setor_grupo ?? 'INDEFINIDO'
    t.setores[s] = round2((t.setores[s] ?? 0) + f.receita)
  }
  return out
}
