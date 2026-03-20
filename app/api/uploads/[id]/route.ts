import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import type { ApiError } from '@/lib/schemas'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * DELETE /api/uploads/[id] — Exclui upload + vendas associadas (cascade).
 * Requer body: { confirmacao: "EXCLUIR" }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params

    // Validar confirmação
    const body = await request.json().catch(() => ({}))
    if (body.confirmacao !== 'EXCLUIR') {
      return jsonError(
        'CONFIRMATION_REQUIRED',
        'Confirmação obrigatória: envie { "confirmacao": "EXCLUIR" }',
        400
      )
    }

    const supabase = getSupabaseServer()

    // Verificar que o upload existe
    const { data: upload, error: findError } = await supabase
      .from('uploads')
      .select('id, nome_arquivo')
      .eq('id', id)
      .single()

    if (findError || !upload) {
      return jsonError('UPLOAD_NOT_FOUND', `Upload não encontrado: ${id}`, 404)
    }

    // Contar vendas que serão removidas (para informar o usuário)
    const { count } = await supabase
      .from('vendas')
      .select('*', { count: 'exact', head: true })
      .eq('upload_id', id)

    // Excluir upload (ON DELETE CASCADE cuida das vendas)
    const { error: deleteError } = await supabase
      .from('uploads')
      .delete()
      .eq('id', id)

    if (deleteError) {
      return jsonError('DB_ERROR', `Erro ao excluir: ${deleteError.message}`, 500)
    }

    return NextResponse.json({
      deleted: true,
      uploadId: id,
      nomeArquivo: upload.nome_arquivo,
      vendasRemovidas: count ?? 0,
    })
  } catch (err) {
    console.error('Upload delete error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao excluir upload.', 500)
  }
}

/**
 * GET /api/uploads/[id] — Detalhes de um upload específico.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = getSupabaseServer()

    const { data, error } = await supabase
      .from('uploads')
      .select('*')
      .eq('id', params.id)
      .single()

    if (error || !data) {
      return jsonError('UPLOAD_NOT_FOUND', 'Upload não encontrado.', 404)
    }

    // Contar vendas associadas
    const { count } = await supabase
      .from('vendas')
      .select('*', { count: 'exact', head: true })
      .eq('upload_id', params.id)

    return NextResponse.json({ upload: data, totalVendas: count ?? 0 })
  } catch (err) {
    console.error('Upload detail error:', err)
    return jsonError('INTERNAL_ERROR', 'Erro ao buscar upload.', 500)
  }
}

function jsonError(code: string, message: string, status: number) {
  const body: ApiError = { error: { code, message } }
  return NextResponse.json(body, { status })
}
