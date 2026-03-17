'use client'

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
      <div className="flex rounded-lg border border-slate-200 bg-white overflow-hidden">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriodo(p.value)}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              periodo === p.value
                ? 'bg-slate-900 text-white'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {periodo === 'custom' && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={customInicio}
            onChange={(e) => setCustomInicio(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
          />
          <span className="text-slate-400">a</span>
          <input
            type="date"
            value={customFim}
            onChange={(e) => setCustomFim(e.target.value)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
          />
        </div>
      )}
    </div>
  )
}
