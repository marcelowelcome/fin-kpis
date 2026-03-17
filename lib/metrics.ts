import type {
  Venda,
  Meta,
  SetorKPI,
  TripsKPI,
  WeddingsKPI,
  DashboardData,
  SemanasData,
  SetorGrupo,
  SetorMeta,
} from '@/lib/schemas'
import { METAS_WT_AUTO, SETORES_WT } from '@/lib/schemas'
import { isSetorWT, getWeddingsSubcategoria } from '@/lib/setor-mapper'

// =============================================================
// KPI por setor
// =============================================================

/**
 * Calcula KPIs de um ou mais setores para um conjunto de vendas.
 *
 * @param vendas - Vendas já filtradas por período
 * @param meta - Valor da meta de faturamento
 * @param setorGrupos - Um ou mais setores a incluir
 */
export function calcSetorKPI(
  vendas: Venda[],
  meta: number,
  setorGrupos: SetorGrupo | SetorGrupo[]
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
    ticketMedio: nVendas > 0 ? fatRealizado / nVendas : 0,
    nVendas,
  }
}

// =============================================================
// Dashboard completo
// =============================================================

/**
 * Calcula todos os KPIs do dashboard para um período.
 *
 * @param vendas - Todas as vendas do banco (serão filtradas por período)
 * @param metas - Metas do período
 * @param periodo - Datas de início e fim
 */
export function calcDashboard(
  vendas: Venda[],
  metas: Meta[],
  periodo: { inicio: Date; fim: Date }
): DashboardData {
  // Filtrar vendas por período
  const inicioStr = toISODate(periodo.inicio)
  const fimStr = toISODate(periodo.fim)
  const vendasPeriodo = vendas.filter(
    (v) => v.data_venda >= inicioStr && v.data_venda <= fimStr
  )

  // Resolver metas por setor
  const getMeta = (setor: SetorMeta): number => {
    const meta = metas.find((m) => m.setor_grupo === setor)
    return meta ? meta.fat_meta : 0
  }

  // KPIs por setor
  const corp = calcSetorKPI(vendasPeriodo, getMeta('CORP'), 'CORP')
  const trips: TripsKPI = {
    ...calcSetorKPI(vendasPeriodo, getMeta('TRIPS'), 'TRIPS'),
    nTaxas: countTaxas(vendasPeriodo),
  }
  const weddings: WeddingsKPI = {
    ...calcSetorKPI(vendasPeriodo, getMeta('WEDDINGS'), 'WEDDINGS'),
    nContratos: countContratos(vendasPeriodo),
    subcategorias: calcWeddingsSubcategorias(vendasPeriodo),
  }

  // WT consolidado
  const wtMeta = METAS_WT_AUTO
    ? getMeta('CORP') + getMeta('TRIPS') + getMeta('WEDDINGS')
    : getMeta('WT')

  const consolidado = calcSetorKPI(
    vendasPeriodo,
    wtMeta,
    SETORES_WT as unknown as SetorGrupo[]
  )

  // Última atualização
  const ultimaAtualizacao = vendas.length > 0
    ? vendas.reduce((latest, v) =>
        v.updated_at > latest ? v.updated_at : latest,
        vendas[0].updated_at
      )
    : null

  return {
    periodo: {
      inicio: inicioStr,
      fim: fimStr,
      label: buildPeriodLabel(periodo.inicio, periodo.fim),
    },
    consolidado,
    corp,
    trips,
    weddings,
    ultimaAtualizacao,
  }
}

// =============================================================
// Contadores de produtos-chave
// =============================================================

const PRODUTOS_CONTRATO = ['contrato de casamento', 'pacote de casamento']

/**
 * Conta contratos WEDDINGS: produto IN ('Contrato de Casamento', 'Pacote de Casamento')
 */
export function countContratos(vendas: Venda[]): number {
  return vendas.filter(
    (v) =>
      v.setor_grupo === 'WEDDINGS' &&
      v.produto !== null &&
      PRODUTOS_CONTRATO.includes(v.produto.toLowerCase())
  ).length
}

/**
 * Conta taxas de serviço TRIPS: produto = 'Taxa de Serviço' AND setor_grupo = 'TRIPS'
 */
