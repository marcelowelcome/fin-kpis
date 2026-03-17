'use client'

import type { QualityAlert } from '@/lib/schemas'
import { SeverityBadge } from '@/components/ui/Badge'

interface QualityReportProps {
  alerts: QualityAlert[]
  score: number
}

export function QualityReport({ alerts, score }: QualityReportProps) {
  const scoreColor =
    score >= 80 ? 'text-green-600' : score >= 60 ? 'text-amber-600' : 'text-red-600'
  const scoreBg =
    score >= 80 ? 'bg-green-50' : score >= 60 ? 'bg-amber-50' : 'bg-red-50'

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-700">Qualidade dos Dados</h3>
        <div className={`px-3 py-1.5 rounded-lg ${scoreBg}`}>
          <span className={`text-lg font-bold ${scoreColor}`}>{score}</span>
          <span className="text-xs text-slate-500 ml-1">/100</span>
        </div>
      </div>

      {alerts.length === 0 ? (
        <p className="text-sm text-green-600">Nenhum alerta de qualidade encontrado.</p>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert, i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3 rounded-lg bg-slate-50"
            >
              <SeverityBadge severidade={alert.severidade} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-700">{alert.descricao}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {alert.quantidade} ocorrencia(s)
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
