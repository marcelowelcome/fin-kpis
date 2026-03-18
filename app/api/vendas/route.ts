import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import type { ApiError } from '@/lib/schemas'

export const dynamic = 'force-dynamic'

/**
 * GET /api/vendas — Listagem filtrada para drill-down.
 *
 * Query params:
 *   setor_grupo, vendedor, produto, pagante
 *   data_inicio, data_fim
 *   valor_min, valor_max
 *   limit (default 100), offset (default 0)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const supabase = getSupabaseServer()

    let query = supabase
      .from('vendas')
      .select('*', { count: 'exact' })
      .order('data_venda', { ascending: false })
      .order('venda_numero', { ascending: false })

    // Filtros
    const setorGrupo = searchParams.get('setor_grupo')
    if (setorGrupo) query = query.eq('setor_grupo', setorGrupo)

    const vendedor = searchParams.get('vendedor')
    if (vendedor) query = query.ilike('vendedor', `%${vendedor}%`)

    const produto = searchParams.get('produto')
    if (produto) query = query.ilike('produto', `%${produto}%`)

    const pagante = searchParams.get('pagante')
    if (pagante) query = query.ilike('pagante', `%${pagante}%`)

    const dataInicio = searchParams.get('data_inicio')
    if (dataInicio) query = query.gte('data_venda', dataInicio)

    const dataFim = searchParams.get('data_fim')
    if (dataFim) query = query.lte('data_venda', dataFim)

    const valorMin = searchParams.get('valor_min')
    if (valorMin) query = query.gte('faturamento', parseFloat(valorMin))

    const valorMax = searchParams.get('valor_max')
    if (valorMax) query = query.lte('faturamento', parseFloat(valorMax))

    // Paginação
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '100'), 1000)
    const offset = parseInt(searchParams.get('offset') ?? '0')
    query = query.range(offset, offset + limit - 1)

    const { data, error, count } = await query

    if (error) {
      return jsonError('DB_ERROR', error.message, 500)
    }

    return NextResponse.json({
      vendas: data ?? [],
      total: count ?? 0,
      limit,
      offset,
    })
  } catch (err) {
    console.error('Vendas error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao buscar vendas.', 500)
  }
}

function jsonError(code: string, message: string, status: number) {
  const body: ApiError = { error: { code, message } }
  return NextResponse.json(body, { status })
}
