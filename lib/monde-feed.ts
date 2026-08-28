/**
 * Leitura da **API de Dados do Monde** por FEEDS PLANOS (`sales` + `products`).
 *
 * Substitui o modelo antigo "lista + detalhe (`raw`) por venda" de lib/monde-client.ts.
 * Motivo: praticamente todo bug de sync de 2026 nasceu de ler o bloco `raw`, que o
 * Monde reescreve sem avisar —
 *   - 2026-08-13: `totals.final_value` → `final_amount`  → valor_total = 0
 *   - 2026-08-13: `custom_fields` perdeu `name`          → setor_bruto = null
 *   - 2026-08-13: `travel_agent` sumiu do raw            → "Sem vendedor"
 *   - 2026-08-05: `product_name` sumiu de others/ops     → produto = null
 *   - 2026-08-14: `approver` sumiu                       → operacao = null (13 dias)
 * Os dois feeds expõem os mesmos dados JÁ RESOLVIDOS e com nome de campo estável,
 * então nenhuma dessas quebras se repete por esse caminho.
 *
 * Divisão de responsabilidade entre os feeds (verificada campo a campo na API):
 *  - `sales`    → nível VENDA: status, Setor, vendedor, pagante, receita, casal.
 *  - `products` → nível LINHA: product_status, nome do produto, fornecedor, valor.
 * Nenhum dos dois basta sozinho: `products` NÃO tem receita/setor/vendedor/pagante e
 * `sales` NÃO tem status por produto. A junção é por `sale_number`.
 *
 * Régua de soma (a mesma que o relatório do Monde usa):
 *   1. fora as vendas com `sale_status = 'canceled'`;
 *   2. nas que sobram, somar SÓ as linhas com `product_status = 'active'`.
 * `canceled_at` NÃO serve como sinal de inatividade: vem vazio nas linhas `deleted` e
 * nas vendas canceladas por inteiro. Só `status` decide.
 */

import type { VendaInput } from './schemas'
import { mapSetor } from './setor-mapper'

const BASE_URL =
  process.env.MONDE_DATA_URL ??
  'https://szyrzxvlptqqheizyrxu.supabase.co/functions/v1/monde-data'

/** Teto real da API: pedir mais é rebaixado (e ela informa em `page_size_maximo`). */
export const PAGE_SIZE = 200

function getApiKey(): string {
  const k = process.env.MONDE_DATA_API_KEY
  if (!k) throw new Error('MONDE_DATA_API_KEY não configurada no .env.local')
  return k
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/** Envelope comum das listagens. `total` passou a existir nos dois feeds em 2026-08-27. */
interface FeedEnvelope<T> {
  resource?: string
  page?: number
  page_size?: number
  total?: number
  page_size_pedido?: number
  page_size_maximo?: number
  data?: T[]
  error?: string
  desconhecidos?: string[]
  aceitos_neste_recurso?: string[]
}

/**
 * GET na API com retry.
 *
 * Trata explicitamente os dois modos de falha que a API passou a expor em 2026-08-27:
 *  - 400 `parâmetro desconhecido`: ela não ignora mais parâmetro que não conhece. Isso é
 *    uma PROTEÇÃO (antes um typo em `from` devolvia a base inteira com HTTP 200), então
 *    falhamos alto e mostramos o que ela aceita — nunca engolimos.
 *  - `page_size_maximo`: quando pedimos acima do teto ela rebaixa e avisa. Validamos o
 *    eco para nunca terminar a paginação comparando com o tamanho PEDIDO.
 * O 500 em offset profundo (~página 360+) segue existindo do lado deles; o retry com
 * backoff cobre a intermitência e as janelas por mês mantêm o offset baixo.
 */
async function feedFetch<T>(params: Record<string, string | number>): Promise<FeedEnvelope<T>> {
  const url = new URL(BASE_URL)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const headers = { 'x-api-key': getApiKey(), Accept: 'application/json' }

  let lastErr = ''
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url.toString(), { headers, cache: 'no-store' })

    if (res.status === 400) {
      const body = (await res.json().catch(() => ({}))) as FeedEnvelope<T>
      if (body.desconhecidos?.length) {
        throw new Error(
          `API de Dados do Monde recusou parâmetro desconhecido: ${body.desconhecidos.join(', ')}. ` +
          `Aceitos em ${params.resource}: ${(body.aceitos_neste_recurso ?? []).join(', ')}`,
        )
      }
      throw new Error(`API de Dados do Monde 400: ${body.error ?? '(sem detalhe)'}`)
    }

    if ([408, 429, 500, 502, 503, 504].includes(res.status)) {
      lastErr = `HTTP ${res.status}`
      await sleep(1000 * Math.pow(2, attempt))
      continue
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      throw new Error(`API de Dados do Monde ${res.status}: ${text.slice(0, 200)}`)
    }

    const body = (await res.json()) as FeedEnvelope<T>
    if (body.page_size_maximo && body.page_size_pedido && body.page_size_maximo < body.page_size_pedido) {
      // Não é erro: só garante que quem paginar use o tamanho REAL, não o pedido.
      body.page_size = body.page_size_maximo
    }
    return body
  }
  throw new Error(`API de Dados do Monde indisponível após 4 tentativas (${lastErr})`)
}

