/**
 * Cliente HTTP para a **API de Dados do Monde** (mirror somente-leitura).
 *
 * Esta é a ÚNICA fonte de dados de vendas do dashboard. A API do Monde v3
 * (web.monde.com.br) NÃO é mais consultada diretamente — lemos o espelho, que já
 * replica tudo em JSON. Só a fonte mudou: o modelo (`vendas`) e os comandos de
 * sincronização (runner, cron, rebuild, Edge Function) continuam idênticos.
 *
 * Estratégia de leitura:
 *  - `resource=sales` (lista paginada, ordenada da mais recente) enumera as vendas
 *    da página, mas NÃO traz produtos/valores por produto.
 *  - `resource=sale&id=<uuid>` traz o objeto completo, cujo campo `raw` é exatamente
 *    o objeto de venda no formato Monde v3. É ele que alimenta o mapper existente
 *    (lib/monde-sync.ts) sem qualquer alteração — mesmo cálculo de cancelamento,
 *    valores ativos, setor, produto e fornecedor.
 *
 * Por que detalhe por venda: os totais da lista (`total_final_value`/`total_revenue`)
 * INCLUEM produtos cancelados (batem com `raw.totals.final_value`). Só o detalhe expõe
 * o status por produto — indispensável para `isMondeSaleCancelled` e para somar apenas
 * os ativos em vendas mistas. Mapear pela lista inflaria o faturamento.
 *
 * Autenticação: header `x-api-key: <MONDE_DATA_API_KEY>`. Parâmetros via query string.
 */

const BASE_URL =
  process.env.MONDE_DATA_URL ??
  'https://szyrzxvlptqqheizyrxu.supabase.co/functions/v1/monde-data'

/** Vendas por página da lista. 50 mantém a semântica das constantes `maxPages`
 *  (~50 vendas/página, como a antiga API v3). O máximo da API é 200. */
const LIST_PAGE_SIZE = 50

/** Requisições de detalhe (`resource=sale`) em paralelo por página. Testado sem
 *  rate-limit até 20; 12 é folgado (~10 req/s) e cabe no teto de 300s dos crons. */
const DETAIL_CONCURRENCY = 12

function getApiKey(): string {
  const k = process.env.MONDE_DATA_API_KEY
  if (!k) throw new Error('MONDE_DATA_API_KEY não configurada no .env.local')
  return k
}

// ─── Tipos de resposta (formato Monde v3, exposto no campo `raw` do detalhe) ──
// Mantidos idênticos: lib/monde-sync.ts e os consumidores dependem deles.

export interface MondePagination {
  page: number
  size: number
  total: number
  total_pages: number
}

export interface MondePerson {
  name?: string
  cpf?: string
  cpf_cnpj?: string
  email?: string
  mobile_number?: string
}

export interface MondeSupplier {
  name?: string
  cnpj?: string
}

export interface MondeProduct {
  external_id?: string
  status?: string
  canceled_at?: string | null
  destination?: string
  supplier?: MondeSupplier
  representative?: string
  commission_amount?: number
  currency?: string
  product_name?: string  // nome real do produto (ex.: "Contrato de casamento") — vem no array `others`
  totals?: Record<string, number>
}

export interface MondeTotals {
  products: number
  taxes: number
  discount: number
  revenue: number
  payments: number
  balance: number
  final_value: number
}

export interface MondeCustomField {
  name: string
  value: string | null
}

