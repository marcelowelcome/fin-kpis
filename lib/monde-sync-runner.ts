/**
 * Lógica central de sincronização Monde → banco.
 * Compartilhada entre o endpoint manual (/api/monde/sync)
 * e o cron automático (/api/cron/monde-sync).
 */

import { getSupabaseServer } from './supabase'
import { fetchMondeSales, mapSaleToVendaInput, isMondeSaleCancelled } from './monde-sync'

const INSERT_BATCH = 500
const DELETE_BATCH = 200
export const MONDE_FILENAME_PREFIX = 'monde-api-'

/**
 * Sync diário/manual processa só vendas a partir desta data (REGRA: janela 2026).
 * Vendas anteriores ao cutoff são ignoradas — nem apagadas, nem inseridas —
 * preservando dados históricos (Excel/backfill). O rebuild de 3 anos usa cutoff próprio.
 */
export const SYNC_CUTOFF_DATE = '2026-01-01'

export interface SyncOptions {
  mode?: 'incremental' | 'full'
  startPage?: number
  maxPages?: number
  /** Só processa vendas com data_venda >= cutoff (default SYNC_CUTOFF_DATE). */
  cutoff?: string
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
  /** True se alguma venda buscada tinha data anterior ao cutoff — sinaliza que a
   *  varredura alcançou a borda da janela (usado pelo rebuild para saber quando parar). */
  reachedCutoff: boolean
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Remove uploads que ficaram sem nenhuma venda após o delete (não toca em `keepId`). */
async function cleanOrphanUploads(
  supabase: ReturnType<typeof getSupabaseServer>,
  uploadIds: string[],
  keepId?: string,
): Promise<void> {
  for (const uid of uploadIds) {
    if (uid === keepId) continue
    const { count } = await supabase
      .from('vendas').select('*', { count: 'exact', head: true }).eq('upload_id', uid)
    if ((count ?? 0) === 0) await supabase.from('uploads').delete().eq('id', uid)
  }
}

/**
 * Sincroniza vendas da API Monde → banco, deduplicando por NÚMERO DA VENDA.
 *
 * Estratégia (sem perda de dados):
 *  - busca as páginas mais recentes (ordem da API = ~mais novas primeiro);
 *  - considera só vendas com data_venda >= cutoff (janela 2026) — as demais são
 *    ignoradas por completo, preservando dados históricos;
 *  - apaga do banco SOMENTE as vendas cujo número foi buscado (remove duplicatas
 *    de Excel e de syncs anteriores, e remove as que agora estão canceladas);
 *  - reinsere as ativas. Vendas não buscadas ficam intactas.
 *
 * Isso substitui o antigo "apagar por intervalo de datas", que apagava mais do que
 * reinseria quando a busca era parcial (subnotificação da faixa recente).
 */
export async function runMondeSync(opts: SyncOptions = {}): Promise<SyncRunResult> {
  const mode = opts.mode ?? 'incremental'
  const startPage = opts.startPage ?? 1
  const maxPages = opts.maxPages ?? (mode === 'full' ? 50 : 15)
  // Incremental (diário/manual) limita à janela 2026; full (backfill /upload) importa
  // tudo que buscar, salvo cutoff explícito (ex.: rebuild de 3 anos passa o seu).
  const cutoff = opts.cutoff ?? (mode === 'full' ? '1900-01-01' : SYNC_CUTOFF_DATE)

  // 1. Buscar páginas da API Monde
  const { sales: rawSales, totalPages, pagesScanned } = await fetchMondeSales({
    startPage,
    maxPages,
  })

  const supabase = getSupabaseServer()

  // Lista de cancelamento MANUAL (tabela vendas_canceladas): a API não expõe o
  // cancelamento de algumas vendas (ex.: "Data Cancelamento" preenchida só no relatório
  // do Monde, sem produto/refund detectável). Espelha a Edge Function `monde-sync`: essas
  // NÃO são reinseridas E são removidas se já existirem (entram em vendaNumeros e o dedup
  // do passo 3 as apaga sem reinserir). Sem isso, esta rota (e o cron Vercel que a usa)
  // reintroduziria as vendas que a Edge exclui.
  const { data: cancRows } = await supabase.from('vendas_canceladas').select('venda_numero')
  const canceladasManual = new Set((cancRows ?? []).map((r) => r.venda_numero as number))

  // 2. Janela: só vendas com data_venda >= cutoff (preserva histórico anterior)
  const inWindow = rawSales.filter((s) => !!s.sale_date && s.sale_date >= cutoff)
  const reachedCutoff = rawSales.some((s) => !!s.sale_date && s.sale_date < cutoff)
  const cancelledCount = inWindow.filter((s) => isMondeSaleCancelled(s) || canceladasManual.has(s.sale_number)).length
  const activeSales = inWindow.filter((s) => !isMondeSaleCancelled(s) && !canceladasManual.has(s.sale_number))

  // Números de venda buscados nesta janela — base do dedup.
  const vendaNumeros = Array.from(new Set(inWindow.map((s) => s.sale_number)))

  // 3. Apagar do banco só os números buscados (Excel + API anteriores + canceladas).
  //    Antes de apagar, guardamos o `produto` existente por número de venda: a API
  //    não traz o produto das vendas de casamento (Contrato/Pacote/Bloqueio — arrays
  //    de produto vazios), mas o Excel traz. Fazemos carry-forward para não apagar
  //    essa informação ao re-sincronizar (preserva o KPI de contratos vindo do Excel).
  let salesDeleted = 0
  const affectedUploadIds = new Set<string>()
  const existingProduto = new Map<number, string>()
  for (const numeros of chunk(vendaNumeros, DELETE_BATCH)) {
    const { data: rows } = await supabase
      .from('vendas').select('venda_numero, upload_id, produto').in('venda_numero', numeros)
    for (const r of rows ?? []) {
      if (r.upload_id) affectedUploadIds.add(r.upload_id)
      if (r.produto && !existingProduto.has(r.venda_numero)) existingProduto.set(r.venda_numero, r.produto)
    }
    salesDeleted += rows?.length ?? 0
    const { error: delError } = await supabase.from('vendas').delete().in('venda_numero', numeros)
    if (delError) throw new Error(`Erro ao apagar lote para dedup: ${delError.message}`)
  }

  if (activeSales.length === 0) {
    await cleanOrphanUploads(supabase, Array.from(affectedUploadIds))
    return {
      uploadId: '',
      pagesScanned,
      totalPages,
      salesFetched: rawSales.length,
      cancelledSkipped: cancelledCount,
      salesInserted: 0,
      salesDeleted,
      dateRange: null,
      indefinidoCount: 0,
      mode,
      startPage,
      nextPage: startPage + pagesScanned,
      reachedCutoff,
    }
  }

  // 4. Range de datas (somente vendas ativas, informativo)
  const dates = activeSales.map((s) => s.sale_date).filter(Boolean).sort()
  const minDate = dates[0]
  const maxDate = dates[dates.length - 1]

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

  // 6. Mapear e inserir em lote. Carry-forward: se a API não tem produto para a venda
  //    (típico em casamentos) mas já havia um produto (do Excel), preserva-o.
  const vendas = activeSales.map((s) => {
    const base = mapSaleToVendaInput(s)
    if (base.produto == null) {
      const prev = existingProduto.get(s.sale_number)
      if (prev) base.produto = prev
    }
    return { ...base, upload_id: uploadId }
  })
  const indefinidoCount = vendas.filter((v) => v.setor_grupo === 'INDEFINIDO').length

  for (let i = 0; i < vendas.length; i += INSERT_BATCH) {
    const batch = vendas.slice(i, i + INSERT_BATCH)
    const { error: insertError } = await supabase.from('vendas').insert(batch)
    if (insertError) {
      await supabase.from('uploads').update({ status: 'error' }).eq('id', uploadId)
      throw new Error(`Erro ao inserir lote ${Math.floor(i / INSERT_BATCH) + 1}: ${insertError.message}`)
    }
  }

  // 7. Limpar uploads que ficaram órfãos após o dedup (preserva o novo upload)
  await cleanOrphanUploads(supabase, Array.from(affectedUploadIds), uploadId)

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
    reachedCutoff,
  }
}
