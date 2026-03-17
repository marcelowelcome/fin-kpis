import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { calcDashboard, getPeriodDates } from '@/lib/metrics'
import type { ApiError, Venda, Meta } from '@/lib/schemas'

/**
 * GET /api/dashboard?periodo=mes-corrente
 * Parâmetros: periodo, inicio (custom), fim (custom)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const periodo = searchParams.get('periodo') ?? 'mes-corrente'
    const inicioParam = searchParams.get('inicio') ?? undefined
    const fimParam = searchParams.get('fim') ?? undefined

    // Calcular datas do período
    let dates
    try {
      dates = getPeriodDates(periodo, inicioParam, fimParam)
    } catch (err) {
      return jsonError('INVALID_PERIOD', (err as Error).message, 400)
    }

    const supabase = getSupabaseServer()

    // Buscar vendas do período (apenas setores relevantes para performance)
    const inicioStr = dates.inicio.toISOString().split('T')[0]
    const fimStr = dates.fim.toISOString().split('T')[0]

    const { data: vendas, error: vendasError } = await supabase
      .from('vendas')
      .select('*')
      .gte('data_venda', inicioStr)
      .lte('data_venda', fimStr)

    if (vendasError) {
      return jsonError('DB_ERROR', vendasError.message, 500)
    }

    // Buscar metas do período (meses abrangidos)
    const mesInicio = dates.inicio.getMonth() + 1
    const mesFim = dates.fim.getMonth() + 1
    const ano = dates.inicio.getFullYear()

    const { data: metas, error: metasError } = await supabase
      .from('metas')
      .select('*')
      .eq('ano', ano)
      .gte('mes', mesInicio)
      .lte('mes', mesFim)

    if (metasError) {
      return jsonError('DB_ERROR', metasError.message, 500)
    }

    // Para acumulado ano, somar metas de todos os meses
    const metasAggregated = aggregateMetas(metas as Meta[] ?? [], periodo)

    const dashboardData = calcDashboard(
      (vendas as Venda[]) ?? [],
      metasAggregated,
      dates
    )

    return NextResponse.json({ data: dashboardData })
  } catch (err) {
    console.error('Dashboard error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao calcular dashboard.', 500)
  }
}

/**
 * Agrega metas quando o período abrange múltiplos meses.
 * Para 'mes-corrente' ou 'semana-atual', retorna as metas do mês.
 * Para 'acumulado-ano', soma as metas de todos os meses.
 */
function aggregateMetas(metas: Meta[], periodo: string): Meta[] {
  if (periodo === 'mes-corrente' || periodo === 'semana-atual' || periodo === 'custom') {
    return metas
  }

  // Acumulado: somar fat_meta por setor_grupo
  const aggregated = new Map<string, Meta>()

  for (const meta of metas) {
    const existing = aggregated.get(meta.setor_grupo)
    if (existing) {
      existing.fat_meta += meta.fat_meta
    } else {
      aggregated.set(meta.setor_grupo, { ...meta })
    }
  }

  return Array.from(aggregated.values())
}

function jsonError(code: string, message: string, status: number) {
  const body: ApiError = { error: { code, message } }
  return NextResponse.json(body, { status })
}
