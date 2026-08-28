/**
 * Supabase Edge Function: monde-sync
 *
 * Sincroniza a **API de Dados do Monde** (espelho somente-leitura) → tabela `vendas`.
 * Roda 100% no Supabase (o Vercel não tem a MONDE_DATA_API_KEY), acionada pelo pg_cron
 * e pelo botão "Atualizar" do dashboard.
 *
 * ── Por que este arquivo foi reescrito (2026-08-27) ─────────────────────────────
 * A versão anterior lia `resource=sales` (lista) + `resource=sale&id=…` (detalhe) e
 * mapeava o bloco `raw`, que é o objeto cru do Monde. Todo bug de sync de 2026 nasceu
 * dali, porque o Monde reescreve o `raw` sem avisar:
 *   2026-08-05  `product_name` sumiu de others/operations   → produto = null
 *   2026-08-13  `totals.final_value` → `final_amount`       → valor_total = 0
 *   2026-08-13  `custom_fields` perdeu `name`               → setor_bruto = null
 *   2026-08-13  `travel_agent` sumiu                        → "Sem vendedor"
 *   2026-08-14  `approver` sumiu                            → operacao = null (13 dias)
 * E era estruturalmente cego a dois erros de dinheiro:
 *   • VENDA CANCELADA ficava somada para sempre — a listagem sem `from`/`to` não
 *     devolve venda cancelada, então o delta nunca a revisitava para apagá-la.
 *     Medido em 2026-08-27: 17 vendas, R$ 45.079,69 de valor / R$ 15.765,93 de receita.
 *   • CANCELAMENTO PARCIAL era matematicamente invisível: o delta comparava o
 *     `total_final_value` da lista (BRUTO, inclui produto cancelado) com o `valor_total`
 *     gravado (LÍQUIDO). Em 264/264 vendas de 2026 com produto cancelado o bruto não se
 *     move ao cancelar um produto, então a checagem não podia funcionar.
 *
 * Agora usamos DOIS FEEDS PLANOS, com nomes de campo estáveis e valores já resolvidos:
 *   `resource=sales`    → nível VENDA:  status, Setor, vendedor, pagante, receita, casal
 *   `resource=products` → nível LINHA:  product_status, produto, fornecedor, valor
 * Nenhum basta sozinho (`products` não tem receita/setor/vendedor/pagante; `sales` não
 * tem status por produto). A junção é por `sale_number`. Zero chamada de detalhe.
 *
 * ── Régua de soma (a mesma do relatório do Monde) ──────────────────────────────
 *   1. fora as vendas com `sale_status = 'canceled'`;
 *   2. nas que sobram, somar SÓ as linhas com `product_status = 'active'`.
 * `canceled_at` NÃO serve de sinal: vem vazio nas linhas `deleted` e nas vendas
 * canceladas por inteiro. Só `status` decide.
 *
 * ── Modos ─────────────────────────────────────────────────────────────────────
 *   delta      (default) — usa `synced_since` (marca d'água em `sync_state`) para
 *                          descobrir QUAIS MESES tiveram releitura e lê esses meses
 *                          POR INTEIRO. Ler o mês inteiro é deliberado: em delta puro a
 *                          venda pode vir relida sem as linhas dela (ou o contrário), e
 *                          então uma venda viva pareceria "sem produto ativo" e seria
 *                          apagada por engano.
 *   reconcile           — varre a janela inteira por data. É o que garante o número.
 *
 * Secrets (Supabase → Edge Functions → Secrets):
 *   MONDE_DATA_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'

// ─── Configuração ─────────────────────────────────────────────────────────────

const MONDE_DATA_URL = Deno.env.get('MONDE_DATA_URL') ??
  'https://szyrzxvlptqqheizyrxu.supabase.co/functions/v1/monde-data'

/** Teto real da API; pedir mais é rebaixado (ela informa em `page_size_maximo`). */
const PAGE_SIZE = 200
const INSERT_BATCH = 500
const DELETE_BATCH = 200
/** Janela corrente. Datas anteriores só são tocadas por um reconcile explícito. */
const CUTOFF = '2026-01-01'
const FILENAME_PREFIX = 'monde-api-'
/** Chave em `sync_state` com a marca d'água do `synced_since`. */
const WATERMARK_KEY = 'feed-delta'
/** Folga da marca d'água: sem ela, registro gravado no mesmo instante da leitura
 *  anterior escaparia para sempre. Reler é idempotente, então o custo é zero. */
