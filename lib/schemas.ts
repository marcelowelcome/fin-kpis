import { z } from 'zod'

// =============================================================
// Tipos base — Setores
// =============================================================

export const SETOR_GRUPOS = ['CORP', 'TRIPS', 'WEDDINGS', 'OUTROS', 'INDEFINIDO'] as const
export type SetorGrupo = (typeof SETOR_GRUPOS)[number]

export const SETOR_METAS = [
  'CORP', 'TRIPS', 'WEDDINGS', 'WT',
  'WEDDINGS-WEDME', 'WEDDINGS-PRODUCAO', 'WEDDINGS-PLANEJAMENTO', 'WEDDINGS-WEDDINGS',
] as const
export type SetorMeta = (typeof SETOR_METAS)[number]

/** Setores principais para a tabela de metas */
export const SETOR_METAS_PRINCIPAIS = ['CORP', 'TRIPS', 'WEDDINGS', 'WT'] as const
export type SetorMetaPrincipal = (typeof SETOR_METAS_PRINCIPAIS)[number]

/** Subcategorias de Weddings para metas */
export const WEDDINGS_SUBCATEGORIAS_METAS: { id: SetorMeta; label: string }[] = [
  { id: 'WEDDINGS-WEDME', label: 'Hospedagem' },
  { id: 'WEDDINGS-WEDDINGS', label: 'Extras Conv.' },
  { id: 'WEDDINGS-PRODUCAO', label: 'Produção' },
  { id: 'WEDDINGS-PLANEJAMENTO', label: 'Planejamento-WED' },
]

/** Labels de exibição em pt-BR para cada setor */
export const SETOR_LABELS: Record<SetorGrupo | 'WT', string> = {
  CORP: 'Corporativo',
  TRIPS: 'Lazer & Expedições',
  WEDDINGS: 'Weddings',
  OUTROS: 'Outros',
  INDEFINIDO: 'Indefinido',
  WT: 'Welcome Group',
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
] as const

/** Colunas opcionais — presentes em exports mais recentes */
export const COLUNAS_OPCIONAIS = ['Situação', 'Situacao'] as const

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
  operacao: string | null // "Operação Própria" do Monde (ex.: casal "W - Fulano e Beltrana")
  valor_total: number
  receitas: number
  faturamento: number
  situacao: string | null // 'Aberta' ou 'Fechada'
  upload_id: string
  updated_at: string
}

/** Campos mínimos de venda para cálculo de KPIs (sem texto pesado) */
export interface VendaKPI {
  id: number
  venda_numero: number
  vendedor: string
  data_venda: string
  setor_bruto: string | null
  setor_grupo: SetorGrupo
  produto: string | null
  operacao: string | null
  valor_total: number
  receitas: number
  faturamento: number
  situacao: string | null
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
  operacao: string | null
  valor_total: number
  receitas: number
  faturamento: number
  situacao: string | null // 'Aberta' ou 'Fechada'
  /** Data de cancelamento do produto (ISO). Não-nulo = cancelado → fora dos KPIs. */
  data_cancelamento: string | null
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
  receita_meta_pct: number // ex: 0.14 = 14%
  updated_at: string
}

// =============================================================
// Metas por Vendedor (vendor_goals)
// =============================================================

export const TIPO_META_OPTIONS = ['valor_total', 'receita'] as const
export type TipoMeta = (typeof TIPO_META_OPTIONS)[number]

export const TIPO_META_LABELS: Record<TipoMeta, string> = {
  valor_total: 'Valor Total',
  receita: 'Receita',
}

export interface VendorGoal {
  id: string
  ano: number
  mes: number
  vendedor: string
  fat_meta: number
  receita_meta_pct: number  // ex: 0.14 = 14%
  tipo_meta: TipoMeta       // 'valor_total' ou 'receita'
  nivel_meta: 1 | 2 | 3    // 1=Meta1, 2=Meta2, 3=Meta3
  updated_at: string
}

