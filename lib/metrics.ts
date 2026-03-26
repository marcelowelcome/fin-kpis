import type {
  VendaKPI,
  Meta,
  SetorKPI,
  TripsKPI,
  WeddingsKPI,
  DashboardData,
  PipelineData,
  VendedorRanking,
  ProdutoRanking,
  TrendPoint,
  TrendSeries,
  DailyTrendPoint,
  ForecastData,
  DeltaData,
  SemanasData,
  SetorGrupo,
  SetorMeta,
} from '@/lib/schemas'
import { METAS_WT_AUTO, SETORES_WT } from '@/lib/schemas'
import { isSetorWT, getWeddingsSubcategoria } from '@/lib/setor-mapper'

// =============================================================
// REGRA FUNDAMENTAL: Todas as datas de negócio são strings ISO
// "YYYY-MM-DD". NUNCA converter para Date para comparações.
// Objetos Date são usados SOMENTE para cálculos de calendário
// (semana ISO, mês corrente, etc.) com cuidado de timezone.
// =============================================================

// =============================================================
// KPI por setor
// =============================================================

export function calcSetorKPI(
  vendas: VendaKPI[],
  meta: number,
  setorGrupos: SetorGrupo | SetorGrupo[],
  receitaMetaPct: number = 0
): SetorKPI {
  const grupos = Array.isArray(setorGrupos) ? setorGrupos : [setorGrupos]
  const filtered = vendas.filter((v) => grupos.includes(v.setor_grupo))

  const fatRealizado = sum(filtered, 'faturamento')
  const receita = sum(filtered, 'receitas')
  const nVendas = countUniqueVendas(filtered)

  return {
    fatMeta: meta,
    fatRealizado,
    percRealizado: meta > 0 ? fatRealizado / meta : null,
    receita,
    percReceita: fatRealizado > 0 ? receita / fatRealizado : null,
    receitaMetaPct,
    ticketMedio: nVendas > 0 ? fatRealizado / nVendas : 0,
    nVendas,
  }
}

// =============================================================
// Dashboard completo
// =============================================================

/**
 * Calcula todos os KPIs do dashboard.
 * As vendas já vêm filtradas por período (feito no SQL).
 * inicio/fim são strings ISO "YYYY-MM-DD".
 */
