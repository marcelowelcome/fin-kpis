/**
 * GET /api/cron/monde-rebuild
 *
 * Rebuild incremental da base Monde dos últimos 3 anos, em chunks resumáveis.
 * Chamado diariamente pelo Vercel Cron (ver vercel.json). Cada chamada processa
 * um pedaço de páginas e avança o cursor (tabela sync_state); o ciclo completo
 * leva ~9 dias e só reinicia 10 dias após a conclusão.
 *
 * Pré-requisito: aplicar supabase/migration-sync-state.sql no Supabase.
 * Segurança: header Authorization: Bearer CRON_SECRET (injetado pelo Vercel Cron).
 * Use ?force=1 para iniciar um ciclo imediatamente, ignorando o intervalo.
 */

import { NextRequest, NextResponse } from 'next/server'
import { runRebuildChunk } from '@/lib/monde-rebuild'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const startedAt = new Date().toISOString()
  try {
    const force = new URL(request.url).searchParams.get('force') === '1'
    const result = await runRebuildChunk({ force })
    console.log(`[cron/monde-rebuild] ${result.status} — pág ${result.cursorPage}→${result.nextPage - 1} (cutoff ${result.cutoff})`)
    return NextResponse.json({ ok: true, startedAt, finishedAt: new Date().toISOString(), ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[cron/monde-rebuild] ERRO:', msg)
    return NextResponse.json({ ok: false, startedAt, error: msg }, { status: 500 })
  }
}
