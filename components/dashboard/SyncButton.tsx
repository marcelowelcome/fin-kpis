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

// O sync roda 100% no Supabase: a Edge Function `monde-sync` tem a chave da API de
// Dados do Monde (MONDE_DATA_API_KEY) e já roda 3x/dia via pg_cron. O botão chama essa
// função DIRETO, e não /api/monde/sync no Vercel — aquela rota falha porque a
// MONDE_DATA_API_KEY não está setada na conta Vercel do projeto. A função varre as ~20
// páginas mais recentes (dedup por número da venda, sem perda); a janela completa de
// 2026 vem do rebuild agendado.
// A anon key é pública (já vai no bundle do dashboard), então usá-la no client é seguro.
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const SYNC_ENDPOINT = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/monde-sync`
// Limite no cliente para o fetch não ficar pendurado para sempre se o servidor travar.
// 180s para acomodar o pior caso da Edge (varredura de 20 páginas + backoff de retry
// quando o Monde dá throttling), evitando um "tempo esgotado" enganoso enquanto o sync
// ainda conclui no servidor (que é idempotente — dedup por número da venda).
const FETCH_TIMEOUT_MS = 180_000

/**
 * Botão de atualização manual: dispara a Edge Function `monde-sync` do Supabase
 * (varre as páginas mais recentes da API Monde) e recarrega o dashboard ao concluir.
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

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

    try {
      const res = await fetch(SYNC_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        },
        cache: 'no-store',
        signal: controller.signal,
      })
      const data = await res.json().catch(() => null)

      // A Edge Function devolve { ok, salesInserted, ... } no topo (não em `result`),
      // e em erro { ok: false, error: <string> } com status 500.
      if (!res.ok || data?.ok === false) {
        const message =
          typeof data?.error === 'string'
            ? data.error
            : (data?.error?.message ?? `Erro ${res.status}`)
        setFeedback({ type: 'error', message })
        return
      }

      const inserted = (data?.salesInserted ?? 0).toLocaleString('pt-BR')
      setFeedback({ type: 'success', message: `${inserted} vendas atualizadas` })
      onSynced?.()
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Tempo esgotado — tente novamente em instantes'
          : err instanceof TypeError
            ? 'Não foi possível conectar ao servidor'
            : err instanceof Error
              ? err.message
              : 'Erro de conexão'
      setFeedback({ type: 'error', message })
    } finally {
      clearTimeout(timeout)
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
