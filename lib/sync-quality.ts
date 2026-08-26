import type { QualityAlert, QualityAlertExemplo } from '@/lib/schemas'
import { formatBRL, formatDate } from '@/lib/format'

/**
 * Monitor de qualidade do SYNC com a API do Monde (distinto de lib/data-quality.ts,
 * que analisa lotes de upload de Excel). Cada alerta aqui reflete uma classe de
 * campo que a API Monde parou de preencher em algum momento (ver histórico em
 * lib/monde-sync.ts) — não é um bug do nosso pipeline, é a API upstream omitindo
 * dado que o mapper depende para classificar a venda.
 */

const MAX_EXEMPLOS = 5

export interface SyncQualityRow {
  venda_numero: number
  data_venda: string
  vendedor: string
  setor_grupo: string
  produto: string | null
  fornecedor: string | null
  operacao: string | null
  valor_total: number
  situacao: string | null
}

function criarExemplo(row: SyncQualityRow, detalhe: string): QualityAlertExemplo {
  return {
    venda_numero: row.venda_numero,
    vendedor: row.vendedor,
    produto: row.produto,
    valor: row.valor_total,
    detalhe: `${formatDate(row.data_venda)} · ${detalhe}`,
  }
}

/** Agrega linhas de produto (1 por produto) em vendas únicas, somando valor. */
function porVenda(rows: SyncQualityRow[]): { venda_numero: number; valor: number; row: SyncQualityRow }[] {
  const m = new Map<number, { venda_numero: number; valor: number; row: SyncQualityRow }>()
  for (const r of rows) {
    const cur = m.get(r.venda_numero)
    if (cur) cur.valor += r.valor_total
    else m.set(r.venda_numero, { venda_numero: r.venda_numero, valor: r.valor_total, row: r })
  }
  return Array.from(m.values())
}

const SETORES_KPI = new Set(['CORP', 'TRIPS', 'WEDDINGS'])

export function checkSyncQuality(rows: SyncQualityRow[]): QualityAlert[] {
  const alerts: QualityAlert[] = []

  // --- Setor indefinido: some de TODO o dashboard, inclusive do consolidado ---
  const semSetor = porVenda(rows.filter((r) => r.setor_grupo === 'INDEFINIDO'))
  if (semSetor.length > 0) {
    const valorTotal = semSetor.reduce((s, v) => s + v.valor, 0)
    alerts.push({
      tipo: 'SETOR_NULO',
      severidade: 'CRITICO',
      quantidade: semSetor.length,
      descricao: `${semSetor.length} venda(s) sem setor definido (${formatBRL(valorTotal)}) — invisíveis em todo o dashboard, inclusive no consolidado do Group`,
      exemplos: semSetor.slice(0, MAX_EXEMPLOS).map(({ row }) =>
        criarExemplo(row, `situação "${row.situacao ?? '—'}" · Monde não trouxe o campo Setor`)
      ),
    })
  }

  // --- Produto sem cadastro: soma no faturamento do setor, mas some de Contratos/Taxas/subcategorias ---
  const semProduto = porVenda(rows.filter((r) => !r.produto && SETORES_KPI.has(r.setor_grupo)))
  if (semProduto.length > 0) {
    const valorTotal = semProduto.reduce((s, v) => s + v.valor, 0)
    alerts.push({
      tipo: 'PRODUTO_NULO',
      severidade: 'ATENCAO',
      quantidade: semProduto.length,
      descricao: `${semProduto.length} venda(s) sem produto identificado (${formatBRL(valorTotal)}) — contam no faturamento do setor, mas somem dos cards de Contratos/Taxas/subcategoria`,
      exemplos: semProduto.slice(0, MAX_EXEMPLOS).map(({ row }) =>
        criarExemplo(row, `${row.setor_grupo} · API não trouxe o nome do produto`)
      ),
    })
  }

  // --- Fornecedor sem nome: hoje sem impacto visível (nenhum card lê esse campo ainda) ---
  const semFornecedor = porVenda(rows.filter((r) => !r.fornecedor))
  if (semFornecedor.length > 0) {
    const valorTotal = semFornecedor.reduce((s, v) => s + v.valor, 0)
    alerts.push({
      tipo: 'FORNECEDOR_NULO',
      severidade: 'INFO',
      quantidade: semFornecedor.length,
      descricao: `${semFornecedor.length} venda(s) sem fornecedor identificado (${formatBRL(valorTotal)}) — sem impacto hoje, nenhum card do dashboard usa esse campo ainda`,
      exemplos: semFornecedor.slice(0, MAX_EXEMPLOS).map(({ row }) =>
        criarExemplo(row, `${row.produto ?? '(produto não identificado)'} · API não trouxe o nome do fornecedor`)
      ),
    })
  }

  // --- Contrato de casamento sem nome do casal (Operação Própria) ---
  const contratoSemOperacao = porVenda(
    rows.filter((r) => (r.produto ?? '').toLowerCase() === 'contrato de casamento' && !r.operacao)
  )
  if (contratoSemOperacao.length > 0) {
    alerts.push({
      tipo: 'CONTRATO_SEM_OPERACAO',
      severidade: 'AVISO',
      quantidade: contratoSemOperacao.length,
      descricao: `${contratoSemOperacao.length} contrato(s) sem nome do casal — coluna "Operação Própria" fica em branco no card de Contratos`,
      exemplos: contratoSemOperacao.slice(0, MAX_EXEMPLOS).map(({ row }) =>
        criarExemplo(row, 'API não trouxe o nome do casal (approver)')
      ),
    })
  }

  // --- Venda sem vendedor atribuído ---
  const semVendedor = porVenda(rows.filter((r) => r.vendedor === 'Sem vendedor'))
  if (semVendedor.length > 0) {
    const valorTotal = semVendedor.reduce((s, v) => s + v.valor, 0)
    alerts.push({
      tipo: 'VENDEDOR_AUSENTE',
      severidade: 'ATENCAO',
      quantidade: semVendedor.length,
      descricao: `${semVendedor.length} venda(s) sem vendedor atribuído (${formatBRL(valorTotal)}) — somem do card Top Vendedores`,
      exemplos: semVendedor.slice(0, MAX_EXEMPLOS).map(({ row }) =>
        criarExemplo(row, `${row.setor_grupo} · Monde ainda não atribuiu vendedor a essa venda`)
      ),
    })
  }

  return alerts
}
