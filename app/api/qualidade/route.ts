import { NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import type { ApiError, Upload } from '@/lib/schemas'

/**
 * GET /api/qualidade — Score agregado e timeline de qualidade dos uploads.
 */
export async function GET() {
  try {
    const supabase = getSupabaseServer()

    // Buscar os últimos 20 uploads para timeline
    const { data: uploads, error } = await supabase
      .from('uploads')
      .select('id, nome_arquivo, uploaded_at, total_linhas, alertas_qualidade, status')
      .order('uploaded_at', { ascending: false })
      .limit(20)

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

    // Calcular score para cada upload baseado nos alertas
    const timeline = (uploads as Upload[]).map((upload) => {
      const alerts = upload.alertas_qualidade ?? []
      let score = 100

      for (const alert of alerts) {
        switch (alert.tipo) {
          case 'SETOR_NULO':
            score -= Math.min(alert.quantidade * 5, 30)
            break
          case 'VALOR_NEGATIVO':
            score -= Math.min(alert.quantidade * 2, 20)
            break
          case 'LINHA_NULA':
            score -= Math.min(alert.quantidade * 1, 10)
            break
          case 'DUPLICATA_INTERNA':
            score -= Math.min(alert.quantidade * 5, 20)
            break
        }
      }

      return {
        uploadId: upload.id,
        nomeArquivo: upload.nome_arquivo,
        uploadedAt: upload.uploaded_at,
        totalLinhas: upload.total_linhas,
        score: Math.max(0, score),
        alertas: alerts,
        status: upload.status,
      }
    })

    return NextResponse.json({
      ultimoScore: timeline[0]?.score ?? null,
      timeline: timeline.reverse(), // ordem cronológica
      ultimoUpload: timeline[timeline.length - 1] ?? null,
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
