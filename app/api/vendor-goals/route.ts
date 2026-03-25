import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { VendorGoalInputSchema } from '@/lib/schemas'
import { jsonError } from '@/lib/api-utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/vendor-goals?ano=2026
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
      .from('vendor_goals')
      .select('*')
      .eq('ano', parseInt(ano))
      .order('vendedor', { ascending: true })
      .order('mes', { ascending: true })

    if (error) {
      return jsonError('DB_ERROR', error.message, 500)
    }

    return NextResponse.json({ goals: data ?? [] })
  } catch (err) {
    console.error('VendorGoals GET error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao buscar metas de vendedores.', 500)
  }
}

/**
 * POST /api/vendor-goals
 * Body: { goals: Array<{ ano, mes, vendedor, fat_meta, receita_meta_pct }> }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (!body.goals || !Array.isArray(body.goals)) {
      return jsonError('INVALID_BODY', 'Body deve conter { goals: [...] }', 400)
    }

    const validated = []
    for (const goal of body.goals) {
      const result = VendorGoalInputSchema.safeParse(goal)
      if (!result.success) {
        return jsonError(
          'VALIDATION_ERROR',
          `Meta inválida: ${JSON.stringify(result.error.issues)}`,
          400
        )
      }
      validated.push(result.data)
    }

    const supabase = getSupabaseServer()

    const { error } = await supabase
      .from('vendor_goals')
      .upsert(
        validated.map((g) => ({
          ano: g.ano,
          mes: g.mes,
          vendedor: g.vendedor,
          fat_meta: g.fat_meta,
          receita_meta_pct: g.receita_meta_pct ?? 0,
          updated_at: new Date().toISOString(),
        })),
        { onConflict: 'ano,mes,vendedor' }
      )

    if (error) {
      return jsonError('DB_ERROR', error.message, 500)
    }

    return NextResponse.json({ saved: validated.length })
  } catch (err) {
    console.error('VendorGoals POST error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao salvar metas de vendedores.', 500)
  }
}
