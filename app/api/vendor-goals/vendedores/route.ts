import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { jsonError } from '@/lib/api-utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/vendor-goals/vendedores?ano=2026
 * Retorna nomes distintos de vendedores que têm vendas no ano.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const ano = searchParams.get('ano')

    if (!ano) {
      return jsonError('MISSING_PARAM', 'Parâmetro "ano" é obrigatório.', 400)
    }

    const anoNum = parseInt(ano)
    const inicio = `${anoNum}-01-01`
    const fim = `${anoNum}-12-31`

    const supabase = getSupabaseServer()

    // Buscar vendedores distintos — usar select com limit alto
    // Como é DISTINCT sobre text, resultado é < 1000 rows
    const { data, error } = await supabase
      .from('vendas')
      .select('vendedor')
      .gte('data_venda', inicio)
      .lte('data_venda', fim)
      .order('vendedor', { ascending: true })

    if (error) {
      return jsonError('DB_ERROR', error.message, 500)
    }

    // Extrair nomes únicos (Supabase não suporta DISTINCT via client)
    const nameSet = new Set<string>()
    for (const row of (data ?? []) as { vendedor: string }[]) {
      if (row.vendedor) nameSet.add(row.vendedor)
    }
    const uniqueNames = Array.from(nameSet).sort()

    return NextResponse.json({ vendedores: uniqueNames })
  } catch (err) {
    console.error('VendorGoals vendedores error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao buscar vendedores.', 500)
  }
}
