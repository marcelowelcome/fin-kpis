'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { VendaKPI } from '@/lib/schemas'
import { formatBRL } from '@/lib/format'

interface Props {
  count: number
  taxas: VendaKPI[]
}

function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

function TaxasTable({ taxas }: { taxas: VendaKPI[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-slate-50 text-slate-600">
        <tr>
          <th className="text-left px-2 py-1.5 font-medium">#</th>
          <th className="text-left px-2 py-1.5 font-medium">Venda</th>
          <th className="text-left px-2 py-1.5 font-medium">Data</th>
          <th className="text-left px-2 py-1.5 font-medium">Vendedor</th>
          <th className="text-right px-2 py-1.5 font-medium">Fat.</th>
          <th className="text-left px-2 py-1.5 font-medium">Sit.</th>
        </tr>
      </thead>
      <tbody className="text-slate-700">
        {taxas.length === 0 && (
          <tr><td colSpan={6} className="text-center py-4 text-slate-400">Nenhuma taxa no período</td></tr>
        )}
        {taxas.map((t, i) => (
          <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
            <td className="px-2 py-1 text-slate-400">{i + 1}</td>
            <td className="px-2 py-1 font-mono">{t.venda_numero}</td>
            <td className="px-2 py-1 whitespace-nowrap">{formatDateBR(t.data_venda)}</td>
            <td className="px-2 py-1">{t.vendedor ?? '-'}</td>
            <td className="px-2 py-1 text-right whitespace-nowrap">{formatBRL(t.faturamento)}</td>
            <td className="px-2 py-1 text-slate-500">{t.situacao ?? '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TotalTaxas({ taxas }: { taxas: VendaKPI[] }) {
  const totalFat = taxas.reduce((s, t) => s + (t.faturamento || 0), 0)
  return (
    <p className="text-xs text-slate-500">
      Fat. total: <strong>{formatBRL(totalFat)}</strong>
    </p>
  )
}

const MARGIN = 8
const MAX_WIDTH = 560

interface PopoverPos {
  left: number
  width: number
  top?: number
  bottom?: number
  maxHeight: number
}

/** Popover em hover com a lista de Taxas de Serviço (usado no card compacto de Trips). */
export function TaxasPopover({ count, taxas }: Props) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<PopoverPos | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLSpanElement>(null)

  const computePos = useCallback(() => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const width = Math.min(MAX_WIDTH, vw - MARGIN * 2)
    let left = r.left
    if (left + width > vw - MARGIN) left = vw - MARGIN - width
    if (left < MARGIN) left = MARGIN
    const spaceBelow = vh - r.bottom - MARGIN
    const spaceAbove = r.top - MARGIN
    if (spaceBelow >= spaceAbove) {
      setPos({ left, width, top: r.bottom + MARGIN, maxHeight: spaceBelow })
    } else {
      setPos({ left, width, bottom: vh - r.top + MARGIN, maxHeight: spaceAbove })
    }
  }, [])

  useEffect(() => {
    if (!open) return
    computePos()
    window.addEventListener('scroll', computePos, true)
    window.addEventListener('resize', computePos)
    return () => {
      window.removeEventListener('scroll', computePos, true)
      window.removeEventListener('resize', computePos)
    }
  }, [open, computePos])

  const handleEnter = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setOpen(true)
  }
  const handleLeave = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 150)
  }

  return (
    <span
      ref={triggerRef}
      className="relative inline-block"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <span className="cursor-help border-b border-dotted border-slate-400">
        Ver detalhes
      </span>

      {open && pos && (
        <div
          className="fixed z-50 bg-white rounded-xl shadow-2xl border border-slate-200 p-3 flex flex-col"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-sm font-semibold text-slate-800">Taxas de Serviço ({count})</p>
            <TotalTaxas taxas={taxas} />
          </div>
          <div className="overflow-auto min-h-0">
            <TaxasTable taxas={taxas} />
          </div>
        </div>
      )}
    </span>
  )
}
