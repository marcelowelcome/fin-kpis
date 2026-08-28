/**
 * GET /api/cron/monde-sync
 *
 * Chamado automaticamente pelo Vercel Cron Jobs (ver vercel.json).
 * Executa RECONCILIAÇÃO da janela corrente (2026 → hoje) pelos feeds planos:
 * revisita a janela inteira, então corrige cancelamento retroativo e cancelamento
 * parcial — que o modelo antigo, limitado às páginas recentes, não alcançava.
 *
 * Segurança: verifica o header Authorization: Bearer CRON_SECRET.
 * O Vercel injeta este header automaticamente nas chamadas de cron.
 * Configure CRON_SECRET nas variáveis de ambiente do projeto no Vercel.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runMondeSync } from '@/lib/monde-sync-runner'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 300

export async function GET(request: NextRequest) {
  // Verifica secret para impedir chamadas não autorizadas
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const startedAt = new Date().toISOString()

  try {
    const result = await runMondeSync({ mode: 'incremental' })

    console.log(`[cron/monde-sync] OK — ${result.linhasInseridas} linhas, ${result.canceladasVenda} venda(s) cancelada(s) removida(s), ${result.canceladasProduto} linha(s) de produto cancelada(s), range ${result.dateRange?.min} → ${result.dateRange?.max}`)

    return NextResponse.json({
      ok: true,
      startedAt,
      finishedAt: new Date().toISOString(),
      result,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron/monde-sync] ERRO:', msg)
    return NextResponse.json({ ok: false, startedAt, error: msg }, { status: 500 })
  }
}
