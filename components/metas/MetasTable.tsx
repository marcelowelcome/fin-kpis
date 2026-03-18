'use client'

import { useState, useEffect } from 'react'
import type { Meta, MetaInput, SetorMeta } from '@/lib/schemas'
import {
  SETOR_METAS_PRINCIPAIS,
  SETOR_LABELS,
  WEDDINGS_SUBCATEGORIAS_METAS,
} from '@/lib/schemas'
import { formatBRL } from '@/lib/format'

interface MetasTableProps {
  metas: Meta[]
  ano: number
  saving: boolean
  onSave: (metas: MetaInput[]) => Promise<boolean>
}

const MESES = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
  'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
]

export function MetasTable({ metas, ano, saving, onSave }: MetasTableProps) {
  const [fatData, setFatData] = useState<Record<string, number>>({})
  const [pctData, setPctData] = useState<Record<string, number>>({})
  const [hasChanges, setHasChanges] = useState(false)

  // Inicializar com os valores do banco
  useEffect(() => {
    const fat: Record<string, number> = {}
    const pct: Record<string, number> = {}
    metas.forEach((m) => {
      const key = `${m.mes}-${m.setor_grupo}`
      fat[key] = m.fat_meta
      pct[key] = m.receita_meta_pct
    })
    setFatData(fat)
    setPctData(pct)
    setHasChanges(false)
  }, [metas])

  const getFat = (mes: number, setor: SetorMeta): number => {
    return fatData[`${mes}-${setor}`] ?? 0
  }

  const getPct = (mes: number, setor: SetorMeta): number => {
    return pctData[`${mes}-${setor}`] ?? 0
  }

  const setFat = (mes: number, setor: SetorMeta, value: number) => {
    setFatData((prev) => ({ ...prev, [`${mes}-${setor}`]: value }))
    setHasChanges(true)
  }

  const setPct = (mes: number, setor: SetorMeta, value: number) => {
    setPctData((prev) => ({ ...prev, [`${mes}-${setor}`]: value }))
    setHasChanges(true)
  }

  const handleSave = async () => {
    const metasToSave: MetaInput[] = []

    // Setores principais
    for (let mes = 1; mes <= 12; mes++) {
      for (const setor of SETOR_METAS_PRINCIPAIS) {
        metasToSave.push({
          ano,
          mes,
          setor_grupo: setor,
          fat_meta: getFat(mes, setor),
          receita_meta_pct: getPct(mes, setor),
        })
      }
    }

    // Subcategorias Weddings
    for (let mes = 1; mes <= 12; mes++) {
      for (const sub of WEDDINGS_SUBCATEGORIAS_METAS) {
        metasToSave.push({
          ano,
          mes,
          setor_grupo: sub.id,
          fat_meta: getFat(mes, sub.id),
          receita_meta_pct: getPct(mes, sub.id),
        })
      }
    }

    const success = await onSave(metasToSave)
    if (success) setHasChanges(false)
  }

  return (
    <div className="space-y-6">
      {/* ============================================================= */}
      {/* Section 1: Metas por Setor                                    */}
      {/* ============================================================= */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">
            Metas por Setor — {ano}
          </h3>
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className="px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Salvando...' : 'Salvar Metas'}
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  Mês
                </th>
                {SETOR_METAS_PRINCIPAIS.map((setor) => (
                  <th
                    key={setor}
                    colSpan={2}
                    className="px-2 py-3 text-center font-medium text-slate-600 border-l border-slate-200"
                  >
                    {SETOR_LABELS[setor]}
                  </th>
                ))}
              </tr>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-1" />
                {SETOR_METAS_PRINCIPAIS.map((setor) => (
                  <th key={setor} colSpan={2} className="border-l border-slate-200">
                    <div className="flex">
                      <span className="flex-1 px-2 py-1 text-xs font-normal text-slate-500 text-right">
                        Fat. Meta
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
                    <td className="px-4 py-2 font-medium text-slate-700">
                      {mesLabel}
                    </td>
                    {SETOR_METAS_PRINCIPAIS.map((setor) => (
                      <td
                        key={setor}
                        colSpan={2}
                        className="px-1 py-1 border-l border-slate-200"
                      >
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            step={1000}
                            value={getFat(mes, setor) || ''}
                            onChange={(e) =>
                              setFat(mes, setor, parseFloat(e.target.value) || 0)
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
                              getPct(mes, setor)
                                ? +(getPct(mes, setor) * 100).toFixed(2)
                                : ''
                            }
                            onChange={(e) => {
                              const raw = parseFloat(e.target.value)
                              setPct(mes, setor, isNaN(raw) ? 0 : raw / 100)
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
                <td className="px-4 py-3 text-slate-700">Total</td>
                {SETOR_METAS_PRINCIPAIS.map((setor) => {
                  const total = Array.from({ length: 12 }).reduce<number>(
                    (acc, _, idx) => acc + getFat(idx + 1, setor),
                    0
                  )
                  return (
                    <td
                      key={setor}
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
      </div>

      {/* ============================================================= */}
      {/* Section 2: Weddings — Subcategorias                           */}
      {/* ============================================================= */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700">
            Weddings — Subcategorias — {ano}
          </h3>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left font-medium text-slate-600">
                  Mês
                </th>
                {WEDDINGS_SUBCATEGORIAS_METAS.map((sub) => (
                  <th
                    key={sub.id}
                    colSpan={2}
                    className="px-2 py-3 text-center font-medium text-slate-600 border-l border-slate-200"
                  >
                    {sub.label}
                  </th>
                ))}
              </tr>
              <tr className="bg-slate-50 border-b border-slate-100">
                <th className="px-4 py-1" />
                {WEDDINGS_SUBCATEGORIAS_METAS.map((sub) => (
                  <th key={sub.id} colSpan={2} className="border-l border-slate-200">
                    <div className="flex">
                      <span className="flex-1 px-2 py-1 text-xs font-normal text-slate-500 text-right">
                        Fat. Meta
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
                    <td className="px-4 py-2 font-medium text-slate-700">
                      {mesLabel}
                    </td>
                    {WEDDINGS_SUBCATEGORIAS_METAS.map((sub) => (
                      <td
                        key={sub.id}
                        colSpan={2}
                        className="px-1 py-1 border-l border-slate-200"
                      >
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            min={0}
                            step={1000}
                            value={getFat(mes, sub.id) || ''}
                            onChange={(e) =>
                              setFat(mes, sub.id, parseFloat(e.target.value) || 0)
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
                              getPct(mes, sub.id)
                                ? +(getPct(mes, sub.id) * 100).toFixed(2)
                                : ''
                            }
                            onChange={(e) => {
                              const raw = parseFloat(e.target.value)
                              setPct(mes, sub.id, isNaN(raw) ? 0 : raw / 100)
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
                <td className="px-4 py-3 text-slate-700">Total</td>
                {WEDDINGS_SUBCATEGORIAS_METAS.map((sub) => {
                  const total = Array.from({ length: 12 }).reduce<number>(
                    (acc, _, idx) => acc + getFat(idx + 1, sub.id),
                    0
                  )
                  return (
                    <td
                      key={sub.id}
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
      </div>
    </div>
  )
}