export interface MondeSale {
  company_identifier?: string
  sale_id: string
  sale_number: number
  sale_date: string          // YYYY-MM-DD — data da VENDA
  status: string             // 'opened' | 'closed'
  observations?: string
  operation_id?: string | null  // operação do Monde; nome só via de-para (lib/monde-operacoes)
  custom_fields?: MondeCustomField[]
  period_start?: string
  period_end?: string
  travel_agent?: MondePerson
  payer?: MondePerson
  intermediary?: MondePerson
  requester?: MondePerson
  approver?: MondePerson
  hotels?: MondeProduct[]
  airline_tickets?: MondeProduct[]
  cruises?: MondeProduct[]
  insurances?: MondeProduct[]
  train_tickets?: MondeProduct[]
  ground_transportations?: MondeProduct[]
  car_rentals?: MondeProduct[]
  travel_packages?: MondeProduct[]
  others?: MondeProduct[]  // produtos "avulsos" — traz product_name (ex.: "Contrato de casamento")
  cvc_packages?: MondeProduct[]  // pacotes CVC (product_name real)
  operations?: MondeProduct[]    // itens de operação (product_name = "X -/G -/W - ..."); ENTRA no final_value
  payments?: unknown[]
  totals?: MondeTotals
}

export interface MondeSalesPage {
  data: MondeSale[]
  pagination: MondePagination
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

async function mondeDataFetch(params: Record<string, string | number>): Promise<Response> {
  const url = new URL(BASE_URL)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))

  const headers = {
    'x-api-key': getApiKey(),
    Accept: 'application/json',
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url.toString(), { headers, cache: 'no-store' })
    if ([408, 429, 500, 502, 503, 504].includes(res.status)) {
      await sleep(1000 * Math.pow(2, attempt))
      continue
    }
    return res
  }
  throw new Error('API de Dados do Monde indisponível após 4 tentativas')
}

/** Executa `fn` sobre `items` com no máximo `limit` chamadas simultâneas. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return out
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

interface SaleListItem {
  sale_number: string | number
  sale_id: string
  // Campos que a LISTA já traz de graça (sem custo de detalhe). São a base do sync
  // incremental: dá para saber o que mudou sem buscar o detalhe de todas as vendas.
  sale_date?: string
  status?: string                 // 'opened' | 'closed'
  total_final_value?: number      // BRUTO (inclui cancelados; bate com raw.totals.final_value)
  total_revenue?: number
  product_count?: number
  custom_fields?: MondeCustomField[]
}

interface SalesListResponse {
  data: SaleListItem[]
  total: number
  page: number
  page_size: number
}

/** Linha da lista já normalizada — o que dá para saber SEM buscar o detalhe. */
export interface SaleListRow {
  sale_number: number
  sale_id: string
  sale_date: string
  status: string                  // 'opened' | 'closed'
  total_final_value: number       // bruto — só para DETECTAR mudança, não para persistir
  total_revenue: number
  product_count: number
  custom_fields?: MondeCustomField[]
}

function toSaleListRow(it: SaleListItem): SaleListRow {
  return {
    sale_number: Number(it.sale_number),
    sale_id: it.sale_id,
    sale_date: it.sale_date ?? '',
    status: it.status ?? '',
    total_final_value: Number(it.total_final_value ?? 0),
    total_revenue: Number(it.total_revenue ?? 0),
    product_count: Number(it.product_count ?? 0),
    custom_fields: it.custom_fields,
  }
}

/** Uma página da lista de vendas (só identificadores; produtos vêm do detalhe).
 *  Falha em voz alta: sem a lista não há como enumerar a página, então o run falha
 *  e o cron/botão re-tenta (idempotente). */
async function getSalesListPage(page: number): Promise<SalesListResponse> {
  const res = await mondeDataFetch({ resource: 'sales', page, page_size: LIST_PAGE_SIZE })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`API de Dados do Monde (sales pág ${page}) ${res.status}: ${text.slice(0, 200)}`)
  }
  const text = await res.text()
  try {
    return JSON.parse(text) as SalesListResponse
  } catch {
    throw new Error(`API de Dados do Monde (sales pág ${page}) resposta não-JSON: ${text.slice(0, 200)}`)
  }
}

/**
 * Reconstrói um MondeSale a partir dos campos normalizados do detalhe.
 * Só é usado se `raw` faltar (não observado em produção) — garante robustez.
 */
