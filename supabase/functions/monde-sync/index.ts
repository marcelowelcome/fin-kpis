/**
 * Supabase Edge Function: monde-sync
 *
 * Sincroniza as vendas mais recentes da API Monde v3 → tabela `vendas`, rodando
 * 100% no Supabase (sem depender do Vercel). Agendável via Supabase Cron.
 *
 * Dedup por NÚMERO DA VENDA (sem perda): apaga só os números buscados e reinsere os
 * ativos — não apaga por intervalo de datas (que subnotificava a faixa recente).
 * Janela: só processa vendas com data_venda >= CUTOFF (preserva histórico anterior).
 * Carry-forward: se a API não traz produto (típico em casamentos) mas já havia um
 * produto (do Excel), preserva-o — não apaga a info que alimenta o KPI de contratos.
 *
 * Secrets (Supabase → Edge Functions → Secrets) — já configurados:
 *   MONDE_V3_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (injetados/automáticos).
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

// ─── Configuração ─────────────────────────────────────────────────────────────

const MONDE_BASE = 'https://web.monde.com.br/api/v3'
const MAX_PAGES = 20          // ~1.000 vendas mais recentes por execução
const CONCURRENCY = 4         // páginas buscadas em paralelo (rate limit folgado)
const INSERT_BATCH = 500
const DELETE_BATCH = 200
const CUTOFF = '2026-01-01'   // só processa vendas a partir desta data (janela 2026)
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

async function mondeFetch(page: number, token: string): Promise<Response> {
  const url = new URL(`${MONDE_BASE}/sales`)
  url.searchParams.set('page', String(page))
  url.searchParams.set('size', '100')
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

async function getPage(page: number, token: string): Promise<{ data: MondeSale[]; totalPages: number }> {
  const res = await mondeFetch(page, token)
  if (!res.ok) throw new Error(`Monde API ${res.status}`)
  const json = await res.json()
  return { data: json.data ?? [], totalPages: json.pagination?.total_pages ?? 1 }
}

/** Busca MAX_PAGES com concorrência limitada. Ordem das vendas não importa. */
async function scanPages(token: string): Promise<{ sales: MondeSale[]; totalPages: number; pagesScanned: number }> {
  const first = await getPage(1, token)
  const totalPages = first.totalPages
  const sales: MondeSale[] = [...first.data]
  let pagesScanned = 1
  if (!first.data.length) return { sales, totalPages, pagesScanned }

  const lastPage = Math.min(MAX_PAGES, totalPages)
  const queue: number[] = []
  for (let p = 2; p <= lastPage; p++) queue.push(p)

  let next = 0
  let stop = false
  async function worker() {
    while (!stop) {
      const i = next++
      if (i >= queue.length) return
      const r = await getPage(queue[i], token)
      pagesScanned++
      if (!r.data.length) { stop = true; return }
      sales.push(...r.data)
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()))
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

  const mondeKey = Deno.env.get('MONDE_V3_API_KEY')
  if (!mondeKey) return json({ ok: false, error: 'MONDE_V3_API_KEY não configurado' }, 500)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const startedAt = new Date().toISOString()
  try {
    // 1. Buscar páginas
    const { sales: rawSales, totalPages, pagesScanned } = await scanPages(mondeKey)

    // 2. Janela (>= CUTOFF) + cancelamento
    const inWindow = rawSales.filter((s) => !!s.sale_date && s.sale_date >= CUTOFF)
    const cancelledCount = inWindow.filter(isCancelled).length
    const activeSales = inWindow.filter((s) => !isCancelled(s))
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
