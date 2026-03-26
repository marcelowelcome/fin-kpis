import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { jsonError } from '@/lib/api-utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE = 1000

/**
 * GET /api/vendor-goals/vendedores?ano=2026
 * Retorna nomes distintos de vendedores que têm vendas no ano.
 * Paginação determinística para garantir que todos os nomes são capturados.
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

    // Paginação determinística — buscar todas as vendas e extrair nomes únicos
    const nameSet = new Set<string>()
    let offset = 0

    while (true) {
      const { data, error } = await supabase
        .from('vendas')
        .select('id, vendedor')
        .gte('data_venda', inicio)
        .lte('data_venda', fim)
        .order('id', { ascending: true })
        .range(offset, offset + PAGE - 1)

      if (error) {
        return jsonError('DB_ERROR', error.message, 500)
      }
      if (!data || data.length === 0) break

      for (const row of data as { id: number; vendedor: string }[]) {
        if (row.vendedor) nameSet.add(row.vendedor)
      }

      if (data.length < PAGE) break
      offset += PAGE
    }

    const uniqueNames = Array.from(nameSet).sort()

    return NextResponse.json({ vendedores: uniqueNames })
  } catch (err) {
    console.error('VendorGoals vendedores error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao buscar vendedores.', 500)
  }
}