const WATERMARK_OVERLAP_MS = 30 * 60 * 1000

// ─── Setor ────────────────────────────────────────────────────────────────────
// Mesma lógica de lib/setor-mapper.ts (normalizado + keywords). A versão anterior
// desta função usava um mapa com match EXATO e sensível a caixa, que divergia do
// dashboard: "corporativo" minúsculo caía em INDEFINIDO aqui e em CORP lá.

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
 * kind estruturado → rótulo de produto.
 * CONTINUA NECESSÁRIO: `product_name_resolvido` é nulo em 100% das linhas de
 * hospedagem, aéreo, seguro, locação e pacote — o Monde só manda código de catálogo em
 * `others`/`operations`, e a origem não tem o dado. Usar só os campos `_resolvido`
 * zeraria o rótulo de ~79% das linhas.
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

// ─── Tipos ────────────────────────────────────────────────────────────────────

interface FeedSale {
  sale_number: number
  sale_date: string
  status: string
  setor_bruto: string | null
  vendedor: string | null
  pagante: string | null
  operacao: string | null
  receita: number
  synced_at: string | null
}

interface FeedLine {
  sale_number: number
  product_status: string
  produto: string | null
  fornecedor: string | null
  valor: number
}

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

// ─── HTTP ─────────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/**
 * Intervalo mínimo entre requisições de SAÍDA.
 *
 * O Edge Runtime do Supabase limita as requisições que a função faz para fora e, quando
 * estoura, LANÇA um erro ("Rate limit exceeded for trace …. Retry after 45822ms") em vez
 * de devolver um status HTTP — então não cai no retry por código de status. Foi o que
 * derrubou o primeiro deploy desta versão: o delta disparava ~64 requisições em rajada.
 * 160 ms ≈ 6 req/s, que passa folgado, e o custo é irrelevante (uma janela de 2 meses
 * são ~40 requisições, ~7 s de espera somada).
 */
const MIN_REQUEST_GAP_MS = 160
let ultimaRequisicao = 0

async function aguardarVez(): Promise<void> {
  const espera = ultimaRequisicao + MIN_REQUEST_GAP_MS - Date.now()
  if (espera > 0) await sleep(espera)
  ultimaRequisicao = Date.now()
}

/** Extrai o "Retry after Nms" da mensagem de rate limit do Edge Runtime. */
function esperaDoRateLimit(msg: string): number | null {
  if (!msg.includes('Rate limit exceeded')) return null
  const m = msg.match(/Retry after (\d+)\s*ms/i)
  return m ? Number(m[1]) : 5000
}

/**
 * GET na API com retry.
 *
 * Desde 2026-08-27 a API devolve 400 em parâmetro desconhecido (antes um typo em `from`
 * devolvia a base inteira com HTTP 200). Falhamos ALTO nesse caso: é uma proteção, e
 * engolir o erro traria de volta exatamente a armadilha que ela consertou.
 * O 500 em offset profundo (~página 360+) segue existindo do lado deles; o retry cobre
 * a intermitência e as janelas mensais mantêm o offset baixo.
 */
async function feedFetch(
  params: Record<string, string | number>,
  apiKey: string,
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const url = new URL(MONDE_DATA_URL)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v))
  const headers = { 'x-api-key': apiKey, Accept: 'application/json' }

  let lastErr = ''
  for (let attempt = 0; attempt < 6; attempt++) {
    await aguardarVez()

    let res: Response
    try {
      res = await fetch(url.toString(), { headers })
    } catch (e) {
      // O rate limit de saída do Edge Runtime chega aqui como exceção, não como status.
      const msg = e instanceof Error ? e.message : String(e)
      const espera = esperaDoRateLimit(msg)
      if (espera !== null && attempt < 5) {
        lastErr = msg
        await sleep(espera + 500)
        continue
      }
      throw e
    }

    if (res.status === 400) {
      const body = await res.json().catch(() => ({}))
      if (body?.desconhecidos?.length) {
        throw new Error(
          `API recusou parâmetro desconhecido: ${body.desconhecidos.join(', ')}. ` +
          `Aceitos em ${params.resource}: ${(body.aceitos_neste_recurso ?? []).join(', ')}`,
        )
      }
      throw new Error(`API 400: ${body?.error ?? '(sem detalhe)'}`)
    }

    if ([408, 429, 500, 502, 503, 504].includes(res.status)) {
      lastErr = `HTTP ${res.status}`
      await sleep(1000 * Math.pow(2, attempt))
      continue
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      throw new Error(`API ${res.status}: ${t.slice(0, 200)}`)
    }
    return await res.json()
  }
  throw new Error(`API de Dados do Monde indisponível após 6 tentativas (${lastErr})`)
}

