import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { parseExcel, isParseError } from '@/lib/excel-parser'
import type { UploadResponse, VendaInput } from '@/lib/schemas'
import { jsonError } from '@/lib/api-utils'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(request: NextRequest) {
  try {
    // 1. Extrair arquivo do FormData
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return jsonError('FILE_MISSING', 'Nenhum arquivo enviado.', 400)
    }

    if (!file.name.endsWith('.xlsx')) {
      return jsonError('INVALID_FORMAT', 'Apenas arquivos .xlsx são aceitos.', 400)
    }

    if (file.size > 5 * 1024 * 1024) {
      return jsonError('FILE_TOO_LARGE', 'Arquivo excede o limite de 5MB.', 400)
    }

    // 2. Converter para ArrayBuffer e parsear
    const buffer = await file.arrayBuffer()
    let parseResult

    try {
      parseResult = parseExcel(buffer)
    } catch (err) {
      if (isParseError(err)) {
        return jsonError(err.code, err.message, 400)
      }
      throw err
    }

    const { rows, alerts, totalLinhas, score } = parseResult

    if (rows.length === 0) {
      return jsonError('NO_VALID_ROWS', 'Nenhuma linha válida encontrada no arquivo.', 400)
    }

    const supabase = getSupabaseServer()

    // 3. Detectar o range de datas do arquivo (min/max data_venda)
    const dates = rows.map((r) => r.data_venda).sort()
    const minDate = dates[0]
    const maxDate = dates[dates.length - 1]

    // 4. Deletar TODAS as vendas no mesmo range de datas + seus uploads órfãos
    //    Isso garante que o novo upload substitui completamente os dados do período,
    //    sem interferir em uploads de outros períodos.
    const { count: existingCount } = await supabase
      .from('vendas')
      .select('*', { count: 'exact', head: true })
      .gte('data_venda', minDate)
      .lte('data_venda', maxDate)

    const atualizadas = existingCount ?? 0

    if (atualizadas > 0) {
      // Identificar uploads que ficarão órfãos (todas as vendas no range serão deletadas)
      const { data: affectedUploads } = await supabase
        .from('vendas')
        .select('upload_id')
        .gte('data_venda', minDate)
        .lte('data_venda', maxDate)

      const affectedUploadIds = Array.from(new Set(
        (affectedUploads ?? []).map((v) => v.upload_id).filter(Boolean)
      ))

      // Deletar vendas no range de datas
      const { error: deleteError } = await supabase
        .from('vendas')
        .delete()
        .gte('data_venda', minDate)
        .lte('data_venda', maxDate)

      if (deleteError) {
        return jsonError('DB_ERROR', `Erro ao limpar dados existentes: ${deleteError.message}`, 500)
      }

      // Limpar uploads que ficaram sem vendas (órfãos)
      for (const uid of affectedUploadIds) {
        const { count: remaining, error: countError } = await supabase
          .from('vendas')
          .select('*', { count: 'exact', head: true })
          .eq('upload_id', uid)

        if (countError) {
          console.error(`Erro ao verificar upload órfão ${uid}:`, countError)
          continue
        }

        if (remaining === 0) {
          const { error: delError } = await supabase.from('uploads').delete().eq('id', uid)
          if (delError) {
            console.error(`Erro ao deletar upload órfão ${uid}:`, delError)
          }
        }
      }
    }

    // 5. Criar registro de upload
    const hasCritico = alerts.some((a) => a.severidade === 'CRITICO')
    const uploadStatus = hasCritico ? 'warning' : 'success'

    const { data: uploadRecord, error: uploadError } = await supabase
      .from('uploads')
      .insert({
        nome_arquivo: file.name,
        total_linhas: totalLinhas,
        linhas_inseridas: rows.length,
        linhas_atualizadas: atualizadas,
        alertas_qualidade: alerts,
        status: uploadStatus,
      })
      .select('id')
      .single()

    if (uploadError || !uploadRecord) {
      return jsonError('DB_ERROR', `Erro ao registrar upload: ${uploadError?.message}`, 500)
    }

    const uploadId = uploadRecord.id

    // 6. Inserir todas as linhas com upload_id
    const rowsWithUploadId = rows.map((r: VendaInput) => ({
      ...r,
      upload_id: uploadId,
    }))

    const INSERT_BATCH = 500
    for (let i = 0; i < rowsWithUploadId.length; i += INSERT_BATCH) {
      const batch = rowsWithUploadId.slice(i, i + INSERT_BATCH)
      const { error: insertError } = await supabase
        .from('vendas')
        .insert(batch)

      if (insertError) {
        await supabase
          .from('uploads')
          .update({ status: 'error' })
          .eq('id', uploadId)

        return jsonError('DB_ERROR', `Erro ao inserir dados (lote ${Math.floor(i / INSERT_BATCH) + 1}): ${insertError.message}`, 500)
      }
    }

    // 7. Retornar resposta
    const response: UploadResponse = {
      uploadId,
      totalLinhas,
      inseridas: rows.length,
      atualizadas,
      alertas: alerts,
      score,
      status: uploadStatus as 'success' | 'warning',
    }

    return NextResponse.json(response, { status: 200 })
  } catch (err) {
    console.error('Upload error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro interno ao processar o upload.', 500)
  }
}

