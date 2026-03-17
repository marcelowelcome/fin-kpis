import { z } from 'zod'

// =============================================================
// Tipos base — Setores
// =============================================================

export const SETOR_GRUPOS = ['CORP', 'TRIPS', 'WEDDINGS', 'OUTROS', 'INDEFINIDO'] as const
export type SetorGrupo = (typeof SETOR_GRUPOS)[number]

export const SETOR_METAS = ['CORP', 'TRIPS', 'WEDDINGS', 'WT'] as const
export type SetorMeta = (typeof SETOR_METAS)[number]

/** Labels de exibição em pt-BR para cada setor */
export const SETOR_LABELS: Record<SetorGrupo | 'WT', string> = {
  CORP: 'Corporativo',
  TRIPS: 'Lazer & Expedições',
  WEDDINGS: 'Weddings',
  OUTROS: 'Outros',
  INDEFINIDO: 'Indefinido',
  WT: 'Welcome Trips',
}

/** Setores que compõem o consolidado WT (participam de metas) */
export const SETORES_WT: SetorGrupo[] = ['CORP', 'TRIPS', 'WEDDINGS']

/** Se true, meta WT = soma(CORP + TRIPS + WEDDINGS). Se false, usa meta manual. */
export const METAS_WT_AUTO = true

// =============================================================
// Colunas obrigatórias do Excel
// =============================================================

export const COLUNAS_OBRIGATORIAS = [
  'Venda Nº',
  'Vendedor',
  'Data Venda',
  'Pagante',
  'Setor',
  'Produto',
  'Valor Total',
  'Receitas',
  'Faturamento',
] as const

// =============================================================
// Entidades do banco
// =============================================================

export interface Venda {
  id: number // BIGINT auto-incremento (PK)
  venda_numero: number // Nº do pedido (não único por linha — um pedido pode ter N itens)
  vendedor: string
  data_venda: string // ISO date string (YYYY-MM-DD)
  pagante: string
  setor_bruto: string | null
  setor_grupo: SetorGrupo
  produto: string | null
  fornecedor: string | null
  representante: string | null
  valor_total: number
  receitas: number
  faturamento: number
  upload_id: string
  updated_at: string
}

/** Dados de venda prontos para upsert (sem updated_at) */
export interface VendaInput {
  venda_numero: number
  vendedor: string
  data_venda: string
  pagante: string
  setor_bruto: string | null
  setor_grupo: SetorGrupo
  produto: string | null
  fornecedor: string | null
  representante: string | null
  valor_total: number
  receitas: number
  faturamento: number
}

export interface Upload {
  id: string
  nome_arquivo: string
  uploaded_at: string
  total_linhas: number
  linhas_inseridas: number
  linhas_atualizadas: number
  alertas_qualidade: QualityAlert[]
  status: 'success' | 'warning' | 'error'
}

export interface Meta {
  id: string
  ano: number
  mes: number
  setor_grupo: SetorMeta
  fat_meta: number
  updated_at: string
}

// =============================================================
// Qualidade de dados
// =============================================================

export const ALERTA_TIPOS = [
  'SETOR_NULO',
  'VALOR_NEGATIVO',
  'LINHA_NULA',
  'DUPLICATA_INTERNA',
  'SETOR_OUTROS',
  'FATURAMENTO_ZERO',
] as const
export type AlertaTipo = (typeof ALERTA_TIPOS)[number]

export const ALERTA_SEVERIDADES = ['CRITICO', 'ATENCAO', 'AVISO', 'INFO'] as const
export type AlertaSeveridade = (typeof ALERTA_SEVERIDADES)[number]

export interface QualityAlert {
  tipo: AlertaTipo
  severidade: AlertaSeveridade
  quantidade: number
  descricao: string
  linhas_afetadas?: number[]
}

export interface QualityBreakdown {
  totalLinhas: number
  setorNulo: number
  valorNegativo: number
  linhaNula: number
  duplicataInterna: number
  setorOutros: number
  faturamentoZero: number
}

// =============================================================
// KPIs
// =============================================================

export interface SetorKPI {
  fatMeta: number
  fatRealizado: number
  percRealizado: number | null
  receita: number
  percReceita: number | null
  ticketMedio: number
  nVendas: number
}

export interface TripsKPI extends SetorKPI {
  nTaxas: number
}

export interface WeddingsKPI extends SetorKPI {
  nContratos: number
  subcategorias: Record<string, SetorKPI>
}

export interface DashboardData {
  periodo: { inicio: string; fim: string; label: string }
  consolidado: SetorKPI // WT
  corp: SetorKPI
  trips: TripsKPI
  weddings: WeddingsKPI
  ultimaAtualizacao: string | null
}

export interface SemanasData {
  semana: string // "S10", "S11" etc.
  inicio: string
  fim: string
  fatRealizado: number
  receita: number
  nVendas: number
}

// =============================================================
// Respostas da API
// =============================================================

export interface UploadResponse {
  uploadId: string
  totalLinhas: number
  inseridas: number
  atualizadas: number
  alertas: QualityAlert[]
  score: number
  status: 'success' | 'warning' | 'error'
}

export interface DashboardResponse {
  data: DashboardData
}

export interface ApiError {
  error: {
    code: string
    message: string
  }
}

// =============================================================
// Schemas Zod — Validação
// =============================================================

export const VendaExcelSchema = z.object({
  'Venda Nº': z.number({ error: 'Venda Nº é obrigatório' }),
  Vendedor: z.string().min(1, 'Vendedor é obrigatório'),
  'Data Venda': z.union([z.string(), z.number(), z.date()]),
  Pagante: z.string().min(1, 'Pagante é obrigatório'),
  Setor: z.string().nullable().optional(),
  Produto: z.string().nullable().optional(),
  Fornecedor: z.string().nullable().optional(),
  Representante: z.string().nullable().optional(),
  'Valor Total': z.number({ error: 'Valor Total é obrigatório' }),
  Receitas: z.number().default(0),
  Faturamento: z.number().default(0),
})

export type VendaExcelRow = z.infer<typeof VendaExcelSchema>

export const MetaInputSchema = z.object({
  ano: z.number().int().min(2020).max(2050),
  mes: z.number().int().min(1).max(12),
  setor_grupo: z.enum(['CORP', 'TRIPS', 'WEDDINGS', 'WT']),
  fat_meta: z.number().min(0),
})

export type MetaInput = z.infer<typeof MetaInputSchema>

// =============================================================
// Parse result do Excel
// =============================================================

export interface ParseResult {
  rows: VendaInput[]
  alerts: QualityAlert[]
  totalLinhas: number
  score: number
}
