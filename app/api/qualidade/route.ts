import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { jsonError, todayISO } from '@/lib/api-utils'
import { calcScoreFromAlerts } from '@/lib/data-quality'
import { checkSyncQuality, type SyncQualityRow } from '@/lib/sync-quality'
import { sondarQualidade, type SondaQualidade } from '@/lib/monde-indice'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE = 1000
const COLS = 'venda_numero, data_venda, vendedor, setor_grupo, produto, fornecedor, operacao, valor_total, situacao'

/**
 * Exclui vendas marcadas como excluídas — mesmo critério do dashboard.
 *
 * Legado: desde 2026-08-27 o sync só GRAVA linha de produto ativa de venda não
 * cancelada (a régua é aplicada na escrita, na Edge Function monde-sync), então nenhuma
 * linha cancelada entra na tabela. Este filtro é defesa em profundidade para linhas
 * antigas vindas do Excel; hoje não remove nada.
 */
function isVendaExcluida(situacao: string | null): boolean {
  return (situacao ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase() === 'excluida'
}

async function fetchAnoAtual(sb: ReturnType<typeof getSupabaseServer>): Promise<SyncQualityRow[]> {
  const inicioAno = `${todayISO().slice(0, 4)}-01-01`
  const rows: SyncQualityRow[] = []
  let offset = 0

  while (true) {
    const { data, error } = await sb
      .from('vendas')
      .select(COLS)
      .gte('data_venda', inicioAno)
      // `data_cancelamento` está vazia em 100% das linhas: a API nunca expôs data de
      // cancelamento de VENDA (só de produto) e o sync não a preenche. O filtro é
      // inócuo hoje — mantido porque a coluna ainda recebe dado de upload de Excel.
      .is('data_cancelamento', null)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1)

    if (error) throw error
    if (!data || data.length === 0) break

    rows.push(...(data as SyncQualityRow[]).filter((v) => !isVendaExcluida(v.situacao)))
    if (data.length < PAGE) break
    offset += PAGE
  }

  return rows
}

/**
 * GET /api/qualidade — Monitor de qualidade do sync com a API do Monde (ano atual).
 * Substitui o antigo score baseado em upload de Excel (descontinuado desde a
 * migração 100% API em 2026-08-07) por uma checagem ao vivo da tabela `vendas`.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) {
  try {
    const supabase = getSupabaseServer()
    const ano = todayISO().slice(0, 4)

    // A sondagem lê o índice `monde_v3_vendas`, que a Edge Function monde-sync mantém a
    // partir da API do Monde (o Vercel não tem a chave do Monde). Se falhar, o monitor
    // degrada para os alarmes de regressão em vez de derrubar a página.
    let sonda: SondaQualidade | null = null
    let sondaErro: string | null = null

    const [rows, sondaResult] = await Promise.all([
      fetchAnoAtual(supabase),
      sondarQualidade(`${ano}-01-01`, `${ano}-12-31`).catch((e: unknown) => {
        sondaErro = e instanceof Error ? e.message : String(e)
        return null
      }),
    ])
    sonda = sondaResult

    const alertas = checkSyncQuality(rows, sonda)
    const score = calcScoreFromAlerts(alertas)

    return NextResponse.json({
      score,
      alertas,
      totalVendas: new Set(rows.map((r) => r.venda_numero)).size,
      totalLinhas: rows.length,
      sonda,
      sondaErro,
      geradoEm: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Qualidade error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao calcular qualidade.', 500)
  }
}