export function calcDashboard(
  vendas: VendaKPI[],
  metas: Meta[],
  periodo: { inicio: string; fim: string; label: string },
  opts?: {
    vendasAnterior?: VendaKPI[]
    metasRaw?: Meta[]
    trendVendas?: VendaKPI[]
    trendMetasRaw?: Meta[]
    trendTipo?: 'mensal' | 'semanal'
    deltaLabel?: string | null
    /** Quando true, WT meta vem direto de getMeta('WT'), não soma setores */
    wtMetaDireta?: boolean
  }
): DashboardData {
  // Proporcionalizar metas quando o período é menor que um mês
  // (ex: semana-atual = 7 dias de um mês de 31 → meta × 7/31)
  const periodoInicio = periodo.inicio
  const periodoFim = periodo.fim
  const periodoDias = diffDays(periodoInicio, periodoFim) + 1

  // Verificar se o período cabe dentro de um único mês
  const mesInicio = periodoInicio.substring(0, 7) // "YYYY-MM"
  const mesFim = periodoFim.substring(0, 7)
  const isSingleMonth = mesInicio === mesFim
  const [pAno, pMes] = periodoInicio.split('-').map(Number)
  const diasNoMes = isSingleMonth ? new Date(pAno, pMes, 0).getDate() : 0
  const metaRatio = (isSingleMonth && periodoDias < diasNoMes) ? periodoDias / diasNoMes : 1

  const getMeta = (setor: SetorMeta): number => {
    const meta = metas.find((m) => m.setor_grupo === setor)
    return meta ? meta.fat_meta * metaRatio : 0
  }
  const getReceitaPct = (setor: SetorMeta): number => {
    const meta = metas.find((m) => m.setor_grupo === setor)
    return meta ? (meta.receita_meta_pct || 0) : 0
  }

  const corp = calcSetorKPI(vendas, getMeta('CORP'), 'CORP', getReceitaPct('CORP'))
  const trips: TripsKPI = {
    ...calcSetorKPI(vendas, getMeta('TRIPS'), 'TRIPS', getReceitaPct('TRIPS')),
    nTaxas: countTaxas(vendas),
  }
  const weddings: WeddingsKPI = {
    ...calcSetorKPI(vendas, getMeta('WEDDINGS'), 'WEDDINGS', getReceitaPct('WEDDINGS')),
    nContratos: countContratos(vendas),
    subcategorias: calcWeddingsSubcategorias(vendas, metas),
  }

  const wtMeta = opts?.wtMetaDireta
    ? getMeta('WT')
    : METAS_WT_AUTO
      ? getMeta('CORP') + getMeta('TRIPS') + getMeta('WEDDINGS')
      : getMeta('WT')
  const wtReceitaPct = getReceitaPct('WT') || getReceitaPct('WEDDINGS') // fallback

  const consolidado = calcSetorKPI(
    vendas,
    wtMeta,
    SETORES_WT,
    wtReceitaPct
  )

  const ultimaAtualizacao = vendas.length > 0
    ? vendas.reduce((latest, v) =>
        v.updated_at > latest ? v.updated_at : latest,
        vendas[0].updated_at
      )
    : null

  // Pipeline e vendedores por setor
  const pipeline = {
    total: calcPipeline(vendas, SETORES_WT),
    corp: calcPipeline(vendas, ['CORP']),
    trips: calcPipeline(vendas, ['TRIPS']),
    weddings: calcPipeline(vendas, ['WEDDINGS']),
  }

  const topVendedores = {
    total: calcTopVendedores(vendas, SETORES_WT, 5),
    corp: calcTopVendedores(vendas, ['CORP'], 5),
    trips: calcTopVendedores(vendas, ['TRIPS'], 5),
    weddings: calcTopVendedores(vendas, ['WEDDINGS'], 5),
  }

  // Forecast por setor
  const forecast = {
    total: calcForecast(consolidado.fatRealizado, wtMeta, periodo.inicio, periodo.fim),
    corp: calcForecast(corp.fatRealizado, getMeta('CORP'), periodo.inicio, periodo.fim),
    trips: calcForecast(trips.fatRealizado, getMeta('TRIPS'), periodo.inicio, periodo.fim),
    weddings: calcForecast(weddings.fatRealizado, getMeta('WEDDINGS'), periodo.inicio, periodo.fim),
  }

  // Delta vs período anterior
  let delta: DashboardData['delta'] = null
  if (opts?.vendasAnterior && opts.vendasAnterior.length > 0) {
    const prev = opts.vendasAnterior
    const prevConsolidado = calcSetorKPI(prev, 0, SETORES_WT)
    const prevCorp = calcSetorKPI(prev, 0, 'CORP')
    const prevTrips = calcSetorKPI(prev, 0, 'TRIPS')
    const prevWeddings = calcSetorKPI(prev, 0, 'WEDDINGS')

    delta = {
      consolidado: calcDelta(consolidado.fatRealizado, prevConsolidado.fatRealizado),
      corp: calcDelta(corp.fatRealizado, prevCorp.fatRealizado),
      trips: calcDelta(trips.fatRealizado, prevTrips.fatRealizado),
      weddings: calcDelta(weddings.fatRealizado, prevWeddings.fatRealizado),
    }
  }

  // Top produtos por setor
  const topProdutos = {
    total: calcTopProdutos(vendas, SETORES_WT, 10),
    corp: calcTopProdutos(vendas, ['CORP'], 10),
    trips: calcTopProdutos(vendas, ['TRIPS'], 10),
    weddings: calcTopProdutos(vendas, ['WEDDINGS'], 10),
  }

  // Série de evolução (semanal ou mensal, conforme período)
  const trendTipo = opts?.trendTipo ?? 'mensal'
  const trendVendas = opts?.trendVendas ?? vendas
  const trendMetas = opts?.trendMetasRaw ?? opts?.metasRaw ?? metas
  const trend = trendTipo === 'semanal'
    ? calcWeeklySeries(trendVendas, trendMetas)
    : calcMonthlySeries(trendVendas, trendMetas)

  // Série diária (últimos 30 dias do período) — para visualização day-by-day
  const dailyTrend = calcDailySeries(vendas, metas, periodo.inicio, periodo.fim)

  return {
    periodo,
    consolidado,
    corp,
    trips,
    weddings,
    pipeline,
    topVendedores,
    topProdutos,
    trend,
    dailyTrend,
    forecast,
    delta,
    deltaLabel: opts?.deltaLabel ?? null,
    ultimaAtualizacao,
  }
}