export function countTaxas(vendas: Venda[]): number {
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

function calcWeddingsSubcategorias(vendas: Venda[]): Record<string, SetorKPI> {
  const weddingsVendas = vendas.filter((v) => v.setor_grupo === 'WEDDINGS')

  // Agrupar por subcategoria
  const groups: Record<string, Venda[]> = {}
  for (const v of weddingsVendas) {
    const sub = getWeddingsSubcategoria(v.setor_bruto)
    if (!groups[sub]) groups[sub] = []
    groups[sub].push(v)
  }

  // Calcular KPI para cada subcategoria (sem metas individuais)
  const result: Record<string, SetorKPI> = {}
  for (const [sub, subVendas] of Object.entries(groups)) {
    const fatRealizado = sum(subVendas, 'faturamento')
    const receita = sum(subVendas, 'receitas')
    const nVendas = countUniqueVendas(subVendas)

    result[sub] = {
      fatMeta: 0,
      fatRealizado,
      percRealizado: null,
      receita,
      percReceita: fatRealizado > 0 ? receita / fatRealizado : null,
      ticketMedio: nVendas > 0 ? fatRealizado / nVendas : 0,
      nVendas,
    }
  }

  return result
}

// =============================================================
// Granularidade semanal
// =============================================================

/**
 * Agrupa vendas do mês em semanas ISO.
 */
export function calcSemanasMes(
  vendas: Venda[],
  ano: number,
  mes: number
): SemanasData[] {
  // Filtrar vendas do mês
  const mesStr = String(mes).padStart(2, '0')
  const prefix = `${ano}-${mesStr}`
  const vendasMes = vendas.filter(
    (v) =>
      v.data_venda.startsWith(prefix) &&
      isSetorWT(v.setor_grupo)
  )

  // Agrupar por semana ISO
  const semanas: Map<number, Venda[]> = new Map()
  for (const v of vendasMes) {
    const weekNum = getISOWeek(new Date(v.data_venda))
    if (!semanas.has(weekNum)) semanas.set(weekNum, [])
    semanas.get(weekNum)!.push(v)
  }

  // Converter para SemanasData
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
// Helpers de período
// =============================================================

/**
 * Calcula datas de início/fim para cada tipo de período.
 */
export function getPeriodDates(
  periodo: string,
  inicio?: string,
  fim?: string
): { inicio: Date; fim: Date; label: string } {
  const now = new Date()

  switch (periodo) {
    case 'semana-atual': {
      const day = now.getDay()
      const monday = new Date(now)
      monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1))
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      return {
        inicio: startOfDay(monday),
        fim: endOfDay(sunday),
        label: `Semana ${getISOWeek(now)}`,
      }
    }
    case 'mes-corrente': {
      const first = new Date(now.getFullYear(), now.getMonth(), 1)
      const last = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      return {
        inicio: startOfDay(first),
        fim: endOfDay(last),
        label: formatMonth(now),
      }
    }
    case 'acumulado-ano': {
      const janFirst = new Date(now.getFullYear(), 0, 1)
      return {
        inicio: startOfDay(janFirst),
        fim: endOfDay(now),
        label: `Acumulado ${now.getFullYear()}`,
      }
    }
    case 'custom': {
      if (!inicio || !fim) {
        throw new Error('Período customizado requer datas de início e fim.')
      }
      return {
        inicio: startOfDay(new Date(inicio)),
        fim: endOfDay(new Date(fim)),
        label: `${formatDate(new Date(inicio))} a ${formatDate(new Date(fim))}`,
      }
    }
    default:
      throw new Error(`Período desconhecido: ${periodo}`)
  }
}

// =============================================================
// Utilitários internos
// =============================================================

function sum(vendas: Venda[], field: 'faturamento' | 'receitas' | 'valor_total'): number {
  return vendas.reduce((acc, v) => acc + (v[field] ?? 0), 0)
}

function countUniqueVendas(vendas: Venda[]): number {
  return new Set(vendas.map((v) => v.venda_numero)).size
}

function getISOWeek(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

function toISODate(date: Date): string {
  return date.toISOString().split('T')[0]
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function endOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999)
}

function formatMonth(date: Date): string {
  return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function buildPeriodLabel(inicio: Date, fim: Date): string {
  return `${formatDate(inicio)} a ${formatDate(fim)}`
}
