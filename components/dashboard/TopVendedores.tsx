'use client'

import type { VendedorRanking } from '@/lib/schemas'
import { formatBRL, getInitials, AVATAR_COLORS } from '@/lib/format'

interface TopVendedoresProps {
  vendedores: VendedorRanking[]
  loading?: boolean
  activeVendedor?: string | null
  onSelect?: (vendedor: string | null) => void
}

function fmtNum(v: number) {
  return Math.round(v).toLocaleString('pt-BR')
}

function metaStatus(receitas: number, m1: number, m2: number | null, m3: number | null) {
  if (m3 && receitas >= m3) return { label: 'M3 ✓', color: 'text-emerald-600 bg-emerald-50' }
  if (m2 && receitas >= m2) return { label: `M3 ${Math.round((receitas / m3!) * 100)}%`, color: 'text-green-600 bg-green-50' }
  if (receitas >= m1)       return { label: `M2 ${m2 ? Math.round((receitas / m2) * 100) + '%' : '✓'}`, color: 'text-amber-600 bg-amber-50' }
  return { label: `${Math.round((receitas / m1) * 100)}% M1`, color: 'text-red-600 bg-red-50' }
}

function MetaBar({ receitas, m1, m2, m3 }: { receitas: number; m1: number; m2: number | null; m3: number | null }) {
  const maxMeta = m3 ?? m2 ?? m1
  const pct = Math.min(receitas / maxMeta, 1)
  const m1Pct = m1 / maxMeta
  const m2Pct = m2 ? m2 / maxMeta : null

  const reachedM1 = receitas >= m1
  const reachedM2 = m2 ? receitas >= m2 : false
  const reachedM3 = m3 ? receitas >= m3 : false

  const barColor = reachedM3 ? 'bg-emerald-500'
    : reachedM2 ? 'bg-green-500'
    : reachedM1 ? 'bg-amber-400'
    : receitas / m1 >= 0.7 ? 'bg-amber-400'
    : 'bg-red-400'

  return (
    <div className="relative w-full h-2 bg-slate-100 rounded-full my-1.5">
      <div className={`absolute inset-y-0 left-0 rounded-full transition-all ${barColor}`} style={{ width: `${pct * 100}%` }} />
      <div className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-blue-300/80 rounded-full" style={{ left: `${m1Pct * 100}%` }} />
      {m2Pct && <div className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-violet-300/80 rounded-full" style={{ left: `${m2Pct * 100}%` }} />}
    </div>
  )
}

export function TopVendedores({ vendedores, loading = false, activeVendedor, onSelect }: TopVendedoresProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm animate-pulse">
        <div className="h-4 bg-slate-100 rounded w-32 mb-4" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 bg-slate-50 rounded-lg mb-3" />
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
          const isActive = activeVendedor === v.vendedor
          const hasMetas = v.fatMeta != null && v.fatMeta > 0
          const status = hasMetas ? metaStatus(v.receitas, v.fatMeta!, v.metaM2 ?? null, v.metaM3 ?? null) : null

          return (
            <div
              key={v.vendedor}
              className={`rounded-xl px-2 py-2 -mx-1 transition-colors ${
                onSelect ? 'cursor-pointer hover:bg-slate-50' : ''
              } ${isActive ? 'bg-blue-50 ring-1 ring-blue-200' : ''}`}
              onClick={() => onSelect?.(isActive ? null : v.vendedor)}
            >
              <div className="flex items-start gap-2.5">
                {/* Posição + Avatar */}
                <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                  <span className="text-[11px] font-medium text-slate-400 w-3">{i + 1}</span>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}>
                    {getInitials(v.vendedor)}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">

                  {/* Linha 1: Nome + % meta */}
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className="text-sm font-semibold text-slate-800 truncate">{v.vendedor}</p>
                    {status && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${status.color}`}>
                        {status.label}
                      </span>
                    )}
                  </div>

                  {/* Linha 2: Receita */}
                  <div className="flex items-baseline gap-1.5 text-xs">
                    <span className="text-slate-400">Receita</span>
                    <span className="font-semibold text-slate-700 tabular-nums">{formatBRL(v.receitas)}</span>
                  </div>

                  {/* Linha 3: M1 / M2 / M3 */}
                  {hasMetas && (
                    <div className="flex items-center gap-2 text-[10px] mt-0.5">
                      <span className="text-blue-600 font-medium">M1 {fmtNum(v.fatMeta!)}</span>
                      {v.metaM2 && <span className="text-violet-500 font-medium">M2 {fmtNum(v.metaM2)}</span>}
                      {v.metaM3 && <span className="text-emerald-600 font-medium">M3 {fmtNum(v.metaM3)}</span>}
                    </div>
                  )}

                  {/* Linha 4: Barra de meta */}
                  {hasMetas && (
                    <MetaBar
                      receitas={v.receitas}
                      m1={v.fatMeta!}
                      m2={v.metaM2 ?? null}
                      m3={v.metaM3 ?? null}
                    />
                  )}

                  {/* Linha 5: Faturamento */}
                  <div className="flex items-baseline gap-1.5 text-xs">
                    <span className="text-slate-400">Faturamento</span>
                    <span className="font-semibold text-slate-900 tabular-nums">{formatBRL(v.faturamento)}</span>
                  </div>

                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