// =============================================================
// Pipeline (Aberta vs Fechada)
// =============================================================

export function calcPipeline(
  vendas: VendaKPI[],
  setorGrupos: SetorGrupo[]
): PipelineData {
  const filtered = vendas.filter((v) => setorGrupos.includes(v.setor_grupo))

  const abertaVendas = filtered.filter((v) => v.situacao?.toLowerCase() === 'aberta')
  const fechadaVendas = filtered.filter((v) => v.situacao?.toLowerCase() === 'fechada')

  const abertaCount = new Set(abertaVendas.map((v) => v.venda_numero)).size
  const fechadaCount = new Set(fechadaVendas.map((v) => v.venda_numero)).size
  const total = abertaCount + fechadaCount

  return {
    aberta: {
      count: abertaCount,
      valor: sum(abertaVendas, 'faturamento'),
    },
    fechada: {
      count: fechadaCount,
      valor: sum(fechadaVendas, 'faturamento'),
    },
    taxaConversao: total > 0 ? fechadaCount / total : null,
  }
}

// =============================================================
// Top Vendedores
// =============================================================

export function calcTopVendedores(
  vendas: VendaKPI[],
  setorGrupos: SetorGrupo[],
  limit: number
): VendedorRanking[] {
  const filtered = vendas.filter((v) => setorGrupos.includes(v.setor_grupo))

  const byVendedor: Record<string, { fat: number; rec: number; vendas: Set<number> }> = {}
  for (const v of filtered) {
    const nome = v.vendedor
    if (!nome) continue
    if (!byVendedor[nome]) byVendedor[nome] = { fat: 0, rec: 0, vendas: new Set() }
    byVendedor[nome].fat += Number(v.faturamento) || 0
    byVendedor[nome].rec += Number(v.receitas) || 0
    byVendedor[nome].vendas.add(v.venda_numero)
  }

  return Object.entries(byVendedor)
    .map(([vendedor, data]) => ({
      vendedor,
      faturamento: data.fat,
      receitas: data.rec,
      nVendas: data.vendas.size,
      ticketMedio: data.vendas.size > 0 ? data.fat / data.vendas.size : 0,
    }))
    .sort((a, b) => b.faturamento - a.faturamento)
    .slice(0, limit)
}

// =============================================================
// Top Produtos
// =============================================================

export function calcTopProdutos(
  vendas: VendaKPI[],
  setorGrupos: SetorGrupo[],
  limit: number
): ProdutoRanking[] {
  const filtered = vendas.filter((v) => setorGrupos.includes(v.setor_grupo))

  const byProduto: Record<string, { fat: number; rec: number; vendas: Set<number> }> = {}
  for (const v of filtered) {
    const nome = v.produto || '(Sem produto)'
    if (!byProduto[nome]) byProduto[nome] = { fat: 0, rec: 0, vendas: new Set() }
    byProduto[nome].fat += Number(v.faturamento) || 0
    byProduto[nome].rec += Number(v.receitas) || 0
    byProduto[nome].vendas.add(v.venda_numero)
  }

  return Object.entries(byProduto)
    .map(([produto, data]) => ({
      produto,
      faturamento: data.fat,
      receitas: data.rec,
      nVendas: data.vendas.size,
      ticketMedio: data.vendas.size > 0 ? data.fat / data.vendas.size : 0,
    }))
    .sort((a, b) => b.faturamento - a.faturamento)
    .slice(0, limit)
}

// =============================================================
// Séries de evolução (mensal e semanal)
// =============================================================

const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

