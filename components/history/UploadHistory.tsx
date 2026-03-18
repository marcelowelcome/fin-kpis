'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Upload, QualityAlert } from '@/lib/schemas'
import { StatusBadge, SeverityBadge } from '@/components/ui/Badge'
import { formatDateTime } from '@/lib/format'
import { DeleteConfirmModal } from './DeleteConfirmModal'

export function UploadHistory({ refreshKey }: { refreshKey?: number }) {
  const [uploads, setUploads] = useState<Upload[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<Upload | null>(null)
  const [alertsTarget, setAlertsTarget] = useState<Upload | null>(null)

  const fetchUploads = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/uploads', { cache: 'no-store' })
      if (!res.ok) {
        console.error('Uploads API error:', res.status, await res.text())
        return
      }
      const json = await res.json()
      setUploads(json.uploads ?? [])
    } catch (err) {
      console.error('Uploads fetch error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUploads()
  }, [fetchUploads, refreshKey])

  const handleDelete = async (uploadId: string) => {
    try {
      const res = await fetch(`/api/uploads/${uploadId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmacao: 'EXCLUIR' }),
      })

      if (res.ok) {
        setDeleteTarget(null)
        fetchUploads()
      }
    } catch {
      // handle error
    }
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 bg-slate-100 rounded-lg" />
        ))}
      </div>
    )
  }

  if (uploads.length === 0) {
    return (
      <div className="text-center py-8 text-slate-500">
        <p className="text-sm">Nenhum upload realizado ainda.</p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-3">
        {uploads.map((upload) => (
          <div
            key={upload.id}
            className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-4"
          >
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-medium text-slate-900 truncate">
                  {upload.nome_arquivo}
                </p>
                <StatusBadge status={upload.status} />
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span>{formatDateTime(upload.uploaded_at)}</span>
                <span>{upload.total_linhas} linhas</span>
                <span>{upload.linhas_inseridas} inseridas</span>
                <span>{upload.linhas_atualizadas} atualizadas</span>
                {upload.alertas_qualidade.length > 0 && (
                  <button
                    onClick={() => setAlertsTarget(upload)}
                    className="text-amber-600 hover:text-amber-700 underline hover:no-underline"
                  >
                    {upload.alertas_qualidade.length} alerta(s)
                  </button>
                )}
              </div>
            </div>
            <button
              onClick={() => setDeleteTarget(upload)}
              className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg border border-red-200 transition-colors shrink-0"
            >
              Excluir
            </button>
          </div>
        ))}
      </div>

      {deleteTarget && (
        <DeleteConfirmModal
          isOpen={true}
          uploadId={deleteTarget.id}
          nomeArquivo={deleteTarget.nome_arquivo}
          totalVendas={deleteTarget.total_linhas}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {alertsTarget && (
        <AlertsModal
          upload={alertsTarget}
          onClose={() => setAlertsTarget(null)}
        />
      )}
    </>
  )
}

// --- Modal de alertas de um upload ---

function AlertsModal({ upload, onClose }: { upload: Upload; onClose: () => void }) {
  const alerts = upload.alertas_qualidade

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-lg font-bold text-slate-900">Alertas de Qualidade</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {upload.nome_arquivo} · {formatDateTime(upload.uploaded_at)}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {alerts.length === 0 ? (
            <p className="text-sm text-green-600">Nenhum alerta registrado.</p>
          ) : (
            alerts.map((alert: QualityAlert, i: number) => (
              <div key={i} className="rounded-lg bg-slate-50 overflow-hidden">
                <div className="flex items-start gap-3 p-3">
                  <SeverityBadge severidade={alert.severidade} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700">{alert.descricao}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {alert.quantidade} ocorrencia(s)
                    </p>
                  </div>
                </div>

                {alert.exemplos && alert.exemplos.length > 0 && (
                  <div className="border-t border-slate-200 px-3 py-2 bg-slate-100/50">
                    <p className="text-xs font-medium text-slate-500 mb-1.5">
                      Exemplos ({alert.exemplos.length} de {alert.quantidade}):
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
                          <span className="truncate">{ex.vendedor}</span>
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
            ))
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 shrink-0">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