/**
 * Pagina uma listagem até o fim. O fim é "página mais curta que o page_size REAL"
 * (o eco da resposta, não o valor pedido) — contrato idêntico nos dois feeds desde
 * 2026-08-27. `total`, quando presente, só serve de trava contra laço infinito.
 */
async function paginate<T, R>(
  params: Record<string, string | number>,
  mapear: (row: T) => R,
): Promise<R[]> {
  const out: R[] = []
  let lidas = 0
  let total: number | undefined
  // Trava dura: 2.000 páginas × 200 = 400 mil linhas, muito acima de qualquer janela real.
  for (let page = 1; page <= 2000; page++) {
    const body = await feedFetch<T>({ ...params, page, page_size: PAGE_SIZE })
    const rows = body.data ?? []
    if (total === undefined) total = body.total
    // Mapeia e DESCARTA a linha crua na hora. `products` devolve `raw` + `passengers`,
    // que são ~63% do payload (~3,4 KB/linha) e não há como pedir sem eles: acumular as
    // linhas cruas de um ano inteiro seriam ~32 MB retidos, o que estoura a memória da
    // Edge Function. Guardamos só os campos projetados.
    for (const r of rows) out.push(mapear(r))
    lidas += rows.length
    const size = body.page_size ?? PAGE_SIZE
    if (rows.length < size) break
    if (total !== undefined && lidas >= total) break
  }
  return out
}

// ─── Nível VENDA (`resource=sales`) ───────────────────────────────────────────

interface SalesRow {
  sale_number: string | number
  sale_id: string
  sale_date?: string
  status?: string
  travel_agent_name?: string | null
  payer_name?: string | null
  intermediary_name_resolvido?: string | null
  custom_fields?: Array<{ name?: string; value?: string | null }>
  total_revenue?: number | null
  total_final_value?: number | null
  operation_product_name_resolvido?: string | null
  synced_at?: string | null
}

export interface FeedSale {
  sale_number: number
  sale_id: string
  sale_date: string
  /** 'opened' | 'closed' | 'canceled' */
  status: string
  setor_bruto: string | null
  vendedor: string | null
  pagante: string | null
  /** Nome do casal / Operação Própria, já sem o placeholder de data. */
  operacao: string | null
  receita: number
  valor_bruto: number
  synced_at: string | null
}

/**
 * Remove o sufixo de data do nome da Operação Própria quando ele é o placeholder
 * literal que ficou sem preencher no catálogo do Monde ("W - Isabela e Erick - DDMMAA").
 * São 16 casos em 2026 e o card de Contratos mostra esse texto ao cliente. Datas REAIS
 * ("- 05SEP26") são preservadas: só o placeholder sai.
 */
export function limparOperacao(nome: string | null | undefined): string | null {
  if (!nome) return null
  const limpo = nome.replace(/\s*-\s*DDMMAA\s*$/i, '').trim()
  return limpo || null
}

