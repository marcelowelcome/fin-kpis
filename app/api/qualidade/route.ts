import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { calcScoreFromAlerts } from '@/lib/data-quality'
import type { ApiError, Upload } from '@/lib/schemas'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/qualidade — Score agregado e timeline de qualidade dos uploads.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) {
  try {
    const supabase = getSupabaseServer()

    const { data: uploads, error } = await supabase
      .from('uploads')
      .select('id, nome_arquivo, uploaded_at, total_linhas, alertas_qualidade, status')
      .order('uploaded_at', { ascending: false })
      .limit(50)

    if (error) {
      return jsonError('DB_ERROR', error.message, 500)
    }

    if (!uploads || uploads.length === 0) {
      return NextResponse.json({
        ultimoScore: null,
        timeline: [],
        ultimoUpload: null,
      })
    }

    const timeline = (uploads as Upload[]).map((upload) => ({
      uploadId: upload.id,
      nomeArquivo: upload.nome_arquivo,
      uploadedAt: upload.uploaded_at,
      totalLinhas: upload.total_linhas,
      score: calcScoreFromAlerts(upload.alertas_qualidade ?? []),
      alertas: upload.alertas_qualidade ?? [],
      status: upload.status,
    }))

    // Cronológico (mais antigo primeiro) sem mutar o array original
    const cronologico = [...timeline].reverse()

    return NextResponse.json({
      ultimoScore: timeline[0]?.score ?? null,
      timeline: cronologico,
      ultimoUpload: cronologico[cronologico.length - 1] ?? null,
    })
  } catch (err) {
    console.error('Qualidade error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao calcular qualidade.', 500)
  }
}

function jsonError(code: string, message: string, status: number) {
  const body: ApiError = { error: { code, message } }
  return NextResponse.json(body, { status })
}
