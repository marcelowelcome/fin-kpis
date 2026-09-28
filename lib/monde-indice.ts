/**
 * Leitura do ÍNDICE do Monde (`monde_v3_vendas`) para o monitor de qualidade.
 *
 * Desde 2026-09-28 o sync lê a API oficial do Monde (v3) direto, na Edge Function
 * `monde-sync`. A chave do Monde abre o financeiro inteiro e só existe como secret da
 * Edge Function — o Vercel não fala com o Monde. Então o monitor não consulta a API
 * na hora: compara `vendas` com o índice que a própria Edge Function mantém a partir
 * da lista e do detalhe de cada venda.
 */

import { getSupabaseServer } from './supabase'

const PAGE = 1000

export interface SondaQualidade {
  /** Números de venda que o Monde reporta CANCELADAS na janela. */
  canceladasNaApi: number[]
  /** Vendas vivas cujo último detalhe lido tinha produto ativo: deveriam estar no banco. */
  comAtivoNaApi: number[]
  /** Vendas vivas cujo último detalhe NÃO tinha produto ativo: não deveriam estar no banco. */
  semAtivoNaApi: number[]
  /** Vendas novas/alteradas esperando o detalhe há mais de 1 h. */
  filaAtrasada: number
  /** Última vez que a lista do Monde foi lida (qualquer venda da janela). */
  listaLidaEm: string | null
  /** Vendas da janela ainda não abertas nenhuma vez pelo sync v3 (carga inicial). */
  semDetalhe: number
}

interface IndiceRow {
  sale_number: number
  status: string | null
  linhas_ativas: number | null
  detail_at: string | null
  listed_at: string | null
}

export async function sondarQualidade(from: string, to: string): Promise<SondaQualidade> {
  const sb = getSupabaseServer()
  const rows: IndiceRow[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await sb
      .from('monde_v3_vendas')
      .select('sale_number, status, linhas_ativas, detail_at, listed_at')
      .gte('sale_date', from)
      .lte('sale_date', to)
      .order('sale_id', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...(data as IndiceRow[]))
    if (data.length < PAGE) break
  }

  const umaHoraAtras = new Date(Date.now() - 3_600_000).toISOString()
  const { count: filaAtrasada } = await sb
    .from('monde_v3_vendas')
    .select('*', { count: 'exact', head: true })
    .eq('prioridade', 0)
    .lt('refresh_at', umaHoraAtras)

  const out: SondaQualidade = {
    canceladasNaApi: [], comAtivoNaApi: [], semAtivoNaApi: [],
    filaAtrasada: filaAtrasada ?? 0, listaLidaEm: null, semDetalhe: 0,
  }
  for (const r of rows) {
    if (r.listed_at && (!out.listaLidaEm || r.listed_at > out.listaLidaEm)) out.listaLidaEm = r.listed_at
    if (r.status === 'canceled') { out.canceladasNaApi.push(r.sale_number); continue }
    if (!r.detail_at) { out.semDetalhe++; continue }
    if ((r.linhas_ativas ?? 0) > 0) out.comAtivoNaApi.push(r.sale_number)
    else out.semAtivoNaApi.push(r.sale_number)
  }
  return out
}
