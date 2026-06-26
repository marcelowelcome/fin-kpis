'use client'

import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, CheckCircle, AlertCircle, Clock, Database, ChevronDown, ChevronUp } from 'lucide-react'

interface SyncResult {
  uploadId: string
  pagesScanned: number
  totalPages: number
  salesFetched: number
  cancelledSkipped: number
  salesInserted: number
  salesDeleted: number
  dateRange: { min: string; max: string } | null
  indefinidoCount: number
  mode: string
  nextPage?: number
}

interface SyncStatus {
  lastSync: { uploadId: string; nomeArquivo: string; syncedAt: string; salesSynced: number; status: string } | null
  history: { uploadId: string; nomeArquivo: string; syncedAt: string; salesSynced: number; status: string }[]
  totalRecordsInDB: number
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function formatDateShort(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

export function MondeSyncSection() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [mode, setMode] = useState<'incremental' | 'full'>('incremental')
  const [currentPage, setCurrentPage] = useState(1)

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/monde/status')
      if (res.ok) setStatus(await res.json())
    } catch { /* ignore */ } finally {
      setLoadingStatus(false)
    }
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  const handleSync = async () => {
    setSyncing(true)
    setSyncError(null)
    setSyncResult(null)

    try {
      const maxPages = mode === 'full' ? 50 : 25
      const res = await fetch('/api/monde/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, maxPages, startPage: mode === 'full' ? currentPage : 1 }),
      })

      const data = await res.json()

      if (!res.ok) {
        setSyncError(data?.error?.message ?? `Erro ${res.status}`)
        return
      }

      setSyncResult(data.result)
      if (data.result.nextPage && mode === 'full') {
        setCurrentPage(data.result.nextPage)
      }
      await loadStatus()
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Erro de rede')
    } finally {
      setSyncing(false)
    }
  }

  const resetFull = () => {
    setCurrentPage(1)
    setSyncResult(null)
    setSyncError(null)
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-6 h-6 rounded-lg bg-blue-600 flex items-center justify-center">
              <RefreshCw size={13} className="text-white" />
            </div>
            <h2 className="text-base font-semibold text-slate-800">Sincronizar com Monde</h2>
          </div>
          <p className="text-xs text-slate-500">
            Importa vendas diretamente da API v3 do Monde, sem necessidade de exportar Excel.
          </p>
        </div>

        {/* Status badge */}
        {!loadingStatus && status && (
          <div className="flex items-center gap-1.5 text-xs text-slate-500 shrink-0">
            <Database size={12} />
            <span>{(status.totalRecordsInDB ?? 0).toLocaleString('pt-BR')} registros</span>
          </div>
        )}
      </div>

      {/* Última sincronização */}
      {!loadingStatus && status?.lastSync && (
        <div className="bg-slate-50 rounded-xl px-4 py-3 mb-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock size={13} className="text-slate-400" />
            <span className="text-xs text-slate-500">Última sync:</span>
            <span className="text-xs font-medium text-slate-700">{formatDate(status.lastSync.syncedAt)}</span>
            <span className="text-xs text-slate-400">·</span>
            <span className="text-xs text-slate-500">{status.lastSync.salesSynced.toLocaleString('pt-BR')} vendas</span>
          </div>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
          >
            Histórico {showHistory ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>
      )}

      {/* Histórico */}
      {showHistory && status?.history && status.history.length > 0 && (
        <div className="mb-5 border border-slate-100 rounded-xl overflow-hidden">
          {status.history.map((h) => (
            <div key={h.uploadId} className="flex items-center justify-between px-4 py-2.5 border-b border-slate-50 last:border-0 hover:bg-slate-50">
              <span className="text-xs text-slate-500 font-mono">{h.nomeArquivo}</span>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span>{h.salesSynced.toLocaleString('pt-BR')} vendas</span>
                <span>{formatDate(h.syncedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Controles */}
      <div className="flex items-center gap-3 mb-4">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
          <button
            onClick={() => { setMode('incremental'); resetFull() }}
            className={`px-3 py-2 font-medium transition-colors ${mode === 'incremental' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            Incremental
          </button>
          <button
            onClick={() => { setMode('full'); resetFull() }}
            className={`px-3 py-2 font-medium transition-colors border-l border-slate-200 ${mode === 'full' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            Histórico completo
          </button>
        </div>

        <div className="text-xs text-slate-400">
          {mode === 'incremental'
            ? '~1.250 vendas mais recentes por chamada'
            : `~2.500 vendas por chamada · página ${currentPage} de ${status?.lastSync ? '?' : '?'}`}
        </div>
      </div>

      {/* Modo Full: info de paginação manual */}
      {mode === 'full' && currentPage > 1 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 mb-4 flex items-center justify-between">
          <p className="text-xs text-amber-700">
            Continuando backfill a partir da página <strong>{currentPage}</strong>. Clique em Sincronizar para avançar.
          </p>
          <button onClick={resetFull} className="text-xs text-amber-600 underline hover:no-underline">
            Reiniciar
          </button>
        </div>
      )}

      {/* Botão de sync */}
      <button
        onClick={handleSync}
        disabled={syncing}
        className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <RefreshCw size={15} className={syncing ? 'animate-spin' : ''} />
        {syncing ? 'Sincronizando...' : 'Sincronizar agora'}
      </button>

      {/* Resultado de sucesso */}
      {syncResult && !syncing && (
        <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={16} className="text-green-600" />
            <span className="text-sm font-semibold text-green-800">Sincronização concluída</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-3">
            <div>
              <p className="text-[10px] text-green-600 uppercase tracking-wide">Páginas</p>
              <p className="text-lg font-bold text-green-800">{syncResult.pagesScanned}<span className="text-xs font-normal text-green-600"> / {syncResult.totalPages}</span></p>
            </div>
            <div>
              <p className="text-[10px] text-green-600 uppercase tracking-wide">Inseridas</p>
              <p className="text-lg font-bold text-green-800">{syncResult.salesInserted.toLocaleString('pt-BR')}</p>
            </div>
            <div>
              <p className="text-[10px] text-green-600 uppercase tracking-wide">Substituídas</p>
              <p className="text-lg font-bold text-green-800">{syncResult.salesDeleted.toLocaleString('pt-BR')}</p>
            </div>
            <div>
              <p className="text-[10px] text-slate-500 uppercase tracking-wide">Canceladas</p>
              <p className="text-lg font-bold text-slate-500">{(syncResult.cancelledSkipped ?? 0).toLocaleString('pt-BR')}</p>
            </div>
            <div>
              <p className="text-[10px] text-green-600 uppercase tracking-wide">Período</p>
              <p className="text-sm font-semibold text-green-800">
                {syncResult.dateRange ? `${formatDateShort(syncResult.dateRange.min)} → ${formatDateShort(syncResult.dateRange.max)}` : '—'}
              </p>
            </div>
          </div>
          {syncResult.indefinidoCount > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
              ⚠ {syncResult.indefinidoCount} vendas com setor INDEFINIDO — verifique as regras de mapeamento ou classifique manualmente no Monde.
            </p>
          )}
          {mode === 'full' && syncResult.nextPage && syncResult.pagesScanned < syncResult.totalPages && (
            <p className="mt-2 text-xs text-blue-700">
              Backfill parcial concluído. Clique em <strong>Sincronizar</strong> novamente para continuar (página {syncResult.nextPage}).
            </p>
          )}
        </div>
      )}

      {/* Erro */}
      {syncError && !syncing && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-2">
          <AlertCircle size={15} className="text-red-500 mt-0.5 shrink-0" />
          <p className="text-sm text-red-700">{syncError}</p>
        </div>
      )}

      {/* Info sobre cálculo */}
      <details className="mt-5">
        <summary className="text-xs text-slate-400 cursor-pointer hover:text-slate-600 select-none">
          Como os valores são calculados?
        </summary>
        <div className="mt-2 text-xs text-slate-500 space-y-1 pl-2 border-l border-slate-200">
          <p><strong>Setor:</strong> lido do campo personalizado &ldquo;Setor&rdquo; do Monde (Corporativo, Lazer, WedMe, etc.)</p>
          <p><strong>Faturamento / Valor Total:</strong> soma do campo <em>amount</em> apenas dos produtos ativos (exclui cancelados e deletados), igual ao relatório &ldquo;Situação Produto: Ativo&rdquo; do CRM.</p>
          <p><strong>Receita:</strong> receita total da venda, proporcional à participação dos produtos ativos no faturamento.</p>
          <p><strong>Vendas excluídas:</strong> vendas canceladas no nível da venda, e vendas onde todos os produtos estão cancelados ou deletados.</p>
        </div>
      </details>
    </div>
  )
}
