'use client'

import { useState, useEffect, useCallback } from 'react'
import { getSupabaseBrowser } from '@/lib/supabase'

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
      const supabase = getSupabaseBrowser()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        setProfile(null)
        return
      }

      const { data } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()

      if (data) {
        setProfile(data as Profile)
      } else {
        // Profile não existe ainda — tratar como viewer
        setProfile({
          id: user.id,
          email: user.email ?? '',
          nome: null,
          role: 'viewer',
          created_at: new Date().toISOString(),
        })
      }
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
