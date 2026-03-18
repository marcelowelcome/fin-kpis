import type { VendaInput, QualityAlert, QualityAlertExemplo, QualityBreakdown } from '@/lib/schemas'

interface QualityResult {
  score: number
  alerts: QualityAlert[]
  breakdown: QualityBreakdown
}

const MAX_EXEMPLOS = 5

/**
 * Cria um exemplo de alerta a partir de uma linha de venda.
 */
function criarExemplo(row: VendaInput, detalhe: string): QualityAlertExemplo {
  return {
    venda_numero: row.venda_numero,
    vendedor: row.vendedor,
    produto: row.produto,
    valor: row.faturamento,
    detalhe,
  }
}

/**
 * Analisa a qualidade de um conjunto de linhas de vendas.
 * Retorna score (0-100), alertas estruturados (com até 5 exemplos cada) e breakdown.
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
  const setorNuloExemplos: QualityAlertExemplo[] = []
  rows.forEach((row, i) => {
    if (row.setor_grupo === 'INDEFINIDO') {
      setorNuloLinhas.push(i)
      if (setorNuloExemplos.length < MAX_EXEMPLOS) {
        setorNuloExemplos.push(
          criarExemplo(row, `Setor bruto: "${row.setor_bruto ?? '(vazio)'}"`)
        )
      }
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
      exemplos: setorNuloExemplos,
    })
  }

  // --- Valores negativos (faturamento ou receitas) ---
  const valorNegLinhas: number[] = []
  const valorNegExemplos: QualityAlertExemplo[] = []
  rows.forEach((row, i) => {
    if (row.faturamento < 0 || row.receitas < 0) {
      valorNegLinhas.push(i)
      if (valorNegExemplos.length < MAX_EXEMPLOS) {
        const detalhes: string[] = []
        if (row.faturamento < 0) detalhes.push(`Fat: R$ ${row.faturamento.toFixed(2)}`)
        if (row.receitas < 0) detalhes.push(`Rec: R$ ${row.receitas.toFixed(2)}`)
        valorNegExemplos.push(criarExemplo(row, detalhes.join(' | ')))
      }
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
      exemplos: valorNegExemplos,
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
  const duplicataExemplos: QualityAlertExemplo[] = []
  rowKeys.forEach((indices) => {
    if (indices.length > 1) {
      duplicataLinhas.push(...indices.slice(0, -1))
      if (duplicataExemplos.length < MAX_EXEMPLOS) {
        const row = rows[indices[0]]
        duplicataExemplos.push(
          criarExemplo(row, `${indices.length}x repetido no arquivo`)
        )
      }
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
      exemplos: duplicataExemplos,
    })
  }

  // --- Setor OUTROS (Welcome) ---
  const setorOutrosLinhas: number[] = []
  const setorOutrosExemplos: QualityAlertExemplo[] = []
  rows.forEach((row, i) => {
    if (row.setor_grupo === 'OUTROS') {
      setorOutrosLinhas.push(i)
      if (setorOutrosExemplos.length < MAX_EXEMPLOS) {
        setorOutrosExemplos.push(
          criarExemplo(row, `Setor: "${row.setor_bruto}" → Outros`)
        )
      }
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
      exemplos: setorOutrosExemplos,
    })
  }

  // --- Faturamento zero ---
  const fatZeroLinhas: number[] = []
  const fatZeroExemplos: QualityAlertExemplo[] = []
  rows.forEach((row, i) => {
    if (row.faturamento === 0 && row.valor_total > 0) {
      fatZeroLinhas.push(i)
      if (fatZeroExemplos.length < MAX_EXEMPLOS) {
        fatZeroExemplos.push(
          criarExemplo(row, `Valor Total: R$ ${row.valor_total.toFixed(2)}, Fat: R$ 0,00`)
        )
      }
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
      exemplos: fatZeroExemplos,
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
  score -= Math.min(b.setorNulo * 5, 30)
  score -= Math.min(b.valorNegativo * 2, 20)
  score -= Math.min(b.linhaNula * 1, 10)
  score -= Math.min(b.duplicataInterna * 5, 20)
  return Math.max(0, score)
}

/** Pesos por tipo de alerta para cálculo de score */
const SCORE_WEIGHTS: Record<string, { perUnit: number; max: number }> = {
  SETOR_NULO: { perUnit: 5, max: 30 },
  VALOR_NEGATIVO: { perUnit: 2, max: 20 },
  LINHA_NULA: { perUnit: 1, max: 10 },
  DUPLICATA_INTERNA: { perUnit: 5, max: 20 },
}

/**
 * Recalcula score a partir de um array de QualityAlert (persistido no upload).
 * Fonte única de verdade — usar esta função ao invés de replicar a lógica.
 */
export function calcScoreFromAlerts(alerts: QualityAlert[]): number {
  let score = 100
  for (const alert of alerts) {
    const weight = SCORE_WEIGHTS[alert.tipo]
    if (weight) {
      score -= Math.min(alert.quantidade * weight.perUnit, weight.max)
    }
  }
  return Math.max(0, score)
}
