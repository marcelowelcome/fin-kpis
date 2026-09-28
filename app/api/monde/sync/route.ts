/**
 * POST /api/monde/sync  — dispara uma rodada da Edge Function `monde-sync`
 * DELETE /api/monde/sync — remove TODOS os dados importados via API Monde
 *
 * O sync lê a API oficial do Monde (v3) e roda só no Supabase: a chave do Monde
 * (MONDE_V3_API_KEY) abre o financeiro inteiro e existe apenas como secret da Edge
 * Function. Esta rota não fala com o Monde — só repassa a chamada.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { jsonError } from '@/lib/api-utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0
// Uma rodada da Edge Function leva até ~115 s.
export const maxDuration = 180

const MONDE_FILENAME_PREFIX = 'monde-api-'

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

export async function POST() {
  try {
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/monde-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
      body: '{}',
      cache: 'no-store',
    })
    const result = await res.json().catch(() => null)
    if (!res.ok || result?.ok === false) {
      return jsonError('SYNC_ERROR', String(result?.error ?? `Edge Function respondeu ${res.status}`), 502)
    }
    return NextResponse.json({ result })
  } catch (err) {
    console.error('Monde sync error:', err)
    return jsonError('INTERNAL_ERROR', String(err instanceof Error ? err.message : err), 500)
  }
}
