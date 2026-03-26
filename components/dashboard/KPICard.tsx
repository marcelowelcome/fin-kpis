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
  deltaLabel?: string | null
  /** % esperado do período (0-1) baseado em dias decorridos/total */
  expectedPercent?: number | null
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
  deltaLabel,
  expectedPercent,
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

      {/* Valor Total Realizado */}
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
              {deltaLabel && (
                <span className="text-[10px] font-normal opacity-75 ml-0.5">{deltaLabel}</span>
              )}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5" style={{ fontFeatureSettings: '"tnum"' }}>
          Meta: {formatBRL(fatMeta)}
        </p>
      </div>

      {/* Progress bar with expected marker + hover tooltip */}
      {fatMeta > 0 && (() => {
        const expectedValue = expectedPercent != null ? fatMeta * expectedPercent : null
        const aheadOfSchedule = expectedPercent != null && percRealizado != null
          ? percRealizado >= expectedPercent
          : null
        const gap = expectedValue != null ? fatRealizado - expectedValue : null

        return (
          <div className="relative w-full h-2.5 bg-slate-100 rounded-full mb-4 group/bar">
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
            {expectedPercent != null && expectedPercent > 0 && expectedPercent < 1 && (
              <>
                {/* Marker line */}
                <div
                  className="absolute top-[-3px] w-0.5 h-[16px] bg-slate-900/50 rounded-full"
                  style={{ left: `${expectedPercent * 100}%` }}
                />
                {/* Hover tooltip */}
                <div
                  className="absolute bottom-full mb-2 opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none z-20"
                  style={{ left: `${expectedPercent * 100}%`, transform: 'translateX(-50%)' }}
                >
                  <div className="bg-slate-900 text-white text-[11px] rounded-lg px-3 py-2 shadow-lg whitespace-nowrap leading-relaxed">
                    <p className="font-medium mb-1">
                      {(expectedPercent * 100).toFixed(0)}% do período decorrido
                    </p>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">Esperado:</span>
                      <span className="font-semibold tabular-nums">{formatBRL(expectedValue ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-slate-400">Realizado:</span>
                      <span className="font-semibold tabular-nums">{formatBRL(fatRealizado)}</span>
                    </div>
                    {gap !== null && (
                      <div className={`mt-1 pt-1 border-t border-slate-700 font-semibold ${
                        aheadOfSchedule ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {aheadOfSchedule ? '+' : ''}{formatBRL(gap)} {aheadOfSchedule ? 'adiantado' : 'atrasado'}
                      </div>
                    )}
                    {/* Arrow */}
                    <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-slate-900" />
                  </div>
                </div>
              </>
            )}
          </div>
        )
      })()}

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