function setorDeCustomFields(cf?: Array<{ name?: string; value?: string | null }>): string | null {
  return cf?.find((f) => f.name === 'Setor')?.value ?? null
}

function toFeedSale(r: SalesRow): FeedSale {
  return {
    sale_number: Number(r.sale_number),
    sale_id: r.sale_id,
    sale_date: r.sale_date ?? '',
    status: r.status ?? '',
    setor_bruto: setorDeCustomFields(r.custom_fields),
    vendedor: r.travel_agent_name ?? null,
    pagante: r.payer_name ?? r.intermediary_name_resolvido ?? null,
    operacao: limparOperacao(r.operation_product_name_resolvido),
    receita: Number(r.total_revenue ?? 0),
    valor_bruto: Number(r.total_final_value ?? 0),
    synced_at: r.synced_at ?? null,
  }
}

// ─── Nível LINHA DE PRODUTO (`resource=products`) ─────────────────────────────

interface ProductsRow {
  sale_number: string | number
  sale_date?: string
  sale_status?: string
  product_status?: string
  product_kind?: string
  product_name_resolvido?: string | null
  supplier_name_resolvido?: string | null
  total_amount?: number | null
  canceled_at?: string | null
  visto_em?: string | null
}

export interface FeedLine {
  sale_number: number
  /** Data da venda a que a linha pertence — usada para agrupar por mês na sonda de delta. */
  sale_date: string
  sale_status: string
  /** 'active' | 'canceled' | 'deleted' */
  product_status: string
  product_kind: string
  produto: string | null
  fornecedor: string | null
  valor: number
  canceled_at: string | null
}

/**
 * kind estruturado → rótulo de produto (mesmos nomes do relatório do Monde).
 *
 * CONTINUA NECESSÁRIO: `product_name_resolvido` é nulo em 100% das linhas de
 * hospedagem, aéreo, seguro, locação e pacote — o Monde só manda código de catálogo
 * em `others` e `operations`, e a própria equipe da API confirmou que a origem não
 * tem o dado. Seguir "usem os campos _resolvido" ao pé da letra zeraria o rótulo de
 * ~79% das linhas.
 */
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

function toFeedLine(r: ProductsRow): FeedLine {
  const kind = r.product_kind ?? ''
  return {
    sale_number: Number(r.sale_number),
    sale_date: r.sale_date ?? '',
    sale_status: r.sale_status ?? '',
    product_status: r.product_status ?? '',
    product_kind: kind,
    // Resolvido primeiro (others/operations/cvc_packages), rótulo por kind depois.
    produto: r.product_name_resolvido?.trim() || KIND_PRODUTO[kind] || null,
    fornecedor: r.supplier_name_resolvido?.trim() || null,
    valor: Number(r.total_amount ?? 0),
    canceled_at: r.canceled_at ?? null,
  }
}

// ─── Janelas ──────────────────────────────────────────────────────────────────

export interface FeedWindow {
  /** data_venda >= from (YYYY-MM-DD) */
  from: string
  /** data_venda <= to (YYYY-MM-DD) */
  to: string
  /** Só registros relidos do Monde desde este instante (ISO). Delta barato. */
  syncedSince?: string
}

/** Quebra [from, to] em janelas mensais. Mantém o offset de paginação baixo (o 500 em
 *  página profunda é do lado deles) e limita o pico de memória por requisição. */
export function janelasMensais(from: string, to: string): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = []
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  let y = fy
  let m = fm
  while (y < ty || (y === ty && m <= tm)) {
    const ini = `${y}-${String(m).padStart(2, '0')}-01`
    const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
    const fim = `${y}-${String(m).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`
    out.push({ from: ini > from ? ini : from, to: fim < to ? fim : to })
    m++
    if (m > 12) { m = 1; y++ }
  }
  return out
}

export async function lerVendas(w: FeedWindow): Promise<FeedSale[]> {
  const p: Record<string, string | number> = { resource: 'sales', from: w.from, to: w.to }
  if (w.syncedSince) p.synced_since = w.syncedSince
  return paginate<SalesRow, FeedSale>(p, toFeedSale)
}