export const VendorGoalInputSchema = z.object({
  ano: z.number().int().min(2020).max(2050),
  mes: z.number().int().min(1).max(12),
  vendedor: z.string().min(1, 'Vendedor é obrigatório'),
  fat_meta: z.number().min(0),
  receita_meta_pct: z.number().min(0).max(1).default(0),
  tipo_meta: z.enum(['valor_total', 'receita']).default('valor_total'),
  nivel_meta: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
})

export type VendorGoalInput = z.infer<typeof VendorGoalInputSchema>

// =============================================================
// Qualidade de dados
// =============================================================

export const ALERTA_TIPOS = [
  'SETOR_NULO',
  'VALOR_NEGATIVO',
  'LINHA_NULA',
  'DUPLICATA_INTERNA',
  'SETOR_OUTROS',
  // Alertas do monitor de qualidade do SYNC (API Monde), não do upload de Excel —
  // ver lib/sync-quality.ts.
  //
  // Os quatro primeiros nasceram como "problemas conhecidos" (campos que a API do Monde
  // parou de preencher). Desde 2026-08-27 os feeds planos entregam todos resolvidos e o
  // esperado é ZERO em cada um: agora eles funcionam como ALARME DE REGRESSÃO — se
  // acenderem, a API voltou a omitir dado.
  'PRODUTO_NULO',
  'FORNECEDOR_NULO',
  'CONTRATO_SEM_OPERACAO',
  'VENDEDOR_AUSENTE',
  // Alarmes de divergência banco × API, montados sobre os sinais que a equipe da API
  // expôs em 2026-08-27 (`total` nas listagens e `synced_at` como frescor).
  'CANCELADA_NO_BANCO',
  'DIVERGENCIA_API',
  'ESPELHO_ATRASADO',
] as const
export type AlertaTipo = (typeof ALERTA_TIPOS)[number]

export const ALERTA_SEVERIDADES = ['CRITICO', 'ATENCAO', 'AVISO', 'INFO'] as const
export type AlertaSeveridade = (typeof ALERTA_SEVERIDADES)[number]

export interface QualityAlertExemplo {
  venda_numero: number
  vendedor: string
  produto: string | null
  valor: number // faturamento ou valor_total, conforme o contexto
  detalhe: string // descrição curta do problema nesta linha
}

export interface QualityAlert {
  tipo: AlertaTipo
  severidade: AlertaSeveridade
  quantidade: number
  descricao: string
  linhas_afetadas?: number[]
  exemplos?: QualityAlertExemplo[] // até 5 exemplos concretos
}

export interface QualityBreakdown {
  totalLinhas: number
  setorNulo: number
  valorNegativo: number
  linhaNula: number
  duplicataInterna: number
  setorOutros: number
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
  receitaMetaPct: number    // meta de % receita (ex: 0.14 = 14%)
  ticketMedio: number
  nVendas: number
  /**
   * Split do faturamento por origem (só usado no card Hospedagem, que soma
   * Diária de Hospedagem dos setores WedMe + Weddings). % sobre o faturamento.
   */
  split?: { wedmePct: number; weddingsPct: number }
}

export interface TripsKPI extends SetorKPI {
  nTaxas: number
  taxasDetalhes: VendaKPI[]
}

export interface WeddingsKPI extends SetorKPI {
  nContratos: number
  contratosDetalhes: VendaKPI[]
  subcategorias: Record<string, SetorKPI>
}

export interface PipelineData {
  aberta: { count: number; valor: number }
  fechada: { count: number; valor: number }
  taxaConversao: number | null // fechada / total
}

export interface VendedorRanking {
  vendedor: string
  faturamento: number
  receitas: number
  nVendas: number
  ticketMedio: number
  fatMeta?: number | null       // M1 — meta base
  metaM2?: number | null        // M2
  metaM3?: number | null        // M3
  percRealizado?: number | null // receitas / fatMeta (M1)
  tipoMeta?: string | null      // 'valor_total' ou 'receita'
}

export interface ProdutoRanking {
  produto: string
  faturamento: number
  receitas: number
  nVendas: number
  ticketMedio: number
}

