/**
 * GET /api/monde/status
 * Retorna informações da última sincronização com a API Monde.
 */

import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { jsonError } from '@/lib/api-utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  try {
    const supabase = getSupabaseServer()

    // Últimas 5 sincronizações Monde
    const { data: uploads, error } = await supabase
      .from('uploads')
      .select('id, nome_arquivo, uploaded_at, total_linhas, linhas_inseridas, linhas_atualizadas, status')
      .like('nome_arquivo', 'monde-api-%')
      .order('uploaded_at', { ascending: false })
      .limit(5)

    if (error) return jsonError('DB_ERROR', error.message, 500)

    const last = uploads?.[0] ?? null

    // Contar total de registros Monde na tabela vendas
    const mondeIds = (uploads ?? []).map((u) => u.id)
    let totalRecords = 0
    if (mondeIds.length > 0) {
      const { count } = await supabase
        .from('vendas')
        .select('*', { count: 'exact', head: true })
        .in('upload_id', mondeIds)
      totalRecords = count ?? 0
    }

    return NextResponse.json({
      lastSync: last
        ? {
            uploadId: last.id,
            nomeArquivo: last.nome_arquivo,
            syncedAt: last.uploaded_at,
            salesSynced: last.total_linhas,
            status: last.status,
          }
        : null,
      history: (uploads ?? []).map((u) => ({
        uploadId: u.id,
        nomeArquivo: u.nome_arquivo,
        syncedAt: u.uploaded_at,
        salesSynced: u.total_linhas,
        status: u.status,
      })),
      totalRecordsInDB: totalRecords,
    })
  } catch (err) {
    console.error('Monde status error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao buscar status do sync.', 500)
  }
}
