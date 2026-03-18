'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Meta, MetaInput } from '@/lib/schemas'

interface UseMetasReturn {
  metas: Meta[]
  loading: boolean
  error: string | null
  saving: boolean
  ano: number
  setAno: (a: number) => void
  saveMetas: (metas: MetaInput[]) => Promise<boolean>
  refetch: () => void
}

export function useMetas(): UseMetasReturn {
  const [metas, setMetas] = useState<Meta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [ano, setAno] = useState(new Date().getFullYear())

  const fetchMetas = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/metas?ano=${ano}`, { cache: 'no-store' })
      const json = await res.json()

      if (!res.ok) {
        setError(json.error?.message ?? 'Erro ao carregar metas')
        return
      }

      setMetas(json.metas ?? [])
    } catch {
      setError('Erro de conexão ao carregar metas')
    } finally {
      setLoading(false)
    }
  }, [ano])

  useEffect(() => {
    fetchMetas()
  }, [fetchMetas])

  const saveMetas = useCallback(
    async (metasInput: MetaInput[]): Promise<boolean> => {
      setSaving(true)
      setError(null)

      try {
        const res = await fetch('/api/metas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ metas: metasInput }),
        })

        const json = await res.json()

        if (!res.ok) {
          setError(json.error?.message ?? 'Erro ao salvar metas')
          return false
        }

        await fetchMetas()
        return true
      } catch {
        setError('Erro de conexão ao salvar metas')
        return false
      } finally {
        setSaving(false)
      }
    },
    [fetchMetas]
  )

  return {
    metas,
    loading,
    error,
    saving,
    ano,
    setAno,
    saveMetas,
    refetch: fetchMetas,
  }
}
