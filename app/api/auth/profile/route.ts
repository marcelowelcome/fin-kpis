import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { createServerClient } from '@supabase/ssr'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/auth/profile — Retorna o profile do usuário logado.
 * Usa service role para bypass de RLS (evita recursão).
 */
export async function GET(request: NextRequest) {
  try {
    // Extrair user da session via anon key (cookies)
    const supabaseAuth = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll() {},
        },
      }
    )

    const { data: { user } } = await supabaseAuth.auth.getUser()
    if (!user) {
      return NextResponse.json({ profile: null })
    }

    // Buscar profile via service role (bypass RLS)
    const supabase = getSupabaseServer()
    const { data: profile } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single()

    return NextResponse.json({ profile: profile ?? null })
  } catch {
    return NextResponse.json({ profile: null })
  }
}
