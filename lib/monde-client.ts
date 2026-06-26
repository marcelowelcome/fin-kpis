/**
 * Cliente HTTP para a API de Vendas v3 do Monde.
 * Spec: monde-v3-sales-api-spec.md
 *
 * Armadilhas implementadas:
 * - Content-Type: application/json obrigatório (inclusive em GET)
 * - size é ignorado pela API → sempre 50/página
 * - paginar por pagination.total_pages, nunca por tamanho da resposta
 * - rate limit 60 req/3s → 220ms entre páginas + backoff exponencial
 */

const BASE_URL = 'https://web.monde.com.br/api/v3'

function getToken(): string {
  const t = process.env.MONDE_V3_API_KEY
  if (!t) throw new Error('MONDE_V3_API_KEY não configurada no .env.local')
  return t
}

// ─── Tipos de resposta da API ────────────────────────────────────────────────

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

async function mondeFetch(path: string, params: Record<string, string | number> = {}): Promise<Response> {
  const url = new URL(`${BASE_URL}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))

  const headers = {
    Authorization: `Basic ${getToken()}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url.toString(), { headers, cache: 'no-store' })
    if ([408, 429, 500, 502, 503, 504].includes(res.status)) {
      await sleep(1500 * Math.pow(2, attempt))
      continue
    }
    return res
  }
  throw new Error('Monde API indisponível após 4 tentativas')
}

// ─── Endpoints ───────────────────────────────────────────────────────────────

/** Busca uma página de vendas. size=100 é ignorado — API fixa em 50/página. */
export async function getMondeSalesPage(page: number): Promise<MondeSalesPage> {
  const res = await mondeFetch('/sales', { page, size: 100 })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Monde API ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

/**
 * Varre N páginas da API (sem filtro = mais recentes primeiro por sale_date).
 * Retorna todas as vendas encontradas e metadados da paginação.
 */
export async function scanMondePages(opts: {
  startPage?: number
  maxPages?: number
  onProgress?: (page: number, total: number, count: number) => void
}): Promise<{ sales: MondeSale[]; totalPages: number; pagesScanned: number }> {
  const { startPage = 1, maxPages = 25, onProgress } = opts
  const sales: MondeSale[] = []
  let totalPages = 1
  let pagesScanned = 0

  for (let page = startPage; page < startPage + maxPages; page++) {
    const resp = await getMondeSalesPage(page)
    totalPages = resp.pagination.total_pages
    pagesScanned++

    if (!resp.data?.length) break
    sales.push(...resp.data)
    onProgress?.(page, totalPages, sales.length)

    if (page >= totalPages) break

    // Respeita rate limit: 60 req / 3s → ~220ms entre requisições
    if (page < startPage + maxPages - 1 && page < totalPages) {
      await sleep(220)
    }
  }

  return { sales, totalPages, pagesScanned }
}
