import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { calcDashboard, getPeriodRange, getPreviousPeriodRange, calcTrendRange } from '@/lib/metrics'
import { todayISO, jsonError } from '@/lib/api-utils'
import type { VendaKPI, Meta, VendorGoal } from '@/lib/schemas'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/dashboard?periodo=mes-corrente
 * GET /api/dashboard?periodo=custom&inicio=2025-01-01&fim=2025-12-31
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const periodo = searchParams.get('periodo') ?? 'mes-corrente'
    const inicioParam = searchParams.get('inicio') ?? undefined
    const fimParam = searchParams.get('fim') ?? undefined
    const vendedorParam = searchParams.get('vendedor') ?? undefined

    // Validar formato de datas custom
    const isoDateRe = /^\d{4}-\d{2}-\d{2}$/
    if (inicioParam && !isoDateRe.test(inicioParam)) {
      return jsonError('INVALID_DATE', 'Formato de inicio inválido. Use YYYY-MM-DD.', 400)
    }
    if (fimParam && !isoDateRe.test(fimParam)) {
      return jsonError('INVALID_DATE', 'Formato de fim inválido. Use YYYY-MM-DD.', 400)
    }
    if (inicioParam && fimParam && inicioParam > fimParam) {
      return jsonError('INVALID_RANGE', 'Data inicio deve ser anterior a fim.', 400)
    }

    // 1. Calcular range — retorna strings ISO, nunca Date
    let range
    try {
      range = getPeriodRange(periodo, inicioParam, fimParam)
    } catch (err) {
      return jsonError('INVALID_PERIOD', (err as Error).message, 400)
    }

    const supabase = getSupabaseServer()

    // 2. Buscar TODAS as vendas do período — paginar com ORDER BY id
    const vendas = await fetchAllVendas(supabase, range.inicio, range.fim, vendedorParam)

    // 3. Buscar metas dos meses abrangidos
    const metas = await fetchMetas(supabase, range.meses)

    // 3.5. Se filtro por vendedor ativo, substituir metas pelos vendor_goals individuais
    //       A meta do vendedor é global — replicar para WT + cada setor para que
    //       todas as abas mostrem a meta. wtMetaDireta=true garante que o consolidado
    //       use getMeta('WT') direto, sem somar CORP+TRIPS+WEDDINGS.
    let metasEfetivas = metas
    let vendorMetaOverride = false
    if (vendedorParam) {
      const vgForVendor = await fetchVendorGoalsForVendor(supabase, range.meses, vendedorParam)
      if (vgForVendor.length > 0) {
        vendorMetaOverride = true
        const SETORES_VENDEDOR = ['WT', 'CORP', 'TRIPS', 'WEDDINGS'] as const
        metasEfetivas = vgForVendor.flatMap((vg) =>
          SETORES_VENDEDOR.map((setor) => ({
            id: vg.id,
            ano: vg.ano,
            mes: vg.mes,
            setor_grupo: setor as string,
            fat_meta: vg.fat_meta,
            receita_meta_pct: vg.receita_meta_pct,
            updated_at: vg.updated_at,
          }))
        ) as Meta[]
      }
    }

    // 4. Agregar metas se multi-mês
    const metasAgg = range.meses.length > 1 ? aggregateMetas(metasEfetivas) : metasEfetivas

    // 5. Buscar período anterior para delta (comparação)
    const prevRange = getPreviousPeriodRange(periodo, range.inicio, range.fim)
    let vendasAnterior: VendaKPI[] = []
    if (prevRange) {
      vendasAnterior = await fetchAllVendas(supabase, prevRange.inicio, prevRange.fim, vendedorParam)
    }

    // 6. Buscar dados expandidos para o gráfico de evolução
    //    semana-atual → últimas 10 semanas | mes-corrente → últimos 12 meses
    const trendTipo = (periodo === 'semana-atual') ? 'semanal' as const : 'mensal' as const
    const trendRange = calcTrendRange(periodo, range.inicio, range.fim)
    const trendVendas = trendRange
      ? await fetchAllVendas(supabase, trendRange.inicio, trendRange.fim, vendedorParam)
      : vendas
    let trendMetas: Meta[]
    if (trendRange) {
      if (vendedorParam) {
        // Buscar vendor_goals para todos os meses do trend (não só o mês corrente)
        const vgTrend = await fetchVendorGoalsForVendor(supabase, trendRange.meses, vendedorParam)
        const SETORES_VENDEDOR = ['WT', 'CORP', 'TRIPS', 'WEDDINGS'] as const
        trendMetas = vgTrend.flatMap((vg) =>
          SETORES_VENDEDOR.map((setor) => ({
            id: vg.id,
            ano: vg.ano,
            mes: vg.mes,
            setor_grupo: setor as string,
            fat_meta: vg.fat_meta,
            receita_meta_pct: vg.receita_meta_pct,
            updated_at: vg.updated_at,
          }))
        ) as Meta[]
      } else {
        trendMetas = await fetchMetas(supabase, trendRange.meses)
      }
    } else {
      trendMetas = metasEfetivas
    }

    // 7. Calcular KPIs com forecast, delta e trend
    const data = calcDashboard(
      vendas as VendaKPI[],
      metasAgg,
      { inicio: range.inicio, fim: range.fim, label: range.label },
      {
        vendasAnterior: vendasAnterior as VendaKPI[],
        metasRaw: metasEfetivas,
        trendVendas: trendVendas as VendaKPI[],
        trendMetasRaw: trendMetas,
        trendTipo,
        deltaLabel: getDeltaLabel(periodo),
        wtMetaDireta: vendorMetaOverride,
      }
    )

    // 7.5. Enriquecer topVendedores com metas individuais (vendor_goals)
    const vgMeses = range.meses
    const vendorGoals = await fetchVendorGoals(supabase, vgMeses)
    // Agregar meta e tipo por vendedor
    const vgMap = new Map<string, { meta: number; tipo: string }>()
    for (const vg of vendorGoals) {
      const existing = vgMap.get(vg.vendedor)
      if (existing) {
        existing.meta += vg.fat_meta
      } else {
        vgMap.set(vg.vendedor, { meta: vg.fat_meta, tipo: vg.tipo_meta ?? 'valor_total' })
      }
    }
    // Attach fatMeta/percRealizado/tipoMeta to each ranking entry
    for (const key of ['total', 'corp', 'trips', 'weddings'] as const) {
      data.topVendedores[key] = data.topVendedores[key].map((v) => {
        const vg = vgMap.get(v.vendedor)
        if (!vg || vg.meta <= 0) {
          return { ...v, fatMeta: null, percRealizado: null, tipoMeta: null }
        }
        // Comparar contra a métrica correta: valor_total (faturamento) ou receita
        const realizado = vg.tipo === 'receita' ? v.receitas : v.faturamento
        return {
          ...v,
          fatMeta: vg.meta,
          percRealizado: realizado / vg.meta,
          tipoMeta: vg.tipo,
        }
      })
    }

    // 8. Cache headers
    const today = todayISO()
    const isHistorical = range.fim < today
    const cc = isHistorical
      ? 'public, max-age=3600, stale-while-revalidate=7200'
      : 'no-store, max-age=0'

    return NextResponse.json({ data }, { headers: { 'Cache-Control': cc } })
  } catch (err) {
    console.error('Dashboard error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao calcular dashboard.', 500)
  }
}