export function calcMonthlySeries(
  vendas: VendaKPI[],
  metas: Meta[]
): TrendSeries {
  // Agrupar vendas por YYYY-MM e setor
  const byMonthSetor: Record<string, Record<string, { fat: number; rec: number; vendas: Set<number> }>> = {}

  for (const v of vendas) {
    const ym = v.data_venda.substring(0, 7) // "YYYY-MM"
    if (!byMonthSetor[ym]) byMonthSetor[ym] = {}
    const setor = v.setor_grupo
    if (!byMonthSetor[ym][setor]) byMonthSetor[ym][setor] = { fat: 0, rec: 0, vendas: new Set() }
    byMonthSetor[ym][setor].fat += Number(v.faturamento) || 0
    byMonthSetor[ym][setor].rec += Number(v.receitas) || 0
    byMonthSetor[ym][setor].vendas.add(v.venda_numero)
  }

  // Mapa de metas: "YYYY-MM|SETOR" → fat_meta
  const metaMap: Record<string, number> = {}
  for (const m of metas) {
    const key = `${m.ano}-${pad(m.mes)}|${m.setor_grupo}`
    metaMap[key] = m.fat_meta
  }

  // Construir pontos por setor
  const months = Object.keys(byMonthSetor).sort()

  function buildPoints(setores: string[]): TrendPoint[] {
    return months.map((ym) => {
      const mesNum = Number(ym.split('-')[1])
      const data = byMonthSetor[ym] || {}

      let fatRealizado = 0
      let receita = 0
      const vendasSet = new Set<number>()
      let fatMeta = 0

      for (const setor of setores) {
        const s = data[setor]
        if (s) {
          fatRealizado += s.fat
          receita += s.rec
          s.vendas.forEach((vn) => vendasSet.add(vn))
        }
        fatMeta += metaMap[`${ym}|${setor}`] || 0
      }

      return {
        label: MESES_PT[mesNum - 1] || ym,
        fatRealizado,
        fatMeta,
        receita,
        nVendas: vendasSet.size,
      }
    })
  }

  return {
    tipo: 'mensal' as const,
    total: buildPoints(['CORP', 'TRIPS', 'WEDDINGS']),
    corp: buildPoints(['CORP']),
    trips: buildPoints(['TRIPS']),
    weddings: buildPoints(['WEDDINGS']),
  }
}

export function calcWeeklySeries(
  vendas: VendaKPI[],
  metas: Meta[]
): TrendSeries {
  // Agrupar por semana ISO: "YYYY-WNN"
  const byWeekSetor: Record<string, Record<string, { fat: number; rec: number; vendas: Set<number> }>> = {}

  for (const v of vendas) {
    const wk = getISOWeek(v.data_venda)
    const ano = v.data_venda.substring(0, 4)
    const bucket = `${ano}-W${pad(wk)}`
    if (!byWeekSetor[bucket]) byWeekSetor[bucket] = {}
    const setor = v.setor_grupo
    if (!byWeekSetor[bucket][setor]) byWeekSetor[bucket][setor] = { fat: 0, rec: 0, vendas: new Set() }
    byWeekSetor[bucket][setor].fat += Number(v.faturamento) || 0
    byWeekSetor[bucket][setor].rec += Number(v.receitas) || 0
    byWeekSetor[bucket][setor].vendas.add(v.venda_numero)
  }

  // Distribuir metas mensais pelas semanas do mês
  const metaMap: Record<string, number> = {}
  for (const m of metas) {
    const lastDay = new Date(m.ano, m.mes, 0).getDate()
    const weeks = new Set<number>()
    for (let d = 1; d <= lastDay; d++) {
      weeks.add(getISOWeek(`${m.ano}-${pad(m.mes)}-${pad(d)}`))
    }
    const weeklyMeta = weeks.size > 0 ? m.fat_meta / weeks.size : 0
    weeks.forEach((wk) => {
      metaMap[`${m.ano}-W${pad(wk)}|${m.setor_grupo}`] = weeklyMeta
    })
  }

  const buckets = Object.keys(byWeekSetor).sort()

  function buildPoints(setores: string[]): TrendPoint[] {
    return buckets.map((bucket) => {
      const data = byWeekSetor[bucket] || {}
      let fatRealizado = 0
      let receita = 0
      const vendasSet = new Set<number>()
      let fatMeta = 0

      for (const setor of setores) {
        const s = data[setor]
        if (s) {
          fatRealizado += s.fat
          receita += s.rec
          s.vendas.forEach((vn) => vendasSet.add(vn))
        }
        fatMeta += metaMap[`${bucket}|${setor}`] || 0
      }

      return {
        label: 'S' + bucket.split('-W')[1],
        fatRealizado,
        fatMeta,
        receita,
        nVendas: vendasSet.size,
      }
    })
  }

  return {
    tipo: 'semanal' as const,
    total: buildPoints(['CORP', 'TRIPS', 'WEDDINGS']),
    corp: buildPoints(['CORP']),
    trips: buildPoints(['TRIPS']),
    weddings: buildPoints(['WEDDINGS']),
  }
}

