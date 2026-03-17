import type { VendaInput, QualityAlert, QualityBreakdown } from '@/lib/schemas'

interface QualityResult {
  score: number
  alerts: QualityAlert[]
  breakdown: QualityBreakdown
}

/**
 * Analisa a qualidade de um conjunto de linhas de vendas.
 * Retorna score (0-100), alertas estruturados e breakdown.
 */
export function analyzeQuality(rows: VendaInput[]): QualityResult {
  const breakdown: QualityBreakdown = {
    totalLinhas: rows.length,
    setorNulo: 0,
    valorNegativo: 0,
    linhaNula: 0,
    duplicataInterna: 0,
    setorOutros: 0,
    faturamentoZero: 0,
  }

  const alerts: QualityAlert[] = []

  // --- Setor nulo / indefinido ---
  const setorNuloLinhas: number[] = []
  rows.forEach((row, i) => {
    if (row.setor_grupo === 'INDEFINIDO') {
      setorNuloLinhas.push(i)
    }
  })
  breakdown.setorNulo = setorNuloLinhas.length
  if (setorNuloLinhas.length > 0) {
    alerts.push({
      tipo: 'SETOR_NULO',
      severidade: 'CRITICO',
      quantidade: setorNuloLinhas.length,
      descricao: `${setorNuloLinhas.length} registro(s) sem setor definido`,
      linhas_afetadas: setorNuloLinhas,
    })
  }

  // --- Valores negativos (faturamento ou receitas) ---
  const valorNegLinhas: number[] = []
  rows.forEach((row, i) => {
    if (row.faturamento < 0 || row.receitas < 0) {
      valorNegLinhas.push(i)
    }
  })
  breakdown.valorNegativo = valorNegLinhas.length
  if (valorNegLinhas.length > 0) {
    alerts.push({
      tipo: 'VALOR_NEGATIVO',
      severidade: 'ATENCAO',
      quantidade: valorNegLinhas.length,
      descricao: `${valorNegLinhas.length} registro(s) com valores negativos (possíveis cancelamentos)`,
      linhas_afetadas: valorNegLinhas,
    })
  }

  // --- Duplicatas internas (linhas completamente idênticas no arquivo) ---
  // NOTA: venda_numero repetido é ESPERADO (um pedido pode ter N itens/produtos).
  // Duplicata real = mesma combinação de venda_numero + produto + valor_total + faturamento.
  const rowKeys = new Map<string, number[]>()
  rows.forEach((row, i) => {
    const key = `${row.venda_numero}|${row.produto}|${row.valor_total}|${row.faturamento}`
    const existing = rowKeys.get(key)
    if (existing) {
      existing.push(i)
    } else {
      rowKeys.set(key, [i])
    }
  })
  const duplicataLinhas: number[] = []
  rowKeys.forEach((indices) => {
    if (indices.length > 1) {
      duplicataLinhas.push(...indices.slice(0, -1))
    }
  })
  breakdown.duplicataInterna = duplicataLinhas.length
  if (duplicataLinhas.length > 0) {
    alerts.push({
      tipo: 'DUPLICATA_INTERNA',
      severidade: 'ATENCAO',
      quantidade: duplicataLinhas.length,
      descricao: `${duplicataLinhas.length} linha(s) possivelmente duplicada(s) no arquivo`,
      linhas_afetadas: duplicataLinhas,
    })
  }

  // --- Setor OUTROS (Welcome) ---
  const setorOutrosLinhas: number[] = []
  rows.forEach((row, i) => {
    if (row.setor_grupo === 'OUTROS') {
      setorOutrosLinhas.push(i)
    }
  })
  breakdown.setorOutros = setorOutrosLinhas.length
  if (setorOutrosLinhas.length > 0) {
    alerts.push({
      tipo: 'SETOR_OUTROS',
      severidade: 'INFO',
      quantidade: setorOutrosLinhas.length,
      descricao: `${setorOutrosLinhas.length} registro(s) classificados como Outros (sem impacto em metas)`,
      linhas_afetadas: setorOutrosLinhas,
    })
  }

  // --- Faturamento zero ---
  const fatZeroLinhas: number[] = []
  rows.forEach((row, i) => {
    if (row.faturamento === 0 && row.valor_total > 0) {
      fatZeroLinhas.push(i)
    }
  })
  breakdown.faturamentoZero = fatZeroLinhas.length
  if (fatZeroLinhas.length > 0) {
    alerts.push({
      tipo: 'FATURAMENTO_ZERO',
      severidade: 'AVISO',
      quantidade: fatZeroLinhas.length,
      descricao: `${fatZeroLinhas.length} registro(s) com faturamento zero (pode indicar venda em processo)`,
      linhas_afetadas: fatZeroLinhas,
    })
  }

  // --- Score ---
  const score = calcScore(breakdown)

  return { score, alerts, breakdown }
}

/**
 * Calcula o score de qualidade (0-100).
 * Inicia em 100 e deduz por tipo de problema.
 */
function calcScore(b: QualityBreakdown): number {
  let score = 100

  // SETOR_NULO: -5 por ocorrência, max -30
  score -= Math.min(b.setorNulo * 5, 30)

  // VALOR_NEGATIVO: -2 por ocorrência, max -20
  score -= Math.min(b.valorNegativo * 2, 20)

  // LINHA_NULA: -1 por ocorrência, max -10
  score -= Math.min(b.linhaNula * 1, 10)

  // DUPLICATA_INTERNA: -5 por ocorrência, max -20
  score -= Math.min(b.duplicataInterna * 5, 20)

  // SETOR_OUTROS: sem impacto no score
  // FATURAMENTO_ZERO: sem impacto no score

  return Math.max(0, score)
}
