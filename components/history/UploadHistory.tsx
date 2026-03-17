'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Upload } from '@/lib/schemas'
import { StatusBadge } from '@/components/ui/Badge'
import { formatDateTime } from '@/lib/format'
import { DeleteConfirmModal } from './DeleteConfirmModal'

export function UploadHistory() {
  const [uploads, setUploads] = useState<Upload[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<Upload | null>(null)

  const fetchUploads = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/uploads')
      const json = await res.json()
      setUploads(json.uploads ?? [])
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchUploads()
  }, [fetchUploads])

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
      <div className="text-center py-12 text-slate-500">
        <p className="text-lg">Nenhum upload realizado ainda.</p>
        <p className="text-sm mt-1">Faca o primeiro upload na pagina de Upload.</p>
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
                  <span className="text-amber-600">
                    {upload.alertas_qualidade.length} alerta(s)
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => setDeleteTarget(upload)}
              className="px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 rounded-lg border border-red-200 transition-colors"
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
    </>
  )
}
