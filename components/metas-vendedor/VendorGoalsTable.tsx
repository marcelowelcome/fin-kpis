'use client'

import { useState, useEffect } from 'react'
import { X, Plus } from 'lucide-react'
import type { VendorGoal, VendorGoalInput } from '@/lib/schemas'
import { formatBRL } from '@/lib/format'

interface VendorGoalsTableProps {
  goals: VendorGoal[]
  vendedores: string[]
  ano: number
  saving: boolean
  onSave: (goals: VendorGoalInput[]) => Promise<boolean>
}

const MESES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
]

export function VendorGoalsTable({ goals, vendedores, ano, saving, onSave }: VendorGoalsTableProps) {
  const [fatData, setFatData] = useState<Record<string, number>>({})
  const [pctData, setPctData] = useState<Record<string, number>>({})
  const [hasChanges, setHasChanges] = useState(false)
  const [selectedVendedores, setSelectedVendedores] = useState<string[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [search, setSearch] = useState('')

  // Inicializar com dados do banco
  useEffect(() => {
    const fat: Record<string, number> = {}
    const pct: Record<string, number> = {}
    const nomes = new Set<string>()

    goals.forEach((g) => {
      const key = `${g.mes}-${g.vendedor}`
      fat[key] = g.fat_meta
      pct[key] = g.receita_meta_pct
      nomes.add(g.vendedor)
    })

    setFatData(fat)
    setPctData(pct)
    setSelectedVendedores(Array.from(nomes).sort())
    setHasChanges(false)
  }, [goals])

  const getFat = (mes: number, vendedor: string): number =>
    fatData[`${mes}-${vendedor}`] ?? 0

  const getPct = (mes: number, vendedor: string): number =>
    pctData[`${mes}-${vendedor}`] ?? 0

  const setFat = (mes: number, vendedor: string, value: number) => {
    setFatData((prev) => ({ ...prev, [`${mes}-${vendedor}`]: value }))
    setHasChanges(true)
  }

  const setPct = (mes: number, vendedor: string, value: number) => {
    setPctData((prev) => ({ ...prev, [`${mes}-${vendedor}`]: value }))
    setHasChanges(true)
  }

  const addVendedor = (nome: string) => {
    if (!selectedVendedores.includes(nome)) {
      setSelectedVendedores((prev) => [...prev, nome].sort())
      setHasChanges(true)
    }
    setShowDropdown(false)
    setSearch('')
  }

  const removeVendedor = (nome: string) => {
    setSelectedVendedores((prev) => prev.filter((v) => v !== nome))
    // Limpar dados do vendedor removido
    setFatData((prev) => {
      const next = { ...prev }
      for (let mes = 1; mes <= 12; mes++) delete next[`${mes}-${nome}`]
      return next
    })
    setPctData((prev) => {
      const next = { ...prev }
      for (let mes = 1; mes <= 12; mes++) delete next[`${mes}-${nome}`]
      return next
    })
    setHasChanges(true)
  }

  const handleSave = async () => {
    const goalsToSave: VendorGoalInput[] = []

    for (let mes = 1; mes <= 12; mes++) {
      for (const vendedor of selectedVendedores) {
        goalsToSave.push({
          ano,
          mes,
          vendedor,
          fat_meta: getFat(mes, vendedor),
          receita_meta_pct: getPct(mes, vendedor),
        })
      }
    }

    const success = await onSave(goalsToSave)
    if (success) setHasChanges(false)
  }

  // Vendedores disponíveis para adicionar (não selecionados ainda)
  const availableVendedores = vendedores.filter(
    (v) => !selectedVendedores.includes(v)
  )
  const filteredAvailable = search
    ? availableVendedores.filter((v) =>
        v.toLowerCase().includes(search.toLowerCase())
      )
    : availableVendedores

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-700">
          Metas por Vendedor — {ano}
        </h3>
        <div className="flex items-center gap-2">
          {/* Adicionar vendedor */}
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <Plus size={14} />
              Adicionar Vendedor
            </button>
            {showDropdown && (
              <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-slate-200 rounded-lg shadow-lg z-20">
                <div className="p-2 border-b border-slate-100">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar vendedor..."
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded focus:outline-none focus:ring-2 focus:ring-slate-400"
                    autoFocus
                  />
                </div>
                <div className="max-h-48 overflow-y-auto">
                  {filteredAvailable.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-400">
                      {availableVendedores.length === 0
                        ? 'Todos os vendedores já foram adicionados'
                        : 'Nenhum resultado'}
                    </p>
                  ) : (
                    filteredAvailable.map((v) => (
                      <button
                        key={v}
                        onClick={() => addVendedor(v)}
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                      >
                        {v}
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Salvando...' : 'Salvar Metas'}
          </button>
        </div>
      </div>

      {/* Fechar dropdown ao clicar fora */}
      {showDropdown && (
        <div className="fixed inset-0 z-10" onClick={() => { setShowDropdown(false); setSearch('') }} />
      )}

      {selectedVendedores.length === 0 ? (
        <div className="px-4 py-12 text-center">
          <p className="text-sm text-slate-400">
            Nenhum vendedor adicionado. Clique em &quot;Adicionar Vendedor&quot; para começar.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-medium text-slate-600 sticky left-0 bg-slate-50 z-10">
                  Mês
                </th>
                {selectedVendedores.map((vendedor) => (
                  <th
                    key={vendedor}
                    colSpan={2}
                    className="px-2 py-3 text-center font-medium text-slate-600 border-l border-slate-200"
                  >
                    <div className="flex items-center justify-center gap-1">
                      <span className="truncate max-w-[120px]" title={vendedor}>
                        {vendedor}
                      </span>
                      <button
                        onClick={() => removeVendedor(vendedor)}
                        className="p-0.5 text-slate-400 hover:text-red-500 transition-colors shrink-0"
                        title="Remover vendedor"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-1 sticky left-0 bg-slate-50 z-10" />
                {selectedVendedores.map((vendedor) => (
                  <th key={vendedor} colSpan={2} className="border-l border-slate-200">
                    <div className="flex">
                      <span className="flex-1 px-2 py-1 text-xs font-normal text-slate-500 text-right">
                        Meta VT
                      </span>
                      <span className="w-16 px-1 py-1 text-xs font-normal text-slate-500 text-right">
                        % Rec
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {MESES.map((mesLabel, i) => {
                const mes = i + 1
                return (
                  <tr key={mes} className="hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-700 sticky left-0 bg-white z-10">
                      {mesLabel}
                    </td>
                    {selectedVendedores.map((vendedor) => (
                      <td
                        key={vendedor}
                        colSpan={2}
                        className="px-1 py-1 border-l border-slate-200"
                      >
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            step={1000}
                            value={getFat(mes, vendedor) || ''}
                            onChange={(e) =>
                              setFat(mes, vendedor, parseFloat(e.target.value) || 0)
                            }
                            className="flex-1 text-right px-2 py-1 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                            placeholder="0"
                          />
                          <input
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={
                              getPct(mes, vendedor)
                                ? +(getPct(mes, vendedor) * 100).toFixed(2)
                                : ''
                            }
                            onChange={(e) => {
                              const raw = parseFloat(e.target.value)
                              setPct(mes, vendedor, isNaN(raw) ? 0 : raw / 100)
                            }}
                            className="w-16 text-right px-1 py-1 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                            placeholder="%"
                          />
                        </div>
                      </td>
                    ))}
                  </tr>
                )
              })}
              {/* Totais */}
              <tr className="bg-slate-50 font-medium border-t border-slate-200">
                <td className="px-4 py-3 text-slate-700 sticky left-0 bg-slate-50 z-10">Total</td>
                {selectedVendedores.map((vendedor) => {
                  const total = Array.from({ length: 12 }).reduce<number>(
                    (acc, _, idx) => acc + getFat(idx + 1, vendedor),
                    0
                  )
                  return (
                    <td
                      key={vendedor}
                      colSpan={2}
                      className="px-2 py-3 text-right text-slate-700 border-l border-slate-200"
                    >
                      {formatBRL(total)}
                    </td>
                  )
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
