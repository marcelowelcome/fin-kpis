/**
 * Supabase Edge Function: monde-sync
 *
 * Sincroniza a **API oficial do Monde (v3)** → tabela `vendas`. Roda 100% no Supabase,
 * acionada pelo pg_cron (a cada 5 min) e pelo botão "Atualizar" do dashboard.
 *
 * ── Por que este arquivo foi reescrito (2026-09-28) ─────────────────────────────
 * Até aqui o sync lia a API de Dados do TTARS (monde-data), um espelho que entregava
 * feeds planos por data, com nomes já resolvidos. Ela desliga em 02/10/2026 (HTTP 410).
 * O Monde v3 direto é bem mais pobre, e o desenho abaixo existe por causa disso:
 *   • GET /sales NÃO filtra por data nem por número (period_start/end são ignorados
 *     calados). Vem inteira, da mais nova para a mais velha, 50 por página, sem total.
 *   • Venda cancelada só vem com status=opened,closed,canceled.
 *   • Produto, Setor, pagante e vendedor só existem em /sales/{id} (o UUID, não o
 *     número) — uma chamada por venda. E vêm só como {id}: o nome está em
 *     /people/{id}, /products/{id} e /custom_fields.
 *   • Limite prático de 1 chamada a cada 1,3 s; 429 = esperar e repetir.
 * 2026 tem ~6 mil vendas: abrir todas é ~2 h de chamadas. Então nada é lido "na hora":
 *
 *   1. LISTA (barata) → tabela `monde_v3_vendas`, o índice. Cada rodada lê a página 1
 *      (venda nova aparece em minutos) e avança um ciclo que desce a lista até 3 anos
 *      atrás. Mudou status/data/totais → a venda entra na fila com prioridade 0.
 *      Cancelada → sai de `vendas` na hora, sem abrir o detalhe.
 *   2. DETALHE (caro) → fila por `refresh_at`/`prioridade`: nova/alterada primeiro,
 *      depois a carga inicial de 2026, depois a revisão periódica (é ela que pega
 *      cancelamento PARCIAL, que não mexe nos totais da lista).
 *   3. NOMES → cache em `monde_v3_nomes`; cada id novo custa uma chamada, uma vez.
 *
 * Cada rodada tem orçamento de ~110 s (a função morre aos 150 s) e para de pedir antes
 * disso; o que sobrar fica na fila para a próxima.
 *
 * ── Régua de soma (inalterada, a mesma do relatório do Monde) ─────────────────────
 *   1. fora a venda com status 'canceled';
 *   2. nas que sobram, só produto com status 'active' entra (valor = totals.amount).
 *   Receita = totals.revenue da venda, rateada entre as linhas ativas pelo valor.
 *
 * ── Modos (body JSON) ─────────────────────────────────────────────────────────
 *   {}                       sync normal (cron e botão)
 *   { mode: 'probe' }        diagnóstico da chave: status HTTP de cada recurso usado.
 *   { mode: 'compare', sale_ids: [...] }  lê as vendas e devolve o que o sync gravaria.
 *   probe e compare devolvem dado de venda, então exigem a service role no Authorization
 *   (a anon key é pública, vai no bundle do dashboard).
 *
 * Secrets (Supabase → Edge Functions → Secrets):
 *   MONDE_V3_API_KEY  token Basic JÁ codificado (base64 de login:senha). Abre o Monde
 *                     inteiro, inclusive o financeiro: só aqui, nunca no front/repo/log.
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (injetados pelo Supabase).
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

// ─── Configuração ─────────────────────────────────────────────────────────────

const MONDE_BASE = 'https://web.monde.com.br/api/v3'
/** Intervalo entre chamadas ao Monde. Rajadas de 2–4/s levaram 429 nos testes; 1,3 s não. */
const GAP_MS = 1300
/** Tempo de trabalho por rodada. A função é morta aos 150 s. */
const ORCAMENTO_MS = 110_000
/** Folga mínima para começar uma venda nova (detalhe + alguns nomes). */
const FOLGA_DETALHE_MS = 12_000
/** Páginas da lista por rodada durante um ciclo (cada uma ~1,3 s). */
const LISTA_PAGINAS_POR_RODADA = 40
/** Tempo reservado ao detalhe mesmo com ciclo de lista em andamento. */
const RESERVA_DETALHE_MS = 35_000
/** Intervalo entre ciclos completos da lista (a página 1 é lida em toda rodada). */
const CICLO_LISTA_HORAS = 6
/** Até onde a lista é descida: mesmo horizonte do antigo rebuild de 3 anos. */
const LISTA_ANOS = 3
/** Janela "corrente": revisão mais frequente e carga inicial completa. */
const CUTOFF = '2026-01-01'
const LOCK_VENCIDO_MS = 4 * 60_000
const INSERT_BATCH = 500
const FILENAME_PREFIX = 'monde-api-'

const KINDS = [
  'hotels', 'airline_tickets', 'insurances', 'cruises', 'car_rentals',
  'ground_transportations', 'train_tickets', 'travel_packages', 'others',
  'operations', 'cvc_packages', 'excursions',
] as const