export interface TrendPoint {
  label: string      // "Jan", "S10", etc.
  fatRealizado: number
  fatMeta: number
  receita: number
  nVendas: number
}

export interface TrendSeries {
  tipo: 'mensal' | 'semanal'
  total: TrendPoint[]
  corp: TrendPoint[]
  trips: TrendPoint[]
  weddings: TrendPoint[]
}

export interface DailyTrendPoint {
  label: string      // "01", "02", ... or "01/Mar"
  date: string       // "YYYY-MM-DD"
  fatRealizado: number
  fatAcumulado: number
  metaAcumulada: number
  receita: number
  nVendas: number
}

export interface ForecastData {
  projecao: number
  ritmoAtual: number
  diasRestantes: number
  diasDecorridos: number
  metaAtingivel: boolean
  /** Meta usada no cálculo do ritmo — normalmente = fatMeta do card, mas em
   *  "acumulado-ano" é a META ANUAL cheia (não o acumulado até hoje). */
  metaBase: number
}

export interface DeltaData {
  valor: number
  percentual: number
}

export interface DashboardData {
  periodo: { inicio: string; fim: string; label: string }
  consolidado: SetorKPI // WT
  corp: SetorKPI
  trips: TripsKPI
  weddings: WeddingsKPI
  pipeline: {
    total: PipelineData
    corp: PipelineData
    trips: PipelineData
    weddings: PipelineData
  }
  topVendedores: {
    total: VendedorRanking[]
    corp: VendedorRanking[]
    trips: VendedorRanking[]
    weddings: VendedorRanking[]
  }
  forecast: {
    total: ForecastData
    corp: ForecastData
    trips: ForecastData
    weddings: ForecastData
  }
  topProdutos: {
    total: ProdutoRanking[]
    corp: ProdutoRanking[]
    trips: ProdutoRanking[]
    weddings: ProdutoRanking[]
  }
  trend: TrendSeries
  dailyTrend?: {
    total: DailyTrendPoint[]
    corp: DailyTrendPoint[]
    trips: DailyTrendPoint[]
    weddings: DailyTrendPoint[]
  } | null
  delta: {
    consolidado: DeltaData | null
    corp: DeltaData | null
    trips: DeltaData | null
    weddings: DeltaData | null
  } | null
  deltaLabel: string | null  // "vs mesmo período ano anterior", "vs semana anterior", etc.
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
  'Situação': z.string().nullable().optional(),
})

export type VendaExcelRow = z.infer<typeof VendaExcelSchema>

