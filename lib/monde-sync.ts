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

// `others` É INCLUÍDO: traz produtos avulsos com product_name (Contrato de casamento,
// Bloqueio Hospedagem, Transporte, Vistos, etc.). Sem ele, uma venda cujo ÚNICO produto
// cancelado está em `others` passava como ativa (bug do cancelamento) e o valor vinha
// bruto. Também é a base do split por linha de produto.
const PRODUCT_KEYS: (keyof Pick<MondeSale,
  'hotels' | 'airline_tickets' | 'cruises' | 'insurances' | 'train_tickets' |
  'ground_transportations' | 'car_rentals' | 'travel_packages' | 'cvc_packages' |
  'operations' | 'others'>)[] = [
  'hotels', 'airline_tickets', 'cruises', 'insurances', 'train_tickets',
  'ground_transportations', 'car_rentals', 'travel_packages',
  'cvc_packages', 'operations', 'others',
]

/** kind estruturado → nome de operação do Monde (mesmos rótulos do relatório/Excel).
 *  Produtos em `others` usam o `product_name` real da API. */
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

/** Uma linha de produto ATIVA da venda — cada uma vira uma linha em `vendas`
 *  ("produto lançado"). Produtos cancelados/deletados ficam de fora (= "Situação
 *  Produto: Ativo" do Monde). */
interface ProdutoLinha { produto: string | null; amount: number; fornecedor: string | null }

function activeProductLines(sale: MondeSale): ProdutoLinha[] {
  const lines: ProdutoLinha[] = []
  for (const key of PRODUCT_KEYS) {
    const arr = sale[key] as MondeProduct[] | undefined
    if (!arr?.length) continue
    for (const p of arr) {
      if (isInactive(p)) continue
      const produto = key === 'others' || key === 'operations' || key === 'cvc_packages'
        ? (p.product_name?.trim() || null)
        : (KIND_PRODUTO[key as string] ?? null)
      const amount = (p.totals as Record<string, number> | undefined)?.amount ?? 0
      lines.push({ produto, amount, fornecedor: p.supplier?.name ?? null })
    }
  }
  return lines
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

/**
 * Mapeia uma venda Monde em UMA LINHA POR PRODUTO ATIVO (como o relatório "Vendas por
 * produto" do Monde e como o Excel). Antes gerava 1 linha agregada por venda, o que:
 *  - perdia a contagem de "produtos lançados" dos cards de subsetor de Weddings;
 *  - colapsava produtos distintos num rótulo sintético só (ex.: "Aéreo").
 * `valor_total`/`faturamento` = valor do produto; `receitas` = receita da venda rateada
 * por valor (mesma proporção do computeActiveAmounts). Produtos cancelados ficam fora.
 *
 * Venda sem produto ativo identificável → UMA linha com produto nulo (o chamador aplica
 * carry-forward do produto do Excel), preservando valor/receita.
 */
export function mapSaleToVendaLines(sale: MondeSale): VendaInput[] {
  const setor_bruto = inferSetorBruto(sale)
  const setor_grupo = mapSetor(setor_bruto)
  const base = {
    venda_numero: sale.sale_number,
    vendedor: sale.travel_agent?.name ?? 'Sem vendedor',
    data_venda: sale.sale_date,
    pagante: sale.payer?.name ?? sale.intermediary?.name ?? 'Sem cliente',
    setor_bruto,
    setor_grupo,
    representante: null as string | null,
    operacao: sale.approver?.name ?? null,  // "Operação Própria" (casal) do Monde
    situacao: sale.status === 'opened' ? 'Aberta' : 'Fechada',
    // Só entram vendas/produtos ATIVOS; a linha nunca representa cancelamento.
    data_cancelamento: null as string | null,
  }

  const lines = activeProductLines(sale)
  const { valorTotal, receita } = computeActiveAmounts(sale)
  const totalAmount = lines.reduce((s, l) => s + l.amount, 0)

  // TRAVA DE SEGURANÇA: só divide em linhas se a soma delas reconcilia com o valor
  // ativo da venda. Se algum array de produto desconhecido escapar (a soma não bate),
  // cai para UMA linha agregada com o valor correto — o total de setor NUNCA erra.
  const reconcilia = lines.length > 0 && Math.abs(totalAmount - valorTotal) <= 0.01
  if (!reconcilia) {
    return [{ ...base, produto: null, fornecedor: inferFornecedor(sale), valor_total: valorTotal, receitas: receita, faturamento: valorTotal }]
  }

  return lines.map((l) => ({
    ...base,
    produto: l.produto,
    fornecedor: l.fornecedor,
    valor_total: l.amount,
    receitas: totalAmount > 0 ? Math.round((receita * l.amount / totalAmount) * 100) / 100 : 0,
    faturamento: l.amount,
  }))
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