/** kind → rótulo de produto, quando o produto não tem {id} de catálogo. */
const KIND_PRODUTO: Record<string, string> = {
  hotels: 'Diárias de Hospedagem',
  airline_tickets: 'Passagem Aérea',
  insurances: 'Seguro Viagem',
  ground_transportations: 'Transporte Rodoviario',
  car_rentals: 'Locação de Carro',
  cruises: 'Cruzeiro',
  train_tickets: 'Trem',
  travel_packages: 'Pacote de Viagem',
}

// ─── Setor (mesma lógica de lib/setor-mapper.ts) ─────────────────────────────

const SETOR_MAP_EXATO: Record<string, string> = {
  corporativo: 'CORP', corp: 'CORP',
  lazer: 'TRIPS', trips: 'TRIPS', 'expedições': 'TRIPS', expedicoes: 'TRIPS',
  'lazer e expedições': 'TRIPS', 'lazer e expedicoes': 'TRIPS',
  weddings: 'WEDDINGS', wedme: 'WEDDINGS', 'wed me': 'WEDDINGS',
  'produção': 'WEDDINGS', producao: 'WEDDINGS',
  'planejamento-wed': 'WEDDINGS', 'planejamento wed': 'WEDDINGS',
  welcome: 'OUTROS', outros: 'OUTROS',
}

const SETOR_KEYWORDS: [string, string][] = [
  ['corporativ', 'CORP'], ['expedi', 'TRIPS'], ['lazer', 'TRIPS'], ['trips', 'TRIPS'],
  ['wedding', 'WEDDINGS'], ['wedme', 'WEDDINGS'], ['wed me', 'WEDDINGS'],
  ['producao', 'WEDDINGS'], ['produção', 'WEDDINGS'], ['planejamento', 'WEDDINGS'],
  ['welcome', 'OUTROS'],
]

function mapSetor(bruto: string | null | undefined): string {
  if (!bruto || bruto.trim() === '') return 'INDEFINIDO'
  const n = bruto.trim().toLowerCase()
  const exato = SETOR_MAP_EXATO[n]
  if (exato) return exato
  for (const [kw, grupo] of SETOR_KEYWORDS) if (n.includes(kw)) return grupo
  return 'INDEFINIDO'
}

/**
 * Remove o placeholder de data que ficou sem preencher no catálogo do Monde
 * ("W - Isabela e Erick - DDMMAA"). Datas REAIS ("- 05SEP26") são preservadas.
 */
function limparOperacao(nome: string | null | undefined): string | null {
  if (!nome) return null
  const limpo = nome.replace(/\s*-\s*DDMMAA\s*$/i, '').trim()
  return limpo || null
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function num(v: unknown): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function inicioLista(): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - LISTA_ANOS)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