export async function lerLinhas(w: FeedWindow): Promise<FeedLine[]> {
  const p: Record<string, string | number> = { resource: 'products', from: w.from, to: w.to }
  if (w.syncedSince) p.synced_since = w.syncedSince
  return paginate<ProductsRow, FeedLine>(p, toFeedLine)
}

// ─── Junção → linhas de `vendas` ──────────────────────────────────────────────

export interface ConstruirResultado {
  /** Linhas prontas para inserir (uma por produto ATIVO de venda não cancelada). */
  linhas: VendaInput[]
  /** Números de venda que a régua manda EXCLUIR do banco (cancelada ou sem ativo). */
  excluir: number[]
  /** Números de venda vistos na janela — base do dedup (apaga-e-reinsere). */
  vistos: number[]
  canceladasVenda: number
  canceladasProduto: number
  semLinhaAtiva: number
}

/**
 * Junta os dois feeds e aplica a régua de soma.
 *
 * `receitas` é rateada entre as linhas ativas na proporção do valor — a receita só
 * existe no nível da venda (`total_revenue`) e NÃO é reconstruível a partir de
 * `products`: testei as combinações de commission_amount/agency_service_fee/over/fees
 * e a melhor fecha em ~72% das vendas, errando até R$ 4,7 mil, além de existir receita
 * negativa que fórmula nenhuma prevê. Por isso `sales` é obrigatório no pipeline.
 *
 * Receita negativa (permuta/patrocínio com 100% de desconto) é fixada em 0, como o
 * relatório do Monde mostra.
 */
/**
 * Rateia a receita da venda entre as linhas ativas, proporcionalmente ao valor.
 *
 * Caso de borda que custava receita: quando TODAS as linhas ativas valem 0 mas a venda
 * tem receita (`somaAtiva === 0`), o rateio proporcional dividiria por zero. Dividir
 * igualmente entre as linhas preserva o total. É raro mas real — venda 72833/2026 é uma
 * passagem aérea de valor 0 com R$ 187,69 de comissão pura, e o rateio proporcional
 * simplesmente descartava esses R$ 187,69.
 */
function ratearReceita(
  receitaVenda: number,
  valorLinha: number,
  somaAtiva: number,
  qtdLinhas: number,
): number {
  if (receitaVenda === 0) return 0
  const bruto = somaAtiva > 0
    ? receitaVenda * valorLinha / somaAtiva
    : receitaVenda / qtdLinhas
  return Math.round(bruto * 100) / 100
}

export function construirLinhas(
  vendas: FeedSale[],
  linhas: FeedLine[],
  opts: { produtoAnterior?: Map<number, string> } = {},
): ConstruirResultado {
  const porVenda = new Map<number, FeedLine[]>()
  for (const l of linhas) {
    const arr = porVenda.get(l.sale_number)
    if (arr) arr.push(l)
    else porVenda.set(l.sale_number, [l])
  }

  const out: VendaInput[] = []
  const excluir: number[] = []
  const vistos: number[] = []
  let canceladasVenda = 0
  let canceladasProduto = 0
  let semLinhaAtiva = 0

  for (const v of vendas) {
    vistos.push(v.sale_number)

    // Régua, passo 1: venda cancelada sai inteira. É o caso que ficava eternamente
    // somado no banco, porque a listagem SEM from/to não devolve venda cancelada e o
    // delta nunca a revisitava.
    if (v.status === 'canceled') {
      canceladasVenda++
      excluir.push(v.sale_number)
      continue
    }

    const todas = porVenda.get(v.sale_number) ?? []
    // Régua, passo 2: só produto ativo entra na soma.
    const ativas = todas.filter((l) => l.product_status === 'active')
    canceladasProduto += todas.length - ativas.length

    if (ativas.length === 0) {
      // Venda viva cujos produtos foram todos cancelados/excluídos: some do dashboard.
      semLinhaAtiva++
      excluir.push(v.sale_number)
      continue
    }

    const somaAtiva = ativas.reduce((s, l) => s + l.valor, 0)
    const receitaVenda = Math.max(v.receita, 0)
    const anterior = opts.produtoAnterior?.get(v.sale_number) ?? null

    const base = {
      venda_numero: v.sale_number,
      vendedor: v.vendedor ?? 'Sem vendedor',
      data_venda: v.sale_date,
      pagante: v.pagante ?? 'Sem cliente',
      setor_bruto: v.setor_bruto,
      setor_grupo: mapSetor(v.setor_bruto),
      representante: null as string | null,
      operacao: v.operacao,
      situacao: v.status === 'opened' ? 'Aberta' : 'Fechada',
      // Só linha ATIVA é gravada, então a linha nunca representa um cancelamento.
      data_cancelamento: null as string | null,
    }

    for (const l of ativas) {
      out.push({
        ...base,
        produto: l.produto ?? anterior,
        fornecedor: l.fornecedor,
        valor_total: l.valor,
        receitas: ratearReceita(receitaVenda, l.valor, somaAtiva, ativas.length),
        faturamento: l.valor,
      })
    }
  }

  return { linhas: out, excluir, vistos, canceladasVenda, canceladasProduto, semLinhaAtiva }
}

