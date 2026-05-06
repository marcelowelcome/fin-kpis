'use client'

import { useState, useEffect, useRef, useMemo } from 'react'
import { CalendarDays, ChevronDown } from 'lucide-react'
import { DayPicker, type DateRange } from 'react-day-picker'
import { ptBR } from 'date-fns/locale/pt-BR'
import 'react-day-picker/style.css'

interface PeriodSelectorProps {
  periodo: string
  setPeriodo: (p: string) => void
  customInicio: string
  setCustomInicio: (d: string) => void
  customFim: string
  setCustomFim: (d: string) => void
  // Compare props são opcionais — quando ausentes, o toggle "Comparar" fica oculto.
  compareEnabled?: boolean
  setCompareEnabled?: (b: boolean) => void
  compareInicio?: string
  setCompareInicio?: (d: string) => void
  compareFim?: string
  setCompareFim?: (d: string) => void
}

const PRESETS: { key: string; label: string }[] = [
  { key: 'hoje', label: 'Hoje' },
  { key: 'ontem', label: 'Ontem' },
  { key: 'esta-semana-ate-hoje', label: 'Esta semana (dom. até hoje)' },
  { key: '7d', label: '7 dias atrás' },
  { key: 'semana-passada', label: 'Semana passada (dom. a sáb.)' },
  { key: '14d', label: '14 dias atrás' },
  { key: 'mes-corrente', label: 'Este mês' },
  { key: '30d', label: '30 dias atrás' },
  { key: 'mes-passado', label: 'Último mês' },
  { key: 'acumulado-ano', label: 'Acumulado do ano' },
  { key: 'todo-periodo', label: 'Todo o período' },
]

const ALL_PRESET_KEYS = [
  'hoje', 'ontem', 'esta-semana-ate-hoje', 'semana-atual', 'semana-passada',
  '7d', '14d', '30d', '90d',
  'mes-corrente', 'mes-passado', 'acumulado-ano', 'todo-periodo',
]

type CompareMode = 'previous-period' | 'previous-year' | 'custom'

// =============================================================
// Helpers — datas ISO end-to-end (ver feedback_dates_as_strings)
// =============================================================

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function isoToDate(iso: string): Date | undefined {
  if (!iso) return undefined
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function dateToISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function todayLocal(): Date {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000)
}

/** Calcula o range visual de um preset no client (timezone local). */
function presetToRange(preset: string): { from: Date; to: Date } | null {
  const today = todayLocal()
  switch (preset) {
    case 'hoje':
      return { from: today, to: today }
    case 'ontem': {
      const y = addDays(today, -1)
      return { from: y, to: y }
    }
    case 'esta-semana-ate-hoje': {
      const day = today.getDay() // 0 = domingo
      return { from: addDays(today, -day), to: today }
    }
    case 'semana-atual': {
      const day = today.getDay()
      const monday = addDays(today, -(day === 0 ? 6 : day - 1))
      return { from: monday, to: addDays(monday, 6) }
    }
    case 'semana-passada': {
      const day = today.getDay()
      const sundayLast = addDays(today, -day - 7)
      return { from: sundayLast, to: addDays(sundayLast, 6) }
    }
    case '7d':
    case '14d':
    case '30d':
    case '90d': {
      const n = parseInt(preset, 10)
      return { from: addDays(today, -(n - 1)), to: today }
    }
    case 'mes-corrente': {
      const y = today.getFullYear(), m = today.getMonth()
      return { from: new Date(y, m, 1), to: new Date(y, m + 1, 0) }
    }
    case 'mes-passado': {
      const y = today.getFullYear(), m = today.getMonth()
      return { from: new Date(y, m - 1, 1), to: new Date(y, m, 0) }
    }
    case 'acumulado-ano': {
      const y = today.getFullYear()
      return { from: new Date(y, 0, 1), to: today }
    }
    case 'todo-periodo':
      return { from: new Date(2024, 0, 1), to: today }
    default:
      return null
  }
}

/** Se o range bate com algum preset conhecido, devolve a key. */
function detectPreset(inicio: string, fim: string): string | null {
  for (const key of ALL_PRESET_KEYS) {
    const r = presetToRange(key)
    if (r && dateToISO(r.from) === inicio && dateToISO(r.to) === fim) return key
  }
  return null
}

