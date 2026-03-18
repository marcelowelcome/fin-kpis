'use client'

import { TrendingUp, TrendingDown } from 'lucide-react'
import { formatBRL, formatPercent, getPercentColor } from '@/lib/format'
import type { DeltaData } from '@/lib/schemas'

interface KPICardProps {
  label: string
  fatMeta: number
  fatRealizado: number
  percRealizado: number | null
  receita: number
  percReceita: number | null
  receitaMetaPct?: number
  ticketMedio?: number
  nVendas?: number
  loading?: boolean
  onClick?: () => void
  accent?: string
  delta?: DeltaData | null
  children?: React.ReactNode
}

export function KPICard({
  label,
  fatMeta,
  fatRealizado,
  percRealizado,
  receita,
  percReceita,
  receitaMetaPct,
  ticketMedio,
  nVendas,
  loading = false,
  onClick,
  accent,
  delta,
  children,
}: KPICardProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 animate-pulse">
        <div className="h-4 bg-slate-100 rounded w-24 mb-4" />
        <div className="h-8 bg-slate-100 rounded w-36 mb-2" />
        <div className="h-4 bg-slate-100 rounded w-28" />
      </div>
    )
  }

  return (
    <div
      className={`bg-white rounded-2xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow ${
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
            className={`text-xl font-extrabold ${getPercentColor(percRealizado)}`}
          >
            {formatPercent(percRealizado)}
          </span>
        )}
      </div>

      {/* Faturamento Realizado */}
      <div className="mb-3">
        <div className="flex items-center gap-2">
          <p className="text-2xl font-bold text-slate-900" style={{ fontFeatureSettings: '"tnum"' }}>
            {formatBRL(fatRealizado)}
          </p>
          {delta && (
            <span
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs font-semibold ${
                delta.percentual >= 0
                  ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-700'
              }`}
            >
              {delta.percentual >= 0 ? (
                <TrendingUp size={12} />
              ) : (
                <TrendingDown size={12} />
              )}
              {delta.percentual >= 0 ? '+' : ''}
              {(delta.percentual * 100).toFixed(1)}%
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5" style={{ fontFeatureSettings: '"tnum"' }}>
          Meta: {formatBRL(fatMeta)}
        </p>
      </div>

      {/* Progress bar */}
      {fatMeta > 0 && (
        <div className="w-full h-2.5 bg-slate-100 rounded-full mb-4 overflow-hidden">
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
          <p className="font-medium" style={{ fontFeatureSettings: '"tnum"' }}>{formatBRL(receita)}</p>
          {percReceita !== null && (
            <div className="flex items-center gap-1.5">
              <p
                className={`text-xs font-medium ${
                  receitaMetaPct && receitaMetaPct > 0
                    ? percReceita >= receitaMetaPct
                      ? 'text-green-600'
                      : 'text-amber-600'
                    : 'text-slate-400'
                }`}
                style={{ fontFeatureSettings: '"tnum"' }}
              >
                {formatPercent(percReceita)}
              </p>
              {receitaMetaPct !== undefined && receitaMetaPct > 0 && percReceita >= receitaMetaPct && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-green-50 text-green-700">
                  ✓ Meta
                </span>
              )}
            </div>
          )}
          {receitaMetaPct !== undefined && receitaMetaPct > 0 && (
            <p className="text-[10px] text-slate-400 mt-0.5" style={{ fontFeatureSettings: '"tnum"' }}>
              Meta: {formatPercent(receitaMetaPct)}
            </p>
          )}
        </div>
        {nVendas !== undefined && (
          <div>
            <p className="text-slate-500">Vendas</p>
            <p className="font-medium" style={{ fontFeatureSettings: '"tnum"' }}>{nVendas}</p>
            {ticketMedio !== undefined && ticketMedio > 0 && (
              <p className="text-xs text-slate-400" style={{ fontFeatureSettings: '"tnum"' }}>TM: {formatBRL(ticketMedio)}</p>
            )}
          </div>
        )}
      </div>

      {/* Conteúdo extra (nContratos, nTaxas, etc.) */}
      {children}
    </div>
  )
}