/**
 * Pagina uma listagem até a página curta, MAPEANDO e descartando a linha crua na hora.
 * `products` devolve `raw` + `passengers` (~63% do payload, ~3,4 KB/linha) e não há como
 * pedir sem: acumular um ano cru seriam ~32 MB retidos, o que estoura a Edge.
 */
async function paginar<R>(
  params: Record<string, string | number>,
  apiKey: string,
  // deno-lint-ignore no-explicit-any
  mapear: (row: any) => R,
): Promise<R[]> {
  const out: R[] = []
  let lidas = 0
  let total: number | undefined
  for (let page = 1; page <= 2000; page++) {
    const body = await feedFetch({ ...params, page, page_size: PAGE_SIZE }, apiKey)
    const rows = body?.data ?? []
    if (total === undefined && typeof body?.total === 'number') total = body.total
    for (const r of rows) out.push(mapear(r))
    lidas += rows.length
    // Usa o page_size ECOADO, nunca o pedido: a API rebaixa acima de 200 e avisa em
    // `page_size_maximo`. Comparar com o pedido terminaria o laço na 1ª página.
    const size = body?.page_size_maximo ?? body?.page_size ?? PAGE_SIZE
    if (rows.length < size) break
    if (total !== undefined && lidas >= total) break
  }
  return out
}

/**
 * Remove o placeholder de data que ficou sem preencher no catálogo do Monde
 * ("W - Isabela e Erick - DDMMAA"). São 16 casos em 2026 e esse texto aparece ao
 * cliente no card de Contratos. Datas REAIS ("- 05SEP26") são preservadas.
 */
function limparOperacao(nome: string | null | undefined): string | null {
  if (!nome) return null
  const limpo = nome.replace(/\s*-\s*DDMMAA\s*$/i, '').trim()
  return limpo || null
}

// deno-lint-ignore no-explicit-any
function toFeedSale(r: any): FeedSale {
  const setor = (r.custom_fields ?? [])
    // deno-lint-ignore no-explicit-any
    .find((f: any) => f?.name === 'Setor')?.value ?? null
  return {
    sale_number: Number(r.sale_number),
    sale_date: r.sale_date ?? '',
    status: r.status ?? '',
    setor_bruto: setor,
    vendedor: r.travel_agent_name ?? null,
    pagante: r.payer_name ?? r.intermediary_name_resolvido ?? null,
    operacao: limparOperacao(r.operation_product_name_resolvido),
    receita: Number(r.total_revenue ?? 0),
    synced_at: r.synced_at ?? null,
  }
}

// deno-lint-ignore no-explicit-any
function toFeedLine(r: any): FeedLine {
  const kind = r.product_kind ?? ''
  return {
    sale_number: Number(r.sale_number),
    product_status: r.product_status ?? '',
    produto: (r.product_name_resolvido ?? '').trim() || KIND_PRODUTO[kind] || null,
    fornecedor: (r.supplier_name_resolvido ?? '').trim() || null,
    valor: Number(r.total_amount ?? 0),
  }
}

// ─── Janelas ──────────────────────────────────────────────────────────────────

function janelasMensais(from: string, to: string): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = []
  const [fy, fm] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  let y = fy, m = fm
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

async function lerVendas(
  w: { from: string; to: string; syncedSince?: string },
  apiKey: string,
): Promise<FeedSale[]> {
  const p: Record<string, string | number> = { resource: 'sales', from: w.from, to: w.to }
  if (w.syncedSince) p.synced_since = w.syncedSince
  return await paginar<FeedSale>(p, apiKey, toFeedSale)
}

