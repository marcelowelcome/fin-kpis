/**
 * Lógica de mapeamento e sincronização Monde → vendas.
 *
 * Inferência de setor (sem campo explícito na API Monde):
 *  1. Palavras-chave em observations
 *  2. Tipo do pagante: CNPJ (14 dígitos) → CORP
 *  3. Tipo de produto: travel_packages / cruises → TRIPS
 *                     hotels + airline_tickets → CORP
 *  4. Default: INDEFINIDO (aparecerá nos alertas de qualidade)
 */

import { scanMondePages, type MondeSale, type MondeProduct } from './monde-client'
import { mapSetor } from './setor-mapper'
import type { VendaInput } from './schemas'

// ─── Produtos: arrays e helpers ───────────────────────────────────────────────

const PRODUCT_KEYS: (keyof Pick<MondeSale,
  'hotels' | 'airline_tickets' | 'cruises' | 'insurances' |
  'train_tickets' | 'ground_transportations' | 'car_rentals' | 'travel_packages'>)[] = [
  'hotels', 'airline_tickets', 'cruises', 'insurances',
  'train_tickets', 'ground_transportations', 'car_rentals', 'travel_packages',
]

function allProducts(sale: MondeSale): MondeProduct[] {
  const out: MondeProduct[] = []
  for (const key of PRODUCT_KEYS) {
    const arr = sale[key] as MondeProduct[] | undefined
    if (arr?.length) out.push(...arr)
  }
  return out
}

/** Produto inativo = cancelado, deletado ou com canceled_at preenchido */
function isInactive(p: MondeProduct): boolean {
  return p.status === 'canceled' || p.status === 'deleted' || !!p.canceled_at
}

/**
 * True se a venda deve ser ignorada:
 * - status da venda contém 'cancel'
 * - OU todos os produtos são inativos (canceled / deleted)
 */
export function isMondeSaleCancelled(sale: MondeSale): boolean {
  if ((sale.status ?? '').toLowerCase().includes('cancel')) return true
  const prods = allProducts(sale)
  if (prods.length === 0) return false
  return prods.every(isInactive)
}

/**
 * Calcula valor_total e receita considerando APENAS produtos ativos.
 *
 * O campo `totals.final_value` da API inclui o valor dos produtos cancelados
 * (mas não dos deletados). Para bater com o relatório do Monde
 * (Situação Produto = Ativo), somamos o campo `amount` só dos ativos.
 * A receita é proporcional à participação dos ativos no total.
 */
function computeActiveAmounts(sale: MondeSale): { valorTotal: number; receita: number } {
  const prods = allProducts(sale)
  const hasCanceled = prods.some((p) => p.status === 'canceled')

  if (!hasCanceled) {
    // Sem produtos cancelados → totals já estão corretos (deleted já excluídos)
    return { valorTotal: sale.totals?.final_value ?? 0, receita: sale.totals?.revenue ?? 0 }
  }

  // Venda mista: somar apenas produtos ativos
  type ProdWithAmount = { status: string; amount: number }
  const enriched: ProdWithAmount[] = prods.map((p) => ({
    status: p.status ?? '',
    amount: ((p.totals as Record<string, number> | undefined)?.amount) ?? 0,
  }))

  const activeAmount   = enriched.filter((p) => p.status === 'active')  .reduce((s, p) => s + p.amount, 0)
  const canceledAmount = enriched.filter((p) => p.status === 'canceled').reduce((s, p) => s + p.amount, 0)

  // Escalar receita proporcionalmente (deleted já fora do final_value e revenue)
  const knownTotal = activeAmount + canceledAmount
  const totalRevenue = sale.totals?.revenue ?? 0
  const scaledRevenue = knownTotal > 0 ? totalRevenue * (activeAmount / knownTotal) : 0

  return { valorTotal: activeAmount, receita: scaledRevenue }
}

// ─── Setor via custom_fields ──────────────────────────────────────────────────

/**
 * Lê o campo 'Setor' dos custom_fields do Monde.
 * Valores conhecidos: Corporativo | Lazer | Expedições | WedMe | Produção |
 *                     Planejamento-WED | Weddings | Welcome
 * Todos são mapeados pelo setor-mapper.ts existente.
 */
function inferSetorBruto(sale: MondeSale): string | null {
  const cf = (sale.custom_fields ?? []).find((f) => f.name === 'Setor')
  return cf?.value ?? null
}

/** Produto ativo (não cancelado/deletado) com determinado product_name. */
function hasActiveProductNamed(sale: MondeSale, nome: string): boolean {
  const alvo = nome.trim().toLowerCase()
  return (sale.others ?? []).some(
    (p) =>
      (p.product_name ?? '').trim().toLowerCase() === alvo &&
      p.status !== 'canceled' && p.status !== 'deleted' && !p.canceled_at,
  )
}

function inferProduto(sale: MondeSale): string | null {
  // A API de Dados do Monde agora entrega o produto real em `others[].product_name`
  // (ex.: "Contrato de casamento", que antes não vinha). Detecta contrato de casamento
  // direto da fonte — não depende mais de import de relatório nem do de-para de operação.
  if (hasActiveProductNamed(sale, 'Contrato de casamento')) return 'Contrato de casamento'
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

// ─── Mapeamento principal ─────────────────────────────────────────────────────

export function mapSaleToVendaInput(sale: MondeSale): VendaInput {
  const setor_bruto = inferSetorBruto(sale)
  const setor_grupo = mapSetor(setor_bruto)
  const { valorTotal, receita } = computeActiveAmounts(sale)

  return {
    venda_numero: sale.sale_number,
    vendedor: sale.travel_agent?.name ?? 'Sem vendedor',
    data_venda: sale.sale_date,
    pagante: sale.payer?.name ?? sale.intermediary?.name ?? 'Sem cliente',
    setor_bruto,
    setor_grupo,
    produto: inferProduto(sale),
    fornecedor: inferFornecedor(sale),
    representante: null,
    operacao: sale.approver?.name ?? null,  // "Operação Própria" (casal) do Monde
    valor_total: valorTotal,
    receitas: receita,
    faturamento: valorTotal,
    situacao: sale.status === 'opened' ? 'Aberta' : 'Fechada',
  }
}

// ─── Resultado do sync ────────────────────────────────────────────────────────

export interface SyncResult {
  uploadId: string
  pagesScanned: number
  totalPages: number
  salesFetched: number
  salesInserted: number
  salesDeleted: number
  dateRange: { min: string; max: string } | null
  indefinidoCount: number
  mode: 'incremental' | 'full'
}

// ─── Fetch de vendas ─────────────────────────────────────────────────────────

export interface FetchMondeSalesOpts {
  startPage?: number
  maxPages?: number
  onProgress?: (page: number, totalPages: number, count: number) => void
}

export async function fetchMondeSales(opts: FetchMondeSalesOpts = {}): Promise<{
  sales: MondeSale[]
  totalPages: number
  pagesScanned: number
}> {
  return scanMondePages({
    startPage: opts.startPage ?? 1,
    maxPages: opts.maxPages ?? 25,
    onProgress: opts.onProgress,
  })
}
