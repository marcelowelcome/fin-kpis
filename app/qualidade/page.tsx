'use client'

import { useState, useEffect } from 'react'
import { SeverityBadge } from '@/components/ui/Badge'
import type { QualityAlert } from '@/lib/schemas'

interface QualityTimeline {
  uploadId: string
  nomeArquivo: string
  uploadedAt: string
  totalLinhas: number
  score: number
  alertas: QualityAlert[]
  status: string
}

export default function QualidadePage() {
  const [data, setData] = useState<{
    ultimoScore: number | null
    timeline: QualityTimeline[]
    ultimoUpload: QualityTimeline | null
  } | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/qualidade')
      .then((res) => res.json())
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Qualidade dos Dados</h1>
        <div className="animate-pulse space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 bg-slate-100 rounded-lg" />
          ))}
        </div>
      </div>
    )
  }

  if (!data || data.ultimoScore === null) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-slate-900">Qualidade dos Dados</h1>
        <div className="text-center py-12 text-slate-500">
          <p>Nenhum upload realizado ainda.</p>
          <p className="text-sm mt-1">Faca o primeiro upload para ver o score de qualidade.</p>
        </div>
      </div>
    )
  }

  const scoreColor =
    data.ultimoScore >= 80 ? 'text-green-600' : data.ultimoScore >= 60 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900">Qualidade dos Dados</h1>

      {/* Score geral */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
        <p className="text-sm text-slate-500 mb-2">Score do Ultimo Upload</p>
        <p className={`text-5xl font-bold ${scoreColor}`}>{data.ultimoScore}</p>
        <p className="text-sm text-slate-400 mt-1">/100</p>
      </div>

      {/* Timeline */}
      {data.timeline.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">Timeline de Uploads</h3>
          </div>
          <div className="divide-y divide-slate-100">
            {data.timeline.map((item) => {
              const sc = item.score
              const color = sc >= 80 ? 'text-green-600' : sc >= 60 ? 'text-amber-600' : 'text-red-600'
              return (
                <div key={item.uploadId} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-700">{item.nomeArquivo}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(item.uploadedAt).toLocaleString('pt-BR')} - {item.totalLinhas} linhas
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {item.alertas.length > 0 && (
                      <span className="text-xs text-slate-500">{item.alertas.length} alerta(s)</span>
                    )}
                    <span className={`text-lg font-bold ${color}`}>{sc}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Alertas do último upload */}
      {data.ultimoUpload && data.ultimoUpload.alertas.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700">
              Alertas do Ultimo Upload ({data.ultimoUpload.nomeArquivo})
            </h3>
          </div>
          <div className="divide-y divide-slate-100">
            {data.ultimoUpload.alertas.map((alert, i) => (
              <div key={i} className="px-4 py-3 flex items-center gap-3">
                <SeverityBadge severidade={alert.severidade} />
                <p className="text-sm text-slate-700 flex-1">{alert.descricao}</p>
                <span className="text-xs text-slate-500">{alert.quantidade}x</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
