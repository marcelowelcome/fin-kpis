'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { Search, Trash2, Zap, ChevronDown, ChevronRight } from 'lucide-react'
import type { VendorGoal, VendorGoalInput, TipoMeta } from '@/lib/schemas'
import { TIPO_META_LABELS } from '@/lib/schemas'
import { formatBRL, getInitials, AVATAR_COLORS } from '@/lib/format'
import { TP_LEVELS, TP_PLANS, TP_COLORS, type TpLevel } from '@/lib/tp-plan'

interface VendorGoalsTableProps {
  goals: VendorGoal[]
  vendedores: string[]
  ano: number
  saving: boolean
  onSave: (goals: VendorGoalInput[]) => Promise<boolean>
}

const MESES_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const NIVEIS = [1, 2, 3] as const
const NIVEL_LABELS = { 1: 'M1', 2: 'M2', 3: 'M3' }
const NIVEL_COLORS = {
  1: 'text-blue-600 bg-blue-50',
  2: 'text-violet-600 bg-violet-50',
  3: 'text-emerald-600 bg-emerald-50',
}
const TP_STORAGE_KEY = 'vendor-tp-assignments'

type Nivel = 1 | 2 | 3

function makeKey(vendedor: string, nivel: Nivel, mes: number) {
  return `${vendedor}|${nivel}|${mes}`
}