function reconstructSaleFromDetail(detail: Record<string, unknown>): MondeSale {
  const byKind: Record<string, MondeProduct[]> = {}
  const products = (detail.products as Array<Record<string, unknown>>) ?? []
  for (const p of products) {
    const kind = String(p.product_kind ?? '')
    if (!kind) continue
    ;(byKind[kind] ??= []).push({
      status: (p.status as string) ?? undefined,
      canceled_at: (p.canceled_at as string | null) ?? null,
      supplier: { name: (p.supplier_name as string) ?? undefined },
      totals: { amount: Number(p.total_amount ?? 0) },
    })
  }
  return {
    sale_id: String(detail.sale_id ?? ''),
    sale_number: Number(detail.sale_number ?? 0),
    sale_date: String(detail.sale_date ?? ''),
    status: String(detail.status ?? ''),
    operation_id: (detail.operation_id as string | null) ?? null,
    custom_fields: (detail.custom_fields as MondeCustomField[]) ?? [],
    travel_agent: { name: (detail.travel_agent_name as string) ?? undefined },
    payer: { name: (detail.payer_name as string) ?? undefined },
    hotels: byKind['hotels'],
    airline_tickets: byKind['airline_tickets'],
    cruises: byKind['cruises'],
    insurances: byKind['insurances'],
    train_tickets: byKind['train_tickets'],
    ground_transportations: byKind['ground_transportations'],
    car_rentals: byKind['car_rentals'],
    travel_packages: byKind['travel_packages'],
    totals: {
      products: 0,
      taxes: 0,
      discount: 0,
      revenue: Number(detail.total_revenue ?? 0),
      payments: 0,
      balance: 0,
      final_value: Number(detail.total_final_value ?? 0),
    },
  }
}

/** Detalhe completo de uma venda → objeto no formato Monde v3 (campo `raw`).
 *  Isola falhas por venda: um detalhe que falhe (5xx persistente ou JSON inválido)
 *  NÃO pode derrubar a página inteira (Promise.all) nem travar o sync a cada ciclo
 *  — efeito "poison-pill" próprio do modelo 1-detalhe-por-venda. A venda é pulada e
 *  registrada; como o dedup só afeta os números buscados, a pulada fica intacta no
 *  banco e volta num próximo ciclo. Retorna null → filtrada em getMondeSalesPage. */
