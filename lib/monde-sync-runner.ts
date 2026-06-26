/**
 * Lógica central de sincronização Monde → banco.
 * Compartilhada entre o endpoint manual (/api/monde/sync)
 * e o cron automático (/api/cron/monde-sync).
 */

import { getSupabaseServer } from './supabase'
import { fetchMondeSales, mapSaleToVendaInput, isMondeSaleCancelled } from './monde-sync'

const INSERT_BATCH = 500
export const MONDE_FILENAME_PREFIX = 'monde-api-'

export interface SyncOptions {
  mode?: 'incremental' | 'full'
  startPage?: number
  maxPages?: number
}

export interface SyncRunResult {
  uploadId: string
  pagesScanned: number
  totalPages: number
  salesFetched: number
  cancelledSkipped: number
  salesInserted: number
  salesDeleted: number
  dateRange: { min: string; max: string } | null
  indefinidoCount: number
  mode: string
  startPage: number
  nextPage: number
}

export async function runMondeSync(opts: SyncOptions = {}): Promise<SyncRunResult> {
  const mode = opts.mode ?? 'incremental'
  const startPage = opts.startPage ?? 1
  const maxPages = opts.maxPages ?? (mode === 'full' ? 50 : 25)

  // 1. Buscar páginas da API Monde
  const { sales: rawSales, totalPages, pagesScanned } = await fetchMondeSales({
    startPage,
    maxPages,
  })

  // 2. Filtrar vendas canceladas
  const cancelledCount = rawSales.filter(isMondeSaleCancelled).length
  const activeSales = rawSales.filter((s) => !isMondeSaleCancelled(s))

  if (activeSales.length === 0) {
    return {
      uploadId: '',
      pagesScanned,
      totalPages,
      salesFetched: rawSales.length,
      cancelledSkipped: cancelledCount,
      salesInserted: 0,
      salesDeleted: 0,
      dateRange: null,
      indefinidoCount: 0,
      mode,
      startPage,
      nextPage: startPage + pagesScanned,
    }
  }

  // 3. Determinar range de datas (somente vendas ativas)
  const dates = activeSales.map((s) => s.sale_date).filter(Boolean).sort()
  const minDate = dates[0]
  const maxDate = dates[dates.length - 1]

  const supabase = getSupabaseServer()

  // 4. Deletar TODOS os registros no range de datas (Excel + API anteriores)
  const { count: existingCount } = await supabase
    .from('vendas')
    .select('*', { count: 'exact', head: true })
    .gte('data_venda', minDate)
    .lte('data_venda', maxDate)

  let salesDeleted = 0
  if ((existingCount ?? 0) > 0) {
    const { data: affectedUploads } = await supabase
      .from('vendas')
      .select('upload_id')
      .gte('data_venda', minDate)
      .lte('data_venda', maxDate)

    const affectedIds = Array.from(
      new Set((affectedUploads ?? []).map((v) => v.upload_id).filter(Boolean))
    )

    await supabase.from('vendas').delete().gte('data_venda', minDate).lte('data_venda', maxDate)
    salesDeleted = existingCount ?? 0

    for (const uid of affectedIds) {
      const { count: remaining } = await supabase
        .from('vendas').select('*', { count: 'exact', head: true }).eq('upload_id', uid)
      if ((remaining ?? 0) === 0) {
        await supabase.from('uploads').delete().eq('id', uid)
      }
    }
  }

  // 5. Criar registro de upload para esta sincronização
  const now = new Date().toISOString().slice(0, 10)
  const nomeSuffix = startPage > 1 ? `-p${startPage}` : ''
  const nomeArquivo = `${MONDE_FILENAME_PREFIX}${mode}${nomeSuffix}-${now}`

  const { data: uploadRecord, error: uploadError } = await supabase
    .from('uploads')
    .insert({
      nome_arquivo: nomeArquivo,
      total_linhas: activeSales.length,
      linhas_inseridas: activeSales.length,
      linhas_atualizadas: salesDeleted,
      alertas_qualidade: [],
      status: 'success',
    })
    .select('id')
    .single()

  if (uploadError || !uploadRecord) {
    throw new Error(`Erro ao registrar sync: ${uploadError?.message}`)
  }

  const uploadId = uploadRecord.id

  // 6. Mapear e inserir em lote
  const vendas = activeSales.map((s) => ({ ...mapSaleToVendaInput(s), upload_id: uploadId }))
  const indefinidoCount = vendas.filter((v) => v.setor_grupo === 'INDEFINIDO').length

  for (let i = 0; i < vendas.length; i += INSERT_BATCH) {
    const batch = vendas.slice(i, i + INSERT_BATCH)
    const { error: insertError } = await supabase.from('vendas').insert(batch)
    if (insertError) {
      await supabase.from('uploads').update({ status: 'error' }).eq('id', uploadId)
      throw new Error(`Erro ao inserir lote ${Math.floor(i / INSERT_BATCH) + 1}: ${insertError.message}`)
    }
  }

  return {
    uploadId,
    pagesScanned,
    totalPages,
    salesFetched: rawSales.length,
    cancelledSkipped: cancelledCount,
    salesInserted: vendas.length,
    salesDeleted,
    dateRange: { min: minDate, max: maxDate },
    indefinidoCount,
    mode,
    startPage,
    nextPage: startPage + pagesScanned,
  }
}
