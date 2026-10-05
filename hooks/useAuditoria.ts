'use client'

import { useState, useEffect, useCallback } from 'react'
import type { AuditoriaMotivo, AuditoriaResponse } from '@/lib/schemas'

interface ResultadoExecucao {
  pulada?: boolean
  emAndamento?: boolean
  baseline?: boolean
  alteracoes?: number
  vendas?: number
  nota?: string
}

interface UseAuditoriaReturn {
  data: AuditoriaResponse | null
  loading: boolean
  error: string | null
  dias: number
  setDias: (d: number) => void
  executando: boolean
  executar: () => Promise<ResultadoExecucao | null>
  revisar: (id: number, motivo: AuditoriaMotivo, nota: string) => Promise<boolean>
  desfazer: (id: number) => Promise<boolean>
  refetch: () => void
}

export function useAuditoria(): UseAuditoriaReturn {
  const [data, setData] = useState<AuditoriaResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dias, setDias] = useState(30)
  const [executando, setExecutando] = useState(false)

  const fetchData = useCallback(async (silencioso = false) => {
    if (!silencioso) setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/auditoria?dias=${dias}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error?.message ?? 'Erro ao carregar a auditoria')
        return
      }
      setData(json as AuditoriaResponse)
    } catch {
      setError('Erro de conexão ao carregar a auditoria')
    } finally {
      setLoading(false)
    }
  }, [dias])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const post = useCallback(async (body: unknown) => {
    const res = await fetch('/api/admin/auditoria', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(json.error?.message ?? `Erro ${res.status}`)
    return json
  }, [])

  const executar = useCallback(async (): Promise<ResultadoExecucao | null> => {
    setExecutando(true)
    setError(null)
    try {
      const json = await post({ action: 'executar' })
      await fetchData(true)
      return (json.result ?? null) as ResultadoExecucao | null
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao rodar a conferência')
      return null
    } finally {
      setExecutando(false)
    }
  }, [post, fetchData])

  const revisar = useCallback(async (id: number, motivo: AuditoriaMotivo, nota: string) => {
    try {
      await post({ action: 'revisar', id, motivo, nota: nota.trim() || undefined })
      await fetchData(true)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar a revisão')
      return false
    }
  }, [post, fetchData])

  const desfazer = useCallback(async (id: number) => {
    try {
      await post({ action: 'desfazer', id })
      await fetchData(true)
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao desfazer a revisão')
      return false
    }
  }, [post, fetchData])

  return { data, loading, error, dias, setDias, executando, executar, revisar, desfazer, refetch: () => fetchData() }
}
