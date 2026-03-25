'use client'

import { useState, useEffect, useCallback } from 'react'
import type { VendorGoal, VendorGoalInput } from '@/lib/schemas'

interface UseVendorGoalsReturn {
  goals: VendorGoal[]
  vendedores: string[]
  loading: boolean
  error: string | null
  saving: boolean
  ano: number
  setAno: (a: number) => void
  saveGoals: (goals: VendorGoalInput[]) => Promise<boolean>
  refetch: () => void
}

export function useVendorGoals(): UseVendorGoalsReturn {
  const [goals, setGoals] = useState<VendorGoal[]>([])
  const [vendedores, setVendedores] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [ano, setAno] = useState(new Date().getFullYear())

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const [goalsRes, vendedoresRes] = await Promise.all([
        fetch(`/api/vendor-goals?ano=${ano}`, { cache: 'no-store' }),
        fetch(`/api/vendor-goals/vendedores?ano=${ano}`, { cache: 'no-store' }),
      ])

      const goalsJson = await goalsRes.json()
      const vendedoresJson = await vendedoresRes.json()

      if (!goalsRes.ok) {
        setError(goalsJson.error?.message ?? 'Erro ao carregar metas')
        return
      }

      setGoals(goalsJson.goals ?? [])
      setVendedores(vendedoresJson.vendedores ?? [])
    } catch {
      setError('Erro de conexão ao carregar metas de vendedores')
    } finally {
      setLoading(false)
    }
  }, [ano])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const saveGoals = useCallback(
    async (goalsInput: VendorGoalInput[]): Promise<boolean> => {
      setSaving(true)
      setError(null)

      try {
        const res = await fetch('/api/vendor-goals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goals: goalsInput }),
        })

        const json = await res.json()

        if (!res.ok) {
          setError(json.error?.message ?? 'Erro ao salvar metas')
          return false
        }

        await fetchData()
        return true
      } catch {
        setError('Erro de conexão ao salvar metas de vendedores')
        return false
      } finally {
        setSaving(false)
      }
    },
    [fetchData]
  )

  return {
    goals,
    vendedores,
    loading,
    error,
    saving,
    ano,
    setAno,
    saveGoals,
    refetch: fetchData,
  }
}
