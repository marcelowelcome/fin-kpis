'use client'

import { useState, useEffect, useMemo } from 'react'
import { Search, Copy, Trash2 } from 'lucide-react'
import type { VendorGoal, VendorGoalInput, TipoMeta } from '@/lib/schemas'
import { TIPO_META_LABELS } from '@/lib/schemas'
import { formatBRL, getInitials, AVATAR_COLORS } from '@/lib/format'

interface VendorGoalsTableProps {
  goals: VendorGoal[]
  vendedores: string[]
  ano: number
  saving: boolean
  onSave: (goals: VendorGoalInput[]) => Promise<boolean>
}

const MESES_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export function VendorGoalsTable({ goals, vendedores, ano, saving, onSave }: VendorGoalsTableProps) {
  const [fatData, setFatData] = useState<Record<string, number>>({})
  const [tipoData, setTipoData] = useState<Record<string, TipoMeta>>({})
  const [hasChanges, setHasChanges] = useState(false)
  const [search, setSearch] = useState('')

  // Inicializar com dados do banco
  useEffect(() => {
    const fat: Record<string, number> = {}
    const tipos: Record<string, TipoMeta> = {}

    goals.forEach((g) => {
      fat[`${g.vendedor}|${g.mes}`] = g.fat_meta
      // tipo_meta é por vendedor (mesmo para todos os meses), pegar o primeiro
      if (!tipos[g.vendedor]) {
        tipos[g.vendedor] = g.tipo_meta ?? 'valor_total'
      }
    })

    setFatData(fat)
    setTipoData(tipos)
    setHasChanges(false)
  }, [goals])

  const getFat = (vendedor: string, mes: number): number =>
    fatData[`${vendedor}|${mes}`] ?? 0

  const setFat = (vendedor: string, mes: number, value: number) => {
    setFatData((prev) => ({ ...prev, [`${vendedor}|${mes}`]: value }))
    setHasChanges(true)
  }

  const getTipo = (vendedor: string): TipoMeta =>
    tipoData[vendedor] ?? 'valor_total'

  const setTipo = (vendedor: string, tipo: TipoMeta) => {
    setTipoData((prev) => ({ ...prev, [vendedor]: tipo }))
    setHasChanges(true)
  }

  const getTotal = (vendedor: string): number => {
    let sum = 0
    for (let m = 1; m <= 12; m++) sum += getFat(vendedor, m)
    return sum
  }

  const applyToAllMonths = (vendedor: string) => {
    let val = 0
    for (let m = 1; m <= 12; m++) {
      const v = getFat(vendedor, m)
      if (v > 0) { val = v; break }
    }
    if (val === 0) return
    setFatData((prev) => {
      const next = { ...prev }
      for (let m = 1; m <= 12; m++) next[`${vendedor}|${m}`] = val
      return next
    })
    setHasChanges(true)
  }

  const clearVendedor = (vendedor: string) => {
    setFatData((prev) => {
      const next = { ...prev }
      for (let m = 1; m <= 12; m++) delete next[`${vendedor}|${m}`]
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
      const aHas = getTotal(a) > 0 ? 1 : 0
      const bHas = getTotal(b) > 0 ? 1 : 0
      if (aHas !== bHas) return bHas - aHas
      return a.localeCompare(b)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredVendedores, fatData])

  const handleSave = async () => {
    const goalsToSave: VendorGoalInput[] = []

    for (const vendedor of allVendedores) {
      const total = getTotal(vendedor)
      if (total === 0) continue
      const tipo = getTipo(vendedor)
      for (let mes = 1; mes <= 12; mes++) {
        goalsToSave.push({
          ano,
          mes,
          vendedor,
          fat_meta: getFat(vendedor, mes),
          receita_meta_pct: 0,
          tipo_meta: tipo,
        })
      }
    }

    const success = await onSave(goalsToSave)
    if (success) setHasChanges(false)
  }

  const vendedoresComMeta = allVendedores.filter((v) => getTotal(v) > 0).length

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
          </span>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Salvando...' : 'Salvar Metas'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-medium text-slate-600 sticky left-0 bg-slate-50 z-10 min-w-[280px]">
                  Vendedor
                </th>
                {MESES_SHORT.map((m, i) => (
                  <th key={i} className="px-1 py-3 text-center font-medium text-slate-600 min-w-[90px]">
                    {m}
                  </th>
                ))}
                <th className="px-3 py-3 text-right font-medium text-slate-600 min-w-[110px] border-l border-slate-200">
                  Total Ano
                </th>
                <th className="px-2 py-3 text-center font-medium text-slate-400 min-w-[70px]" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedVendedores.map((vendedor, idx) => {
                const total = getTotal(vendedor)
                const hasGoal = total > 0
                const tipo = getTipo(vendedor)
                return (
                  <tr
                    key={vendedor}
                    className={`group transition-colors ${hasGoal ? 'bg-white' : 'bg-slate-50/30'} hover:bg-blue-50/30`}
                  >
                    {/* Vendedor name + avatar + tipo toggle */}
                    <td className="px-4 py-2 sticky left-0 z-10 bg-inherit">
                      <div className="flex items-center gap-2.5">
                        <div
                          className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${
                            AVATAR_COLORS[idx % AVATAR_COLORS.length]
                          }`}
                        >
                          {getInitials(vendedor)}
                        </div>
                        <div className="min-w-0">
                          <span className="text-sm font-medium text-slate-700 truncate block max-w-[140px]" title={vendedor}>
                            {vendedor}
                          </span>
                          {/* Tipo meta toggle */}
                          <div className="flex items-center gap-0.5 mt-0.5">
                            {(['valor_total', 'receita'] as TipoMeta[]).map((t) => (
                              <button
                                key={t}
                                onClick={() => setTipo(vendedor, t)}
                                className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                                  tipo === t
                                    ? t === 'valor_total'
                                      ? 'bg-blue-100 text-blue-700'
                                      : 'bg-emerald-100 text-emerald-700'
                                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
                                }`}
                              >
                                {TIPO_META_LABELS[t]}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* 12 month inputs */}
                    {MESES_SHORT.map((_, mi) => {
                      const mes = mi + 1
                      return (
                        <td key={mes} className="px-1 py-1">
                          <input
                            type="number"
                            min={0}
                            step={1000}
                            value={getFat(vendedor, mes) || ''}
                            onChange={(e) => setFat(vendedor, mes, parseFloat(e.target.value) || 0)}
                            className="w-full text-right px-1.5 py-1 border border-slate-200 rounded text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-slate-400 focus:border-slate-400"
                            placeholder="0"
                          />
                        </td>
                      )
                    })}

                    {/* Total */}
                    <td className="px-3 py-2 text-right border-l border-slate-200 whitespace-nowrap">
                      {total > 0 ? (
                        <div>
                          <span className="font-semibold text-slate-900 tabular-nums">{formatBRL(total)}</span>
                          <span className={`block text-[10px] font-medium ${
                            tipo === 'receita' ? 'text-emerald-600' : 'text-blue-600'
                          }`}>
                            {TIPO_META_LABELS[tipo]}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => applyToAllMonths(vendedor)}
                          className="p-1 text-slate-400 hover:text-blue-600 transition-colors"
                          title="Copiar 1o valor para todos os meses"
                        >
                          <Copy size={14} />
                        </button>
                        <button
                          onClick={() => clearVendedor(vendedor)}
                          className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                          title="Limpar metas deste vendedor"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}

              {filteredVendedores.length === 0 && (
                <tr>
                  <td colSpan={15} className="px-4 py-8 text-center text-sm text-slate-400">
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
