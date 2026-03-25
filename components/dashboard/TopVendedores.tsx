'use client'

import type { VendedorRanking } from '@/lib/schemas'
import { formatBRL, formatPercent, getInitials, AVATAR_COLORS, getPercentColor } from '@/lib/format'

interface VendedorWithGoal extends VendedorRanking {
  fatMeta?: number | null
  percRealizado?: number | null
}

interface TopVendedoresProps {
  vendedores: VendedorWithGoal[]
  loading?: boolean
  activeVendedor?: string | null
  onSelect?: (vendedor: string | null) => void
}

export function TopVendedores({ vendedores, loading = false, activeVendedor, onSelect }: TopVendedoresProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm animate-pulse">
        <div className="h-4 bg-slate-100 rounded w-32 mb-4" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-12 bg-slate-50 rounded-lg mb-2" />
        ))}
      </div>
    )
  }

  if (vendedores.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Top Vendedores
        </h3>
        <p className="text-sm text-slate-400">Nenhum dado disponível.</p>
      </div>
    )
  }

  const maxFat = vendedores[0]?.faturamento || 1

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Top Vendedores
        </h3>
        {activeVendedor && onSelect && (
          <button
            onClick={() => onSelect(null)}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium"
          >
            Limpar filtro
          </button>
        )}
      </div>

      <div className="space-y-3">
        {vendedores.map((v, i) => {
          const pct = maxFat > 0 ? (v.faturamento / maxFat) * 100 : 0
          const isActive = activeVendedor === v.vendedor
          return (
            <div
              key={v.vendedor}
              className={`flex items-center gap-3 rounded-lg px-1 py-0.5 -mx-1 transition-colors ${
                onSelect ? 'cursor-pointer hover:bg-slate-50' : ''
              } ${isActive ? 'bg-blue-50 ring-1 ring-blue-200' : ''}`}
              onClick={() => onSelect?.(isActive ? null : v.vendedor)}
            >
              {/* Posição + Avatar */}
              <div className="flex items-center gap-2.5 shrink-0">
                <span className="text-xs font-medium text-slate-400 w-4 text-right">
                  {i + 1}
                </span>
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${
                    AVATAR_COLORS[i % AVATAR_COLORS.length]
                  }`}
                >
                  {getInitials(v.vendedor)}
                </div>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-sm font-medium text-slate-700 truncate">
                    {v.vendedor}
                  </p>
                  <p className="text-sm font-semibold text-slate-900 tabular-nums shrink-0 ml-2">
                    {formatBRL(v.faturamento)}
                  </p>
                </div>
                {/* Barra relativa */}
                <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-300 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {/* Barra de meta individual */}
                {v.fatMeta != null && v.fatMeta > 0 && (
                  <div className="flex items-center gap-2 mt-1">
                    <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          v.percRealizado != null && v.percRealizado >= 1
                            ? 'bg-green-500'
                            : v.percRealizado != null && v.percRealizado >= 0.7
                            ? 'bg-amber-500'
                            : 'bg-red-400'
                        }`}
                        style={{ width: `${Math.min((v.percRealizado ?? 0) * 100, 100)}%` }}
                      />
                    </div>
                    <span className={`text-[10px] font-semibold tabular-nums shrink-0 ${
                      v.percRealizado != null ? getPercentColor(v.percRealizado) : 'text-slate-400'
                    }`}>
                      {v.percRealizado != null ? formatPercent(v.percRealizado) : '—'}
                    </span>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-xs text-slate-400">
                    Rec: {formatBRL(v.receitas)}
                  </span>
                  <span className="text-xs text-slate-400">
                    ({v.faturamento > 0 ? ((v.receitas / v.faturamento) * 100).toFixed(1).replace('.', ',') : '0,0'}%)
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-slate-400">
                    {v.nVendas} vendas
                  </span>
                  <span className="text-xs text-slate-400">
                    TM: {formatBRL(v.ticketMedio)}
                  </span>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