// =============================================================
// Data fetching — paginação determinística
// =============================================================

const PAGE = 1000
const COLS = 'id, venda_numero, vendedor, data_venda, setor_bruto, setor_grupo, produto, valor_total, receitas, faturamento, situacao, updated_at'

async function fetchAllVendas(
  sb: ReturnType<typeof getSupabaseServer>,
  inicio: string,
  fim: string,
  vendedor?: string
): Promise<VendaKPI[]> {
  const all: VendaKPI[] = []
  let offset = 0

  while (true) {
    let query = sb
      .from('vendas')
      .select(COLS)
      .gte('data_venda', inicio)
      .lte('data_venda', fim)
    if (vendedor) query = query.eq('vendedor', vendedor)
    const { data, error } = await query
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)

    if (error) {
      console.error('fetchAllVendas error:', error)
      break
    }
    if (!data || data.length === 0) break

    all.push(...data)
    if (data.length < PAGE) break
    offset += PAGE
  }

  return all
}

async function fetchMetas(
  sb: ReturnType<typeof getSupabaseServer>,
  meses: { ano: number; mes: number }[]
): Promise<Meta[]> {
  if (meses.length === 0) return []

  // Agrupar por ano para minimizar queries
  const byAno: Record<number, number[]> = {}
  for (const { ano, mes } of meses) {
    if (!byAno[ano]) byAno[ano] = []
    byAno[ano].push(mes)
  }

  const all: Meta[] = []
  for (const anoStr of Object.keys(byAno)) {
    const ano = Number(anoStr)
    const months = byAno[ano]
    const minM = Math.min(...months)
    const maxM = Math.max(...months)
    const { data } = await sb
      .from('metas')
      .select('*')
      .eq('ano', ano)
      .gte('mes', minM)
      .lte('mes', maxM)

    if (data) all.push(...(data as Meta[]))
  }

  return all
}