// =============================================================
// Série diária — evolução dia a dia com acumulado vs meta
// =============================================================

export function calcDailySeries(
  vendas: VendaKPI[],
  metas: Meta[],
  inicio: string,
  fim: string
): { total: DailyTrendPoint[]; corp: DailyTrendPoint[]; trips: DailyTrendPoint[]; weddings: DailyTrendPoint[] } {
  // Gerar lista de todos os dias no range
  const days: string[] = []
  const [sy, sm, sd] = inicio.split('-').map(Number)
  const [ey, em, ed] = fim.split('-').map(Number)
  const startDate = new Date(sy, sm - 1, sd)
  const endDate = new Date(ey, em - 1, ed)
  const cursor = new Date(startDate)
  while (cursor <= endDate) {
    days.push(localDateToISO(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  // Meta mensal do período (agrupar metas em um total por setor)
  const metaTotal: Record<string, number> = {}
  for (const m of metas) {
    metaTotal[m.setor_grupo] = (metaTotal[m.setor_grupo] ?? 0) + m.fat_meta
  }

  function buildDaily(setores: string[]): DailyTrendPoint[] {
    const filtered = vendas.filter((v) => setores.includes(v.setor_grupo))

    // Agrupar por dia
    const byDay: Record<string, { fat: number; rec: number; vendas: Set<number> }> = {}
    for (const v of filtered) {
      if (!byDay[v.data_venda]) byDay[v.data_venda] = { fat: 0, rec: 0, vendas: new Set() }
      byDay[v.data_venda].fat += Number(v.faturamento) || 0
      byDay[v.data_venda].rec += Number(v.receitas) || 0
      byDay[v.data_venda].vendas.add(v.venda_numero)
    }

    // Meta total para estes setores
    let totalMeta = 0
    for (const s of setores) totalMeta += metaTotal[s] ?? 0
    // Se não tem meta por setor, tentar WT
    if (totalMeta === 0 && setores.length > 1) totalMeta = metaTotal['WT'] ?? 0

    const totalDays = days.length
    const dailyMeta = totalDays > 0 ? totalMeta / totalDays : 0

    let acumulado = 0
    return days.map((day, i) => {
      const d = byDay[day]
      const fat = d?.fat ?? 0
      acumulado += fat
      const dayNum = day.split('-')[2]

      return {
        label: dayNum,
        date: day,
        fatRealizado: fat,
        fatAcumulado: acumulado,
        metaAcumulada: dailyMeta * (i + 1),
        receita: d?.rec ?? 0,
        nVendas: d?.vendas.size ?? 0,
      }
    })
  }

  return {
    total: buildDaily(['CORP', 'TRIPS', 'WEDDINGS']),
    corp: buildDaily(['CORP']),
    trips: buildDaily(['TRIPS']),
    weddings: buildDaily(['WEDDINGS']),
  }
}

// =============================================================
// Forecast — projeção de fim de período
// =============================================================

export function calcForecast(
  realizado: number,
  meta: number,
  inicio: string,
  fim: string
): ForecastData {
  const today = localDateToISO(new Date())
  // Se o período já passou, não projetar
  const efetivo = fim < today ? fim : today
  const diasDecorridos = diffDays(inicio, efetivo)
  const diasTotal = diffDays(inicio, fim)
  const diasRestantes = Math.max(0, diasTotal - diasDecorridos)

  const ritmoAtual = diasDecorridos > 0 ? realizado / diasDecorridos : 0
  const projecao = diasRestantes > 0 ? realizado + ritmoAtual * diasRestantes : realizado

  return {
    projecao,
    ritmoAtual,
    diasRestantes,
    diasDecorridos,
    metaAtingivel: meta > 0 ? projecao >= meta : true,
  }
}

// =============================================================
// Delta — comparação com período anterior
// =============================================================

export function calcDelta(atual: number, anterior: number): DeltaData | null {
  if (anterior === 0) return null
  return {
    valor: atual - anterior,
    percentual: (atual - anterior) / anterior,
  }
}

/** Diferença em dias entre duas strings ISO "YYYY-MM-DD" */
function diffDays(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const da = new Date(ay, am - 1, ad)
  const db = new Date(by, bm - 1, bd)
  return Math.max(0, Math.round((db.getTime() - da.getTime()) / 86400000))
}

// =============================================================
// Contadores de produtos-chave
// =============================================================

const PRODUTOS_CONTRATO = ['contrato de casamento', 'pacote de casamento']

export function countContratos(vendas: VendaKPI[]): number {
  return vendas.filter(
    (v) =>
      v.setor_grupo === 'WEDDINGS' &&
      v.produto !== null &&
      PRODUTOS_CONTRATO.includes(v.produto.toLowerCase())
  ).length
}

export function countTaxas(vendas: VendaKPI[]): number {
  return vendas.filter(
    (v) =>
      v.setor_grupo === 'TRIPS' &&
      v.produto !== null &&
      v.produto.toLowerCase() === 'taxa de serviço'
  ).length
}

// =============================================================
// Subcategorias WEDDINGS
// =============================================================

/** Mapa de subcategoria label → setor_grupo para metas */
const SUBCATEGORIA_META_MAP: Record<string, SetorMeta> = {
  'WedMe': 'WEDDINGS-WEDME',
  'Weddings': 'WEDDINGS-WEDDINGS',
  'Produção': 'WEDDINGS-PRODUCAO',
  'Planejamento-WED': 'WEDDINGS-PLANEJAMENTO',
}

function calcWeddingsSubcategorias(vendas: VendaKPI[], metas: Meta[]): Record<string, SetorKPI> {
  const weddingsVendas = vendas.filter((v) => v.setor_grupo === 'WEDDINGS')

  const groups: Record<string, VendaKPI[]> = {}
  for (const v of weddingsVendas) {
    const sub = getWeddingsSubcategoria(v.setor_bruto)
    if (!groups[sub]) groups[sub] = []
    groups[sub].push(v)
  }

  // Buscar metas de subcategorias
  const getSubMeta = (sub: string): { fat: number; recPct: number } => {
    const metaSetor = SUBCATEGORIA_META_MAP[sub]
    if (!metaSetor) return { fat: 0, recPct: 0 }
    const meta = metas.find((m) => m.setor_grupo === metaSetor)
    return {
      fat: meta ? meta.fat_meta : 0,
      recPct: meta ? (meta.receita_meta_pct || 0) : 0,
    }
  }

  const result: Record<string, SetorKPI> = {}
  for (const [sub, subVendas] of Object.entries(groups)) {
    const fatRealizado = sum(subVendas, 'faturamento')
    const receita = sum(subVendas, 'receitas')
    const nVendas = countUniqueVendas(subVendas)
    const subMeta = getSubMeta(sub)

    result[sub] = {
      fatMeta: subMeta.fat,
      fatRealizado,
      percRealizado: subMeta.fat > 0 ? fatRealizado / subMeta.fat : null,
      receita,
      percReceita: fatRealizado > 0 ? receita / fatRealizado : null,
      receitaMetaPct: subMeta.recPct,
      ticketMedio: nVendas > 0 ? fatRealizado / nVendas : 0,
      nVendas,
    }
  }

  return result
}

// =============================================================
// Granularidade semanal
// =============================================================

export function calcSemanasMes(
  vendas: VendaKPI[],
  ano: number,
  mes: number
): SemanasData[] {
  const mesStr = String(mes).padStart(2, '0')
  const prefix = `${ano}-${mesStr}`
  const vendasMes = vendas.filter(
    (v) =>
      v.data_venda.startsWith(prefix) &&
      isSetorWT(v.setor_grupo)
  )

  const semanas: Map<number, VendaKPI[]> = new Map()
  for (const v of vendasMes) {
    const weekNum = getISOWeek(v.data_venda)
    if (!semanas.has(weekNum)) semanas.set(weekNum, [])
    semanas.get(weekNum)!.push(v)
  }

  const result: SemanasData[] = []
  const sortedWeeks = Array.from(semanas.keys()).sort((a, b) => a - b)

  for (const weekNum of sortedWeeks) {
    const weekVendas = semanas.get(weekNum)!
    const dates = weekVendas.map((v) => v.data_venda).sort()

    result.push({
      semana: `S${weekNum}`,
      inicio: dates[0],
      fim: dates[dates.length - 1],
      fatRealizado: sum(weekVendas, 'faturamento'),
      receita: sum(weekVendas, 'receitas'),
      nVendas: countUniqueVendas(weekVendas),
    })
  }

  return result
}

// =============================================================
// Helpers de período — retorna strings ISO, NUNCA Date
// =============================================================

/**
 * Retorna strings ISO "YYYY-MM-DD" para cada tipo de período.
 * Usa Date SOMENTE internamente para aritmética de calendário,
 * e converte de volta para string antes de retornar.
 */
export function getPeriodRange(
  periodo: string,
  inicioParam?: string,
  fimParam?: string
): { inicio: string; fim: string; label: string; meses: { ano: number; mes: number }[] } {
  // now em timezone local do server
  const now = new Date()
  const todayStr = localDateToISO(now)

  switch (periodo) {
    case 'semana-atual': {
      const day = now.getDay()
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (day === 0 ? 6 : day - 1))
      const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6)
      const inicio = localDateToISO(monday)
      const fim = localDateToISO(sunday)
      return {
        inicio,
        fim,
        label: `Semana ${getISOWeek(todayStr)}`,
        meses: [{ ano: now.getFullYear(), mes: now.getMonth() + 1 }],
      }
    }
    case 'mes-corrente': {
      const ano = now.getFullYear()
      const mes = now.getMonth() + 1
      const inicio = `${ano}-${pad(mes)}-01`
      const lastDay = new Date(ano, mes, 0).getDate()
      const fim = `${ano}-${pad(mes)}-${pad(lastDay)}`
      return {
        inicio,
        fim,
        label: now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }),
        meses: [{ ano, mes }],
      }
    }
    case 'acumulado-ano': {
      const ano = now.getFullYear()
      const inicio = `${ano}-01-01`
      const fim = todayStr
      return {
        inicio,
        fim,
        label: `Acumulado ${ano}`,
        meses: buildMesesRange(ano, 1, ano, now.getMonth() + 1),
      }
    }
    case 'custom': {
      if (!inicioParam || !fimParam) {
        throw new Error('Período customizado requer datas de início e fim.')
      }
      // Strings ISO vêm do browser (input type=date) — usar direto
      const inicio = inicioParam
      const fim = fimParam
      const label = `${formatISOtoBR(inicio)} a ${formatISOtoBR(fim)}`
      const [ai, mi] = inicio.split('-').map(Number)
      const [af, mf] = fim.split('-').map(Number)
      return {
        inicio,
        fim,
        label,
        meses: buildMesesRange(ai, mi, af, mf),
      }
    }
    default:
      throw new Error(`Período desconhecido: ${periodo}`)
  }
}

