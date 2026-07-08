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
const MAX_PAGES = 10          // páginas da LISTA varridas (barato: 1 req/página, ~500 vendas recentes)
const LIST_PAGE_SIZE = 50     // vendas por página da lista (mantém a semântica de MAX_PAGES)
const DETAIL_CONCURRENCY = 12 // requisições de detalhe em paralelo (~10 req/s)
// Teto de DETALHES buscados por execução. O sync incremental só busca detalhe das
// vendas novas/alteradas (tipicamente algumas dezenas), muito abaixo do rate-limiter
// de saída do Edge Runtime. Este teto é o cinto de segurança: se um ciclo tiver muitas
// mudanças (ex.: 1º run após período parado), processa as mais recentes e deixa o resto
// para o próximo ciclo — nunca dispara ~1.000 fetches de uma vez (o que estourava o limite).
const MAX_DETAILS = 150
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
  cvc_packages?: MondeProduct[]  // pacotes CVC (product_name real)
  operations?: MondeProduct[]    // itens de operação (product_name = "X -/G -/W - ..."); ENTRA no final_value
  totals?: { final_value: number; revenue: number }
}

// `operations` e `cvc_packages` INCLUÍDOS: entram no final_value e viram linha de
// produto. `others` idem (Contrato/Bloqueio/etc.) — sem ele o cancelamento de venda
// cujo único produto está em `others` passava despercebido.
const PRODUCT_KEYS = [
  'hotels', 'airline_tickets', 'cruises', 'insurances', 'train_tickets',
  'ground_transportations', 'car_rentals', 'travel_packages',
  'cvc_packages', 'operations', 'others',
] as const

/** kind estruturado → nome de operação do Monde. `others`/`operations`/`cvc_packages`
 *  usam o product_name real da API. */
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

// A lista (`resource=sales`) já traz status/valores/contagem de itens sem custo de
// detalhe — é a base do sync incremental para decidir o que mudou.
interface SaleListItem {
  sale_number: string
  sale_id: string
  sale_date?: string
  status?: string                 // 'opened' | 'closed'
  total_final_value?: number      // BRUTO (inclui cancelados; bate com raw.totals.final_value)
  total_revenue?: number
  product_count?: number
  custom_fields?: Array<{ name: string; value: string | null }>  // traz "Setor" sem custo de detalhe
}

/** Linha da lista já normalizada — o que dá para saber SEM buscar o detalhe. */
interface SaleListRow {
  sale_number: number
  sale_id: string
  sale_date: string
  status: string
  total_final_value: number       // bruto — só para DETECTAR mudança, não para persistir
  total_revenue: number
  product_count: number
  setorBruto: string | null        // custom field "Setor" — detecta troca de setor sem detalhe
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
    setorBruto: (it.custom_fields ?? []).find((f) => f.name === 'Setor')?.value ?? null,
  }
}

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
    const msg = err instanceof Error ? err.message : String(err)
    // Rate-limit de SAÍDA do runtime não é erro DA venda: relança para o chamador
    // (fetchDetails) parar e marcar o resto como pendente — em vez de "pular" a venda
    // (o que, num caminho que apaga+reinsere, poderia perder o dado atual).
    if (/rate.?limit/i.test(msg)) throw err
    console.warn(`[monde-sync] detalhe da venda ${saleId} pulado: ${msg}`)
    return null
  }
}

/** Varre MAX_PAGES da LISTA apenas (SEM buscar detalhe de nada). Barato: 1 requisição
 *  por página (~50 vendas). A lista já traz status/valores/itens — suficiente para o
 *  sync incremental decidir o que mudou. É o que evita o rate-limiter: antes, cada
 *  página resolvia ~50 detalhes (=~1.000 fetches/execução). */
async function scanSalesList(apiKey: string): Promise<{ rows: SaleListRow[]; totalPages: number; pagesScanned: number }> {
  const first = await getSalesListPage(1, apiKey)
  const totalPages = Math.max(1, Math.ceil(first.total / LIST_PAGE_SIZE))
  const rows: SaleListRow[] = first.data.map(toSaleListRow)
  let pagesScanned = 1
  if (first.total === 0) return { rows, totalPages, pagesScanned }

  // `total` é global (igual em toda página); o fim é lastPage = min(MAX_PAGES, totalPages).
  const lastPage = Math.min(MAX_PAGES, totalPages)
  for (let p = 2; p <= lastPage; p++) {
    const r = await getSalesListPage(p, apiKey)
    pagesScanned++
    rows.push(...r.data.map(toSaleListRow))
  }
  return { rows, totalPages, pagesScanned }
}

