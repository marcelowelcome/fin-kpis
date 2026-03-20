'use client'

import { useState, useEffect, useCallback } from 'react'
import { Users } from 'lucide-react'
import { PeriodSelector } from '@/components/dashboard/PeriodSelector'
import { formatBRL, formatPercent, getInitials, AVATAR_COLORS } from '@/lib/format'
import { getPeriodRange } from '@/lib/metrics'

interface VendedorRow {
  vendedor: string
  faturamento: number
  receitas: number
  nVendas: number
  ticketMedio: number
}

const SETORES = [
  { value: '', label: 'Todos' },
  { value: 'CORP', label: 'Corp' },
  { value: 'TRIPS', label: 'Trips' },
  { value: 'WEDDINGS', label: 'Weddings' },
]

export default function VendedoresPage() {
  const [periodo, setPeriodo] = useState('mes-corrente')
  const [customInicio, setCustomInicio] = useState('')
  const [customFim, setCustomFim] = useState('')
  const [setorGrupo, setSetorGrupo] = useState('')
  const [vendedores, setVendedores] = useState<VendedorRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchVendedores = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      let inicio: string
      let fim: string

      if (periodo === 'custom') {
        if (!customInicio || !customFim) {
          setLoading(false)
          return
        }
        inicio = customInicio
        fim = customFim
      } else {
        const range = getPeriodRange(periodo)
        inicio = range.inicio
        fim = range.fim
      }

      const params = new URLSearchParams({ inicio, fim })
      if (setorGrupo) params.set('setor_grupo', setorGrupo)

      const res = await fetch(`/api/insights/vendedores?${params}`, {
        cache: 'no-store',
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error?.message ?? `Erro ${res.status}`)
      }

      const json = await res.json()
      setVendedores(json.vendedores ?? [])
    } catch (err) {
      setError((err as Error).message)
      setVendedores([])
    } finally {
      setLoading(false)
    }
  }, [periodo, customInicio, customFim, setorGrupo])

  useEffect(() => {
    fetchVendedores()
  }, [fetchVendedores])

  const totalFaturamento = vendedores.reduce((sum, v) => sum + v.faturamento, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center">
            <Users size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Vendedores</h1>
            <p className="text-sm text-slate-500">Ranking completo de performance por vendedor</p>
          </div>
        </div>
      </div>

      {/* Period selector */}
      <PeriodSelector
        periodo={periodo}
        setPeriodo={setPeriodo}
        customInicio={customInicio}
        setCustomInicio={setCustomInicio}
        customFim={customFim}
        setCustomFim={setCustomFim}
      />

      {/* Sector filter pills */}
      <div className="flex flex-wrap items-center gap-2">
        {SETORES.map((s) => (
          <button
            key={s.value}
            onClick={() => setSetorGrupo(s.value)}
            className={`px-4 py-2 text-sm font-medium rounded-full transition-colors ${
              setorGrupo === s.value
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Table card */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-5 space-y-3 animate-pulse">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4">
                <div className="w-6 h-4 bg-slate-100 rounded" />
                <div className="w-8 h-8 bg-slate-100 rounded-full" />
                <div className="flex-1 h-4 bg-slate-100 rounded" />
                <div className="w-24 h-4 bg-slate-100 rounded" />
                <div className="w-20 h-4 bg-slate-100 rounded" />
                <div className="w-12 h-4 bg-slate-100 rounded" />
                <div className="w-24 h-4 bg-slate-100 rounded" />
                <div className="w-16 h-4 bg-slate-100 rounded" />
              </div>
            ))}
          </div>
        ) : vendedores.length === 0 ? (
          <div className="p-8 text-center">
            <Users size={32} className="mx-auto text-slate-300 mb-2" />
            <p className="text-sm text-slate-400">Nenhum vendedor encontrado no periodo.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider w-10">
                    #
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Vendedor
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Faturamento
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Receita
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Vendas
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Ticket Medio
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    % do Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vendedores.map((v, i) => {
                  const pctTotal = totalFaturamento > 0 ? v.faturamento / totalFaturamento : 0
                  return (
                    <tr key={v.vendedor} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 text-xs font-medium text-slate-400 tabular-nums">
                        {i + 1}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${
                              AVATAR_COLORS[i % AVATAR_COLORS.length]
                            }`}
                          >
                            {getInitials(v.vendedor)}
                          </div>
                          <span className="font-medium text-slate-700 truncate">
                            {v.vendedor}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                        {formatBRL(v.faturamento)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 tabular-nums whitespace-nowrap">
                        {formatBRL(v.receitas)}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 tabular-nums">
                        {v.nVendas}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 tabular-nums whitespace-nowrap">
                        {formatBRL(v.ticketMedio)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">
                          {formatPercent(pctTotal)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
