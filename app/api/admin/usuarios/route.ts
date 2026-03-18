import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import type { ApiError } from '@/lib/schemas'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/admin/usuarios — Lista todos os usuários (profiles).
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) {
  try {
    const supabase = getSupabaseServer()

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Usuarios DB error:', error)
      return jsonError('DB_ERROR', error.message, 500)
    }

    return NextResponse.json(
      { usuarios: data ?? [] },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    )
  } catch (err) {
    console.error('Usuarios list error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao listar usuários.', 500)
  }
}

/**
 * POST /api/admin/usuarios — Criar usuário ou atualizar role.
 *
 * Body:
 *   { action: 'create', email, nome, role, senha }
 *   { action: 'update_role', userId, role }
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseServer()
    const body = await request.json()
    const { action } = body

    if (action === 'create') {
      const { email, nome, role, senha } = body as {
        action: 'create'
        email: string
        nome: string
        role: 'admin' | 'viewer'
        senha: string
      }

      if (!email || !nome || !senha) {
        return jsonError('VALIDATION_ERROR', 'Email, nome e senha são obrigatórios.', 400)
      }

      // Create user via Supabase Auth Admin API
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email,
        password: senha,
        email_confirm: true,
        user_metadata: { nome },
      })

      if (authError) {
        console.error('Auth createUser error:', authError)
        return jsonError('AUTH_ERROR', authError.message, 400)
      }

      // The trigger auto-creates the profile as 'viewer'.
      // If the desired role is 'admin', update the profile.
      if (role === 'admin' && authData.user) {
        const { error: updateError } = await supabase
          .from('profiles')
          .update({ role })
          .eq('id', authData.user.id)

        if (updateError) {
          console.error('Profile role update error:', updateError)
          // User was created but role update failed — not fatal
        }
      }

      return NextResponse.json({ success: true })
    }

    if (action === 'update_role') {
      const { userId, role } = body as {
        action: 'update_role'
        userId: string
        role: 'admin' | 'viewer'
      }

      if (!userId || !role) {
        return jsonError('VALIDATION_ERROR', 'userId e role são obrigatórios.', 400)
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ role })
        .eq('id', userId)

      if (updateError) {
        console.error('Role update error:', updateError)
        return jsonError('DB_ERROR', updateError.message, 500)
      }

      return NextResponse.json({ success: true })
    }

    return jsonError('VALIDATION_ERROR', 'Ação inválida. Use "create" ou "update_role".', 400)
  } catch (err) {
    console.error('Usuarios POST error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao processar requisição.', 500)
  }
}

function jsonError(code: string, message: string, status: number) {
  const body: ApiError = { error: { code, message } }
  return NextResponse.json(body, { status })
}