/** Detalhe (`raw`) das vendas passadas, em ondas de DETAIL_CONCURRENCY. Para na 1ª onda
 *  que bater no rate-limiter de SAÍDA do runtime; as vendas não buscadas ficam pendentes
 *  para o próximo ciclo. Retorna quais foram buscadas com sucesso + se houve throttle —
 *  o chamador só apaga/reinsere o que veio aqui (nunca o pendente). */
async function fetchDetails(saleIds: string[], apiKey: string): Promise<{ sales: MondeSale[]; throttled: boolean }> {
  const sales: MondeSale[] = []
  let throttled = false
  for (let i = 0; i < saleIds.length && !throttled; i += DETAIL_CONCURRENCY) {
    const wave = saleIds.slice(i, i + DETAIL_CONCURRENCY)
    const results = await Promise.all(wave.map(async (id) => {
      try {
        return { sale: await getSaleRaw(id, apiKey) }
      } catch (_err) {
        return { throttled: true as const }  // getSaleRaw só relança em rate-limit
      }
    }))
    for (const r of results) {
      if ('throttled' in r) throttled = true
      else if (r.sale) sales.push(r.sale)
    }
  }
  return { sales, throttled }
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

interface ProdutoLinha { produto: string | null; amount: number; fornecedor: string | null }

/** Uma linha por produto ATIVO (cancelados/deletados fora = "Situação Produto: Ativo"). */
function activeProductLines(sale: MondeSale): ProdutoLinha[] {
  const lines: ProdutoLinha[] = []
  for (const key of PRODUCT_KEYS) {
    const arr = sale[key] as MondeProduct[] | undefined
    if (!arr?.length) continue
    for (const p of arr) {
      if (isInactive(p)) continue
      const produto = key === 'others' || key === 'operations' || key === 'cvc_packages'
        ? (p.product_name?.trim() || null)
        : (KIND_PRODUTO[key] ?? null)
      const amount = (p.totals as Record<string, number> | undefined)?.amount ?? 0
      lines.push({ produto, amount, fornecedor: p.supplier?.name ?? null })
    }
  }
  return lines
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
    // 1. Varre SÓ a lista (barato) — a lista vem da mais recente p/ a mais antiga.
    const { rows, totalPages, pagesScanned } = await scanSalesList(apiKey)

    // 2. Janela 2026 (a lista já traz sale_date).
    const inWindow = rows.filter((r) => !!r.sale_date && r.sale_date >= CUTOFF)

    // 3. Cancelamento MANUAL (tabela vendas_canceladas): a API não expõe o cancelamento
    //    de algumas vendas. Essas nunca são reinseridas E são removidas se ainda existirem.
    const { data: cancRows } = await supabase.from('vendas_canceladas').select('venda_numero')
    const canceladasManual = new Set((cancRows ?? []).map((r: { venda_numero: number }) => r.venda_numero))

    // 4. Estado atual no banco para os números vistos (agrega por número: o Excel pode
    //    ter várias linhas por venda; a API colapsa em uma). valor/receita são somados.
    const seenNumeros = [...new Set(inWindow.map((r) => r.sale_number))]
    interface DbAgg { situacao: string | null; valor_total: number; receitas: number; produto: string | null; setorBruto: string | null; uploadIds: Set<string> }
    const dbState = new Map<number, DbAgg>()
    for (const numeros of chunk(seenNumeros, DELETE_BATCH)) {
      const { data: dbRows } = await supabase
        .from('vendas').select('venda_numero, situacao, valor_total, receitas, produto, setor_bruto, upload_id').in('venda_numero', numeros)
      for (const r of dbRows ?? []) {
        const cur = dbState.get(r.venda_numero) ?? { situacao: r.situacao, valor_total: 0, receitas: 0, produto: null, setorBruto: null, uploadIds: new Set<string>() }
        cur.valor_total += Number(r.valor_total ?? 0)
        cur.receitas += Number(r.receitas ?? 0)
        cur.situacao = r.situacao
        if (r.produto && !cur.produto) cur.produto = r.produto
        if (r.setor_bruto && !cur.setorBruto) cur.setorBruto = r.setor_bruto
        if (r.upload_id) cur.uploadIds.add(r.upload_id)
        dbState.set(r.venda_numero, cur)
      }
    }

    // 5. Delta: novas / alteradas (status, valor bruto, receita) + canceladas-manuais presentes.
    //    Numa venda SEM cancelamento, o valor_total salvo já bate com o total_final_value
    //    da lista → "inalterada" → não busca detalhe (por isso não há enxurrada no 1º run).
    const EPS = 0.01
    const mapStatus = (s: string) => (s === 'opened' ? 'Aberta' : 'Fechada')
    const changes: Array<{ row: SaleListRow; motivo: string }> = []
    let unchanged = 0
    for (const r of inWindow) {
      const d = dbState.get(r.sale_number)
      if (canceladasManual.has(r.sale_number)) {
        if (d) changes.push({ row: r, motivo: 'cancelada-manual' }); else unchanged++
        continue
      }
      if (!d) { changes.push({ row: r, motivo: 'nova' }); continue }
      if (mapStatus(r.status) !== (d.situacao ?? '')) { changes.push({ row: r, motivo: 'status' }); continue }
      if (Math.abs(r.total_final_value - d.valor_total) >= EPS) { changes.push({ row: r, motivo: 'valor' }); continue }
      if (Math.abs(r.total_revenue - d.receitas) >= EPS) { changes.push({ row: r, motivo: 'receita' }); continue }
      // Troca de setor: não mexe em valor/status/receita, então só a lista (custom field
      // "Setor") a revela. Sem isso, mudar o setor no Monde não refletia no dash.
      if ((r.setorBruto ?? '') !== (d.setorBruto ?? '')) { changes.push({ row: r, motivo: 'setor' }); continue }
      unchanged++
    }
    const novas = changes.filter((c) => c.motivo === 'nova').length
    const alteradas = changes.filter((c) => c.motivo === 'status' || c.motivo === 'valor' || c.motivo === 'receita' || c.motivo === 'setor').length

    // 6. Cap de segurança: as mais recentes vêm primeiro; o excedente fica p/ o próximo ciclo.
    const toProcess = changes.length > MAX_DETAILS ? changes.slice(0, MAX_DETAILS) : changes

    // Nada mudou → early return (caso comum; nenhum detalhe buscado, nada gravado).
    const deltaNumeros = [...new Set(toProcess.map((c) => c.row.sale_number))]
    if (deltaNumeros.length === 0) {
      return json({ ok: true, startedAt, pagesScanned, totalPages, listInWindow: inWindow.length, unchanged, novas: 0, alteradas: 0, detailsFetched: 0, salesInserted: 0, salesDeleted: 0, cancelledSkipped: 0, throttled: false, pending: 0 })
    }

    // 7. Busca o detalhe SÓ das novas/alteradas (canceladas-manuais só saem do banco).
    //    Para no 1º throttle; o resto fica pendente p/ o próximo ciclo.
    const fetchIds = toProcess.filter((c) => c.motivo !== 'cancelada-manual').map((c) => c.row.sale_id)
    const { sales: raws, throttled } = await fetchDetails(fetchIds, apiKey)

    // 8. Cancelamento (produto/refund detectável) + manual.
    const cancelledCount = raws.filter((s) => isCancelled(s) || canceladasManual.has(s.sale_number)).length
    const activeSales = raws.filter((s) => !isCancelled(s) && !canceladasManual.has(s.sale_number))

    // Mexe no banco SÓ no que foi RESOLVIDO agora: detalhe buscado OU cancelamento manual.
    // O pendente (throttle/cap) NÃO é apagado — preserva o dado atual e volta no próximo
    // ciclo. (Sem isso, uma venda ALTERADA que sofresse throttle seria apagada sem
    // reinserir o detalhe novo → perda de dado.)
    const manualNumeros = toProcess.filter((c) => c.motivo === 'cancelada-manual').map((c) => c.row.sale_number)
    const resolvedNumeros = [...new Set([...raws.map((s) => s.sale_number), ...manualNumeros])]

    // 9. Carry-forward de produto (Excel) + uploads afetados, só dos resolvidos.
    const existingProduto = new Map<number, string>()
    const affectedUploadIds = new Set<string>()
    for (const num of resolvedNumeros) {
      const agg = dbState.get(num)
      if (!agg) continue
      if (agg.produto) existingProduto.set(num, agg.produto)
      agg.uploadIds.forEach((uid) => affectedUploadIds.add(uid))
    }

    // 10. Dedup: apaga só os números resolvidos.
    let salesDeleted = 0
    for (const numeros of chunk(resolvedNumeros, DELETE_BATCH)) {
      const { count } = await supabase.from('vendas').select('*', { count: 'exact', head: true }).in('venda_numero', numeros)
      salesDeleted += count ?? 0
      const { error: delErr } = await supabase.from('vendas').delete().in('venda_numero', numeros)
      if (delErr) throw new Error(`Erro ao apagar lote: ${delErr.message}`)
    }

    // 11. Inserir as ativas (se houver) sob um novo registro de upload.
    let uploadId = ''
    let inserted = 0
    if (activeSales.length > 0) {
      const today = new Date().toISOString().slice(0, 10)
      const { data: uploadRecord, error: upErr } = await supabase
        .from('uploads')
        .insert({
          nome_arquivo: `${FILENAME_PREFIX}delta-${today}`,
          total_linhas: activeSales.length,
          linhas_inseridas: activeSales.length,
          linhas_atualizadas: salesDeleted,
          alertas_qualidade: [],
          status: 'success',
        })
        .select('id').single()
      if (upErr || !uploadRecord) throw new Error(`Erro upload: ${upErr?.message}`)
      uploadId = uploadRecord.id

      // UMA LINHA POR PRODUTO ATIVO (como o relatório "Vendas por produto"). Receita
      // rateada por valor. Carry-forward do produto (Excel) quando a linha vem nula.
      const vendas = activeSales.flatMap((s) => {
        const setorBruto = inferSetorBruto(s)
        const setorGrupo = mapSetor(setorBruto)
        const prev = existingProduto.get(s.sale_number)
        const base = {
          upload_id: uploadId,
          venda_numero: s.sale_number,
          vendedor: s.travel_agent?.name ?? 'Sem vendedor',
          data_venda: s.sale_date,
          pagante: s.payer?.name ?? s.intermediary?.name ?? 'Sem cliente',
          setor_bruto: setorBruto,
          setor_grupo: setorGrupo,
          representante: null,
          operacao: s.approver?.name ?? null,
          situacao: s.status === 'opened' ? 'Aberta' : 'Fechada',
          data_cancelamento: null, // sync só grava produtos ativos
        }
        const lines = activeProductLines(s)
        const { valorTotal, receita } = computeActiveAmounts(s)
        const totalAmount = lines.reduce((sum, l) => sum + l.amount, 0)
        // Trava: só divide se a soma bate com o valor ativo; senão 1 linha agregada.
        const reconcilia = lines.length > 0 && Math.abs(totalAmount - valorTotal) <= 0.01
        if (!reconcilia) {
          return [{ ...base, produto: prev ?? null, fornecedor: inferFornecedor(s), valor_total: valorTotal, receitas: receita, faturamento: valorTotal }]
        }
        return lines.map((l) => ({
          ...base,
          produto: l.produto ?? prev ?? null,
          fornecedor: l.fornecedor,
          valor_total: l.amount,
          receitas: totalAmount > 0 ? Math.round((receita * l.amount / totalAmount) * 100) / 100 : 0,
          faturamento: l.amount,
        }))
      })

      for (const batch of chunk(vendas, INSERT_BATCH)) {
        const { error } = await supabase.from('vendas').insert(batch)
        if (error) {
          await supabase.from('uploads').update({ status: 'error' }).eq('id', uploadId)
          throw new Error(`Erro insert: ${error.message}`)
        }
      }
      inserted = vendas.length
    }

    await cleanOrphans(supabase, [...affectedUploadIds], uploadId || undefined)

    // Pendentes = mudanças detectadas que NÃO foram resolvidas agora (throttle + excedente
    // do cap). Drenam nos próximos ciclos (cron 3x/dia) ou em novos cliques.
    const pending = Math.max(0, changes.length - raws.length - manualNumeros.length)
    const dates = activeSales.map((s) => s.sale_date).filter(Boolean).sort()
    const result = {
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      pagesScanned,
      totalPages,
      listInWindow: inWindow.length,
      unchanged,
      novas,
      alteradas,
      detailsFetched: raws.length,
      cancelledSkipped: cancelledCount,
      salesInserted: inserted,
      salesDeleted,
      throttled,
      pending,
      dateRange: dates.length ? { min: dates[0], max: dates[dates.length - 1] } : null,
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
