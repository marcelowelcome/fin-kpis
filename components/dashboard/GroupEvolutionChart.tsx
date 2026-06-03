'use client'

import { useState } from 'react'
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
  Area,
  Legend,
} from 'recharts'
import type { TrendPoint, DailyTrendPoint } from '@/lib/schemas'
import { formatBRL } from '@/lib/format'

const SERIES = [
  { key: 'total',    label: 'Grupo',       color: '#1e293b', width: 2.5, dashed: false },
  { key: 'corp',     label: 'Corporativo', color: '#3b82f6', width: 2,   dashed: false },
  { key: 'trips',    label: 'Trips',       color: '#10b981', width: 2,   dashed: false },
  { key: 'weddings', label: 'Weddings',    color: '#D4AC0D', width: 2,   dashed: false },
] as const

type SeriesKey = typeof SERIES[number]['key']
type ViewMode = 'mensal' | 'diario'

interface MergedMonthly {
  label: string
  total: number
  corp: number
  trips: number
  weddings: number
  meta: number
}

interface MergedDaily {
  label: string
  date: string
  totalAcum: number
  corpAcum: number
  tripsAcum: number
  weddingsAcum: number
  metaAcum: number
}

function mergeMonthly(
  total: TrendPoint[],
  corp: TrendPoint[],
  trips: TrendPoint[],
  weddings: TrendPoint[],
): MergedMonthly[] {
  const byLabel = new Map<string, MergedMonthly>()
  const pushSeries = (pts: TrendPoint[], key: SeriesKey) => {
    for (const p of pts) {
      if (!byLabel.has(p.label)) {
        byLabel.set(p.label, { label: p.label, total: 0, corp: 0, trips: 0, weddings: 0, meta: 0 })
      }
      const row = byLabel.get(p.label)!
      row[key] = p.fatRealizado
      if (key === 'total') row.meta = p.fatMeta
    }
  }
  pushSeries(total, 'total')
  pushSeries(corp, 'corp')
  pushSeries(trips, 'trips')
  pushSeries(weddings, 'weddings')
  return Array.from(byLabel.values())
}

function mergeDaily(
  total: DailyTrendPoint[],
  corp: DailyTrendPoint[],
  trips: DailyTrendPoint[],
  weddings: DailyTrendPoint[],
): MergedDaily[] {
  const byLabel = new Map<string, MergedDaily>()
  const pushSeries = (pts: DailyTrendPoint[], acumKey: 'totalAcum' | 'corpAcum' | 'tripsAcum' | 'weddingsAcum') => {
    for (const p of pts) {
      if (!byLabel.has(p.label)) {
        byLabel.set(p.label, { label: p.label, date: p.date, totalAcum: 0, corpAcum: 0, tripsAcum: 0, weddingsAcum: 0, metaAcum: 0 })
      }
      const row = byLabel.get(p.label)!
      row[acumKey] = p.fatAcumulado
      if (acumKey === 'totalAcum') row.metaAcum = p.metaAcumulada
    }
  }
  pushSeries(total, 'totalAcum')
  pushSeries(corp, 'corpAcum')
  pushSeries(trips, 'tripsAcum')
  pushSeries(weddings, 'weddingsAcum')
  return Array.from(byLabel.values())
}

function MultiTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value: number; name: string; color: string }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-lg shadow-lg border border-slate-200 p-3 text-xs min-w-[160px]">
      <p className="font-semibold text-slate-700 mb-1.5">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center justify-between gap-3 py-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-slate-500">{entry.name}</span>
          </div>
          <span className="font-semibold text-slate-800 tabular-nums">{formatBRL(entry.value)}</span>
        </div>
      ))}
    </div>
  )
}

function DailyMultiTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value: number; name: string; color: string; payload: MergedDaily }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  const date = payload[0]?.payload?.date
  const dateStr = date ? date.split('-').reverse().join('/') : label
  return (
    <div className="bg-white rounded-lg shadow-lg border border-slate-200 p-3 text-xs min-w-[160px]">
      <p className="font-semibold text-slate-700 mb-1.5">{dateStr}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center justify-between gap-3 py-0.5">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
            <span className="text-slate-500">{entry.name}</span>
          </div>
          <span className="font-semibold text-slate-800 tabular-nums">{formatBRL(entry.value)}</span>
        </div>
      ))}
    </div>
  )
}

interface GroupEvolutionChartProps {
  trendTotal: TrendPoint[]
  trendCorp: TrendPoint[]
  trendTrips: TrendPoint[]
  trendWeddings: TrendPoint[]
  dailyTotal?: DailyTrendPoint[]
  dailyCorp?: DailyTrendPoint[]
  dailyTrips?: DailyTrendPoint[]
  dailyWeddings?: DailyTrendPoint[]
  loading?: boolean
}

const yFmt = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v / 1_000).toFixed(0)}K` : String(v)

export function GroupEvolutionChart({
  trendTotal, trendCorp, trendTrips, trendWeddings,
  dailyTotal, dailyCorp, dailyTrips, dailyWeddings,
  loading = false,
}: GroupEvolutionChartProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('mensal')

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm animate-pulse">
        <div className="h-4 bg-slate-100 rounded w-44 mb-4" />
        <div className="h-64 bg-slate-50 rounded-lg" />
      </div>
    )
  }

  const hasDailyData = dailyTotal && dailyTotal.length > 0
  const monthlyData = mergeMonthly(trendTotal, trendCorp, trendTrips, trendWeddings)
  const dailyData = hasDailyData
    ? mergeDaily(dailyTotal!, dailyCorp ?? [], dailyTrips ?? [], dailyWeddings ?? [])
    : []

  if (monthlyData.length === 0 && dailyData.length === 0) return null

  const hasMeta = monthlyData.some((d) => d.meta > 0)
  const hasDailyMeta = dailyData.some((d) => d.metaAcum > 0)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          {viewMode === 'mensal' ? 'Evolução Mensal' : 'Evolução Diária'}
        </h3>
        {hasDailyData && (
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('mensal')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                viewMode === 'mensal' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Mensal
            </button>
            <button
              onClick={() => setViewMode('diario')}
              className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors ${
                viewMode === 'diario' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Diário
            </button>
          </div>
        )}
      </div>

      {viewMode === 'mensal' ? (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={monthlyData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="grad-total" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1e293b" stopOpacity={0.12} />
                <stop offset="100%" stopColor="#1e293b" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={yFmt} />
            <Tooltip content={<MultiTooltip />} />
            <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingBottom: 8 }} />
            <Area type="monotone" dataKey="total" name="Grupo" stroke="#1e293b" strokeWidth={2.5} fill="url(#grad-total)" />
            <Line type="monotone" dataKey="corp" name="Corporativo" stroke="#3b82f6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="trips" name="Trips" stroke="#10b981" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="weddings" name="Weddings" stroke="#D4AC0D" strokeWidth={2} dot={false} />
            {hasMeta && (
              <Line type="monotone" dataKey="meta" name="Meta Grupo" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      ) : (
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={dailyData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <defs>
              <linearGradient id="grad-total-daily" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1e293b" stopOpacity={0.12} />
                <stop offset="100%" stopColor="#1e293b" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} interval={2} />
            <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={yFmt} />
            <Tooltip content={<DailyMultiTooltip />} />
            <Legend verticalAlign="top" align="right" iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingBottom: 8 }} />
            <Area type="monotone" dataKey="totalAcum" name="Grupo" stroke="#1e293b" strokeWidth={2.5} fill="url(#grad-total-daily)" />
            <Line type="monotone" dataKey="corpAcum" name="Corporativo" stroke="#3b82f6" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="tripsAcum" name="Trips" stroke="#10b981" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="weddingsAcum" name="Weddings" stroke="#D4AC0D" strokeWidth={2} dot={false} />
            {hasDailyMeta && (
              <Line type="monotone" dataKey="metaAcum" name="Meta Grupo" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="6 3" dot={false} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