/**
 * Calcula o range expandido para o gráfico de evolução.
 * - semana-atual → últimas 10 semanas (~70 dias)
 * - mes-corrente → últimos 12 meses
 * - acumulado-ano / custom → usa o próprio range (sem expansão)
 */
export function calcTrendRange(
  periodo: string,
  inicio: string,
  fim: string
): { inicio: string; fim: string; meses: { ano: number; mes: number }[] } | null {
  if (periodo === 'semana-atual') {
    // Últimas 10 semanas antes do fim
    const [fy, fm, fd] = fim.split('-').map(Number)
    const inicioDate = new Date(fy, fm - 1, fd - 69) // 10 semanas = 70 dias
    const trendInicio = localDateToISO(inicioDate)
    const trendFim = fim
    const [ai, mi] = trendInicio.split('-').map(Number)
    const [af, mf] = trendFim.split('-').map(Number)
    return {
      inicio: trendInicio,
      fim: trendFim,
      meses: buildMesesRange(ai, mi, af, mf),
    }
  }
  if (periodo === 'mes-corrente') {
    // Últimos 12 meses antes do fim
    const [fy, fm] = fim.split('-').map(Number)
    const inicioDate = new Date(fy - 1, fm - 1, 1) // 12 meses atrás, dia 1
    const trendInicio = localDateToISO(inicioDate)
    const trendFim = fim
    const ai = inicioDate.getFullYear()
    const mi = inicioDate.getMonth() + 1
    return {
      inicio: trendInicio,
      fim: trendFim,
      meses: buildMesesRange(ai, mi, fy, fm),
    }
  }
  // acumulado-ano e custom: usar o range original (não expandir)
  return null
}

