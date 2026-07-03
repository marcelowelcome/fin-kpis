'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
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

/** Tabela de contratos — Operação Própria no lugar de Vendedor, sem coluna Produto. */
function ContratosTable({ contratos }: { contratos: VendaKPI[] }) {
  return (
    <table className="w-full text-xs">
      <thead className="sticky top-0 bg-slate-50 text-slate-600">
        <tr>
          <th className="text-left px-2 py-1.5 font-medium">#</th>
          <th className="text-left px-2 py-1.5 font-medium">Venda</th>
          <th className="text-left px-2 py-1.5 font-medium">Data</th>
          <th className="text-left px-2 py-1.5 font-medium">Operação Própria</th>
          <th className="text-right px-2 py-1.5 font-medium">Fat.</th>
          <th className="text-right px-2 py-1.5 font-medium">Receita</th>
          <th className="text-left px-2 py-1.5 font-medium">Sit.</th>
        </tr>
      </thead>
      <tbody className="text-slate-700">
        {contratos.length === 0 && (
          <tr><td colSpan={7} className="text-center py-4 text-slate-400">Nenhum contrato no período</td></tr>
        )}
        {contratos.map((c, i) => (
          <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
            <td className="px-2 py-1 text-slate-400">{i + 1}</td>
            <td className="px-2 py-1 font-mono">{c.venda_numero}</td>
            <td className="px-2 py-1 whitespace-nowrap">{formatDateBR(c.data_venda)}</td>
            <td className="px-2 py-1">{c.operacao ?? '-'}</td>
            <td className="px-2 py-1 text-right whitespace-nowrap">{formatBRL(c.faturamento)}</td>
            <td className="px-2 py-1 text-right whitespace-nowrap">{formatBRL(c.receitas)}</td>
            <td className="px-2 py-1 text-slate-500">{c.situacao ?? '-'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TotaisContratos({ contratos }: { contratos: VendaKPI[] }) {
  const totalFat = contratos.reduce((s, c) => s + (c.faturamento || 0), 0)
  const totalRec = contratos.reduce((s, c) => s + (c.receitas || 0), 0)
  return (
    <p className="text-xs text-slate-500">
      Fat. total: <strong>{formatBRL(totalFat)}</strong> · Receita: <strong>{formatBRL(totalRec)}</strong>
    </p>
  )
}

/**
 * Card SEMPRE VISÍVEL com a lista de contratos (para a aba Weddings).
 * Mostra Operação Própria (casal) em vez de vendedor e omite a coluna Produto.
 */
export function ContratosCard({ count, contratos }: Props) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-center justify-between mb-2 px-1">
        <p className="text-sm font-semibold text-slate-800">Contratos vendidos ({count})</p>
        <TotaisContratos contratos={contratos} />
      </div>
      <div className="overflow-auto max-h-96">
        <ContratosTable contratos={contratos} />
      </div>
    </div>
  )
}

const MARGIN = 8
const MAX_WIDTH = 640

/** Posição fixa do popover, ancorada por cima OU por baixo do gatilho. */
interface PopoverPos {
  left: number
  width: number
  top?: number
  bottom?: number
  maxHeight: number
}

/** Popover em hover (usado no card compacto da aba Group). */
export function ContratosPopover({ count, contratos }: Props) {
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
        Contratos: <strong className="text-slate-700">{count}</strong>
      </span>

      {open && pos && (
        <div
          className="fixed z-50 bg-white rounded-xl shadow-2xl border border-slate-200 p-3 flex flex-col"
          style={{ left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight }}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
        >
          <div className="flex items-center justify-between mb-2 px-1">
            <p className="text-sm font-semibold text-slate-800">Contratos considerados ({count})</p>
            <TotaisContratos contratos={contratos} />
          </div>
          <div className="overflow-auto min-h-0">
            <ContratosTable contratos={contratos} />
          </div>
        </div>
      )}
    </span>
  )
}