export async function getSaleRaw(saleId: string): Promise<MondeSale | null> {
  try {
    const res = await mondeDataFetch({ resource: 'sale', id: saleId })
    if (!res.ok) {
      if (res.status === 404) return null
      const text = await res.text().catch(() => '')
      throw new Error(`sale ${res.status}: ${text.slice(0, 200)}`)
    }
    const body = await res.json()
    const detail = body?.data
    if (!detail) return null
    const raw = detail.raw
    if (raw && typeof raw === 'object') return raw as MondeSale
    return reconstructSaleFromDetail(detail)
  } catch (err) {
    console.warn(`[monde-client] detalhe da venda ${saleId} pulado: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/**
 * Busca uma página de vendas: lista os identificadores da página e resolve o
 * detalhe (`raw`, formato Monde v3) de cada venda em paralelo. Retorna no mesmo
 * formato da antiga API v3 — o restante do pipeline não muda.
 */
export async function getMondeSalesPage(page: number): Promise<MondeSalesPage> {
  const list = await getSalesListPage(page)
  const items = list.data ?? []
  const total = list.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE))

  const raws = await mapWithConcurrency(items, DETAIL_CONCURRENCY, (it) => getSaleRaw(it.sale_id))
  const data = raws.filter((s): s is MondeSale => s !== null)

  return { data, pagination: { page, size: LIST_PAGE_SIZE, total, total_pages: totalPages } }
}

/**
 * Varre N páginas a partir de startPage (ordem da API = ~mais recentes primeiro).
 * As páginas são varridas em sequência: cada página já dispara `DETAIL_CONCURRENCY`
 * requisições de detalhe em paralelo, então paralelizar páginas multiplicaria a
 * concorrência sem ganho. A ordem das vendas no retorno não importa (o runner
 * ordena por data e deduplica por número).
 */
export async function scanMondePages(opts: {
  startPage?: number
  maxPages?: number
  onProgress?: (page: number, total: number, count: number) => void
}): Promise<{ sales: MondeSale[]; totalPages: number; pagesScanned: number }> {
  const { startPage = 1, maxPages = 25, onProgress } = opts
  const sales: MondeSale[] = []
  let pagesScanned = 0

  // 1ª página: descobre total_pages antes de continuar.
  const first = await getMondeSalesPage(startPage)
  const totalPages = first.pagination.total_pages
  pagesScanned++
  if (first.pagination.total === 0) return { sales, totalPages, pagesScanned }
  sales.push(...first.data)
  onProgress?.(startPage, totalPages, sales.length)

  // Termina em lastPage: total_pages = ceil(total/50) e as páginas do mirror são
  // contíguas (não há página vazia dentro de [1, totalPages]). Não dá para usar
  // "página vazia" como fim, pois `total` é o total GLOBAL, igual em toda página.
  const lastPage = Math.min(startPage + maxPages - 1, totalPages)
  for (let p = startPage + 1; p <= lastPage; p++) {
    const resp = await getMondeSalesPage(p)
    pagesScanned++
    sales.push(...resp.data)
    onProgress?.(p, totalPages, sales.length)
  }

  return { sales, totalPages, pagesScanned }
}

// ─── Sync incremental: lista barata + detalhe só do que mudou ──────────────────

/**
 * Varre N páginas da LISTA apenas (SEM buscar o detalhe de nada). É barato: 1
 * requisição por página (~50 vendas). A lista já traz status, valores e contagem de
 * itens — o suficiente para o sync incremental decidir o que mudou. Contrasta com
 * `scanMondePages`, que resolve o detalhe (`raw`) de TODAS as vendas (~50 req/página)
 * e por isso estoura o rate-limiter de saída do Edge Runtime.
 */
export async function scanSalesListPages(opts: {
  startPage?: number
  maxPages?: number
  onProgress?: (page: number, totalPages: number, count: number) => void
}): Promise<{ rows: SaleListRow[]; totalPages: number; pagesScanned: number }> {
  const { startPage = 1, maxPages = 20, onProgress } = opts
  const rows: SaleListRow[] = []
  let pagesScanned = 0

  const first = await getSalesListPage(startPage)
  const total = first.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / LIST_PAGE_SIZE))
  pagesScanned++
  for (const it of first.data ?? []) rows.push(toSaleListRow(it))
  onProgress?.(startPage, totalPages, rows.length)
  if (total === 0) return { rows, totalPages, pagesScanned }

  const lastPage = Math.min(startPage + maxPages - 1, totalPages)
  for (let p = startPage + 1; p <= lastPage; p++) {
    const resp = await getSalesListPage(p)
    pagesScanned++
    for (const it of resp.data ?? []) rows.push(toSaleListRow(it))
    onProgress?.(p, totalPages, rows.length)
  }

  return { rows, totalPages, pagesScanned }
}

/**
 * Busca o detalhe (`raw`, formato Monde v3) de uma lista específica de vendas, em
 * paralelo com concorrência controlada. Falhas por venda são isoladas (poison-pill,
 * ver `getSaleRaw`). Usado pelo sync incremental: só as vendas NOVAS ou ALTERADAS
 * chegam aqui — não a janela inteira.
 */
export async function fetchSaleRaws(saleIds: string[]): Promise<MondeSale[]> {
  const raws = await mapWithConcurrency(saleIds, DETAIL_CONCURRENCY, (id) => getSaleRaw(id))
  return raws.filter((s): s is MondeSale => s !== null)
}
