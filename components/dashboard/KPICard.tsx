'use client'

import { formatBRL, formatPercent, getPercentColor } from '@/lib/format'

interface KPICardProps {
  label: string
  fatMeta: number
  fatRealizado: number
  percRealizado: number | null
  receita: number
  percReceita: number | null
  ticketMedio?: number
  nVendas?: number
  loading?: boolean
  onClick?: () => void
  accent?: string
  children?: React.ReactNode
}

export function KPICard({
  label,
  fatMeta,
  fatRealizado,
  percRealizado,
  receita,
  percReceita,
  ticketMedio,
  nVendas,
  loading = false,
  onClick,
  accent,
  children,
}: KPICardProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
        <div className="h-4 bg-slate-100 rounded w-24 mb-4" />
        <div className="h-8 bg-slate-100 rounded w-36 mb-2" />
        <div className="h-4 bg-slate-100 rounded w-28" />
      </div>
    )
  }

  return (
    <div
      className={`bg-white rounded-xl border border-slate-200 p-5 hover:shadow-md transition-shadow ${
        onClick ? 'cursor-pointer' : ''
      }`}
      onClick={onClick}
      style={accent ? { borderTopColor: accent, borderTopWidth: '3px' } : undefined}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-600 uppercase tracking-wider">
          {label}
        </h3>
        {percRealizado !== null && (
          <span
            className={`text-lg font-bold ${getPercentColor(percRealizado)}`}
          >
            {formatPercent(percRealizado)}
          </span>
        )}
      </div>

      {/* Faturamento Realizado */}
      <div className="mb-3">
        <p className="text-2xl font-bold text-slate-900">
          {formatBRL(fatRealizado)}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">
          Meta: {formatBRL(fatMeta)}
        </p>
      </div>

      {/* Progress bar */}
      {fatMeta > 0 && (
        <div className="w-full h-2 bg-slate-100 rounded-full mb-4 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              percRealizado !== null && percRealizado >= 1
                ? 'bg-green-500'
                : percRealizado !== null && percRealizado >= 0.7
                ? 'bg-amber-500'
                : 'bg-red-500'
            }`}
            style={{ width: `${Math.min((percRealizado ?? 0) * 100, 100)}%` }}
          />
        </div>
      )}

      {/* Métricas secundárias */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-slate-500">Receita</p>
          <p className="font-medium">{formatBRL(receita)}</p>
          {percReceita !== null && (
            <p className="text-xs text-slate-400">{formatPercent(percReceita)}</p>
          )}
        </div>
        {nVendas !== undefined && (
          <div>
            <p className="text-slate-500">Vendas</p>
            <p className="font-medium">{nVendas}</p>
            {ticketMedio !== undefined && ticketMedio > 0 && (
              <p className="text-xs text-slate-400">TM: {formatBRL(ticketMedio)}</p>
            )}
          </div>
        )}
      </div>

      {/* Conteúdo extra (nContratos, nTaxas, etc.) */}
      {children}
    </div>
  )
}
