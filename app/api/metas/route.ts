import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { MetaInputSchema } from '@/lib/schemas'
import type { ApiError } from '@/lib/schemas'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/metas?ano=2026
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const ano = searchParams.get('ano')

    if (!ano) {
      return jsonError('MISSING_PARAM', 'Parâmetro "ano" é obrigatório.', 400)
    }

    const supabase = getSupabaseServer()

    const { data, error } = await supabase
      .from('metas')
      .select('*')
      .eq('ano', parseInt(ano))
      .order('mes', { ascending: true })
      .order('setor_grupo', { ascending: true })

    if (error) {
      return jsonError('DB_ERROR', error.message, 500)
    }

    return NextResponse.json({ metas: data ?? [] })
  } catch (err) {
    console.error('Metas GET error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao buscar metas.', 500)
  }
}

/**
 * POST /api/metas
 * Body: { metas: Array<{ ano, mes, setor_grupo, fat_meta }> }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (!body.metas || !Array.isArray(body.metas)) {
      return jsonError('INVALID_BODY', 'Body deve conter { metas: [...] }', 400)
    }

    // Validar cada meta
    const validatedMetas = []
    for (const meta of body.metas) {
      const result = MetaInputSchema.safeParse(meta)
      if (!result.success) {
        return jsonError(
          'VALIDATION_ERROR',
          `Meta inválida: ${JSON.stringify(result.error.issues)}`,
          400
        )
      }
      validatedMetas.push(result.data)
    }

    const supabase = getSupabaseServer()

    // Upsert: INSERT ... ON CONFLICT (ano, mes, setor_grupo) DO UPDATE
    const { error } = await supabase
      .from('metas')
      .upsert(
        validatedMetas.map((m) => ({
          ano: m.ano,
          mes: m.mes,
          setor_grupo: m.setor_grupo,
          fat_meta: m.fat_meta,
          receita_meta_pct: m.receita_meta_pct ?? 0,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'ano,mes,setor_grupo' }
      )

    if (error) {
      return jsonError('DB_ERROR', error.message, 500)
    }

    return NextResponse.json({ saved: validatedMetas.length })
  } catch (err) {
    console.error('Metas POST error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao salvar metas.', 500)
  }
}

function jsonError(code: string, message: string, status: number) {
  const body: ApiError = { error: { code, message } }
  return NextResponse.json(body, { status })
}
