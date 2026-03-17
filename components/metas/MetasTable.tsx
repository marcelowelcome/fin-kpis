'use client'

import { useState, useEffect } from 'react'
import type { Meta, MetaInput, SetorMeta } from '@/lib/schemas'
import { SETOR_METAS, SETOR_LABELS } from '@/lib/schemas'
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
  const [editData, setEditData] = useState<Record<string, number>>({})
  const [hasChanges, setHasChanges] = useState(false)

  // Inicializar editData com os valores do banco
  useEffect(() => {
    const data: Record<string, number> = {}
    metas.forEach((m) => {
      data[`${m.mes}-${m.setor_grupo}`] = m.fat_meta
    })
    setEditData(data)
    setHasChanges(false)
  }, [metas])

  const getValue = (mes: number, setor: SetorMeta): number => {
    return editData[`${mes}-${setor}`] ?? 0
  }

  const setValue = (mes: number, setor: SetorMeta, value: number) => {
    setEditData((prev) => ({
      ...prev,
      [`${mes}-${setor}`]: value,
    }))
    setHasChanges(true)
  }

  const handleSave = async () => {
    const metasToSave: MetaInput[] = []

    for (let mes = 1; mes <= 12; mes++) {
      for (const setor of SETOR_METAS) {
        const value = getValue(mes, setor)
        metasToSave.push({
          ano,
          mes,
          setor_grupo: setor,
          fat_meta: value,
        })
      }
    }

    const success = await onSave(metasToSave)
    if (success) setHasChanges(false)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">
          Metas de Faturamento — {ano}
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
            <tr className="bg-slate-50 border-b">
              <th className="px-4 py-3 text-left font-medium text-slate-600">Mes</th>
              {SETOR_METAS.map((setor) => (
                <th key={setor} className="px-4 py-3 text-right font-medium text-slate-600">
                  {SETOR_LABELS[setor]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {MESES.map((mesLabel, i) => {
              const mes = i + 1
              return (
                <tr key={mes} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-700">{mesLabel}</td>
                  {SETOR_METAS.map((setor) => (
                    <td key={setor} className="px-4 py-2">
                      <input
                        type="number"
                        min={0}
                        step={1000}
                        value={getValue(mes, setor) || ''}
                        onChange={(e) =>
                          setValue(mes, setor, parseFloat(e.target.value) || 0)
                        }
                        className="w-full text-right px-2 py-1 border border-slate-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
                        placeholder="0"
                      />
                    </td>
                  ))}
                </tr>
              )
            })}
            {/* Totais */}
            <tr className="bg-slate-50 font-medium">
              <td className="px-4 py-3 text-slate-700">Total</td>
              {SETOR_METAS.map((setor) => {
                const total = Array.from({ length: 12 }).reduce<number>(
                  (acc, _, i) => acc + getValue(i + 1, setor),
                  0
                )
                return (
                  <td key={setor} className="px-4 py-3 text-right text-slate-700">
                    {formatBRL(total)}
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
