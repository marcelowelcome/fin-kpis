'use client'

import { useState, useEffect, useCallback } from 'react'

export interface Profile {
  id: string
  email: string
  nome: string | null
  role: 'admin' | 'viewer'
  created_at: string
}

interface UseAuthReturn {
  profile: Profile | null
  isAdmin: boolean
  loading: boolean
  refetch: () => void
}

export function useAuth(): UseAuthReturn {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchProfile = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/auth/profile', { cache: 'no-store' })
      const json = await res.json()
      setProfile(json.profile as Profile | null)
    } catch {
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  return {
    profile,
    isAdmin: profile?.role === 'admin',
    loading,
    refetch: fetchProfile,
  }
}