function aggregateMetas(metas: Meta[]): Meta[] {
  const map = new Map<string, Meta>()
  for (const m of metas) {
    const existing = map.get(m.setor_grupo)
    if (existing) {
      existing.fat_meta += m.fat_meta
    } else {
      map.set(m.setor_grupo, { ...m })
    }
  }
  return Array.from(map.values())
}

async function fetchVendorGoalsForVendor(
  sb: ReturnType<typeof getSupabaseServer>,
  meses: { ano: number; mes: number }[],
  vendedor: string
): Promise<VendorGoal[]> {
  if (meses.length === 0) return []

  const byAno: Record<number, number[]> = {}
  for (const { ano, mes } of meses) {
    if (!byAno[ano]) byAno[ano] = []
    byAno[ano].push(mes)
  }

  const all: VendorGoal[] = []
  for (const anoStr of Object.keys(byAno)) {
    const ano = Number(anoStr)
    const months = byAno[ano]
    const minM = Math.min(...months)
    const maxM = Math.max(...months)
    const { data } = await sb
      .from('vendor_goals')
      .select('*')
      .eq('ano', ano)
      .eq('vendedor', vendedor)
      .gte('mes', minM)
      .lte('mes', maxM)

    if (data) all.push(...(data as VendorGoal[]))
  }

  return all
}

async function fetchVendorGoals(
  sb: ReturnType<typeof getSupabaseServer>,
  meses: { ano: number; mes: number }[]
): Promise<VendorGoal[]> {
  if (meses.length === 0) return []

  const byAno: Record<number, number[]> = {}
  for (const { ano, mes } of meses) {
    if (!byAno[ano]) byAno[ano] = []
    byAno[ano].push(mes)
  }

  const all: VendorGoal[] = []
  for (const anoStr of Object.keys(byAno)) {
    const ano = Number(anoStr)
    const months = byAno[ano]
    const minM = Math.min(...months)
    const maxM = Math.max(...months)
    const { data } = await sb
      .from('vendor_goals')
      .select('*')
      .eq('ano', ano)
      .gte('mes', minM)
      .lte('mes', maxM)

    if (data) all.push(...(data as VendorGoal[]))
  }

  return all
}

function getDeltaLabel(periodo: string): string | null {
  switch (periodo) {
    case 'semana-atual': return 'vs semana anterior'
    case 'mes-corrente': return 'vs mês anterior'
    case 'acumulado-ano': return 'vs mesmo período ano anterior'
    case 'custom': return 'vs período anterior'
    default: return null
  }
}

