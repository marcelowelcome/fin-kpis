'use client'

import { useState, useEffect, useCallback } from 'react'
import type { DashboardData } from '@/lib/schemas'

interface UseDashboardReturn {
  data: DashboardData | null
  loading: boolean
  error: string | null
  refetch: () => void
  periodo: string
  setPeriodo: (p: string) => void
  customInicio: string
  setCustomInicio: (d: string) => void
  customFim: string
  setCustomFim: (d: string) => void
}

export function useDashboard(): UseDashboardReturn {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [periodo, setPeriodo] = useState('mes-corrente')
  const [customInicio, setCustomInicio] = useState('')
  const [customFim, setCustomFim] = useState('')

  const fetchDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ periodo })
      if (periodo === 'custom' && customInicio && customFim) {
        params.set('inicio', customInicio)
        params.set('fim', customFim)
      }

      const res = await fetch(`/api/dashboard?${params}`)
      const json = await res.json()

      if (!res.ok) {
        setError(json.error?.message ?? 'Erro ao carregar dashboard')
        return
      }

      setData(json.data)
    } catch {
      setError('Erro de conexão ao carregar dashboard')
    } finally {
      setLoading(false)
    }
  }, [periodo, customInicio, customFim])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  return {
    data,
    loading,
    error,
    refetch: fetchDashboard,
    periodo,
    setPeriodo,
    customInicio,
    setCustomInicio,
    customFim,
    setCustomFim,
  }
}
