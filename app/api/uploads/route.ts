import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import type { ApiError } from '@/lib/schemas'

/**
 * GET /api/uploads — Lista todos os uploads ordenados por data DESC.
 */
export async function GET() {
  try {
    const supabase = getSupabaseServer()

    const { data, error } = await supabase
      .from('uploads')
      .select('*')
      .order('uploaded_at', { ascending: false })

    if (error) {
      return jsonError('DB_ERROR', error.message, 500)
    }

    return NextResponse.json({ uploads: data ?? [] })
  } catch (err) {
    console.error('Uploads list error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao listar uploads.', 500)
  }
}

function jsonError(code: string, message: string, status: number) {
  const body: ApiError = { error: { code, message } }
  return NextResponse.json(body, { status })
}