/**
 * Calcula o período anterior equivalente para comparação (delta).
 * - mes-corrente → mês anterior
 * - semana-atual → semana anterior
 * - acumulado-ano → mesmo período do ano anterior
 * - custom → mesmo duração deslocada para trás
 */
export function getPreviousPeriodRange(
  periodo: string,
  inicio: string,
  fim: string
): { inicio: string; fim: string } | null {
  const [iy, im, id] = inicio.split('-').map(Number)
  const [fy, fm, fd] = fim.split('-').map(Number)

  switch (periodo) {
    case 'mes-corrente': {
      // Mês anterior
      const prevDate = new Date(iy, im - 2, 1) // mês anterior, dia 1
      const prevLast = new Date(prevDate.getFullYear(), prevDate.getMonth() + 1, 0)
      return {
        inicio: localDateToISO(prevDate),
        fim: localDateToISO(prevLast),
      }
    }
    case 'semana-atual': {
      // Semana anterior (7 dias antes)
      const prevInicio = new Date(iy, im - 1, id - 7)
      const prevFim = new Date(fy, fm - 1, fd - 7)
      return {
        inicio: localDateToISO(prevInicio),
        fim: localDateToISO(prevFim),
      }
    }
    case 'acumulado-ano': {
      // Mesmo período do ano anterior
      return {
        inicio: `${iy - 1}-${pad(im)}-${pad(id)}`,
        fim: `${fy - 1}-${pad(fm)}-${pad(fd)}`,
      }
    }
    case 'custom': {
      // Mesma duração, deslocada para trás
      const duracao = diffDays(inicio, fim)
      const prevFim = new Date(iy, im - 1, id - 1) // dia antes do início atual
      const prevInicio = new Date(prevFim.getFullYear(), prevFim.getMonth(), prevFim.getDate() - duracao)
      return {
        inicio: localDateToISO(prevInicio),
        fim: localDateToISO(prevFim),
      }
    }
    default:
      return null
  }
}

// =============================================================
// Utilitários internos — NUNCA exportar Date objects
// =============================================================

function sum(vendas: VendaKPI[], field: 'faturamento' | 'receitas' | 'valor_total'): number {
  return vendas.reduce((acc, v) => acc + (Number(v[field]) || 0), 0)
}

function countUniqueVendas(vendas: VendaKPI[]): number {
  return new Set(vendas.map((v) => v.venda_numero)).size
}

/** Converte Date local para string "YYYY-MM-DD" sem timezone shift */
function localDateToISO(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** "YYYY-MM-DD" → "DD/MM/YYYY" */
function formatISOtoBR(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/** Calcula semana ISO a partir de string "YYYY-MM-DD" */
function getISOWeek(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

/** Gera lista de {ano, mes} entre dois pontos */
function buildMesesRange(
  anoInicio: number, mesInicio: number,
  anoFim: number, mesFim: number
): { ano: number; mes: number }[] {
  const result: { ano: number; mes: number }[] = []
  let ano = anoInicio
  let mes = mesInicio
  while (ano < anoFim || (ano === anoFim && mes <= mesFim)) {
    result.push({ ano, mes })
    mes++
    if (mes > 12) { mes = 1; ano++ }
  }
  return result
}