/** Próxima revisão do detalhe, com ±20% de espalhamento para não empilhar a fila. */
function proximaRevisao(status: string, saleDate: string, agora = Date.now()): string {
  const dias = status === 'canceled' ? 180
    : saleDate >= CUTOFF ? (status === 'opened' ? 2 : 7)
    : 45
  const jitter = 0.8 + Math.random() * 0.4
  return new Date(agora + dias * jitter * 86_400_000).toISOString()
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ─── Cliente do Monde ─────────────────────────────────────────────────────────

class MondeErro extends Error {
  constructor(public status: number, msg: string) { super(msg) }
}

/**
 * Um cliente por rodada: guarda o instante da última chamada (espaçamento de 1,3 s) e
 * o prazo da rodada. A chave nunca entra em mensagem de erro nem em log.
 */
class Monde {
  private ultima = 0
  chamadas = 0
  constructor(private token: string, readonly prazo: number) {}

  resta(): number {
    return this.prazo - Date.now()
  }

  // deno-lint-ignore no-explicit-any
  async get(path: string, params: Record<string, string | number> = {}): Promise<any | null> {
    const url = new URL(MONDE_BASE + path)
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
    const headers = {
      // O secret JÁ é o base64 de login:senha — não codificar de novo.
      Authorization: `Basic ${this.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }

    let ultimoErro = ''
    for (let tentativa = 0; tentativa < 6; tentativa++) {
      // Trava dura: nunca passar do prazo + 20 s (a função morre aos 150 s).
      if (Date.now() > this.prazo + 20_000) throw new MondeErro(0, 'orçamento de tempo esgotado')
      const espera = this.ultima + GAP_MS - Date.now()
      if (espera > 0) await sleep(espera)
      this.ultima = Date.now()
      this.chamadas++

      let res: Response
      try {
        res = await fetch(url.toString(), { headers })
      } catch (e) {
        // Rede ou limite de saída do Edge Runtime ("Retry after Nms"), que chega como exceção.
        const msg = e instanceof Error ? e.message : String(e)
        const m = msg.match(/Retry after (\d+)\s*ms/i)
        ultimoErro = msg.slice(0, 120)
        await sleep(m ? Number(m[1]) + 500 : 2000 * (tentativa + 1))
        continue
      }

      if (res.status === 429) {
        await res.body?.cancel()
        const ra = Number(res.headers.get('retry-after'))
        ultimoErro = 'HTTP 429'
        await sleep(Number.isFinite(ra) && ra > 0 ? ra * 1000 : 3000 * (tentativa + 1))
        continue
      }
      if ([408, 500, 502, 503, 504].includes(res.status)) {
        await res.body?.cancel()
        ultimoErro = `HTTP ${res.status}`
        await sleep(1000 * Math.pow(2, tentativa))
        continue
      }
      if (res.status === 404) { await res.body?.cancel(); return null }
      if (res.status === 403) {
        await res.body?.cancel()
        throw new MondeErro(403, `Monde 403 em ${path.split('/')[1]}: recurso não liberado na chave`)
      }
      if (res.status === 401) {
        await res.body?.cancel()
        throw new MondeErro(401, 'Monde 401: chave recusada (confira o secret MONDE_V3_API_KEY)')
      }
      if (!res.ok) {
        const t = await res.text().catch(() => '')
        throw new MondeErro(res.status, `Monde ${res.status} em ${path}: ${t.slice(0, 200)}`)
      }
      return await res.json()
    }
    throw new MondeErro(0, `Monde indisponível após 6 tentativas em ${path} (${ultimoErro})`)
  }
}

/** Detalhe de um recurso: o Monde embrulha em { data: {...} }. */
// deno-lint-ignore no-explicit-any
function unwrap(body: any): any {
  if (body && typeof body === 'object' && body.data && !Array.isArray(body.data)) return body.data
  return body
}

// ─── Cache de nomes ───────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
type Sb = any

/**
 * Nomes de pessoa (pagante, vendedor, fornecedor) e de produto do catálogo. Primeiro o
 * banco, depois o Monde; o resultado — inclusive "não existe" (404) — vai para o banco,
 * para nunca pedir o mesmo id duas vezes.
 */
class Nomes {
  private mapa = new Map<string, string | null>()
  private novos: Array<{ tipo: string; id: string; nome: string | null; extra: unknown; fetched_at: string }> = []

  constructor(private sb: Sb, private monde: Monde) {}

  async carregar(tipo: string, ids: Iterable<string>): Promise<void> {
    const faltam = [...new Set(ids)].filter((id) => id && !this.mapa.has(`${tipo}:${id}`))
    for (const lote of chunk(faltam, 200)) {
      const { data } = await this.sb.from('monde_v3_nomes').select('id, nome').eq('tipo', tipo).in('id', lote)
      for (const r of data ?? []) this.mapa.set(`${tipo}:${r.id}`, r.nome ?? null)
    }
  }

  /** Quantos ids deste conjunto ainda precisam de chamada ao Monde. */
  faltando(tipo: string, ids: Iterable<string>): number {
    let n = 0
    for (const id of new Set(ids)) if (id && !this.mapa.has(`${tipo}:${id}`)) n++
    return n
  }

  async pessoa(id: string | null | undefined): Promise<string | null> {
    if (!id) return null
    const k = `person:${id}`
    if (this.mapa.has(k)) return this.mapa.get(k) ?? null
    const p = unwrap(await this.monde.get(`/people/${id}`))
    const nome = (p?.name ?? p?.legal_name ?? '').trim() || null
    this.guardar('person', id, nome, p ? { person_kind: p.person_kind ?? null } : { ausente: true })
    return nome
  }

  async produto(id: string | null | undefined): Promise<string | null> {
    if (!id) return null
    const k = `product:${id}`
    if (this.mapa.has(k)) return this.mapa.get(k) ?? null
    const p = unwrap(await this.monde.get(`/products/${id}`))
    const nome = (p?.name ?? '').trim() || null
    this.guardar('product', id, nome, p ? { kind: p.kind ?? null } : { ausente: true })
    return nome
  }

  private guardar(tipo: string, id: string, nome: string | null, extra: unknown) {
    this.mapa.set(`${tipo}:${id}`, nome)
    this.novos.push({ tipo, id, nome, extra, fetched_at: new Date().toISOString() })
  }

  async salvar(): Promise<void> {
    if (this.novos.length === 0) return
    const lote = this.novos
    this.novos = []
    await this.sb.from('monde_v3_nomes').upsert(lote, { onConflict: 'tipo,id' })
  }
}

/**
 * Id do campo personalizado "Setor". A venda traz custom_fields só como [{id, value}];
 * o nome está em /custom_fields. Relido 1x por semana. Se "Setor" não for encontrado a
 * rodada FALHA — gravar sem setor jogaria todo o faturamento em INDEFINIDO.
 */
async function idDoSetor(sb: Sb, monde: Monde): Promise<string> {
  const { data } = await sb.from('monde_v3_nomes').select('id, nome, fetched_at').eq('tipo', 'custom_field')
  const semana = Date.now() - 7 * 86_400_000
  let campos: Array<{ id: string; nome: string | null }> = data ?? []
  const velho = campos.length === 0 ||
    campos.some((c: { fetched_at?: string }) => !c.fetched_at || new Date(c.fetched_at).getTime() < semana)

  if (velho) {
    const lidos: Array<{ tipo: string; id: string; nome: string | null; extra: unknown; fetched_at: string }> = []
    for (let page = 1; page <= 20; page++) {
      const body = await monde.get('/custom_fields', { resource: 'sales', page, size: 50 })
      for (const c of body?.data ?? []) {
        lidos.push({
          tipo: 'custom_field', id: String(c.id), nome: c.name ?? null,
          extra: { kind: c.kind ?? null, active: c.active ?? null }, fetched_at: new Date().toISOString(),
        })
      }
      if (!body?.pagination?.has_next_page) break
    }
    if (lidos.length > 0) {
      await sb.from('monde_v3_nomes').upsert(lidos, { onConflict: 'tipo,id' })
      campos = lidos
    }
  }

  const setor = campos.find((c) => (c.nome ?? '').trim().toLowerCase() === 'setor')
  if (!setor) throw new Error('Campo personalizado "Setor" não encontrado em /custom_fields — sync abortado')
  return String(setor.id)
}

// ─── Venda → linhas de `vendas` ───────────────────────────────────────────────

interface VendaRow {
  venda_numero: number
  vendedor: string
  data_venda: string
  pagante: string
  produto: string | null
  fornecedor: string | null
  setor_bruto: string | null
  setor_grupo: string
  representante: string | null
  operacao: string | null
  situacao: string
  data_cancelamento: string | null
  valor_total: number
  receitas: number
  faturamento: number
}

/**
 * Rateia a receita da venda entre as linhas ativas, proporcionalmente ao valor. Se
 * todas as linhas valem 0 mas há receita (ex.: venda 72833, passagem de valor 0 com
 * comissão pura), divide igual — o rateio proporcional dividiria por zero.
 */
function ratearReceita(receita: number, valor: number, soma: number, qtd: number): number {
  if (receita === 0) return 0
  return round2(soma > 0 ? receita * valor / soma : receita / qtd)
}

// deno-lint-ignore no-explicit-any
function produtosDaVenda(d: any): Array<{ kind: string; p: any }> {
  // deno-lint-ignore no-explicit-any
  return KINDS.flatMap((k) => ((d?.[k] ?? []) as any[]).map((p) => ({ kind: k as string, p })))
}

/** Todos os ids de pessoa e produto que a venda cita, para carregar o cache de uma vez. */
// deno-lint-ignore no-explicit-any
function idsCitados(d: any): { pessoas: string[]; produtos: string[] } {
  const pessoas = [d?.seller?.id, d?.payer?.id, d?.intermediary?.id]
  const produtos = [d?.operation?.id]
  for (const { p } of produtosDaVenda(d)) {
    if (p?.status !== 'active') continue
    pessoas.push(p?.supplier?.id)
    produtos.push(p?.product?.id)
  }
  return { pessoas: pessoas.filter(Boolean), produtos: produtos.filter(Boolean) }
}

interface Construida {
  linhas: VendaRow[]
  ativas: number
  status: string
}

// deno-lint-ignore no-explicit-any
async function construirVenda(d: any, nomes: Nomes, setorId: string, manual: Set<number>, anterior: string | null): Promise<Construida> {
  const numero = Number(d.sale_number)
  const status = String(d.status ?? '')
  if (status === 'canceled' || manual.has(numero)) return { linhas: [], ativas: 0, status }

  const ativos = produtosDaVenda(d).filter(({ p }) => p?.status === 'active')
  if (ativos.length === 0) return { linhas: [], ativas: 0, status }

  // deno-lint-ignore no-explicit-any
  const setorBruto = ((d.custom_fields ?? []) as any[]).find((f) => String(f?.id) === setorId)?.value ?? null
  const vendedor = await nomes.pessoa(d.seller?.id)
  const pagante = (await nomes.pessoa(d.payer?.id)) ?? (await nomes.pessoa(d.intermediary?.id))
  const operacao = limparOperacao(await nomes.produto(d.operation?.id))

  const soma = ativos.reduce((s, { p }) => s + num(p?.totals?.amount), 0)
  const receita = Math.max(num(d.totals?.revenue), 0)

  const linhas: VendaRow[] = []
  for (const { kind, p } of ativos) {
    const valor = num(p?.totals?.amount)
    const produto = (await nomes.produto(p?.product?.id)) ?? KIND_PRODUTO[kind] ?? anterior
    linhas.push({
      venda_numero: numero,
      vendedor: vendedor ?? 'Sem vendedor',
      data_venda: String(d.sale_date),
      pagante: pagante ?? 'Sem cliente',
      produto,
      fornecedor: await nomes.pessoa(p?.supplier?.id),
      setor_bruto: setorBruto,
      setor_grupo: mapSetor(setorBruto),
      representante: null,
      operacao,
      situacao: status === 'opened' ? 'Aberta' : 'Fechada',
      data_cancelamento: null,
      valor_total: valor,
      receitas: ratearReceita(receita, valor, soma, ativos.length),
      faturamento: valor,
    })
  }
  return { linhas, ativas: ativos.length, status }
}

// ─── Escrita em `vendas` ──────────────────────────────────────────────────────

/** Registro de upload criado só na primeira escrita da rodada (rastro de toda escrita). */
class Escrita {
  uploadId = ''
  inseridas = 0
  apagadas = 0
  uploadsTocados = new Set<string>()
  constructor(private sb: Sb) {}

  private async garantirUpload() {
    if (this.uploadId) return
    const { data, error } = await this.sb.from('uploads').insert({
      nome_arquivo: `${FILENAME_PREFIX}v3-${new Date().toISOString().slice(0, 10)}`,
      total_linhas: 0, linhas_inseridas: 0, linhas_atualizadas: 0,
      // 'warning' = em andamento; a tabela só aceita success/warning/error.
      alertas_qualidade: [], status: 'warning',
    }).select('id').single()
    if (error || !data) throw new Error(`Erro ao registrar sync: ${error?.message}`)
    this.uploadId = data.id
  }

  /** Estado atual no banco dos números: soma de valor/receita e o produto já gravado. */
  async atual(numeros: number[]): Promise<Map<number, { valor: number; receita: number; produto: string | null }>> {
    const m = new Map<number, { valor: number; receita: number; produto: string | null }>()
    for (const lote of chunk(numeros, 150)) {
      const { data } = await this.sb.from('vendas')
        .select('venda_numero, upload_id, produto, valor_total, receitas').in('venda_numero', lote)
      for (const r of data ?? []) {
        if (r.upload_id) this.uploadsTocados.add(r.upload_id)
        const cur = m.get(r.venda_numero) ?? { valor: 0, receita: 0, produto: null }
        cur.valor += num(r.valor_total)
        cur.receita += num(r.receitas)
        cur.produto = cur.produto ?? r.produto ?? null
        m.set(r.venda_numero, cur)
      }
    }
    return m
  }

  /** Apaga e reinsere os números no mesmo passo: idempotente. */
  async regravar(numeros: number[], linhas: VendaRow[]): Promise<void> {
    if (numeros.length === 0) return
    await this.garantirUpload()
    for (const lote of chunk(numeros, 150)) {
      const { error } = await this.sb.from('vendas').delete().in('venda_numero', lote)
      if (error) throw new Error(`Erro ao apagar vendas: ${error.message}`)
    }
    this.apagadas += numeros.length
    const novas = linhas.map((l) => ({ ...l, upload_id: this.uploadId }))
    for (const lote of chunk(novas, INSERT_BATCH)) {
      const { error } = await this.sb.from('vendas').insert(lote)
      if (error) throw new Error(`Erro ao inserir vendas: ${error.message}`)
    }
    this.inseridas += novas.length
  }

  async fechar(status: 'success' | 'error'): Promise<void> {
    if (!this.uploadId) return
    await this.sb.from('uploads').update({
      status, total_linhas: this.inseridas, linhas_inseridas: this.inseridas, linhas_atualizadas: this.apagadas,
    }).eq('id', this.uploadId)
    if (status === 'success') await this.limparOrfaos()
  }

  private async limparOrfaos(): Promise<void> {
    const candidatos = [...this.uploadsTocados].filter((id) => id !== this.uploadId)
    if (candidatos.length === 0) return
    const emUso = new Set<string>()
    for (const lote of chunk(candidatos, 100)) {
      const { data } = await this.sb.from('vendas').select('upload_id').in('upload_id', lote).limit(10000)
      for (const r of data ?? []) if (r.upload_id) emUso.add(r.upload_id)
    }
    const orfaos = candidatos.filter((id) => !emUso.has(id))
    for (const lote of chunk(orfaos, 100)) await this.sb.from('uploads').delete().in('id', lote)
  }
}

// ─── Fase 1: lista → índice ───────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
function hashLista(r: any): string {
  const t = r?.totals ?? {}
  return JSON.stringify([
    r?.status ?? null, r?.sale_date ?? null,
    t.products ?? null, t.fees ?? null, t.discount ?? null, t.revenue ?? null, t.balance ?? null, t.final_amount ?? null,
  ])
}

interface ResumoLista {
  paginas: number
  novas: number
  alteradas: number
  canceladas: number
  ciclo: string
}

/**
 * Grava uma página da lista no índice. Decide o que vai para a fila de detalhe:
 *   nova e já no banco (veio do TTARS) → carga inicial (prioridade 1) se for de 2026,
 *                                         senão só revisão periódica espalhada;
 *   nova e fora do banco                → prioridade 0 (venda nova);
 *   status/data/totais mudaram          → prioridade 0;
 *   cancelada (nova ou mudou)           → sai de `vendas` já, sem abrir o detalhe.
 */
// deno-lint-ignore no-explicit-any
async function gravarPaginaLista(sb: Sb, rows: any[], piso: string, escrita: Escrita, manual: Set<number>, r: ResumoLista): Promise<void> {
  const vis = rows.filter((x) => x?.id && x?.sale_date && x.sale_date >= piso)
  if (vis.length === 0) return
  const agora = new Date().toISOString()

  const ids = vis.map((x) => x.id as string)
  const { data: exist } = await sb.from('monde_v3_vendas').select('sale_id, list_hash').in('sale_id', ids)
  const hashAntigo = new Map<string, string | null>((exist ?? []).map((e: { sale_id: string; list_hash: string | null }) => [e.sale_id, e.list_hash]))

  const novosNums = vis.filter((x) => !hashAntigo.has(x.id)).map((x) => Number(x.sale_number))
  const noBanco = new Set<number>()
  for (const lote of chunk(novosNums, 150)) {
    const { data } = await sb.from('vendas').select('venda_numero').in('venda_numero', lote)
    for (const v of data ?? []) noBanco.add(v.venda_numero)
  }

  const gravar: Record<string, unknown>[] = []
  const soVisto: string[] = []
  const cancelar: number[] = []

  for (const x of vis) {
    const numero = Number(x.sale_number)
    const status = String(x.status ?? '')
    const hash = hashLista(x)
    const base = {
      sale_id: x.id, sale_number: numero, sale_date: x.sale_date, status,
      final_amount: x.totals?.final_amount ?? null, revenue: x.totals?.revenue ?? null,
      balance: x.totals?.balance ?? null, list_hash: hash, listed_at: agora, updated_at: agora,
    }
    const novo = !hashAntigo.has(x.id)
    if (!novo && hashAntigo.get(x.id) === hash) { soVisto.push(x.id); continue }

    if (status === 'canceled' || manual.has(numero)) {
      r.canceladas++
      cancelar.push(numero)
      gravar.push({ ...base, prioridade: 2, linhas_ativas: 0, detail_at: agora, refresh_at: proximaRevisao('canceled', x.sale_date) })
    } else if (novo && noBanco.has(numero)) {
      r.novas++
      gravar.push(x.sale_date >= CUTOFF
        ? { ...base, prioridade: 1, refresh_at: agora }
        : { ...base, prioridade: 2, refresh_at: new Date(Date.now() + Math.random() * 45 * 86_400_000).toISOString() })
    } else {
      if (novo) r.novas++; else r.alteradas++
      gravar.push({ ...base, prioridade: 0, refresh_at: agora })
    }
  }

  if (cancelar.length) {
    await escrita.atual(cancelar)
    await escrita.regravar(cancelar, [])
  }
  if (gravar.length) {
    const { error } = await sb.from('monde_v3_vendas').upsert(gravar, { onConflict: 'sale_id' })
    if (error) throw new Error(`Erro ao gravar índice: ${error.message}`)
  }
  if (soVisto.length) {
    await sb.from('monde_v3_vendas').update({ listed_at: agora }).in('sale_id', soVisto)
  }
}

async function faseLista(sb: Sb, monde: Monde, escrita: Escrita, manual: Set<number>): Promise<ResumoLista> {
  const r: ResumoLista = { paginas: 0, novas: 0, alteradas: 0, canceladas: 0, ciclo: 'topo' }
  const piso = inicioLista()
  const { data: st } = await sb.from('sync_state').select('cursor_page, running, last_done_at').eq('key', 'v3-lista').maybeSingle()
  let emCiclo = !!st?.running
  let cursor = Number(st?.cursor_page ?? 1)
  const ultimoFim = st?.last_done_at ? new Date(st.last_done_at).getTime() : 0
  if (!emCiclo && Date.now() - ultimoFim >= CICLO_LISTA_HORAS * 3_600_000) { emCiclo = true; cursor = 1 }

  const lerPagina = async (page: number) => {
    const body = await monde.get('/sales', { page, size: 50, status: 'opened,closed,canceled' })
    r.paginas++
    // deno-lint-ignore no-explicit-any
    const rows: any[] = body?.data ?? []
    await gravarPaginaLista(sb, rows, piso, escrita, manual, r)
    const fim = !body?.pagination?.has_next_page || rows.length === 0 ||
      rows.every((x) => !x?.sale_date || x.sale_date < piso)
    return fim
  }

  // Página 1 sempre: venda recém-criada aparece na próxima rodada, com ciclo ou sem.
  if (!emCiclo || cursor > 1) await lerPagina(1)

  if (emCiclo) {
    r.ciclo = `página ${cursor}`
    let lidas = 0
    let terminou = false
    while (lidas < LISTA_PAGINAS_POR_RODADA && monde.resta() > RESERVA_DETALHE_MS) {
      terminou = await lerPagina(cursor)
      lidas++
      if (terminou) break
      cursor++
    }
    const agora = new Date().toISOString()
    if (terminou) {
      r.ciclo = `ciclo completo na página ${cursor}`
      await sb.from('sync_state').update({ running: false, cursor_page: 1, last_done_at: agora, updated_at: agora, note: r.ciclo }).eq('key', 'v3-lista')
    } else {
      r.ciclo = `ciclo na página ${cursor}`
      await sb.from('sync_state').update({ running: true, cursor_page: cursor, updated_at: agora, note: r.ciclo }).eq('key', 'v3-lista')
    }
  }
  return r
}

// ─── Fase 2: fila de detalhe ──────────────────────────────────────────────────

interface ResumoDetalhe {
  vendas: number
  semLinhaAtiva: number
  removidas: number
  erros: string[]
}

async function faseDetalhe(sb: Sb, monde: Monde, escrita: Escrita, manual: Set<number>, setorId: string): Promise<ResumoDetalhe> {
  const r: ResumoDetalhe = { vendas: 0, semLinhaAtiva: 0, removidas: 0, erros: [] }
  const nomes = new Nomes(sb, monde)
  let parar = false

  while (!parar && monde.resta() > FOLGA_DETALHE_MS) {
    const { data: fila } = await sb.from('monde_v3_vendas')
      .select('sale_id, sale_number, prioridade, diff_valor')
      .lte('refresh_at', new Date().toISOString())
      .order('prioridade', { ascending: true })
      .order('sale_date', { ascending: false })
      .limit(10)
    if (!fila || fila.length === 0) break

    for (const item of fila) {
      if (monde.resta() <= FOLGA_DETALHE_MS) { parar = true; break }
      const agora = new Date().toISOString()
      try {
        const d = unwrap(await monde.get(`/sales/${item.sale_id}`))
        const numero = Number(item.sale_number)

        if (!d || !d.sale_number) {
          // 404: a venda não existe mais no Monde. Sai do banco e do índice.
          await escrita.atual([numero])
          await escrita.regravar([numero], [])
          await sb.from('monde_v3_vendas').delete().eq('sale_id', item.sale_id)
          r.removidas++
          continue
        }

        const ids = idsCitados(d)
        await nomes.carregar('person', ids.pessoas)
        await nomes.carregar('product', ids.produtos)
        // Não começa uma venda cujos nomes não cabem no tempo que resta: ela ficaria pela metade.
        const custo = nomes.faltando('person', ids.pessoas) + nomes.faltando('product', ids.produtos)
        if (monde.resta() < (custo + 1) * GAP_MS + 3000) { parar = true; break }

        const antes = (await escrita.atual([numero])).get(numero)
        const c = await construirVenda(d, nomes, setorId, manual, antes?.produto ?? null)
        await escrita.regravar([numero], c.linhas)
        await nomes.salvar()

        const valor = c.linhas.reduce((s, l) => s + l.valor_total, 0)
        const receita = c.linhas.reduce((s, l) => s + l.receitas, 0)
        const upd: Record<string, unknown> = {
          status: c.status, sale_date: d.sale_date,
          final_amount: d.totals?.final_amount ?? null, revenue: d.totals?.revenue ?? null,
          balance: d.totals?.balance ?? null,
          detail_at: agora, linhas_ativas: c.ativas, prioridade: 2, erro: null,
          refresh_at: proximaRevisao(c.status, String(d.sale_date)), updated_at: agora,
        }
        // Auditoria da troca TTARS → v3: primeira leitura de uma venda que já estava no banco.
        if (item.prioridade === 1 && item.diff_valor === null) {
          upd.diff_valor = round2(valor - (antes?.valor ?? 0))
          upd.diff_receita = round2(receita - (antes?.receita ?? 0))
        }
        await sb.from('monde_v3_vendas').update(upd).eq('sale_id', item.sale_id)
        r.vendas++
        if (c.ativas === 0 && c.status !== 'canceled') r.semLinhaAtiva++
      } catch (e) {
        // 401/403 e prazo esgotado param a rodada; o resto marca a venda e segue.
        if (e instanceof MondeErro && (e.status === 401 || e.status === 403 || e.status === 0)) throw e
        const msg = e instanceof Error ? e.message : String(e)
        r.erros.push(`${item.sale_number}: ${msg.slice(0, 160)}`)
        await sb.from('monde_v3_vendas').update({
          erro: msg.slice(0, 500), refresh_at: new Date(Date.now() + 3_600_000).toISOString(), updated_at: agora,
        }).eq('sale_id', item.sale_id)
      }
    }
  }
  await nomes.salvar()
  return r
}

// ─── Diagnóstico (service role) ───────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
function datasDoProduto(kind: string, p: any): { inicio: string | null; fim: string | null } {
  if (kind === 'airline_tickets') {
    // deno-lint-ignore no-explicit-any
    const segs = ((p?.segments ?? []) as any[]).map((s) => s?.departure_date).filter(Boolean).sort()
    return { inicio: segs[0] ?? null, fim: segs[segs.length - 1] ?? null }
  }
  return {
    inicio: p?.check_in ?? p?.begin_date ?? p?.pickup_date ?? p?.departure_date ?? null,
    fim: p?.check_out ?? p?.end_date ?? p?.dropoff_date ?? p?.arrival_date ?? null,
  }
}

async function modoCompare(sb: Sb, monde: Monde, saleIds: string[]): Promise<unknown[]> {
  const setorId = await idDoSetor(sb, monde)
  const nomes = new Nomes(sb, monde)
  const out: unknown[] = []
  for (const id of saleIds.slice(0, 5)) {
    const d = unwrap(await monde.get(`/sales/${id}`))
    if (!d) { out.push({ sale_id: id, erro: '404' }); continue }
    const c = await construirVenda(d, nomes, setorId, new Set(), null)
    out.push({
      sale_id: id,
      sale_number: Number(d.sale_number),
      sale_date: d.sale_date,
      created_at: d.created_at ?? null,
      departure_date: d.departure_date ?? null,
      return_date: d.return_date ?? null,
      status: d.status,
      valor: num(d.totals?.final_amount),
      receita: num(d.totals?.revenue),
      em_aberto: num(d.totals?.balance),
      pago: round2(num(d.totals?.final_amount) - num(d.totals?.balance)),
      vendedor: c.linhas[0]?.vendedor ?? null,
      pagante: c.linhas[0]?.pagante ?? null,
      setor: c.linhas[0]?.setor_bruto ?? null,
      operacao: c.linhas[0]?.operacao ?? null,
      produtos: produtosDaVenda(d).map(({ kind, p }) => ({
        kind, status: p?.status, valor: num(p?.totals?.amount),
        ...datasDoProduto(kind, p),
        // deno-lint-ignore no-explicit-any
        passageiros: ((p?.passengers ?? []) as any[]).map((x) => x?.person?.id).filter(Boolean),
      })),
      linhas_gravadas: c.linhas.map((l) => ({ produto: l.produto, fornecedor: l.fornecedor, valor: l.valor_total, receita: l.receitas })),
    })
  }
  await nomes.salvar()
  return out
}

async function modoProbe(monde: Monde): Promise<unknown> {
  const teste = async (nome: string, path: string, params: Record<string, string | number> = {}) => {
    try {
      const b = await monde.get(path, params)
      return { nome, ok: b !== null, status: b === null ? 404 : 200, chaves: b ? Object.keys(unwrap(b) ?? {}).slice(0, 40) : [] }
    } catch (e) {
      return { nome, ok: false, status: e instanceof MondeErro ? e.status : -1, erro: e instanceof Error ? e.message : String(e) }
    }
  }
  const lista = await monde.get('/sales', { page: 1, size: 1, status: 'opened,closed,canceled' })
  const v = lista?.data?.[0]
  const res: unknown[] = [{ nome: 'sales', ok: !!v, paginacao: lista?.pagination ?? null, chaves: v ? Object.keys(v) : [] }]
  if (v?.id) {
    const d = unwrap(await monde.get(`/sales/${v.id}`))
    res.push({ nome: 'sales/{id}', ok: !!d, chaves: d ? Object.keys(d) : [] })
    if (d?.seller?.id) res.push(await teste('people/{seller}', `/people/${d.seller.id}`))
    if (d?.seller?.id) res.push(await teste('sellers/{seller}', `/sellers/${d.seller.id}`))
    if (d?.payer?.id) res.push(await teste('people/{payer}', `/people/${d.payer.id}`))
    if (d?.operation?.id) res.push(await teste('products/{operation}', `/products/${d.operation.id}`))
  }
  res.push(await teste('custom_fields', '/custom_fields', { resource: 'sales', page: 1, size: 50 }))
  res.push(await teste('products', '/products', { page: 1, size: 1 }))
  return res
}

/**
 * O gateway (verify_jwt) já validou a assinatura do JWT; aqui só se confere o papel.
 * Comparar com a string de SUPABASE_SERVICE_ROLE_KEY falha quando o projeto tem mais
 * de uma chave de service role válida.
 */
function ehServiceRole(req: Request): boolean {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const parte = token.split('.')[1]
  if (!parte) return false
  try {
    const payload = JSON.parse(atob(parte.replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'service_role'
  } catch {
    return false
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const token = Deno.env.get('MONDE_V3_API_KEY')
  if (!token) return json({ ok: false, error: 'MONDE_V3_API_KEY não configurado' }, 500)
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', serviceKey)

  const startedAt = new Date().toISOString()
  const body = await req.json().catch(() => ({}))
  const monde = new Monde(token, Date.now() + ORCAMENTO_MS)

  if (body?.mode === 'probe' || body?.mode === 'compare') {
    if (!ehServiceRole(req)) {
      return json({ ok: false, error: 'modo restrito à service role' }, 403)
    }
    try {
      const resultado = body.mode === 'probe'
        ? await modoProbe(monde)
        : await modoCompare(sb, monde, Array.isArray(body.sale_ids) ? body.sale_ids.map(String) : [])
      return json({ ok: true, mode: body.mode, chamadasMonde: monde.chamadas, resultado })
    } catch (e) {
      return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500)
    }
  }

  // Trava atômica: só pega quem acha a linha livre (ou com trava vencida).
  const vencida = new Date(Date.now() - LOCK_VENCIDO_MS).toISOString()
  const { data: trava } = await sb.from('sync_state')
    .update({ running: true, updated_at: startedAt })
    .eq('key', 'v3-lock')
    .or(`running.eq.false,updated_at.lt.${vencida}`)
    .select('key')
  if (!trava || trava.length === 0) {
    return json({ ok: true, startedAt, emAndamento: true, salesInserted: 0, pending: 0, nota: 'outra rodada em andamento' })
  }

  const escrita = new Escrita(sb)
  try {
    const { data: cancRows } = await sb.from('vendas_canceladas').select('venda_numero')
    const manual = new Set<number>((cancRows ?? []).map((r: { venda_numero: number }) => r.venda_numero))

    const setorId = await idDoSetor(sb, monde)
    const lista = await faseLista(sb, monde, escrita, manual)
    const detalhe = await faseDetalhe(sb, monde, escrita, manual, setorId)
    await escrita.fechar('success')

    const agora = new Date().toISOString()
    const [{ count: pendentes }, { count: cargaInicial }] = await Promise.all([
      sb.from('monde_v3_vendas').select('*', { count: 'exact', head: true }).eq('prioridade', 0).lte('refresh_at', agora),
      sb.from('monde_v3_vendas').select('*', { count: 'exact', head: true }).eq('prioridade', 1),
    ])

    return json({
      ok: true, startedAt, finishedAt: agora, chamadasMonde: monde.chamadas,
      lista, detalhe,
      salesInserted: escrita.inseridas, salesDeleted: escrita.apagadas,
      // `pending` é o que o botão mostra: só venda nova/alterada ainda não aberta.
      pending: pendentes ?? 0, cargaInicial: cargaInicial ?? 0,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[monde-sync] ERRO:', msg)
    await escrita.fechar('error').catch(() => {})
    return json({ ok: false, startedAt, error: msg, salesInserted: escrita.inseridas, salesDeleted: escrita.apagadas }, 500)
  } finally {
    await sb.from('sync_state').update({ running: false, updated_at: new Date().toISOString() }).eq('key', 'v3-lock')
  }
})
