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
        <div className="space-y-3">
          {alerts.map((alert, i) => (
            <div
              key={i}
              className="rounded-lg bg-slate-50 overflow-hidden"
            >
              <div className="flex items-start gap-3 p-3">
                <SeverityBadge severidade={alert.severidade} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700">{alert.descricao}</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {alert.quantidade} ocorrencia(s)
                  </p>
                </div>
              </div>

              {/* Exemplos concretos */}
              {alert.exemplos && alert.exemplos.length > 0 && (
                <div className="border-t border-slate-200 px-3 py-2 bg-slate-100/50">
                  <p className="text-xs font-medium text-slate-500 mb-1.5">
                    Exemplos ({Math.min(alert.exemplos.length, 5)} de {alert.quantidade}):
                  </p>
                  <div className="space-y-1">
                    {alert.exemplos.map((ex, j) => (
                      <div
                        key={j}
                        className="flex items-center gap-2 text-xs text-slate-600"
                      >
                        <span className="font-mono text-slate-500 shrink-0">
                          #{ex.venda_numero}
                        </span>
                        <span className="truncate">
                          {ex.vendedor}
                        </span>
                        {ex.produto && (
                          <span className="text-slate-400 truncate">
                            · {ex.produto}
                          </span>
                        )}
                        <span className="ml-auto shrink-0 text-slate-500">
                          {ex.detalhe}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
