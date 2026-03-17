/**
 * Formatadores reutilizáveis para o dashboard.
 */

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const percentFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

const numberFormatter = new Intl.NumberFormat('pt-BR')

export function formatBRL(value: number): string {
  return brlFormatter.format(value)
}

export function formatPercent(value: number | null): string {
  if (value === null) return '-'
  return percentFormatter.format(value)
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00')
  return date.toLocaleDateString('pt-BR')
}

export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString('pt-BR')
}

/**
 * Retorna a classe de cor baseada no percentual realizado.
 */
export function getPercentColor(perc: number | null): string {
  if (perc === null) return 'text-slate-400'
  if (perc >= 1.0) return 'text-green-600'
  if (perc >= 0.7) return 'text-amber-600'
  return 'text-red-600'
}

export function getPercentBgColor(perc: number | null): string {
  if (perc === null) return 'bg-slate-100'
  if (perc >= 1.0) return 'bg-green-50'
  if (perc >= 0.7) return 'bg-amber-50'
  return 'bg-red-50'
}
