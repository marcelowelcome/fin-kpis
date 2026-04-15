'use client'

import { useState, useRef } from 'react'
import type { VendaKPI } from '@/lib/schemas'
import { formatBRL } from '@/lib/format'

interface Props {
  count: number
  contratos: VendaKPI[]
}

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

export function ContratosPopover({ count, contratos }: Props) {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const handleLeave = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  const totalFat = contratos.reduce((s, c) => s + (c.faturamento || 0), 0)
  const totalRec = contratos.reduce((s, c) => s + (c.receitas || 0), 0)

  return (
    <span
      className="relative inline-block"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <span className="cursor-help border-b border-dotted border-slate-400">
        Contratos: <strong className="text-slate-700">{count}</strong>
      </span>

      {open && (
        <div
          className="absolute left-0 top-full mt-2 z-50 w-[720px] max-w-[95vw] bg-white rounded-xl shadow-2xl border border-slate-200 p-3"
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-sm font-semibold text-slate-800">
              Contratos considerados ({count})
            </p>
            <p className="text-xs text-slate-500">
              Fat. total: <strong>{formatBRL(totalFat)}</strong> · Receita: <strong>{formatBRL(totalRec)}</strong>
            </p>
          </div>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left px-2 py-1.5 font-medium">#</th>
                  <th className="text-left px-2 py-1.5 font-medium">Venda</th>
                  <th className="text-left px-2 py-1.5 font-medium">Data</th>
                  <th className="text-left px-2 py-1.5 font-medium">Vendedor</th>
                  <th className="text-left px-2 py-1.5 font-medium">Produto</th>
                  <th className="text-right px-2 py-1.5 font-medium">Fat.</th>
                  <th className="text-right px-2 py-1.5 font-medium">Receita</th>
                  <th className="text-left px-2 py-1.5 font-medium">Sit.</th>
                </tr>
              </thead>
              <tbody className="text-slate-700">
                {contratos.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-4 text-slate-400">Nenhum contrato no período</td></tr>
                )}
                {contratos.map((c, i) => (
                  <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                    <td className="px-2 py-1 font-mono">{c.venda_numero}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{formatDateBR(c.data_venda)}</td>
                    <td className="px-2 py-1 whitespace-nowrap">{c.vendedor}</td>
                    <td className="px-2 py-1">{c.produto}</td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">{formatBRL(c.faturamento)}</td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">{formatBRL(c.receitas)}</td>
                    <td className="px-2 py-1 text-slate-500">{c.situacao ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-400 mt-2 px-1">
            Filtro: setor_grupo = WEDDINGS e produto = "contrato de casamento"
          </p>
        </div>
      )}
    </span>
  )
}