/** Lê os dois feeds de uma janela, mês a mês, e devolve tudo junto. */
export async function lerJanela(w: FeedWindow): Promise<{ vendas: FeedSale[]; linhas: FeedLine[] }> {
  const vendas: FeedSale[] = []
  const linhas: FeedLine[] = []
  for (const mes of janelasMensais(w.from, w.to)) {
    const jan: FeedWindow = { ...mes, syncedSince: w.syncedSince }
    const [vs, ls] = await Promise.all([lerVendas(jan), lerLinhas(jan)])
    vendas.push(...vs)
    linhas.push(...ls)
  }
  return { vendas, linhas }
}

// ─── Sondagem de qualidade ────────────────────────────────────────────────────

export interface SondaQualidade {
  /** Números de venda que a API reporta CANCELADAS na janela. */
  canceladasNaApi: number[]
  /** Total de linhas com `product_status = 'active'` na janela, segundo a API. */
  linhasAtivasApi: number
  /** Total de vendas na janela, segundo a API. */
  vendasNaApi: number
  /** Vendas relidas do Monde nas últimas `horas` (frescor do espelho). */
  vendasRelidas: number
  horas: number
}

/**
 * Sondagem BARATA para o monitor de qualidade: usa só o campo `total` do envelope
 * (page_size=1), então são 4 requisições independentes do tamanho da janela — não
 * baixa as linhas. É o que permite a página /qualidade comparar banco × API a cada
 * carregamento sem custo.
 *
 * Os quatro sinais são exatamente os que a equipe da API deixou do nosso lado para
 * montar o alarme de quebra: `total` nas listagens e `synced_at` como frescor.
 */
export async function sondarQualidade(
  from: string,
  to: string,
  horas = 24,
): Promise<SondaQualidade> {
  const desde = new Date(Date.now() - horas * 3600_000).toISOString()

  const [canc, ativas, vendas, relidas] = await Promise.all([
    // A lista de canceladas é pequena (18 em 2026), então aqui vale trazer os números.
    paginate<{ sale_number: string | number }, number>(
      { resource: 'sales', from, to, status: 'canceled' },
      (r) => Number(r.sale_number),
    ),
    feedFetch<unknown>({ resource: 'products', from, to, product_status: 'active', page: 1, page_size: 1 }),
    feedFetch<unknown>({ resource: 'sales', from, to, page: 1, page_size: 1 }),
    feedFetch<unknown>({ resource: 'sales', from, to, synced_since: desde, page: 1, page_size: 1 }),
  ])

  return {
    canceladasNaApi: canc,
    linhasAtivasApi: ativas.total ?? 0,
    vendasNaApi: vendas.total ?? 0,
    vendasRelidas: relidas.total ?? 0,
    horas,
  }
}
