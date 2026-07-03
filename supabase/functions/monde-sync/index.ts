/**
 * Supabase Edge Function: monde-sync
 *
 * Sincroniza as vendas mais recentes da **API de Dados do Monde** (mirror somente
 * leitura) → tabela `vendas`, rodando 100% no Supabase (sem depender do Vercel).
 * Agendável via Supabase Cron. A API do Monde v3 NÃO é mais consultada: só a fonte
 * mudou — o modelo (`vendas`) e a lógica de sync continuam idênticos.
 *
 * Fonte: lista `resource=sales` (identificadores) + `resource=sale&id=<uuid>` por venda,
 * cujo campo `raw` é o objeto no formato Monde v3 que alimenta o mapper. O detalhe é
 * obrigatório porque os totais da lista incluem produtos cancelados — só o `raw` expõe
 * o status por produto (cancelamento + soma dos ativos em vendas mistas).
 *
 * Dedup por NÚMERO DA VENDA (sem perda): apaga só os números buscados e reinsere os
 * ativos — não apaga por intervalo de datas (que subnotificava a faixa recente).
 * Janela: só processa vendas com data_venda >= CUTOFF (preserva histórico anterior).
 * Carry-forward: se a API não traz produto (típico em casamentos) mas já havia um
 * produto (do Excel), preserva-o — não apaga a info que alimenta o KPI de contratos.
 *
 * Secrets (Supabase → Edge Functions → Secrets):
 *   MONDE_DATA_API_KEY (header x-api-key da API de Dados),
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (injetados/automáticos).
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

// ─── Configuração ─────────────────────────────────────────────────────────────

const MONDE_DATA_URL = Deno.env.get('MONDE_DATA_URL') ??
  'https://szyrzxvlptqqheizyrxu.supabase.co/functions/v1/monde-data'
const MAX_PAGES = 20          // ~1.000 vendas mais recentes por execução
const LIST_PAGE_SIZE = 50     // vendas por página da lista (mantém a semântica de MAX_PAGES)
const DETAIL_CONCURRENCY = 12 // requisições de detalhe em paralelo (~10 req/s, sem rate-limit)
const INSERT_BATCH = 500
const DELETE_BATCH = 200
const CUTOFF = '2026-01-01'   // só processa vendas a partir desta data (janela 2026)
const FILENAME_PREFIX = 'monde-api-'

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface MondeProduct {
  status?: string
  canceled_at?: string | null
  supplier?: { name?: string }
  product_name?: string
  totals?: Record<string, number>
}

interface MondeSale {
  sale_id: string
  sale_number: number
  sale_date: string
  status: string
  custom_fields?: Array<{ name: string; value: string | null }>
  travel_agent?: { name?: string }
  payer?: { name?: string }
  intermediary?: { name?: string }
  approver?: { name?: string }  // "Operação Própria" (casal) do Monde
  others?: MondeProduct[]       // produtos avulsos — traz product_name (ex.: "Contrato de casamento")
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

// ─── API de Dados do Monde ─────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

async function dataFetch(params: Record<string, string | number>, apiKey: string): Promise<Response> {
  const url = new URL(MONDE_DATA_URL)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url.toString(), {
      headers: { 'x-api-key': apiKey, Accept: 'application/json' },
    })
    if ([408, 429, 500, 502, 503, 504].includes(res.status)) {
      await sleep(1000 * Math.pow(2, attempt))
      continue
    }
    return res
  }
  throw new Error('API de Dados do Monde indisponível após 4 tentativas')
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

interface SaleListItem { sale_number: string; sale_id: string }

async function getSalesListPage(page: number, apiKey: string): Promise<{ data: SaleListItem[]; total: number }> {
  const res = await dataFetch({ resource: 'sales', page, page_size: LIST_PAGE_SIZE }, apiKey)
  if (!res.ok) throw new Error(`API de Dados do Monde (sales pág ${page}) ${res.status}`)
  const text = await res.text()
  let json: { data?: SaleListItem[]; total?: number }
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`API de Dados do Monde (sales pág ${page}) resposta não-JSON: ${text.slice(0, 200)}`)
  }
  return { data: json.data ?? [], total: json.total ?? 0 }
}

// deno-lint-ignore no-explicit-any
function reconstructSaleFromDetail(detail: any): MondeSale {
  const byKind: Record<string, MondeProduct[]> = {}
  for (const p of (detail.products ?? [])) {
    const kind = String(p.product_kind ?? '')
    if (!kind) continue
    ;(byKind[kind] ??= []).push({
      status: p.status ?? undefined,
      canceled_at: p.canceled_at ?? null,
      supplier: { name: p.supplier_name ?? undefined },
      product_name: p.product_name ?? p.description ?? undefined,
      totals: { amount: Number(p.total_amount ?? 0) },
    })
  }
  return {
    sale_id: String(detail.sale_id ?? ''),
    sale_number: Number(detail.sale_number ?? 0),
    sale_date: String(detail.sale_date ?? ''),
    status: String(detail.status ?? ''),
    custom_fields: detail.custom_fields ?? [],
    travel_agent: { name: detail.travel_agent_name ?? undefined },
    payer: { name: detail.payer_name ?? undefined },
    approver: { name: detail.approver_name ?? undefined },
    others: byKind['others'],
    hotels: byKind['hotels'],
    airline_tickets: byKind['airline_tickets'],
    cruises: byKind['cruises'],
    insurances: byKind['insurances'],
    train_tickets: byKind['train_tickets'],
    ground_transportations: byKind['ground_transportations'],
    car_rentals: byKind['car_rentals'],
    travel_packages: byKind['travel_packages'],
    totals: { final_value: Number(detail.total_final_value ?? 0), revenue: Number(detail.total_revenue ?? 0) },
  }
}

/** Detalhe de uma venda → objeto formato Monde v3 (campo `raw`).
 *  Isola falhas por venda (poison-pill): um detalhe que falhe não derruba a página
 *  (Promise.all) nem trava o sync — a venda é pulada/registrada e volta num próximo
 *  ciclo (o dedup só afeta os números buscados). */
