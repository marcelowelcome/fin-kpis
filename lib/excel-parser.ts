import * as XLSX from 'xlsx'
import { mapSetor } from '@/lib/setor-mapper'
import { analyzeQuality } from '@/lib/data-quality'
import { COLUNAS_OBRIGATORIAS } from '@/lib/schemas'
import type { VendaInput, ParseResult, QualityAlert } from '@/lib/schemas'

const TARGET_SHEET = 'modelo-exportacao-final'

/**
 * Parseia um arquivo Excel (.xlsx) e retorna dados validados prontos para upsert.
 *
 * Fluxo:
 * 1. Lê workbook via SheetJS
 * 2. Busca aba 'modelo-exportacao-final' (ou primeira aba com warning)
 * 3. Valida colunas obrigatórias
 * 4. Processa cada linha: mapeia colunas, normaliza valores, aplica mapSetor()
 * 5. Remove linhas nulas, resolve duplicatas internas
 * 6. Executa análise de qualidade
 *
 * @param buffer - Conteúdo do arquivo como ArrayBuffer
 * @returns ParseResult com rows, alerts, totalLinhas e score
 */
export function parseExcel(buffer: ArrayBuffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: 'array' })

  // Buscar aba correta
  let sheetName = TARGET_SHEET
  const extraAlerts: QualityAlert[] = []

  if (!workbook.SheetNames.includes(TARGET_SHEET)) {
    sheetName = workbook.SheetNames[0]
    if (!sheetName) {
      throw createParseError('EMPTY_WORKBOOK', 'O arquivo não contém nenhuma aba de dados.')
    }
  }

  const worksheet = workbook.Sheets[sheetName]
  const rawData: Record<string, unknown>[] = XLSX.utils.sheet_to_json(worksheet)

  if (rawData.length === 0) {
    throw createParseError('EMPTY_SHEET', 'A aba de dados está vazia.')
  }

  // Validar colunas obrigatórias
  const headers = Object.keys(rawData[0])
  const missingColumns = COLUNAS_OBRIGATORIAS.filter(
    (col) => !headers.includes(col)
  )
  if (missingColumns.length > 0) {
    throw createParseError(
      'MISSING_COLUMNS',
      `Colunas obrigatórias ausentes: ${missingColumns.join(', ')}`,
      missingColumns as unknown as string[]
    )
  }

  // Processar linhas
  const totalLinhas = rawData.length
  let nullRowCount = 0
  const nullRowIndices: number[] = []
  const allRows: VendaInput[] = []

  for (let i = 0; i < rawData.length; i++) {
    const raw = rawData[i]

    // Verificar linha nula (todos os campos obrigatórios vazios)
    if (isNullRow(raw)) {
      nullRowCount++
      nullRowIndices.push(i)
      continue
    }

    const row = parseRow(raw)
    if (row) {
      allRows.push(row)
    }
  }

  // Registrar linhas nulas
  if (nullRowCount > 0) {
    extraAlerts.push({
      tipo: 'LINHA_NULA',
      severidade: 'AVISO',
      quantidade: nullRowCount,
      descricao: `${nullRowCount} linha(s) em branco removidas automaticamente`,
      linhas_afetadas: nullRowIndices,
    })
  }

  // NOTA: NÃO deduplicar por venda_numero — um pedido pode ter N itens.
  // Todas as linhas são mantidas.

  // Análise de qualidade
  const qualityResult = analyzeQuality(allRows)

  // Merge alertas de linhas nulas com alertas de qualidade
  const allAlerts = [...extraAlerts, ...qualityResult.alerts]

  // Recalcular score incluindo linhas nulas
  const adjustedScore = Math.max(
    0,
    qualityResult.score - Math.min(nullRowCount * 1, 10)
  )

  return {
    rows: allRows,
    alerts: allAlerts,
    totalLinhas,
    score: adjustedScore,
  }
}

/**
 * Parseia uma linha do Excel para VendaInput.
 */
function parseRow(raw: Record<string, unknown>): VendaInput | null {
  try {
    const vendaNumero = toNumber(raw['Venda Nº'])
    if (vendaNumero === null || isNaN(vendaNumero)) {
      return null
    }

    const setorBruto = toStringOrNull(raw['Setor'])
    const setorGrupo = mapSetor(setorBruto)

    return {
      venda_numero: Math.round(vendaNumero),
      vendedor: toString(raw['Vendedor']),
      data_venda: parseDate(raw['Data Venda']),
      pagante: toString(raw['Pagante']),
      setor_bruto: setorBruto,
      setor_grupo: setorGrupo,
      produto: toStringOrNull(raw['Produto']),
      fornecedor: toStringOrNull(raw['Fornecedor']),
      representante: toStringOrNull(raw['Representante']),
      valor_total: toNumber(raw['Valor Total']) ?? 0,
      receitas: toNumber(raw['Receitas']) ?? 0,
      faturamento: toNumber(raw['Faturamento']) ?? 0,
      situacao: toStringOrNull(raw['Situação'] ?? raw['Situacao'] ?? raw['situacao']),
    }
  } catch {
    // Linha com dados inválidos — skip
    return null
  }
}

/**
 * Converte data do Excel (serial number, Date ou string) para ISO date string.
 */
function parseDate(value: unknown): string {
  if (value instanceof Date) {
    // Extrair componentes locais para evitar shift de timezone
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  if (typeof value === 'number') {
    // Serial number do Excel: dias desde 1900-01-01 (com bug do Excel: 1900 conta como leap year)
    const date = new Date(Date.UTC(1899, 11, 30 + value))
    return date.toISOString().split('T')[0]
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()

    // Formato ISO: YYYY-MM-DD — retorna direto sem parsear Date
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed
    }

    // Formato BR: DD/MM/YYYY
    const brMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (brMatch) {
      return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`
    }

    // Fallback: forçar midnight local para evitar shift de timezone
    const parsed = new Date(trimmed + 'T00:00:00')
    if (!isNaN(parsed.getTime())) {
      const y = parsed.getFullYear()
      const m = String(parsed.getMonth() + 1).padStart(2, '0')
      const d = String(parsed.getDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }
  }

  throw new Error(`Data inválida: ${value}`)
}

/**
 * Verifica se uma linha é completamente nula.
 */
function isNullRow(raw: Record<string, unknown>): boolean {
  return COLUNAS_OBRIGATORIAS.every((col) => {
    const val = raw[col]
    return val === null || val === undefined || val === ''
  })
}

// =============================================================
// Helpers de conversão
// =============================================================

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const parsed = parseFloat(value.replace(',', '.'))
    return isNaN(parsed) ? null : parsed
  }
  return null
}

function toString(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  return String(value).trim()
}

// =============================================================
// Erro customizado para parsing
// =============================================================

export class ParseError extends Error {
  code: string
  missing?: string[]

  constructor(code: string, message: string, missing?: string[]) {
    super(message)
    this.name = 'ParseError'
    this.code = code
    this.missing = missing
  }
}

function createParseError(code: string, message: string, missing?: string[]): ParseError {
  return new ParseError(code, message, missing)
}

export function isParseError(error: unknown): error is ParseError {
  return error instanceof ParseError
}