/** Range B para um modo de comparação dado o range A. */
function calcCompareRange(mode: CompareMode, mainFrom: Date, mainTo: Date): { from: Date; to: Date } {
  switch (mode) {
    case 'previous-period': {
      // Mesma duração, deslocada para trás imediatamente antes do range A
      const dur = diffDays(mainFrom, mainTo)
      const to = addDays(mainFrom, -1)
      const from = addDays(to, -dur)
      return { from, to }
    }
    case 'previous-year': {
      // Mesmo range deslocado 1 ano pra trás
      const from = new Date(mainFrom.getFullYear() - 1, mainFrom.getMonth(), mainFrom.getDate())
      const to = new Date(mainTo.getFullYear() - 1, mainTo.getMonth(), mainTo.getDate())
      return { from, to }
    }
    case 'custom':
      // Sem cálculo — usuário define
      return { from: mainFrom, to: mainTo }
  }
}

function formatBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function periodoToLabel(periodo: string, customInicio: string, customFim: string): string {
  if (periodo === 'custom') {
    if (customInicio && customFim) return `${formatBR(customInicio)} – ${formatBR(customFim)}`
    return 'Selecionar período'
  }
  const preset = PRESETS.find((p) => p.key === periodo)
  if (preset) return preset.label
  // Tokens não listados nos presets visíveis (ex.: semana-atual, 90d)
  const r = presetToRange(periodo)
  if (r) return `${formatBR(dateToISO(r.from))} – ${formatBR(dateToISO(r.to))}`
  return 'Selecionar período'
}

function compareLabel(mode: CompareMode | null, ci: string, cf: string): string | null {
  if (!ci || !cf) return null
  switch (mode) {
    case 'previous-period': return 'vs período anterior'
    case 'previous-year': return 'vs ano anterior'
    case 'custom':
    default: return `vs ${formatBR(ci)} – ${formatBR(cf)}`
  }
}

function detectCompareMode(mainFrom: Date, mainTo: Date, ci: string, cf: string): CompareMode | null {
  if (!ci || !cf) return null
  const prev = calcCompareRange('previous-period', mainFrom, mainTo)
  if (dateToISO(prev.from) === ci && dateToISO(prev.to) === cf) return 'previous-period'
  const yr = calcCompareRange('previous-year', mainFrom, mainTo)
  if (dateToISO(yr.from) === ci && dateToISO(yr.to) === cf) return 'previous-year'
  return 'custom'
}

function periodoToInitialRange(periodo: string, customInicio: string, customFim: string): DateRange | undefined {
  if (periodo === 'custom' && customInicio && customFim) {
    return { from: isoToDate(customInicio), to: isoToDate(customFim) }
  }
  const r = presetToRange(periodo)
  return r ?? undefined
}

// =============================================================
// Component
// =============================================================

