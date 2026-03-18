'use client'

import { CircleDot, CheckCircle2 } from 'lucide-react'
import type { PipelineData } from '@/lib/schemas'
import { formatBRL, formatPercent } from '@/lib/format'

interface PipelineCardProps {
  data: PipelineData
  loading?: boolean
}

export function PipelineCard({ data, loading = false }: PipelineCardProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm animate-pulse">
        <div className="h-4 bg-slate-100 rounded w-24 mb-4" />
        <div className="h-8 bg-slate-100 rounded w-36" />
      </div>
    )
  }

  const total = data.aberta.count + data.fechada.count
  const fechadaPct = total > 0 ? data.fechada.count / total : 0

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
        Pipeline
      </h3>

      <div className="grid grid-cols-2 gap-4">
        {/* Aberta */}
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
            <CircleDot size={16} className="text-amber-500" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Em aberto</p>
            <p className="text-lg font-semibold text-slate-900 tabular-nums">
              {data.aberta.count}
            </p>
            <p className="text-xs text-slate-400 tabular-nums">
              {formatBRL(data.aberta.valor)}
            </p>
          </div>
        </div>

        {/* Fechada */}
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center shrink-0">
            <CheckCircle2 size={16} className="text-green-500" />
          </div>
          <div>
            <p className="text-xs text-slate-500">Fechadas</p>
            <p className="text-lg font-semibold text-slate-900 tabular-nums">
              {data.fechada.count}
            </p>
            <p className="text-xs text-slate-400 tabular-nums">
              {formatBRL(data.fechada.valor)}
            </p>
          </div>
        </div>
      </div>

      {/* Barra de conversão */}
      {total > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
            <span>Taxa de conversão</span>
            <span className="font-medium text-slate-700">
              {formatPercent(data.taxaConversao)}
            </span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${Math.min(fechadaPct * 100, 100)}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
