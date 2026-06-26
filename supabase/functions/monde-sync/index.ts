/**
 * Supabase Edge Function: monde-sync
 *
 * Sincroniza as vendas mais recentes da API Monde v3 → tabela vendas.
 * Agendada via Supabase Cron (Dashboard → Edge Functions → Schedule).
 *
 * Secrets necessários (Supabase Dashboard → Edge Functions → Secrets):
 *   MONDE_V3_API_KEY       — chave Basic Auth da API Monde
 *   SUPABASE_URL           — injetado automaticamente pelo Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — injetado automaticamente pelo Supabase
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

// ─── Configuração ─────────────────────────────────────────────────────────────

const MONDE_BASE = 'https://web.monde.com.br/api/v3'
const PAGE_DELAY_MS = 220   // respeita rate limit: 60 req / 3s
const MAX_PAGES = 25        // ~1.250 vendas mais recentes por sync
const INSERT_BATCH = 500
const FILENAME_PREFIX = 'monde-api-'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface MondeProduct {
  status?: string
  canceled_at?: string | null
  supplier?: { name?: string }
  totals?: Record<string, number>
}

interface MondeSale {
  sale_id: string
  sale_number: number
  sale_date: string
  status: string
  observations?: string | null
  custom_fields?: Array<{ name: string; value: string | null }>
  travel_agent?: { name?: string }
  payer?: { name?: string }
  intermediary?: { name?: string }
  hotels?: MondeProduct[]
  airline_tickets?: MondeProduct[]
  cruises?: MondeProduct[]
  insurances?: MondeProduct[]
  train_tickets?: MondeProduct[]
  ground_transportations?: MondeProduct[]
  car_rentals?: MondeProduct[]
  travel_packages?: MondeProduct[]
  totals?: { final_value: number; revenue: number }
}

const PRODUCT_KEYS = [
  'hotels', 'airline_tickets', 'cruises', 'insurances',
  'train_tickets', 'ground_transportations', 'car_rentals', 'travel_packages',
] as const

// ─── Monde API ────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

async function mondeFetch(path: string, params: Record<string, string | number>, token: string): Promise<Response> {
  const url = new URL(`${MONDE_BASE}${path}`)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Basic ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    })
    if ([408, 429, 500, 502, 503, 504].includes(res.status)) {
      await sleep(1500 * Math.pow(2, attempt))
      continue
    }
    return res
  }
  throw new Error('Monde API indisponível após 4 tentativas')
}

async function scanPages(token: string): Promise<{ sales: MondeSale[]; totalPages: number; pagesScanned: number }> {
  const sales: MondeSale[] = []
  let totalPages = 1
  let pagesScanned = 0

  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await mondeFetch('/sales', { page, size: 100 }, token)
    if (!res.ok) throw new Error(`Monde API ${res.status}`)
    const json = await res.json()
    totalPages = json.pagination.total_pages
    pagesScanned++
    if (!json.data?.length) break
    sales.push(...json.data)
    if (page >= totalPages) break
    if (page < MAX_PAGES) await sleep(PAGE_DELAY_MS)
  }

  return { sales, totalPages, pagesScanned }
}

// ─── Setor ────────────────────────────────────────────────────────────────────

const SETOR_MAP: Record<string, string> = {
  Corporativo: 'CORP',
  Lazer: 'TRIPS',
  'Expedições': 'TRIPS',
  WedMe: 'WEDDINGS',
  'Produção': 'WEDDINGS',
  'Planejamento-WED': 'WEDDINGS',
  Weddings: 'WEDDINGS',
  Welcome: 'OUTROS',
}

function mapSetor(bruto: string | null | undefined): string {
  if (!bruto) return 'INDEFINIDO'
  return SETOR_MAP[bruto] ?? 'INDEFINIDO'
}

function inferSetorBruto(sale: MondeSale): string | null {
  return (sale.custom_fields ?? []).find((f) => f.name === 'Setor')?.value ?? null
}

// ─── Cancelamento e valores ───────────────────────────────────────────────────

function allProducts(sale: MondeSale): MondeProduct[] {
  const out: MondeProduct[] = []
  for (const key of PRODUCT_KEYS) {
    const arr = sale[key] as MondeProduct[] | undefined
    if (arr?.length) out.push(...arr)
  }
  return out
}

function isInactive(p: MondeProduct): boolean {
  return p.status === 'canceled' || p.status === 'deleted' || !!p.canceled_at
}

function isCancelled(sale: MondeSale): boolean {
  if ((sale.status ?? '').toLowerCase().includes('cancel')) return true
  const prods = allProducts(sale)
  if (prods.length === 0) return false
  return prods.every(isInactive)
}

function computeActiveAmounts(sale: MondeSale): { valorTotal: number; receita: number } {
  const prods = allProducts(sale)
  const hasCanceled = prods.some((p) => p.status === 'canceled')

  if (!hasCanceled) {
    return { valorTotal: sale.totals?.final_value ?? 0, receita: sale.totals?.revenue ?? 0 }
  }

  type P = { status: string; amount: number }
  const enriched: P[] = prods.map((p) => ({
    status: p.status ?? '',
    amount: (p.totals as Record<string, number> | undefined)?.amount ?? 0,
  }))

  const activeAmount   = enriched.filter((p) => p.status === 'active')  .reduce((s, p) => s + p.amount, 0)
  const canceledAmount = enriched.filter((p) => p.status === 'canceled').reduce((s, p) => s + p.amount, 0)
  const knownTotal = activeAmount + canceledAmount
  const scaledRevenue = knownTotal > 0 ? (sale.totals?.revenue ?? 0) * (activeAmount / knownTotal) : 0

  return { valorTotal: activeAmount, receita: scaledRevenue }
}

function inferProduto(sale: MondeSale): string | null {
  if ((sale.travel_packages?.length ?? 0) > 0) return 'Pacote de Viagem'
  if ((sale.cruises?.length ?? 0) > 0) return 'Cruzeiro'
  if ((sale.hotels?.length ?? 0) > 0 && (sale.airline_tickets?.length ?? 0) > 0) return 'Hotel + Aéreo'
  if ((sale.hotels?.length ?? 0) > 0) return 'Hotel'
  if ((sale.airline_tickets?.length ?? 0) > 0) return 'Aéreo'
  if ((sale.insurances?.length ?? 0) > 0) return 'Seguro Viagem'
  if ((sale.train_tickets?.length ?? 0) > 0) return 'Trem'
  if ((sale.ground_transportations?.length ?? 0) > 0) return 'Transfer'
  if ((sale.car_rentals?.length ?? 0) > 0) return 'Locação de Carro'
  return null
}

function inferFornecedor(sale: MondeSale): string | null {
  const arrays = [
    sale.travel_packages, sale.hotels, sale.airline_tickets, sale.cruises,
    sale.insurances, sale.train_tickets, sale.ground_transportations, sale.car_rentals,
  ]
  for (const arr of arrays) {
    const name = arr?.[0]?.supplier?.name
    if (name) return name
  }
  return null
}

// ─── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  const mondKey = Deno.env.get('MONDE_V3_API_KEY')
  if (!mondKey) return new Response(JSON.stringify({ error: 'MONDE_V3_API_KEY não configurado' }), { status: 500 })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  try {
    // 1. Buscar páginas
    const { sales: rawSales, totalPages, pagesScanned } = await scanPages(mondKey)

    // 2. Filtrar canceladas
    const cancelledCount = rawSales.filter(isCancelled).length
    const activeSales = rawSales.filter((s) => !isCancelled(s))

    if (activeSales.length === 0) {
      return new Response(JSON.stringify({ ok: true, salesInserted: 0, cancelledSkipped: cancelledCount }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 3. Range de datas
    const dates = activeSales.map((s) => s.sale_date).filter(Boolean).sort()
    const minDate = dates[0]
    const maxDate = dates[dates.length - 1]

    // 4. Identificar uploads existentes para limpeza de órfãos
    const { data: affected } = await supabase
      .from('vendas').select('upload_id')
      .gte('data_venda', minDate).lte('data_venda', maxDate)

    const affectedIds: string[] = [...new Set(
      (affected ?? []).map((v: { upload_id: string }) => v.upload_id).filter(Boolean)
    )]

    // 5. Deletar registros do período
    await supabase.from('vendas').delete().gte('data_venda', minDate).lte('data_venda', maxDate)

    // Limpar uploads órfãos
    for (const uid of affectedIds) {
      const { count } = await supabase.from('vendas').select('*', { count: 'exact', head: true }).eq('upload_id', uid)
      if ((count ?? 0) === 0) await supabase.from('uploads').delete().eq('id', uid)
    }

    // 6. Criar registro de upload
    const today = new Date().toISOString().slice(0, 10)
    const { data: uploadRecord, error: uploadErr } = await supabase
      .from('uploads')
      .insert({
        nome_arquivo: `${FILENAME_PREFIX}cron-${today}`,
        total_linhas: activeSales.length,
        linhas_inseridas: activeSales.length,
        linhas_atualizadas: 0,
        alertas_qualidade: [],
        status: 'success',
      })
      .select('id')
      .single()

    if (uploadErr || !uploadRecord) throw new Error(`Erro upload: ${uploadErr?.message}`)

    const uploadId = uploadRecord.id

    // 7. Mapear e inserir
    const vendas = activeSales.map((s) => {
      const setor_bruto = inferSetorBruto(s)
      const { valorTotal, receita } = computeActiveAmounts(s)
      return {
        upload_id: uploadId,
        venda_numero: s.sale_number,
        vendedor: s.travel_agent?.name ?? 'Sem vendedor',
        data_venda: s.sale_date,
        pagante: s.payer?.name ?? s.intermediary?.name ?? 'Sem cliente',
        setor_bruto,
        setor_grupo: mapSetor(setor_bruto),
        produto: inferProduto(s),
        fornecedor: inferFornecedor(s),
        representante: null,
        valor_total: valorTotal,
        receitas: receita,
        faturamento: valorTotal,
        situacao: s.status === 'opened' ? 'Aberta' : 'Fechada',
      }
    })

    for (let i = 0; i < vendas.length; i += INSERT_BATCH) {
      const { error } = await supabase.from('vendas').insert(vendas.slice(i, i + INSERT_BATCH))
      if (error) throw new Error(`Erro insert lote ${Math.floor(i / INSERT_BATCH) + 1}: ${error.message}`)
    }

    const result = {
      ok: true,
      pagesScanned,
      totalPages,
      salesFetched: rawSales.length,
      cancelledSkipped: cancelledCount,
      salesInserted: vendas.length,
      dateRange: { min: minDate, max: maxDate },
      indefinidoCount: vendas.filter((v) => v.setor_grupo === 'INDEFINIDO').length,
    }

    console.log('[monde-sync]', JSON.stringify(result))

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[monde-sync] ERRO:', msg)
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