export function PeriodSelector({
  periodo,
  setPeriodo,
  customInicio,
  setCustomInicio,
  customFim,
  setCustomFim,
  compareEnabled = false,
  setCompareEnabled,
  compareInicio = '',
  setCompareInicio,
  compareFim = '',
  setCompareFim,
}: PeriodSelectorProps) {
  const compareSupported = !!(setCompareEnabled && setCompareInicio && setCompareFim)
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Estado interno do popover (não propagado até "Aplicar")
  const [draftRange, setDraftRange] = useState<DateRange | undefined>(undefined)
  const [daysUntilToday, setDaysUntilToday] = useState('')
  const [daysUntilYesterday, setDaysUntilYesterday] = useState('')
  // Inputs de texto editáveis (espelham o draft mas permitem digitação parcial)
  const [inicioText, setInicioText] = useState('')
  const [fimText, setFimText] = useState('')
  // Compare draft
  const [draftCompareEnabled, setDraftCompareEnabled] = useState(false)
  const [draftCompareMode, setDraftCompareMode] = useState<CompareMode>('previous-period')
  const [draftCompareRange, setDraftCompareRange] = useState<DateRange | undefined>(undefined)
  const [compareInicioText, setCompareInicioText] = useState('')
  const [compareFimText, setCompareFimText] = useState('')

  // Sincronizar draft com props ao abrir
  useEffect(() => {
    if (!open) return
    const r = periodoToInitialRange(periodo, customInicio, customFim)
    setDraftRange(r)
    setInicioText(r?.from ? formatBR(dateToISO(r.from)) : '')
    setFimText(r?.to ? formatBR(dateToISO(r.to)) : '')
    setDaysUntilToday('')
    setDaysUntilYesterday('')

    setDraftCompareEnabled(compareEnabled)
    if (compareEnabled && compareInicio && compareFim && r?.from && r?.to) {
      const mode = detectCompareMode(r.from, r.to, compareInicio, compareFim)
      setDraftCompareMode(mode ?? 'custom')
      setDraftCompareRange({ from: isoToDate(compareInicio), to: isoToDate(compareFim) })
      setCompareInicioText(formatBR(compareInicio))
      setCompareFimText(formatBR(compareFim))
    } else {
      setDraftCompareMode('previous-period')
      if (r?.from && r?.to) {
        const auto = calcCompareRange('previous-period', r.from, r.to)
        setDraftCompareRange({ from: auto.from, to: auto.to })
        setCompareInicioText(formatBR(dateToISO(auto.from)))
        setCompareFimText(formatBR(dateToISO(auto.to)))
      } else {
        setDraftCompareRange(undefined)
        setCompareInicioText('')
        setCompareFimText('')
      }
    }
  }, [open, periodo, customInicio, customFim, compareEnabled, compareInicio, compareFim])

  // Quando o range A ou o modo de compare mudam, recalcular o range B (exceto em modo custom)
  useEffect(() => {
    if (!open) return
    if (draftCompareMode === 'custom') return
    if (!draftRange?.from || !draftRange?.to) return
    const r = calcCompareRange(draftCompareMode, draftRange.from, draftRange.to)
    setDraftCompareRange({ from: r.from, to: r.to })
    setCompareInicioText(formatBR(dateToISO(r.from)))
    setCompareFimText(formatBR(dateToISO(r.to)))
  }, [open, draftCompareMode, draftRange])

  // Click fora fecha
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEsc)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEsc)
    }
  }, [open])

  const buttonLabel = useMemo(
    () => periodoToLabel(periodo, customInicio, customFim),
    [periodo, customInicio, customFim]
  )

  const buttonCompareLabel = useMemo(() => {
    if (!compareEnabled) return null
    const r = periodoToInitialRange(periodo, customInicio, customFim)
    if (!r?.from || !r?.to) return null
    const mode = detectCompareMode(r.from, r.to, compareInicio, compareFim)
    return compareLabel(mode, compareInicio, compareFim)
  }, [compareEnabled, periodo, customInicio, customFim, compareInicio, compareFim])

  // Preset ativo no draft (para destacar visualmente)
  const activePresetKey = useMemo(() => {
    if (!draftRange?.from || !draftRange?.to) return null
    return detectPreset(dateToISO(draftRange.from), dateToISO(draftRange.to))
  }, [draftRange])

  function setDraftFromRange(r: { from: Date; to: Date }) {
    setDraftRange({ from: r.from, to: r.to })
    setInicioText(formatBR(dateToISO(r.from)))
    setFimText(formatBR(dateToISO(r.to)))
  }

  function handlePresetClick(key: string) {
    const r = presetToRange(key)
    if (r) {
      setDraftFromRange(r)
      setDaysUntilToday('')
      setDaysUntilYesterday('')
    }
  }

  function handleDaysUntilToday(value: string) {
    setDaysUntilToday(value)
    if (value) setDaysUntilYesterday('')
    const n = parseInt(value, 10)
    if (Number.isFinite(n) && n > 0) {
      const today = todayLocal()
      setDraftFromRange({ from: addDays(today, -(n - 1)), to: today })
    }
  }

  function handleDaysUntilYesterday(value: string) {
    setDaysUntilYesterday(value)
    if (value) setDaysUntilToday('')
    const n = parseInt(value, 10)
    if (Number.isFinite(n) && n > 0) {
      const yesterday = addDays(todayLocal(), -1)
      setDraftFromRange({ from: addDays(yesterday, -(n - 1)), to: yesterday })
    }
  }

  function handleDayPickerSelect(range: DateRange | undefined) {
    setDraftRange(range)
    setInicioText(range?.from ? formatBR(dateToISO(range.from)) : '')
    setFimText(range?.to ? formatBR(dateToISO(range.to)) : '')
    setDaysUntilToday('')
    setDaysUntilYesterday('')
  }

  // Inputs de texto: aceita "DD/MM/YYYY" ou "YYYY-MM-DD"
  function parseTextDate(input: string): Date | null {
    const trimmed = input.trim()
    if (!trimmed) return null
    let y: number, m: number, d: number
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      [y, m, d] = trimmed.split('-').map(Number)
    } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
      const [dd, mm, yy] = trimmed.split('/').map(Number)
      y = yy; m = mm; d = dd
    } else {
      return null
    }
    const date = new Date(y, m - 1, d)
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
    return date
  }

  function handleInicioBlur() {
    const date = parseTextDate(inicioText)
    if (date) {
      setDraftRange((prev) => ({ from: date, to: prev?.to }))
      setInicioText(formatBR(dateToISO(date)))
    } else if (draftRange?.from) {
      setInicioText(formatBR(dateToISO(draftRange.from)))
    }
  }
  function handleFimBlur() {
    const date = parseTextDate(fimText)
    if (date) {
      setDraftRange((prev) => ({ from: prev?.from, to: date }))
      setFimText(formatBR(dateToISO(date)))
    } else if (draftRange?.to) {
      setFimText(formatBR(dateToISO(draftRange.to)))
    }
  }

  function handleCompareInicioBlur() {
    const date = parseTextDate(compareInicioText)
    if (date) {
      setDraftCompareRange((prev) => ({ from: date, to: prev?.to }))
      setCompareInicioText(formatBR(dateToISO(date)))
    } else if (draftCompareRange?.from) {
      setCompareInicioText(formatBR(dateToISO(draftCompareRange.from)))
    }
  }
  function handleCompareFimBlur() {
    const date = parseTextDate(compareFimText)
    if (date) {
      setDraftCompareRange((prev) => ({ from: prev?.from, to: date }))
      setCompareFimText(formatBR(dateToISO(date)))
    } else if (draftCompareRange?.to) {
      setCompareFimText(formatBR(dateToISO(draftCompareRange.to)))
    }
  }

  function handleApply() {
    if (!draftRange?.from || !draftRange?.to) return
    let from = draftRange.from
    let to = draftRange.to
    if (from > to) {
      const tmp = from; from = to; to = tmp
    }
    const inicio = dateToISO(from)
    const fim = dateToISO(to)
    const preset = detectPreset(inicio, fim)
    if (preset) {
      setPeriodo(preset)
      setCustomInicio('')
      setCustomFim('')
    } else {
      setCustomInicio(inicio)
      setCustomFim(fim)
      setPeriodo('custom')
    }

    // Compare (só propaga se a página suporta — nas que não passam os setters, ignoramos)
    if (compareSupported) {
      if (draftCompareEnabled && draftCompareRange?.from && draftCompareRange?.to) {
        let cFrom = draftCompareRange.from
        let cTo = draftCompareRange.to
        if (cFrom > cTo) { const t = cFrom; cFrom = cTo; cTo = t }
        setCompareEnabled!(true)
        setCompareInicio!(dateToISO(cFrom))
        setCompareFim!(dateToISO(cTo))
      } else {
        setCompareEnabled!(false)
        setCompareInicio!('')
        setCompareFim!('')
      }
    }

    setOpen(false)
  }

  const canApply = !!(draftRange?.from && draftRange?.to)

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-full bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 transition-colors"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <CalendarDays size={14} className="text-slate-500" />
        <span className="flex flex-col items-start max-w-[260px] leading-tight">
          <span className="truncate">{buttonLabel}</span>
          {buttonCompareLabel && (
            <span className="text-[10px] text-slate-500 truncate">{buttonCompareLabel}</span>
          )}
        </span>
        <ChevronDown size={14} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Selecionar período"
          className="absolute right-0 z-50 mt-2 w-[640px] max-w-[calc(100vw-2rem)] bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
        >
          <div className="flex flex-col sm:flex-row">
            {/* Coluna esquerda: presets + N-dias */}
            <div className="sm:w-56 border-b sm:border-b-0 sm:border-r border-slate-100 p-2 flex flex-col gap-0.5 max-h-[420px] overflow-y-auto">
              {PRESETS.map((p) => {
                const active = activePresetKey === p.key
                return (
                  <button
                    key={p.key}
                    onClick={() => handlePresetClick(p.key)}
                    className={`text-left px-3 py-2 text-sm rounded-lg transition-colors ${
                      active
                        ? 'bg-slate-900 text-white font-medium'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {p.label}
                  </button>
                )
              })}

              <div className="mt-2 pt-3 border-t border-slate-100 space-y-2 px-1">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={daysUntilToday}
                    onChange={(e) => handleDaysUntilToday(e.target.value)}
                    placeholder="0"
                    className="w-14 px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 tabular-nums"
                  />
                  <span className="text-xs text-slate-600">dias até hoje</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    value={daysUntilYesterday}
                    onChange={(e) => handleDaysUntilYesterday(e.target.value)}
                    placeholder="0"
                    className="w-14 px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 tabular-nums"
                  />
                  <span className="text-xs text-slate-600">dias até ontem</span>
                </div>
              </div>
            </div>

            {/* Coluna direita: inputs de data + calendário */}
            <div className="flex-1 p-3">
              <div className="flex items-center gap-2 mb-3">
                <div className="flex-1">
                  <label className="block text-[10px] uppercase tracking-wide text-slate-400 mb-1">Data de início</label>
                  <input
                    type="text"
                    value={inicioText}
                    onChange={(e) => setInicioText(e.target.value)}
                    onBlur={handleInicioBlur}
                    placeholder="DD/MM/AAAA"
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 tabular-nums"
                  />
                </div>
                <span className="text-slate-400 mt-4">–</span>
                <div className="flex-1">
                  <label className="block text-[10px] uppercase tracking-wide text-slate-400 mb-1">Data de término</label>
                  <input
                    type="text"
                    value={fimText}
                    onChange={(e) => setFimText(e.target.value)}
                    onBlur={handleFimBlur}
                    placeholder="DD/MM/AAAA"
                    className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 tabular-nums"
                  />
                </div>
              </div>

              <div className="rdp-wrapper">
                <DayPicker
                  mode="range"
                  numberOfMonths={2}
                  selected={draftRange}
                  onSelect={handleDayPickerSelect}
                  locale={ptBR}
                  weekStartsOn={0}
                  defaultMonth={draftRange?.from ?? todayLocal()}
                  showOutsideDays
                />
              </div>
            </div>
          </div>

          {/* Compare section (oculta quando a página não passa os setters) */}
          {compareSupported && (
          <div className="border-t border-slate-100 px-3 py-3 bg-slate-50/40">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={draftCompareEnabled}
                onChange={(e) => setDraftCompareEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-2 focus:ring-slate-300"
              />
              <span className="text-sm font-medium text-slate-700">Comparar com outro período</span>
            </label>

            {draftCompareEnabled && (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  {([
                    { key: 'previous-period', label: 'Período anterior' },
                    { key: 'previous-year', label: 'Mesmo período ano anterior' },
                    { key: 'custom', label: 'Personalizado' },
                  ] as const).map(({ key, label }) => (
                    <button
                      key={key}
                      onClick={() => setDraftCompareMode(key)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
                        draftCompareMode === key
                          ? 'bg-slate-900 text-white'
                          : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="block text-[10px] uppercase tracking-wide text-slate-400 mb-1">Comparar de</label>
                    <input
                      type="text"
                      value={compareInicioText}
                      onChange={(e) => {
                        setCompareInicioText(e.target.value)
                        if (draftCompareMode !== 'custom') setDraftCompareMode('custom')
                      }}
                      onBlur={handleCompareInicioBlur}
                      placeholder="DD/MM/AAAA"
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 tabular-nums"
                    />
                  </div>
                  <span className="text-slate-400 mt-4">–</span>
                  <div className="flex-1">
                    <label className="block text-[10px] uppercase tracking-wide text-slate-400 mb-1">Até</label>
                    <input
                      type="text"
                      value={compareFimText}
                      onChange={(e) => {
                        setCompareFimText(e.target.value)
                        if (draftCompareMode !== 'custom') setDraftCompareMode('custom')
                      }}
                      onBlur={handleCompareFimBlur}
                      placeholder="DD/MM/AAAA"
                      className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-300 tabular-nums"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-3 py-2.5 border-t border-slate-100 bg-slate-50/60">
            <button
              onClick={() => setOpen(false)}
              className="px-3 py-1.5 text-sm font-medium text-slate-600 rounded-lg hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              onClick={handleApply}
              disabled={!canApply}
              className="px-4 py-1.5 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
