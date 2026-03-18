'use client'

import {
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Line,
  ComposedChart,
  Legend,
} from 'recharts'
import type { TrendPoint } from '@/lib/schemas'
import { formatBRL } from '@/lib/format'

interface MonthlyChartProps {
  data: TrendPoint[]
  color?: string
  loading?: boolean
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white rounded-lg shadow-lg border border-slate-200 p-3 text-xs">
      <p className="font-semibold text-slate-700 mb-1.5">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-slate-500">{entry.name}:</span>
          <span className="font-semibold text-slate-800 tabular-nums">{formatBRL(entry.value)}</span>
        </div>
      ))}
    </div>
  )
}

export function MonthlyChart({ data, color = '#3b82f6', loading = false }: MonthlyChartProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm animate-pulse">
        <div className="h-4 bg-slate-100 rounded w-40 mb-4" />
        <div className="h-64 bg-slate-50 rounded-lg" />
      </div>
    )
  }

  if (data.length === 0) return null

  const hasMeta = data.some((d) => d.fatMeta > 0)

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
        Evolução Mensal
      </h3>

      <ResponsiveContainer width="100%" height={280}>
        <ComposedChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
          <defs>
            <linearGradient id={`gradient-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.2} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(0)}K` : String(v)}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            verticalAlign="top"
            align="right"
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, paddingBottom: 8 }}
          />
          <Area
            type="monotone"
            dataKey="fatRealizado"
            name="Realizado"
            stroke={color}
            strokeWidth={2}
            fill={`url(#gradient-${color.replace('#', '')})`}
          />
          {hasMeta && (
            <Line
              type="monotone"
              dataKey="fatMeta"
              name="Meta"
              stroke="#94a3b8"
              strokeWidth={1.5}
              strokeDasharray="6 3"
              dot={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
