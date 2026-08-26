import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { jsonError, todayISO } from '@/lib/api-utils'
import { calcScoreFromAlerts } from '@/lib/data-quality'
import { checkSyncQuality, type SyncQualityRow } from '@/lib/sync-quality'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const PAGE = 1000
const COLS = 'venda_numero, data_venda, vendedor, setor_grupo, produto, fornecedor, operacao, valor_total, situacao'

/** Exclui produtos cancelados e vendas deletadas — mesmo critério do dashboard. */
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
    const rows = await fetchAnoAtual(supabase)
    const alertas = checkSyncQuality(rows)
    const score = calcScoreFromAlerts(alertas)

    return NextResponse.json({
      score,
      alertas,
      totalVendas: new Set(rows.map((r) => r.venda_numero)).size,
      geradoEm: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Qualidade error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao calcular qualidade.', 500)
  }
}