async function lerLinhas(
  w: { from: string; to: string; syncedSince?: string },
  apiKey: string,
): Promise<FeedLine[]> {
  const p: Record<string, string | number> = { resource: 'products', from: w.from, to: w.to }
  if (w.syncedSince) p.synced_since = w.syncedSince
  return await paginar<FeedLine>(p, apiKey, toFeedLine)
}

// ─── Régua de soma ────────────────────────────────────────────────────────────

interface Construido {
  linhas: VendaRow[]
  vistos: number[]
  canceladasVenda: number
  canceladasProduto: number
  semLinhaAtiva: number
}

/**
 * Junta os feeds e aplica a régua. `receitas` é rateada entre as linhas ativas na
 * proporção do valor — a receita só existe no nível da venda e NÃO é reconstruível a
 * partir de `products` (a melhor fórmula testada fecha em ~72% das vendas, errando até
 * R$ 4,7 mil, e há receita negativa que fórmula nenhuma prevê).
 * Receita negativa (permuta/patrocínio com 100% de desconto) vira 0, como no relatório.
 */
/**
 * Rateia a receita da venda entre as linhas ativas, proporcionalmente ao valor.
 * Quando TODAS as linhas ativas valem 0 mas a venda tem receita, divide igualmente:
 * o rateio proporcional dividiria por zero e DESCARTARIA a receita. Raro mas real —
 * venda 72833/2026 é uma passagem de valor 0 com R$ 187,69 de comissão pura.
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

function construirLinhas(
  vendas: FeedSale[],
  linhas: FeedLine[],
  produtoAnterior: Map<number, string>,
): Construido {
  const porVenda = new Map<number, FeedLine[]>()
  for (const l of linhas) {
    const arr = porVenda.get(l.sale_number)
    if (arr) arr.push(l); else porVenda.set(l.sale_number, [l])
  }

  const out: VendaRow[] = []
  const vistos: number[] = []
  let canceladasVenda = 0, canceladasProduto = 0, semLinhaAtiva = 0

  for (const v of vendas) {
    vistos.push(v.sale_number)

    // Passo 1: venda cancelada sai inteira (o caso que ficava somado para sempre).
    if (v.status === 'canceled') { canceladasVenda++; continue }

    const todas = porVenda.get(v.sale_number) ?? []
    // Passo 2: só produto ativo entra.
    const ativas = todas.filter((l) => l.product_status === 'active')
    canceladasProduto += todas.length - ativas.length

    // Venda viva cujos produtos foram todos cancelados/excluídos: some do dashboard.
    if (ativas.length === 0) { semLinhaAtiva++; continue }

    const somaAtiva = ativas.reduce((s, l) => s + l.valor, 0)
    const receitaVenda = Math.max(v.receita, 0)
    const anterior = produtoAnterior.get(v.sale_number) ?? null

    for (const l of ativas) {
      out.push({
        venda_numero: v.sale_number,
        vendedor: v.vendedor ?? 'Sem vendedor',
        data_venda: v.sale_date,
        pagante: v.pagante ?? 'Sem cliente',
        produto: l.produto ?? anterior,
        fornecedor: l.fornecedor,
        setor_bruto: v.setor_bruto,
        setor_grupo: mapSetor(v.setor_bruto),
        representante: null,
        operacao: v.operacao,
        situacao: v.status === 'opened' ? 'Aberta' : 'Fechada',
        // Só linha ATIVA é gravada, então a linha nunca representa cancelamento.
        data_cancelamento: null,
        valor_total: l.valor,
        receitas: ratearReceita(receitaVenda, l.valor, somaAtiva, ativas.length),
        faturamento: l.valor,
      })
    }
  }

  return { linhas: out, vistos, canceladasVenda, canceladasProduto, semLinhaAtiva }
}

// ─── Utilidades ───────────────────────────────────────────────────────────────

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
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

// deno-lint-ignore no-explicit-any
async function cleanOrphans(supabase: any, uploadIds: string[], keepId?: string): Promise<void> {
  for (const uid of uploadIds) {
    if (uid === keepId) continue
    const { count } = await supabase
      .from('vendas').select('*', { count: 'exact', head: true }).eq('upload_id', uid)
    if ((count ?? 0) === 0) await supabase.from('uploads').delete().eq('id', uid)
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const apiKey = Deno.env.get('MONDE_DATA_API_KEY')
  if (!apiKey) return json({ ok: false, error: 'MONDE_DATA_API_KEY não configurado' }, 500)

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  )

  const startedAt = new Date().toISOString()
  const body = await req.json().catch(() => ({}))
  const mode: 'delta' | 'reconcile' = body?.mode === 'reconcile' ? 'reconcile' : 'delta'
  const from: string = typeof body?.from === 'string' ? body.from : CUTOFF
  const to: string = typeof body?.to === 'string' ? body.to : new Date().toISOString().slice(0, 10)
  const dryRun = !!body?.dryRun

  try {
    // ── 1. Decidir quais meses ler ──────────────────────────────────────────
    const todosMeses = janelasMensais(from, to)
    let syncedSince: string | null = null
    let mesesLidos = todosMeses

    if (mode === 'delta') {
      const { data: st } = await supabase
        .from('sync_state').select('last_done_at').eq('key', WATERMARK_KEY).maybeSingle()
      const wm = st?.last_done_at as string | null
      if (wm) {
        syncedSince = new Date(new Date(wm).getTime() - WATERMARK_OVERLAP_MS).toISOString()
        // Sonda a JANELA INTEIRA de uma vez (não mês a mês): o conjunto relido é pequeno,
        // então são ~2 requisições em vez de 24. Consulta os DOIS feeds porque a venda
        // pode ser relida sem as linhas dela e vice-versa.
        const relidas = await lerVendas({ from, to, syncedSince }, apiKey)
        const relidasLinhas = await paginar<string>(
          { resource: 'products', from, to, synced_since: syncedSince },
          apiKey,
          // deno-lint-ignore no-explicit-any
          (r: any) => String(r.sale_date ?? ''),
        )
        const mesesComMudanca = new Set<string>()
        for (const v of relidas) if (v.sale_date) mesesComMudanca.add(v.sale_date.slice(0, 7))
        for (const d of relidasLinhas) if (d) mesesComMudanca.add(d.slice(0, 7))
        mesesLidos = todosMeses.filter((m) => mesesComMudanca.has(m.from.slice(0, 7)))
      }
      // Sem marca d'água: primeiro run = reconciliação completa da janela.
    }

    if (mesesLidos.length === 0) {
      return json({
        ok: true, startedAt, mode, from, to, syncedSince,
        mesesLidos: 0, vendasLidas: 0, linhasLidas: 0,
        salesInserted: 0, salesDeleted: 0, pending: 0,
        canceladasVenda: 0, canceladasProduto: 0, semLinhaAtiva: 0,
        nota: 'nada relido desde a última marca d\'água',
      })
    }

    // ── 2. Ler os meses afetados POR INTEIRO (sem synced_since) ─────────────
    const vendas: FeedSale[] = []
    const linhas: FeedLine[] = []
    // Serializado de propósito: em paralelo, os dois feeds dobram a taxa de saída e
    // aproximam o rate limiter do Edge Runtime sem ganho real (o gargalo é o throttle).
    for (const mes of mesesLidos) {
      vendas.push(...await lerVendas(mes, apiKey))
      linhas.push(...await lerLinhas(mes, apiKey))
    }

    const maxSynced = vendas.reduce<string | null>(
      (mx, v) => (v.synced_at && (!mx || v.synced_at > mx) ? v.synced_at : mx), null,
    )

    // ── 3. Cancelamento MANUAL (contorno de junho/2026) ─────────────────────
    // Hoje as 7 entradas já são cobertas pela régua (produtos vêm `canceled`), mas
    // seguimos honrando: é barato e é a única saída manual se o espelho voltar a errar.
    const { data: cancRows } = await supabase.from('vendas_canceladas').select('venda_numero')
    const canceladasManual = new Set(
      (cancRows ?? []).map((r: { venda_numero: number }) => r.venda_numero),
    )

    // ── 4. Estado atual: carry-forward de produto + uploads afetados ────────
    const vistosTodos = [...new Set(vendas.map((v) => v.sale_number))]
    const produtoAnterior = new Map<number, string>()
    const affectedUploadIds = new Set<string>()
    let salesDeleted = 0

    for (const numeros of chunk(vistosTodos, DELETE_BATCH)) {
      const { data: rows } = await supabase
        .from('vendas').select('venda_numero, upload_id, produto').in('venda_numero', numeros)
      for (const r of rows ?? []) {
        if (r.upload_id) affectedUploadIds.add(r.upload_id)
        if (r.produto && !produtoAnterior.has(r.venda_numero)) {
          produtoAnterior.set(r.venda_numero, r.produto)
        }
      }
      salesDeleted += rows?.length ?? 0
    }

    // ── 5. Aplicar a régua ─────────────────────────────────────────────────
    const elegiveis = vendas.filter((v) => !canceladasManual.has(v.sale_number))
    const c = construirLinhas(elegiveis, linhas, produtoAnterior)
    const manualIgnoradas = vendas.length - elegiveis.length

    if (dryRun) {
      return json({
        ok: true, startedAt, mode, from, to, syncedSince, dryRun: true,
        mesesLidos: mesesLidos.length, vendasLidas: vendas.length, linhasLidas: linhas.length,
        salesInserted: 0, salesDeleted: 0, pending: 0,
        linhasQueSeriamInseridas: c.linhas.length,
        canceladasVenda: c.canceladasVenda, canceladasProduto: c.canceladasProduto,
        semLinhaAtiva: c.semLinhaAtiva, canceladasManual: manualIgnoradas,
      })
    }

    // ── 6. Dedup: apaga TODOS os números vistos ────────────────────────────
    for (const numeros of chunk(vistosTodos, DELETE_BATCH)) {
      const { error } = await supabase.from('vendas').delete().in('venda_numero', numeros)
      if (error) throw new Error(`Erro ao apagar lote: ${error.message}`)
    }

    // ── 7. Inserir as linhas ativas ────────────────────────────────────────
    let uploadId = ''
    let inserted = 0
    if (c.linhas.length > 0) {
      const { data: up, error: upErr } = await supabase
        .from('uploads')
        .insert({
          nome_arquivo: `${FILENAME_PREFIX}${mode}-${new Date().toISOString().slice(0, 10)}`,
          total_linhas: c.linhas.length,
          linhas_inseridas: c.linhas.length,
          linhas_atualizadas: salesDeleted,
          alertas_qualidade: [],
          status: 'success',
        })
        .select('id').single()
      if (upErr || !up) throw new Error(`Erro ao registrar sync: ${upErr?.message}`)
      uploadId = up.id

      const comUpload = c.linhas.map((l) => ({ ...l, upload_id: uploadId }))
      for (let i = 0; i < comUpload.length; i += INSERT_BATCH) {
        const { error } = await supabase.from('vendas').insert(comUpload.slice(i, i + INSERT_BATCH))
        if (error) {
          await supabase.from('uploads').update({ status: 'error' }).eq('id', uploadId)
          throw new Error(`Erro ao inserir lote ${Math.floor(i / INSERT_BATCH) + 1}: ${error.message}`)
        }
      }
      inserted = comUpload.length
    }

    // ── 8. Faxina e marca d'água ───────────────────────────────────────────
    await cleanOrphans(supabase, [...affectedUploadIds], uploadId || undefined)

    if (maxSynced) {
      const now = new Date().toISOString()
      await supabase.from('sync_state').upsert({
        key: WATERMARK_KEY, cursor_page: 1, running: false,
        last_done_at: maxSynced,
        note: `${mode}: ${mesesLidos.length} mês(es), ${inserted} linhas, ${c.canceladasVenda} cancelada(s)`,
        updated_at: now,
      }, { onConflict: 'key' })
    }

    const datas = c.linhas.map((l) => l.data_venda).filter(Boolean).sort()

    return json({
      ok: true, startedAt, finishedAt: new Date().toISOString(),
      mode, from, to, syncedSince,
      mesesLidos: mesesLidos.length,
      vendasLidas: vendas.length, linhasLidas: linhas.length,
      salesInserted: inserted, salesDeleted, pending: 0,
      canceladasVenda: c.canceladasVenda, canceladasProduto: c.canceladasProduto,
      semLinhaAtiva: c.semLinhaAtiva, canceladasManual: manualIgnoradas,
      watermark: maxSynced,
      dateRange: datas.length ? { min: datas[0], max: datas[datas.length - 1] } : null,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[monde-sync] ERRO:', msg)
    return json({ ok: false, startedAt, error: msg }, 500)
  }
})
