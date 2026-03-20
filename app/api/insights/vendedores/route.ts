import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { jsonError } from '@/lib/api-utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/insights/vendedores?inicio=2025-01-01&fim=2025-12-31&setor_grupo=CORP&limit=50
 *
 * Retorna ranking de vendedores agrupado por nome.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const inicio = searchParams.get('inicio')
    const fim = searchParams.get('fim')
    const setorGrupo = searchParams.get('setor_grupo') ?? undefined
    const limit = Math.min(Number(searchParams.get('limit') ?? '50'), 500)

    if (!inicio || !fim) {
      return jsonError('MISSING_PARAMS', 'Parâmetros inicio e fim são obrigatórios.', 400)
    }

    const supabase = getSupabaseServer()

    // Buscar todas as vendas do período — paginação determinística
    const vendas = await fetchAllVendas(supabase, inicio, fim, setorGrupo)

    // Agrupar por vendedor
    const map = new Map<
      string,
      { faturamento: number; receitas: number; vendaNums: Set<string> }
    >()

    for (const v of vendas) {
      const key = v.vendedor ?? 'Desconhecido'
      let entry = map.get(key)
      if (!entry) {
        entry = { faturamento: 0, receitas: 0, vendaNums: new Set() }
        map.set(key, entry)
      }
      entry.faturamento += v.faturamento ?? 0
      entry.receitas += v.receitas ?? 0
      if (v.venda_numero) entry.vendaNums.add(v.venda_numero)
    }

    // Montar array, calcular ticket médio, ordenar
    const vendedores = Array.from(map.entries())
      .map(([vendedor, agg]) => {
        const nVendas = agg.vendaNums.size
        return {
          vendedor,
          faturamento: agg.faturamento,
          receitas: agg.receitas,
          nVendas,
          ticketMedio: nVendas > 0 ? agg.faturamento / nVendas : 0,
        }
      })
      .sort((a, b) => b.faturamento - a.faturamento)
      .slice(0, limit)

    return NextResponse.json(
      { vendedores, total: vendedores.length },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    )
  } catch (err) {
    console.error('Vendedores ranking error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao calcular ranking de vendedores.', 500)
  }
}

// =============================================================
// Data fetching — paginação determinística
// =============================================================

const PAGE = 1000
const COLS = 'id, venda_numero, vendedor, setor_grupo, faturamento, receitas'

interface VendaRow {
  id: number
  venda_numero: string | null
  vendedor: string | null
  setor_grupo: string | null
  faturamento: number | null
  receitas: number | null
}

async function fetchAllVendas(
  sb: ReturnType<typeof getSupabaseServer>,
  inicio: string,
  fim: string,
  setorGrupo?: string
): Promise<VendaRow[]> {
  const all: VendaRow[] = []
  let offset = 0

  while (true) {
    let query = sb
      .from('vendas')
      .select(COLS)
      .gte('data_venda', inicio)
      .lte('data_venda', fim)

    if (setorGrupo) {
      query = query.eq('setor_grupo', setorGrupo)
    }

    const { data, error } = await query
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)

    if (error) {
      console.error('fetchAllVendas error:', error)
      break
    }
    if (!data || data.length === 0) break

    all.push(...(data as VendaRow[]))
    if (data.length < PAGE) break
    offset += PAGE
  }

  return all
}

