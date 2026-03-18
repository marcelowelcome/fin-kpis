import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import type { ApiError } from '@/lib/schemas'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/uploads — Lista todos os uploads ordenados por data DESC.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) {
  try {
    const supabase = getSupabaseServer()

    const { data, error } = await supabase
      .from('uploads')
      .select('id, nome_arquivo, uploaded_at, total_linhas, linhas_inseridas, linhas_atualizadas, alertas_qualidade, status')
      .order('uploaded_at', { ascending: false })

    if (error) {
      console.error('Uploads DB error:', error)
      return jsonError('DB_ERROR', error.message, 500)
    }

    return NextResponse.json(
      { uploads: data ?? [] },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    )
  } catch (err) {
    console.error('Uploads list error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao listar uploads.', 500)
  }
}

function jsonError(code: string, message: string, status: number) {
  const body: ApiError = { error: { code, message } }
  return NextResponse.json(body, { status })
}
