'use client'

import { TrendingUp, Clock, Target } from 'lucide-react'
import type { ForecastData } from '@/lib/schemas'
import { formatBRL } from '@/lib/format'

interface ForecastCardProps {
  data: ForecastData
  meta: number
  realizado: number
  loading?: boolean
}

export function ForecastCard({ data, meta, realizado, loading = false }: ForecastCardProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm animate-pulse">
        <div className="h-4 bg-slate-100 rounded w-24 mb-4" />
        <div className="h-8 bg-slate-100 rounded w-48" />
      </div>
    )
  }

  // Se não há dias restantes, é período histórico — não mostrar projeção
  if (data.diasRestantes <= 0) {
    return null
  }

  const percRealizado = meta > 0 ? realizado / meta : 0
  const percProjecao = meta > 0 ? Math.min(data.projecao / meta, 1.5) : 0

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
          Projeção
        </h3>
        <span
          className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${
            data.metaAtingivel
              ? 'bg-green-50 text-green-700'
              : 'bg-red-50 text-red-700'
          }`}
        >
          <Target size={12} />
          {data.metaAtingivel ? 'Meta atingível' : 'Abaixo do ritmo'}
        </span>
      </div>

      {/* Valor projetado */}
      <p className="text-2xl font-bold text-slate-900 tabular-nums">
        {formatBRL(data.projecao)}
      </p>
      {meta > 0 && (
        <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
          Meta: {formatBRL(meta)}
        </p>
      )}

      {/* Barra: realizado (sólido) + projeção (semitransparente) */}
      {meta > 0 && (
        <div className="w-full h-3 bg-slate-100 rounded-full mt-3 mb-3 overflow-hidden relative">
          {/* Projeção (fundo) */}
          <div
            className="absolute h-full rounded-full bg-blue-200 transition-all"
            style={{ width: `${Math.min(percProjecao * 100, 100)}%` }}
          />
          {/* Realizado (frente) */}
          <div
            className="absolute h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${Math.min(percRealizado * 100, 100)}%` }}
          />
        </div>
      )}

      {/* Métricas */}
      <div className="grid grid-cols-2 gap-4 mt-3">
        <div className="flex items-start gap-2">
          <TrendingUp size={14} className="text-slate-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-slate-500">Ritmo diário</p>
            <p className="text-sm font-semibold text-slate-900 tabular-nums">
              {formatBRL(data.ritmoAtual)}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-2">
          <Clock size={14} className="text-slate-400 mt-0.5 shrink-0" />
          <div>
            <p className="text-xs text-slate-500">Dias restantes</p>
            <p className="text-sm font-semibold text-slate-900 tabular-nums">
              {data.diasRestantes}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
