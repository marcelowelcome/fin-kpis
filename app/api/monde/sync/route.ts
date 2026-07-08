/**
 * POST /api/monde/sync  — sincroniza vendas Monde → banco (chamada manual)
 * DELETE /api/monde/sync — remove TODOS os dados importados via API Monde
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { runMondeSync, runMondeSyncDelta, MONDE_FILENAME_PREFIX } from '@/lib/monde-sync-runner'
import { jsonError } from '@/lib/api-utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0
// 300s como o cron: a varredura de páginas + escrita no banco pode passar de 60s.
// Com o teto antigo de 60 a função era morta no meio e o cliente via "Failed to fetch".
export const maxDuration = 300

// ─── DELETE: remove todos os dados Monde do banco ───────────────────────────

export async function DELETE() {
  try {
    const supabase = getSupabaseServer()

    const { data: mondeUploads } = await supabase
      .from('uploads')
      .select('id')
      .like('nome_arquivo', `${MONDE_FILENAME_PREFIX}%`)

    const ids = (mondeUploads ?? []).map((u) => u.id)

    if (ids.length === 0) {
      return NextResponse.json({ deleted: { vendas: 0, uploads: 0 } })
    }

    const { count: vendasCount } = await supabase
      .from('vendas')
      .select('*', { count: 'exact', head: true })
      .in('upload_id', ids)

    await supabase.from('vendas').delete().in('upload_id', ids)
    await supabase.from('uploads').delete().in('id', ids)

    return NextResponse.json({ deleted: { vendas: vendasCount ?? 0, uploads: ids.length } })
  } catch (err) {
    return jsonError('INTERNAL_ERROR', String(err instanceof Error ? err.message : err), 500)
  }
}

// ─── POST: sincronizar manualmente ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))

    // Sync INCREMENTAL (delta): só busca da API o que é novo ou mudou (valor, status,
    // itens). É o caminho do botão "Atualizar" — não estoura o rate-limit por não
    // rebaixar o detalhe da janela inteira. `dryRun:true` só relata, sem gravar.
    if (body.mode === 'delta' || body.delta) {
      const result = await runMondeSyncDelta({
        startPage: Number(body.startPage) || 1,
        maxPages: body.maxPages != null ? Number(body.maxPages) : undefined,
        maxDetails: body.maxDetails != null ? Number(body.maxDetails) : undefined,
        cutoff: typeof body.cutoff === 'string' ? body.cutoff : undefined,
        dryRun: !!body.dryRun,
      })
      return NextResponse.json({ result })
    }

    const result = await runMondeSync({
      mode: body.mode === 'full' ? 'full' : 'incremental',
      startPage: Number(body.startPage) || 1,
      maxPages: Number(body.maxPages) || undefined,
    })
    return NextResponse.json({ result })
  } catch (err) {
    console.error('Monde sync error:', err)
    return jsonError('INTERNAL_ERROR', String(err instanceof Error ? err.message : err), 500)
  }
}
