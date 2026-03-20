import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { getSupabaseServer } from '@/lib/supabase'
import type { ApiError } from '@/lib/schemas'

/** Resposta de erro padronizada para API routes */
export function jsonError(code: string, message: string, status: number) {
  const body: ApiError = { error: { code, message } }
  return NextResponse.json(body, { status })
}

interface AuthResult {
  userId: string
  role: 'admin' | 'viewer'
}

/**
 * Verifica autenticação + role do usuário via cookies da request.
 * Retorna { userId, role } se autenticado, ou null se não.
 */
export async function getAuthUser(request: NextRequest): Promise<AuthResult | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return null

  const supabaseAuth = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll() {},
    },
  })

  const { data: { user } } = await supabaseAuth.auth.getUser()
  if (!user) return null

  const supabase = getSupabaseServer()
  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  return {
    userId: user.id,
    role: (profile?.role as 'admin' | 'viewer') ?? 'viewer',
  }
}

/**
 * Retorna "YYYY-MM-DD" baseado no horário local do servidor (BRT).
 * Usar em vez de new Date().toISOString().split('T')[0] que retorna UTC.
 */
export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
