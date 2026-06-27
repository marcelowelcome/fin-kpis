'use client'

import { useEffect, useState } from 'react'
import { RefreshCw, Check, AlertCircle } from 'lucide-react'

interface SyncButtonProps {
  /** Chamado após uma sincronização bem-sucedida — usar para recarregar o dashboard. */
  onSynced?: () => void
}

interface Feedback {
  type: 'success' | 'error'
  message: string
}

/**
 * Botão de atualização manual: dispara um sync incremental com a API Monde
 * (mesmas ~25 páginas do cron) e recarrega o dashboard ao concluir.
 * A janela completa de backfill continua em /upload (MondeSyncSection).
 */
export function SyncButton({ onSynced }: SyncButtonProps) {
  const [syncing, setSyncing] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  // Sucesso some sozinho; erro fica até a próxima tentativa.
  useEffect(() => {
    if (feedback?.type !== 'success') return
    const t = setTimeout(() => setFeedback(null), 5000)
    return () => clearTimeout(t)
  }, [feedback])

  const handleSync = async () => {
    setSyncing(true)
    setFeedback(null)

    try {
      const res = await fetch('/api/monde/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'incremental', maxPages: 25 }),
        cache: 'no-store',
      })
      const data = await res.json()

      if (!res.ok) {
        setFeedback({ type: 'error', message: data?.error?.message ?? `Erro ${res.status}` })
        return
      }

      const inserted = (data.result?.salesInserted ?? 0).toLocaleString('pt-BR')
      setFeedback({ type: 'success', message: `${inserted} vendas atualizadas` })
      onSynced?.()
    } catch (err) {
      setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Erro de conexão' })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={handleSync}
        disabled={syncing}
        title="Sincroniza as vendas mais recentes direto do Monde"
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-full hover:bg-slate-50 transition-colors disabled:opacity-50"
      >
        <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
        {syncing ? 'Atualizando...' : 'Atualizar'}
      </button>

      {feedback && !syncing && (
        <div
          className={`absolute right-0 top-full mt-1.5 z-10 flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs shadow-sm ${
            feedback.type === 'success'
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {feedback.type === 'success' ? <Check size={12} /> : <AlertCircle size={12} />}
          {feedback.message}
        </div>
      )}
    </div>
  )
}
