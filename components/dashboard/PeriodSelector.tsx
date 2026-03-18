'use client'

import { CalendarDays } from 'lucide-react'

interface PeriodSelectorProps {
  periodo: string
  setPeriodo: (p: string) => void
  customInicio: string
  setCustomInicio: (d: string) => void
  customFim: string
  setCustomFim: (d: string) => void
}

const PERIODS = [
  { value: 'semana-atual', label: 'Semana Atual' },
  { value: 'mes-corrente', label: 'Mês Corrente' },
  { value: 'acumulado-ano', label: 'Acumulado Ano' },
  { value: 'custom', label: 'Personalizado' },
]

export function PeriodSelector({
  periodo,
  setPeriodo,
  customInicio,
  setCustomInicio,
  customFim,
  setCustomFim,
}: PeriodSelectorProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          onClick={() => setPeriodo(p.value)}
          className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-full transition-colors ${
            periodo === p.value
              ? 'bg-slate-900 text-white'
              : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
          }`}
        >
          {p.value === 'custom' && <CalendarDays size={14} />}
          {p.label}
        </button>
      ))}

      {periodo === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customInicio}
            max={customFim || undefined}
            onChange={(e) => setCustomInicio(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
          <span className="text-slate-400">a</span>
          <input
            type="date"
            value={customFim}
            min={customInicio || undefined}
            onChange={(e) => setCustomFim(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-slate-300"
          />
        </div>
      )}
    </div>
  )
}