export const MetaInputSchema = z.object({
  ano: z.number().int().min(2020).max(2050),
  mes: z.number().int().min(1).max(12),
  setor_grupo: z.enum([
    'CORP', 'TRIPS', 'WEDDINGS', 'WT',
    'WEDDINGS-WEDME', 'WEDDINGS-PRODUCAO', 'WEDDINGS-PLANEJAMENTO', 'WEDDINGS-WEDDINGS',
  ]),
  fat_meta: z.number().min(0),
  receita_meta_pct: z.number().min(0).max(1).default(0),
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

// =============================================================
// Auditoria de receitas (Admin → Auditoria)
// Espelho de TIPOS / MOTIVOS em supabase/functions/auditoria-receitas/motor.ts:
// mudou lá, mude aqui.
// =============================================================

/** O que mudou na venda (fato tirado da comparação entre duas conferências). */
export const AUDITORIA_TIPOS = [
  'VENDA_CANCELADA', 'CANCELAMENTO_MANUAL', 'VENDA_EXCLUIDA', 'PRODUTOS_CANCELADOS',
  'PRODUTO_CANCELADO', 'PRODUTO_INCLUIDO', 'TROCA_PRODUTO', 'ALTERACAO_VALOR',
  'AJUSTE_RECEITA', 'MUDANCA_DATA', 'MUDANCA_VENDEDOR', 'MUDANCA_SETOR',
  'RECLASSIFICACAO_PRODUTO', 'VENDA_REABERTA', 'VENDA_REFECHADA', 'FECHAMENTO_TARDIO',
  'LANCAMENTO_RETROATIVO', 'VENDA_REATIVADA', 'DIVERGENCIA_SYNC',
] as const
export type AuditoriaTipo = (typeof AUDITORIA_TIPOS)[number]

export const AUDITORIA_TIPO_LABELS: Record<AuditoriaTipo, string> = {
  VENDA_CANCELADA: 'Venda cancelada',
  CANCELAMENTO_MANUAL: 'Cancelamento manual',
  VENDA_EXCLUIDA: 'Venda excluída',
  PRODUTOS_CANCELADOS: 'Todos os produtos cancelados',
  PRODUTO_CANCELADO: 'Produto cancelado',
  PRODUTO_INCLUIDO: 'Produto incluído',
  TROCA_PRODUTO: 'Troca de produto',
  ALTERACAO_VALOR: 'Valor alterado',
  AJUSTE_RECEITA: 'Receita ajustada',
  MUDANCA_DATA: 'Data alterada',
  MUDANCA_VENDEDOR: 'Vendedor alterado',
  MUDANCA_SETOR: 'Setor alterado',
  RECLASSIFICACAO_PRODUTO: 'Produto reclassificado',
  VENDA_REABERTA: 'Venda reaberta',
  VENDA_REFECHADA: 'Venda fechada de novo',
  FECHAMENTO_TARDIO: 'Fechamento tardio',
  LANCAMENTO_RETROATIVO: 'Lançamento retroativo',
  VENDA_REATIVADA: 'Venda reativada',
  DIVERGENCIA_SYNC: 'Divergência do sync',
}

/** Por que mudou (hipótese sugerida pelo motor e confirmada/corrigida na revisão). */
export const AUDITORIA_MOTIVOS = [
  'CANCELAMENTO_CLIENTE', 'REMARCACAO_REEMISSAO', 'AJUSTE_COMISSAO', 'DESCONTO_NEGOCIACAO',
  'TAXA_FEE', 'VARIACAO_CAMBIAL', 'CORRECAO_LANCAMENTO', 'DUPLICIDADE',
  'VENDA_COMPLEMENTAR', 'REATRIBUICAO', 'LANCAMENTO_ATRASADO', 'FALHA_INTEGRACAO', 'OUTRO',
] as const
export type AuditoriaMotivo = (typeof AUDITORIA_MOTIVOS)[number]

export const AUDITORIA_MOTIVO_LABELS: Record<AuditoriaMotivo, string> = {
  CANCELAMENTO_CLIENTE: 'Cancelamento / desistência do cliente',
  REMARCACAO_REEMISSAO: 'Remarcação, troca ou reemissão',
  AJUSTE_COMISSAO: 'Ajuste de comissão / incentivo do fornecedor',
  DESCONTO_NEGOCIACAO: 'Desconto ou renegociação com o cliente',
  TAXA_FEE: 'Taxa ou fee incluída/removida',
  VARIACAO_CAMBIAL: 'Variação cambial / tarifa',
  CORRECAO_LANCAMENTO: 'Correção de lançamento',
  DUPLICIDADE: 'Lançamento duplicado removido',
  VENDA_COMPLEMENTAR: 'Serviço adicional vendido depois',
  REATRIBUICAO: 'Venda transferida de vendedor/setor',
  LANCAMENTO_ATRASADO: 'Lançamento ou fechamento atrasado',
  FALHA_INTEGRACAO: 'Falha de integração (não é alteração real)',
  OUTRO: 'Outro',
}

export const AUDITORIA_REVISOES = ['pendente', 'confirmada', 'corrigida'] as const
export type AuditoriaRevisao = (typeof AUDITORIA_REVISOES)[number]

export interface AuditoriaProduto {
  produto: string | null
  fornecedor: string | null
  /** Só em 'reclassificado': o nome de antes. */
  produto_antes?: string | null
  fornecedor_antes?: string | null
  mudanca: 'igual' | 'alterado' | 'reclassificado' | 'cancelado' | 'incluido' | 'saiu'
  valor_antes: number
  valor_depois: number
  receita_antes: number
  receita_depois: number
}

/** De onde veio o motivo sugerido: a regra e as revisões de casos parecidos. */
export interface AuditoriaBaseAprendizado {
  chave: string | null
  descricao: string | null
  revisoes: number
  votos: Record<string, number>
  regra: Record<string, number>
  aprendido: boolean
}

/** Uma venda alterada numa conferência. Receita/valor são os do relatório de Fechadas. */
export interface AuditoriaAlteracao {
  id: number
  execucao_id: number | null
  detectado_em: string
  venda_numero: number
  data_venda: string | null
  data_venda_antes: string | null
  situacao: string | null
  situacao_antes: string | null
  vendedor: string | null
  vendedor_antes: string | null
  setor_grupo: string | null
  setor_grupo_antes: string | null
  setor_bruto: string | null
  pagante: string | null
  receita_antes: number
  receita_depois: number
  delta_receita: number
  valor_antes: number
  valor_depois: number
  delta_valor: number
  tipo: AuditoriaTipo
  produtos: AuditoriaProduto[]
  explicacao: string
  evidencias: string[]
  motivo_sugerido: AuditoriaMotivo
  confianca: number
  base_aprendizado: AuditoriaBaseAprendizado | null
  chaves: string[]
  revisao: AuditoriaRevisao
  motivo_real: AuditoriaMotivo | null
  nota: string | null
  revisado_por: string | null
  revisado_em: string | null
}

export interface AuditoriaTotalMes {
  receita: number
  valor: number
  vendas: number
  linhas: number
  setores: Record<string, number>
}

export interface AuditoriaExecucao {
  id: number
  data_ref: string
  origem: 'cron' | 'manual'
  status: 'rodando' | 'ok' | 'baseline' | 'erro'
  iniciado_em: string
  finalizado_em: string | null
  janela_inicio: string | null
  vendas_fechadas: number | null
  linhas_fechadas: number | null
  receita_fechada: number | null
  valor_fechado: number | null
  alteracoes: number | null
  impacto_receita: number | null
  vendas_novas: number | null
  receita_novas: number | null
  totais: Record<string, AuditoriaTotalMes> | null
  erro: string | null
}

export interface AuditoriaGrupo {
  chave: string
  n: number
  impacto: number
  quedas: number
  altas: number
}

export interface AuditoriaResumo {
  total: number
  impacto: number
  somaQuedas: number
  somaAltas: number
  quedas: number
  altas: number
  pendentes: number
  porSetor: AuditoriaGrupo[]
  porVendedor: AuditoriaGrupo[]
  porTipo: AuditoriaGrupo[]
}

/** Quanto o motivo sugerido acertou, entre as alterações já revisadas. */
export interface AuditoriaPrecisao {
  revisadas: number
  acertos: number
  precisao: number | null
  porSemana: { semana: string; revisadas: number; acertos: number; precisao: number }[]
  porMotivo: { motivo: AuditoriaMotivo; sugeridas: number; acertos: number; precisao: number }[]
}

/** Um contexto em que as revisões já ensinaram um motivo ao motor. */
export interface AuditoriaPadrao {
  chave: string
  descricao: string
  revisoes: number
  motivo: AuditoriaMotivo
  share: number
  nota: string | null
}

export interface AuditoriaResponse {
  dias: number
  alteracoes: AuditoriaAlteracao[]
  execucoes: AuditoriaExecucao[]
  precisao: AuditoriaPrecisao
  padroes: AuditoriaPadrao[]
}

export const AuditoriaAcaoSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('revisar'),
    id: z.number().int().positive(),
    motivo: z.enum(AUDITORIA_MOTIVOS),
    nota: z.string().trim().max(500).optional(),
  }),
  z.object({ action: z.literal('desfazer'), id: z.number().int().positive() }),
  z.object({ action: z.literal('executar') }),
])
export type AuditoriaAcao = z.infer<typeof AuditoriaAcaoSchema>
