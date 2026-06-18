'use client'

import type { VendedorRanking } from '@/lib/schemas'
import { formatBRL, getInitials, AVATAR_COLORS } from '@/lib/format'

interface TopVendedoresProps {
  vendedores: VendedorRanking[]
  loading?: boolean
  activeVendedor?: string | null
  onSelect?: (vendedor: string | null) => void
}

function MetaBar({ receitas, m1, m2, m3 }: { receitas: number; m1: number; m2: number | null; m3: number | null }) {
  const maxMeta = m3 ?? m2 ?? m1
  const pct = Math.min(receitas / maxMeta, 1)

  const m1Pct = m1 / maxMeta
  const m2Pct = m2 ? m2 / maxMeta : null

  const reachedM1 = receitas >= m1
  const reachedM2 = m2 ? receitas >= m2 : false
  const reachedM3 = m3 ? receitas >= m3 : false

  const barColor = reachedM3
    ? 'bg-emerald-500'
    : reachedM2
    ? 'bg-green-500'
    : reachedM1
    ? 'bg-amber-500'
    : receitas / m1 >= 0.7
    ? 'bg-amber-400'
    : 'bg-red-400'

  return (
    <div className="mt-1.5">
      {/* Barra com marcadores */}
      <div className="relative w-full h-2 bg-slate-100 rounded-full">
        {/* Fill */}
        <div className={`absolute inset-y-0 left-0 rounded-full transition-all ${barColor}`} style={{ width: `${pct * 100}%` }} />
        {/* Marcador M1 */}
        <div className="absolute top-[-3px] bottom-[-3px] w-0.5 bg-blue-400/60 rounded-full" style={{ left: `${m1Pct * 100}%` }} />
        {/* Marcador M2 */}
        {m2Pct && (
          <div className="absolute top-[-3px] bottom-[-3px] w-0.5 bg-violet-400/60 rounded-full" style={{ left: `${m2Pct * 100}%` }} />
        )}
      </div>

      {/* Badges de meta atingida + percentuais */}
      <div className="flex items-center gap-1 mt-1 flex-wrap">
        <span className="text-[10px] text-slate-400">Rec:</span>
        <span className="text-[10px] font-semibold text-slate-600 tabular-nums">{formatBRL(receitas)}</span>

        {/* M1 */}
        <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold ${
          reachedM1 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'
        }`}>
          M1 {reachedM1 ? '✓' : `${Math.round((receitas / m1) * 100)}%`}
        </span>

        {/* M2 */}
        {m2 && (
          <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold ${
            reachedM2 ? 'bg-violet-100 text-violet-700' : reachedM1 ? 'bg-slate-100 text-slate-500' : 'bg-slate-50 text-slate-300'
          }`}>
            M2 {reachedM2 ? '✓' : reachedM1 ? `${Math.round((receitas / m2) * 100)}%` : '—'}
          </span>
        )}

        {/* M3 */}
        {m3 && (
          <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[9px] font-bold ${
            reachedM3 ? 'bg-emerald-100 text-emerald-700' : reachedM2 ? 'bg-slate-100 text-slate-500' : 'bg-slate-50 text-slate-300'
          }`}>
            M3 {reachedM3 ? '✓' : reachedM2 ? `${Math.round((receitas / m3) * 100)}%` : '—'}
          </span>
        )}
      </div>
    </div>
  )
}

export function TopVendedores({ vendedores, loading = false, activeVendedor, onSelect }: TopVendedoresProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm animate-pulse">
        <div className="h-4 bg-slate-100 rounded w-32 mb-4" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 bg-slate-50 rounded-lg mb-2" />
        ))}
      </div>
    )
  }

  if (vendedores.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Top Vendedores</h3>
        <p className="text-sm text-slate-400">Nenhum dado disponível.</p>
      </div>
    )
  }

  const maxFat = vendedores[0]?.faturamento || 1

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Top Vendedores</h3>
        {activeVendedor && onSelect && (
          <button onClick={() => onSelect(null)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
            Limpar filtro
          </button>
        )}
      </div>

      <div className="space-y-4">
        {vendedores.map((v, i) => {
          const pctFat = maxFat > 0 ? (v.faturamento / maxFat) * 100 : 0
          const isActive = activeVendedor === v.vendedor
          const hasMetas = v.fatMeta != null && v.fatMeta > 0

          return (
            <div
              key={v.vendedor}
              className={`rounded-lg px-1 py-0.5 -mx-1 transition-colors ${
                onSelect ? 'cursor-pointer hover:bg-slate-50' : ''
              } ${isActive ? 'bg-blue-50 ring-1 ring-blue-200' : ''}`}
              onClick={() => onSelect?.(isActive ? null : v.vendedor)}
            >
              <div className="flex items-start gap-3">
                {/* Posição + Avatar */}
                <div className="flex items-center gap-2 shrink-0 pt-0.5">
                  <span className="text-xs font-medium text-slate-400 w-4 text-right">{i + 1}</span>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}>
                    {getInitials(v.vendedor)}
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  {/* Nome + Faturamento */}
                  <div className="flex items-center justify-between mb-0.5">
                    <p className="text-sm font-semibold text-slate-800 truncate">{v.vendedor}</p>
                    <p className="text-sm font-bold text-slate-900 tabular-nums shrink-0 ml-2">{formatBRL(v.faturamento)}</p>
                  </div>

                  {/* Barra relativa de faturamento */}
                  <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden mb-1">
                    <div className="h-full bg-slate-300 rounded-full transition-all" style={{ width: `${pctFat}%` }} />
                  </div>

                  {/* Receita */}
                  <div className="flex items-center gap-2 text-xs text-slate-400 mb-0.5">
                    <span>{v.nVendas} vendas</span>
                    <span>·</span>
                    <span>TM: {formatBRL(v.ticketMedio)}</span>
                  </div>

                  {/* Barra de meta escalonada M1→M2→M3 */}
                  {hasMetas ? (
                    <MetaBar
                      receitas={v.receitas}
                      m1={v.fatMeta!}
                      m2={v.metaM2 ?? null}
                      m3={v.metaM3 ?? null}
                    />
                  ) : (
                    <div className="text-[10px] text-slate-400 mt-1">
                      Rec: {formatBRL(v.receitas)}
                      <span className="ml-2 text-slate-300">sem meta cadastrada</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
