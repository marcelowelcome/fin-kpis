import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { parseExcel, isParseError } from '@/lib/excel-parser'
import type { UploadResponse, ApiError, VendaInput } from '@/lib/schemas'

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

    // 3. Identificar quais venda_numero estão no arquivo
    //    e contar quantos registros existentes serão substituídos
    const vendaNumeros = Array.from(new Set(rows.map((r) => r.venda_numero)))

    // Contar registros existentes que serão substituídos
    const { count: existingCount } = await supabase
      .from('vendas')
      .select('*', { count: 'exact', head: true })
      .in('venda_numero', vendaNumeros)

    const atualizadas = existingCount ?? 0
    // Novos = venda_numero que não existem no banco
    // Mas como um pedido pode ter N itens, contamos linhas inseridas como total
    const inseridas = rows.length

    // 4. Deletar registros existentes para os venda_numero que estão no arquivo
    //    Isso garante que dados atualizados substituem os antigos
    if (atualizadas > 0) {
      // Deletar em lotes (IN clause tem limite)
      const BATCH_SIZE = 500
      for (let i = 0; i < vendaNumeros.length; i += BATCH_SIZE) {
        const batch = vendaNumeros.slice(i, i + BATCH_SIZE)
        const { error: deleteError } = await supabase
          .from('vendas')
          .delete()
          .in('venda_numero', batch)

        if (deleteError) {
          return jsonError('DB_ERROR', `Erro ao limpar dados existentes: ${deleteError.message}`, 500)
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
        linhas_inseridas: inseridas,
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
      inseridas,
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

function jsonError(code: string, message: string, status: number) {
  const body: ApiError = { error: { code, message } }
  return NextResponse.json(body, { status })
}