async function getSaleRaw(saleId: string, apiKey: string): Promise<MondeSale | null> {
  try {
    const res = await dataFetch({ resource: 'sale', id: saleId }, apiKey)
    if (!res.ok) {
      if (res.status === 404) return null
      throw new Error(`sale ${res.status}`)
    }
    const body = await res.json()
    const detail = body?.data
    if (!detail) return null
    const raw = detail.raw
    if (raw && typeof raw === 'object') return raw as MondeSale
    return reconstructSaleFromDetail(detail)
  } catch (err) {
    console.warn(`[monde-sync] detalhe da venda ${saleId} pulado: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

/** Uma página: lista os identificadores e resolve o detalhe (`raw`) de cada venda. */
async function getPage(page: number, apiKey: string): Promise<{ data: MondeSale[]; totalPages: number; total: number }> {
  const list = await getSalesListPage(page, apiKey)
  const totalPages = Math.max(1, Math.ceil(list.total / LIST_PAGE_SIZE))
  const raws = await mapWithConcurrency(list.data, DETAIL_CONCURRENCY, (it) => getSaleRaw(it.sale_id, apiKey))
  return { data: raws.filter((s): s is MondeSale => s !== null), totalPages, total: list.total }
}

/** Varre MAX_PAGES em sequência (cada página já paraleliza os detalhes). */
async function scanPages(apiKey: string): Promise<{ sales: MondeSale[]; totalPages: number; pagesScanned: number }> {
  const first = await getPage(1, apiKey)
  const totalPages = first.totalPages
  const sales: MondeSale[] = [...first.data]
  let pagesScanned = 1
  if (first.total === 0) return { sales, totalPages, pagesScanned }

  // Termina em lastPage: total_pages = ceil(total/50) e as páginas do mirror são
  // contíguas. `total` é global (igual em toda página), então não serve de sinal de fim.
  const lastPage = Math.min(MAX_PAGES, totalPages)
  for (let p = 2; p <= lastPage; p++) {
    const r = await getPage(p, apiKey)
    pagesScanned++
    sales.push(...r.data)
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
  const enriched = prods.map((p) => ({
    status: p.status ?? '',
    amount: (p.totals as Record<string, number> | undefined)?.amount ?? 0,
  }))
  const activeAmount = enriched.filter((p) => p.status === 'active').reduce((s, p) => s + p.amount, 0)
  const canceledAmount = enriched.filter((p) => p.status === 'canceled').reduce((s, p) => s + p.amount, 0)
  const knownTotal = activeAmount + canceledAmount
  const scaledRevenue = knownTotal > 0 ? (sale.totals?.revenue ?? 0) * (activeAmount / knownTotal) : 0
  return { valorTotal: activeAmount, receita: scaledRevenue }
}

function inferProduto(sale: MondeSale): string | null {
  // A API de Dados entrega o produto real em `others[].product_name` (ex.: "Contrato de
  // casamento", que antes não vinha). Detecta contrato de casamento direto da fonte.
  if ((sale.others ?? []).some((p) =>
    (p.product_name ?? '').trim().toLowerCase() === 'contrato de casamento' &&
    p.status !== 'canceled' && p.status !== 'deleted' && !p.canceled_at)) return 'Contrato de casamento'
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
  for (const key of PRODUCT_KEYS) {
    const arr = sale[key] as MondeProduct[] | undefined
    const name = arr?.[0]?.supplier?.name
    if (name) return name
  }
  return null
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ─── CORS ───────────────────────────────────────────────────────────────────
// Permite que o botão "Atualizar" do dashboard (outro domínio: Vercel) chame esta
// função pelo navegador. O preflight OPTIONS é liberado pelo gateway do Supabase
// mesmo com verify_jwt ligado; a chamada real (POST) envia a anon key como Bearer.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ─── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const apiKey = Deno.env.get('MONDE_DATA_API_KEY')
  if (!apiKey) return json({ ok: false, error: 'MONDE_DATA_API_KEY não configurado' }, 500)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const startedAt = new Date().toISOString()
  try {
    // 1. Buscar páginas
    const { sales: rawSales, totalPages, pagesScanned } = await scanPages(apiKey)

    // 2. Janela (>= CUTOFF) + cancelamento
    // Lista de cancelamento MANUAL (tabela vendas_canceladas): a API não expõe o
    // cancelamento de algumas vendas (ex.: "Data Cancelamento" preenchida só no
    // relatório do Monde, sem produto/refund detectável). Essas ficam nessa lista e
    // são excluídas aqui — não reinseridas E removidas do banco se já existirem
    // (pois entram em vendaNumeros e o dedup do passo 3 as apaga sem reinserir).
    const { data: cancRows } = await supabase.from('vendas_canceladas').select('venda_numero')
    const canceladasManual = new Set((cancRows ?? []).map((r: { venda_numero: number }) => r.venda_numero))
    const inWindow = rawSales.filter((s) => !!s.sale_date && s.sale_date >= CUTOFF)
    const cancelledCount = inWindow.filter((s) => isCancelled(s) || canceladasManual.has(s.sale_number)).length
    const activeSales = inWindow.filter((s) => !isCancelled(s) && !canceladasManual.has(s.sale_number))
    const vendaNumeros = [...new Set(inWindow.map((s) => s.sale_number))]

    // 3. Dedup por número da venda + carry-forward do produto existente
    let salesDeleted = 0
    const affectedUploadIds = new Set<string>()
    const existingProduto = new Map<number, string>()
    for (const numeros of chunk(vendaNumeros, DELETE_BATCH)) {
      const { data: rows } = await supabase
        .from('vendas').select('venda_numero, upload_id, produto').in('venda_numero', numeros)
      for (const r of rows ?? []) {
        if (r.upload_id) affectedUploadIds.add(r.upload_id)
        if (r.produto && !existingProduto.has(r.venda_numero)) existingProduto.set(r.venda_numero, r.produto)
      }
      salesDeleted += rows?.length ?? 0
      const { error: delErr } = await supabase.from('vendas').delete().in('venda_numero', numeros)
      if (delErr) throw new Error(`Erro ao apagar lote: ${delErr.message}`)
    }

    if (activeSales.length === 0) {
      await cleanOrphans(supabase, [...affectedUploadIds])
      return json({ ok: true, startedAt, salesFetched: rawSales.length, cancelledSkipped: cancelledCount, salesInserted: 0, salesDeleted })
    }

    // 4. Registro de upload
    const today = new Date().toISOString().slice(0, 10)
    const { data: uploadRecord, error: upErr } = await supabase
      .from('uploads')
      .insert({
        nome_arquivo: `${FILENAME_PREFIX}edge-${today}`,
        total_linhas: activeSales.length,
        linhas_inseridas: activeSales.length,
        linhas_atualizadas: salesDeleted,
        alertas_qualidade: [],
        status: 'success',
      })
      .select('id').single()
    if (upErr || !uploadRecord) throw new Error(`Erro upload: ${upErr?.message}`)
    const uploadId = uploadRecord.id

    // 5. Mapear (carry-forward de produto quando a API não traz) e inserir
    const vendas = activeSales.map((s) => {
      const setorBruto = inferSetorBruto(s)
      const { valorTotal, receita } = computeActiveAmounts(s)
      let produto = inferProduto(s)
      if (produto == null) {
        const prev = existingProduto.get(s.sale_number)
        if (prev) produto = prev
      }
      return {
        upload_id: uploadId,
        venda_numero: s.sale_number,
        vendedor: s.travel_agent?.name ?? 'Sem vendedor',
        data_venda: s.sale_date,
        pagante: s.payer?.name ?? s.intermediary?.name ?? 'Sem cliente',
        setor_bruto: setorBruto,
        setor_grupo: mapSetor(setorBruto),
        produto,
        fornecedor: inferFornecedor(s),
        representante: null,
        operacao: s.approver?.name ?? null,
        valor_total: valorTotal,
        receitas: receita,
        faturamento: valorTotal,
        situacao: s.status === 'opened' ? 'Aberta' : 'Fechada',
      }
    })

    for (const batch of chunk(vendas, INSERT_BATCH)) {
      const { error } = await supabase.from('vendas').insert(batch)
      if (error) {
        await supabase.from('uploads').update({ status: 'error' }).eq('id', uploadId)
        throw new Error(`Erro insert: ${error.message}`)
      }
    }

    await cleanOrphans(supabase, [...affectedUploadIds], uploadId)

    const dates = activeSales.map((s) => s.sale_date).filter(Boolean).sort()
    const result = {
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      pagesScanned,
      totalPages,
      salesFetched: rawSales.length,
      cancelledSkipped: cancelledCount,
      salesInserted: vendas.length,
      salesDeleted,
      dateRange: { min: dates[0], max: dates[dates.length - 1] },
      indefinidoCount: vendas.filter((v) => v.setor_grupo === 'INDEFINIDO').length,
    }
    console.log('[monde-sync]', JSON.stringify(result))
    return json(result, 200)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[monde-sync] ERRO:', msg)
    return json({ ok: false, startedAt, error: msg }, 500)
  }
})

// deno-lint-ignore no-explicit-any
async function cleanOrphans(supabase: any, uploadIds: string[], keepId?: string): Promise<void> {
  for (const uid of uploadIds) {
    if (uid === keepId) continue
    const { count } = await supabase.from('vendas').select('*', { count: 'exact', head: true }).eq('upload_id', uid)
    if ((count ?? 0) === 0) await supabase.from('uploads').delete().eq('id', uid)
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