export function VendorGoalsTable({ goals, vendedores, ano, saving, onSave }: VendorGoalsTableProps) {
  const [fatData, setFatData] = useState<Record<string, number>>({})
  const [tipoData, setTipoData] = useState<Record<string, TipoMeta>>({})
  const [tpData, setTpData] = useState<Record<string, TpLevel>>({})
  const [hasChanges, setHasChanges] = useState(false)
  const [search, setSearch] = useState('')
  const [expandedVendors, setExpandedVendors] = useState<Set<string>>(new Set())

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TP_STORAGE_KEY)
      if (saved) setTpData(JSON.parse(saved))
    } catch { /* ignore */ }
  }, [])

  useEffect(() => {
    const fat: Record<string, number> = {}
    const tipos: Record<string, TipoMeta> = {}
    const withGoals = new Set<string>()

    goals.forEach((g) => {
      const nivel = (g.nivel_meta ?? 1) as Nivel
      fat[makeKey(g.vendedor, nivel, g.mes)] = g.fat_meta
      if (!tipos[g.vendedor]) tipos[g.vendedor] = g.tipo_meta ?? 'valor_total'
      if (g.fat_meta > 0) withGoals.add(g.vendedor)
    })

    setFatData(fat)
    setTipoData(tipos)
    setExpandedVendors(withGoals)
    setHasChanges(false)
  }, [goals])

  const toggleExpand = (vendedor: string) => {
    setExpandedVendors((prev) => {
      const next = new Set(prev)
      if (next.has(vendedor)) next.delete(vendedor)
      else next.add(vendedor)
      return next
    })
  }

  const getFat = (vendedor: string, nivel: Nivel, mes: number): number =>
    fatData[makeKey(vendedor, nivel, mes)] ?? 0

  const setFat = (vendedor: string, nivel: Nivel, mes: number, value: number) => {
    setFatData((prev) => ({ ...prev, [makeKey(vendedor, nivel, mes)]: value }))
    setHasChanges(true)
  }

  const getTipo = (vendedor: string): TipoMeta => tipoData[vendedor] ?? 'valor_total'
  const setTipo = (vendedor: string, tipo: TipoMeta) => {
    setTipoData((prev) => ({ ...prev, [vendedor]: tipo }))
    setHasChanges(true)
  }

  const getTp = (vendedor: string): TpLevel | null => tpData[vendedor] ?? null
  const setTp = (vendedor: string, tp: TpLevel | null) => {
    setTpData((prev) => {
      const next = { ...prev }
      if (tp === null) delete next[vendedor]
      else next[vendedor] = tp
      try { localStorage.setItem(TP_STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  const applyTpNivel = (vendedor: string, nivel: Nivel) => {
    const tp = getTp(vendedor)
    if (!tp) return
    const values = TP_PLANS[tp][nivel]
    if (!values.length) return
    setFatData((prev) => {
      const next = { ...prev }
      values.forEach((val, idx) => {
        next[makeKey(vendedor, nivel, idx + 1)] = Math.round(val)
      })
      return next
    })
    setHasChanges(true)
  }

  const applyTpAll = (vendedor: string) => {
    const tp = getTp(vendedor)
    if (!tp) return
    setFatData((prev) => {
      const next = { ...prev }
      for (const nivel of NIVEIS) {
        const values = TP_PLANS[tp][nivel]
        if (!values.length) continue
        values.forEach((val, idx) => {
          next[makeKey(vendedor, nivel, idx + 1)] = Math.round(val)
        })
      }
      return next
    })
    setHasChanges(true)
    // auto-expand so user sees the filled values
    setExpandedVendors((prev) => new Set(prev).add(vendedor))
  }

  const getNivelTotal = (vendedor: string, nivel: Nivel): number => {
    let sum = 0
    for (let m = 1; m <= 12; m++) sum += getFat(vendedor, nivel, m)
    return sum
  }

  const getVendedorTotal = (vendedor: string): number =>
    NIVEIS.reduce((s, n) => s + getNivelTotal(vendedor, n), 0)

  const clearVendedor = (vendedor: string) => {
    setFatData((prev) => {
      const next = { ...prev }
      for (const nivel of NIVEIS)
        for (let m = 1; m <= 12; m++) delete next[makeKey(vendedor, nivel, m)]
      return next
    })
    setHasChanges(true)
  }

  const allVendedores = useMemo(() => {
    const names = new Set<string>(vendedores)
    goals.forEach((g) => names.add(g.vendedor))
    return Array.from(names).sort()
  }, [vendedores, goals])

  const filteredVendedores = useMemo(() => {
    if (!search) return allVendedores
    const q = search.toLowerCase()
    return allVendedores.filter((v) => v.toLowerCase().includes(q))
  }, [allVendedores, search])

  const sortedVendedores = useMemo(() => {
    return [...filteredVendedores].sort((a, b) => {
      const aHas = getVendedorTotal(a) > 0 ? 1 : 0
      const bHas = getVendedorTotal(b) > 0 ? 1 : 0
      if (aHas !== bHas) return bHas - aHas
      return a.localeCompare(b)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredVendedores, fatData])

  const handleSave = async () => {
    const goalsToSave: VendorGoalInput[] = []
    for (const vendedor of allVendedores) {
      const tipo = getTipo(vendedor)
      for (const nivel of NIVEIS) {
        const total = getNivelTotal(vendedor, nivel)
        if (total === 0) continue
        for (let mes = 1; mes <= 12; mes++) {
          goalsToSave.push({
            ano, mes, vendedor,
            fat_meta: getFat(vendedor, nivel, mes),
            receita_meta_pct: 0,
            tipo_meta: tipo,
            nivel_meta: nivel,
          })
        }
      }
    }
    const success = await onSave(goalsToSave)
    if (success) setHasChanges(false)
  }

  const vendedoresComMeta = allVendedores.filter((v) => getVendedorTotal(v) > 0).length
  const vendedoresComTp = allVendedores.filter((v) => getTp(v) !== null).length

  const allExpanded = sortedVendedores.length > 0 && sortedVendedores.every((v) => expandedVendors.has(v))
  const toggleAll = () => {
    if (allExpanded) setExpandedVendors(new Set())
    else setExpandedVendors(new Set(sortedVendedores))
  }

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Buscar entre ${allVendedores.length} vendedores...`}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {vendedoresComMeta} de {allVendedores.length} com meta
            {vendedoresComTp > 0 && <span className="ml-2 text-amber-600">· {vendedoresComTp} com TP</span>}
          </span>
          <button
            onClick={toggleAll}
            className="px-3 py-2 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg transition-colors"
          >
            {allExpanded ? 'Recolher todos' : 'Expandir todos'}
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Salvando...' : 'Salvar Metas'}
          </button>
        </div>
      </div>

      {/* Legenda TP */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-slate-400 flex items-center gap-1"><Zap size={11} />Nível TP:</span>
        {TP_LEVELS.filter(tp => tp !== 'TP5').map((tp) => (
          <span key={tp} className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${TP_COLORS[tp]}`}>{tp}</span>
        ))}
        <span className="text-xs text-slate-400 ml-1">— atribua o nível e clique <strong>Aplicar</strong> para preencher M1/M2/M3 automaticamente</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <colgroup>
              <col className="w-[220px]" />
              <col className="w-[44px]" />
              {MESES_SHORT.map((_, i) => <col key={i} className="w-[90px]" />)}
              <col className="w-[120px]" />
            </colgroup>
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-medium text-slate-600 sticky left-0 bg-slate-50 z-10">
                  Vendedor
                </th>
                <th className="py-3 text-center font-medium text-slate-400 text-xs">—</th>
                {MESES_SHORT.map((m, i) => (
                  <th key={i} className="py-3 text-center font-medium text-slate-600 text-xs">{m}</th>
                ))}
                <th className="px-3 py-3 text-right font-medium text-slate-600 text-xs border-l border-slate-200">
                  Total Ano
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedVendedores.map((vendedor, idx) => {
                const tp = getTp(vendedor)
                const tipo = getTipo(vendedor)
                const hasTpPlan = tp !== null && TP_PLANS[tp][1].length > 0
                const hasAnyGoal = getVendedorTotal(vendedor) > 0
                const isExpanded = expandedVendors.has(vendedor)

                return (
                  <React.Fragment key={vendedor}>
                    {/* Vendor header row */}
                    <tr className={`border-t-2 border-slate-200 ${hasAnyGoal ? 'bg-slate-50' : 'bg-slate-50/60 opacity-70'}`}>
                      <td className="px-3 py-2 sticky left-0 bg-inherit z-10">
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => toggleExpand(vendedor)}
                            className="text-slate-400 hover:text-slate-700 transition-colors shrink-0"
                            title={isExpanded ? 'Recolher' : 'Expandir'}
                          >
                            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          </button>
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${AVATAR_COLORS[idx % AVATAR_COLORS.length]}`}>
                            {getInitials(vendedor)}
                          </div>
                          <div className="min-w-0">
                            <span className="text-sm font-semibold text-slate-800 truncate block max-w-[130px]" title={vendedor}>
                              {vendedor}
                            </span>
                            <div className="flex items-center gap-0.5 mt-0.5 flex-wrap">
                              {(['valor_total', 'receita'] as TipoMeta[]).map((t) => (
                                <button key={t} onClick={() => setTipo(vendedor, t)}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                    tipo === t
                                      ? t === 'valor_total' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
                                      : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100'
                                  }`}>
                                  {TIPO_META_LABELS[t]}
                                </button>
                              ))}
                              <span className="text-slate-200 mx-0.5">|</span>
                              {TP_LEVELS.filter(lv => lv !== 'TP5').map((lv) => (
                                <button key={lv} onClick={() => setTp(vendedor, tp === lv ? null : lv)}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                                    tp === lv ? TP_COLORS[lv] : 'text-slate-300 hover:text-slate-500 hover:bg-slate-100'
                                  }`}>
                                  {lv}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </td>
                      {/* nivel col empty */}
                      <td className="bg-inherit" />
                      {/* month cols empty */}
                      {MESES_SHORT.map((_, mi) => <td key={mi} className="bg-inherit" />)}
                      {/* actions */}
                      <td className="px-2 py-2 bg-inherit border-l border-slate-200">
                        <div className="flex items-center gap-1 justify-end">
                          {hasTpPlan && (
                            <button onClick={() => applyTpAll(vendedor)}
                              className="px-2 py-1 text-[10px] font-bold rounded bg-amber-100 text-amber-700 hover:bg-amber-200 border border-amber-200 transition-colors whitespace-nowrap">
                              Aplicar {tp}
                            </button>
                          )}
                          <button onClick={() => clearVendedor(vendedor)}
                            className="p-1 text-slate-300 hover:text-red-500 transition-colors" title="Limpar">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>

                    {/* M1, M2, M3 rows — only when expanded */}
                    {isExpanded && NIVEIS.map((nivel) => {
                      const nivelTotal = getNivelTotal(vendedor, nivel)
                      return (
                        <tr key={`${vendedor}-n${nivel}`} className="border-t border-slate-100 hover:bg-blue-50/20 transition-colors group/row">
                          {/* sticky vendor col (empty spacer) */}
                          <td className="sticky left-0 bg-white z-10 group-hover/row:bg-blue-50/20" />
                          {/* nivel badge */}
                          <td className="py-1.5 text-center">
                            <span className={`inline-flex items-center justify-center w-7 h-5 rounded text-[10px] font-bold ${NIVEL_COLORS[nivel]}`}>
                              {NIVEL_LABELS[nivel]}
                            </span>
                          </td>
                          {/* 12 month inputs */}
                          {MESES_SHORT.map((_, mi) => {
                            const mes = mi + 1
                            return (
                              <td key={mes} className="px-1 py-1">
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={getFat(vendedor, nivel, mes) || ''}
                                  onChange={(e) => setFat(vendedor, nivel, mes, Math.round(parseFloat(e.target.value) || 0))}
                                  className="w-full text-right px-1.5 py-1 border border-slate-200 rounded text-xs tabular-nums focus:outline-none focus:ring-1 focus:ring-slate-400"
                                  placeholder="0"
                                />
                              </td>
                            )
                          })}
                          {/* nivel total + apply button */}
                          <td className="px-3 py-1 text-right border-l border-slate-200 whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              {hasTpPlan && (
                                <button onClick={() => applyTpNivel(vendedor, nivel)}
                                  title={`Aplicar ${NIVEL_LABELS[nivel]} do ${tp}`}
                                  className="opacity-0 group-hover/row:opacity-100 px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-50 text-amber-600 hover:bg-amber-100 border border-amber-200 transition-all">
                                  {NIVEL_LABELS[nivel]}
                                </button>
                              )}
                              {nivelTotal > 0 ? (
                                <span className={`text-xs font-semibold tabular-nums ${
                                  nivel === 1 ? 'text-blue-700' : nivel === 2 ? 'text-violet-700' : 'text-emerald-700'
                                }`}>
                                  {formatBRL(nivelTotal)}
                                </span>
                              ) : (
                                <span className="text-slate-300 text-xs">—</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </React.Fragment>
                )
              })}

              {filteredVendedores.length === 0 && (
                <tr>
                  <td colSpan={16} className="px-4 py-8 text-center text-sm text-slate-400">
                    Nenhum vendedor encontrado para &quot;{search}&quot;
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
