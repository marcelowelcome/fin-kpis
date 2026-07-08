/**
 * Lógica central de sincronização Monde → banco.
 * Compartilhada entre o endpoint manual (/api/monde/sync)
 * e o cron automático (/api/cron/monde-sync).
 */

import { getSupabaseServer } from './supabase'
import { fetchMondeSales, mapSaleToVendaLines, isMondeSaleCancelled } from './monde-sync'
import { scanSalesListPages, fetchSaleRaws, type SaleListRow } from './monde-client'

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

  // 6. Mapear (UMA linha por produto ativo) e inserir em lote. Carry-forward: se a API
  //    não traz produto (linha nula, típico em casamentos) mas já havia um produto (do
  //    Excel), preserva-o.
  const vendas = activeSales.flatMap((s) => {
    const prev = existingProduto.get(s.sale_number)
    return mapSaleToVendaLines(s).map((l) => ({
      ...l,
      produto: l.produto ?? prev ?? null,
      upload_id: uploadId,
    }))
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

// ─── Sync INCREMENTAL (delta) ─────────────────────────────────────────────────
//
// Motivação: o sync "cheio" acima resolve o detalhe (`raw`) de TODAS as vendas da
// janela — até ~1.000 requisições de saída por execução. Rodando na Edge Function do
// Supabase, isso estoura o rate-limiter de requisições de SAÍDA do Edge Runtime
// (EdgeRuntime.errors.RateLimitError → "Rate limit exceeded … Retry after ~56s"),
// que é o erro do botão "Atualizar".
//
// O delta varre só a LISTA (barata) e busca o detalhe APENAS das vendas NOVAS ou
// ALTERADAS. A lista já traz status, valor bruto e contagem de itens; comparando com
// o que está no banco, decidimos o que mudou. Numa venda SEM cancelamento o
// valor_total salvo já é igual ao total_final_value da lista, então a maioria é
// "inalterada" e nem no primeiro run há enxurrada de detalhes.
//
// Detecção de "mudou" (só com o que a lista dá): venda nova, mudança de status
// (opened/closed → Aberta/Fechada), ou mudança de valor/receita. Troca de ITEM quase
// sempre mexe no valor (logo é pega); troca que mantém o total idêntico não é vista
// nesta v1 (precisaria persistir product_count — decisão pós-revisão).
//
// LIMITE conhecido: a API do Monde não tem "modificado desde X" e a lista é ordenada
// por criação, então edição em venda ANTIGA (fora das `maxPages` recentes varridas)
// não é pega pelo botão — isso continua sendo papel do rebuild agendado.

export interface DeltaSyncOptions {
  startPage?: number
  maxPages?: number
  /** Só considera vendas com data_venda >= cutoff (default SYNC_CUTOFF_DATE). */
  cutoff?: string
  /** Teto de detalhes buscados por execução (cinto de segurança contra rate-limit).
   *  O que passar do teto fica para o próximo ciclo (as mais recentes vêm primeiro). */
  maxDetails?: number
  /** Se true, NÃO grava nada — só relata o que mudaria. Para revisão local. */
  dryRun?: boolean
}

export interface DeltaChange {
  venda_numero: number
  motivo: 'nova' | 'status' | 'valor' | 'receita' | 'setor' | 'cancelada-manual'
  de?: string
  para?: string
}

/** Valor do custom field "Setor" que a LISTA já traz (sem custo de detalhe). É o que
 *  permite detectar troca de setor — uma "edição silenciosa" que não mexe em
 *  valor/status/receita — sem baixar o detalhe de todas as vendas. */
function listSetorBruto(cf?: Array<{ name: string; value: string | null }>): string | null {
  return cf?.find((f) => f.name === 'Setor')?.value ?? null
}

export interface DeltaSyncResult {
  mode: 'delta'
  dryRun: boolean
  pagesScanned: number
  totalPages: number
  listInWindow: number     // vendas na janela (>= cutoff) vistas na lista
  unchanged: number        // puladas — nenhum detalhe buscado
  novas: number
  alteradas: number
  detailsFetched: number   // detalhes efetivamente buscados (só novas/alteradas)
  salesInserted: number
  salesDeleted: number
  cancelledSkipped: number
  capped: boolean          // true se o delta passou de maxDetails
  pending: number          // deltas deixados para o próximo ciclo (por causa do cap)
  dateRange: { min: string; max: string } | null
  sample: DeltaChange[]    // amostra do que mudou (até 25) — útil na revisão
}

/**
 * Sync incremental: só busca da API o que é novo ou mudou (valor, status, itens).
 * Ver bloco de comentário acima para a estratégia e os limites.
 */
export async function runMondeSyncDelta(opts: DeltaSyncOptions = {}): Promise<DeltaSyncResult> {
  const startPage = opts.startPage ?? 1
  const maxPages = opts.maxPages ?? 20
  const cutoff = opts.cutoff ?? SYNC_CUTOFF_DATE
  const maxDetails = opts.maxDetails ?? 200
  const dryRun = !!opts.dryRun

  const supabase = getSupabaseServer()

  // 1. Varre SÓ a lista (barato, sem detalhe). A lista vem da mais recente p/ a mais antiga.
  const { rows, totalPages, pagesScanned } = await scanSalesListPages({ startPage, maxPages })

  // 2. Janela 2026 (a lista já traz sale_date).
  const inWindow = rows.filter((r) => !!r.sale_date && r.sale_date >= cutoff)

  // 3. Lista de cancelamento manual (mesma semântica do runMondeSync/Edge).
  const { data: cancRows } = await supabase.from('vendas_canceladas').select('venda_numero')
  const canceladasManual = new Set((cancRows ?? []).map((r) => r.venda_numero as number))

  // 4. Estado atual no banco para os números vistos. Agrega por número: o Excel pode
  //    ter várias linhas por venda; a API colapsa em uma. valor/receita são somados.
  const seenNumeros = Array.from(new Set(inWindow.map((r) => r.sale_number)))
  interface DbAgg {
    situacao: string | null
    valor_total: number
    receitas: number
    produto: string | null
    setorBruto: string | null
    uploadIds: Set<string>
  }
  const dbState = new Map<number, DbAgg>()
  for (const numeros of chunk(seenNumeros, DELETE_BATCH)) {
    const { data: dbRows } = await supabase
      .from('vendas')
      .select('venda_numero, situacao, valor_total, receitas, produto, setor_bruto, upload_id')
      .in('venda_numero', numeros)
    for (const r of dbRows ?? []) {
      const cur = dbState.get(r.venda_numero) ?? {
        situacao: r.situacao, valor_total: 0, receitas: 0, produto: null, setorBruto: null, uploadIds: new Set<string>(),
      }
      cur.valor_total += Number(r.valor_total ?? 0)
      cur.receitas += Number(r.receitas ?? 0)
      cur.situacao = r.situacao
      if (r.produto && !cur.produto) cur.produto = r.produto
      if (r.setor_bruto && !cur.setorBruto) cur.setorBruto = r.setor_bruto
      if (r.upload_id) cur.uploadIds.add(r.upload_id)
      dbState.set(r.venda_numero, cur)
    }
  }

  // 5. Delta: novas / alteradas (status, valor bruto, receita) + canceladas-manuais presentes.
  const EPS = 0.01
  const mapStatus = (s: string) => (s === 'opened' ? 'Aberta' : 'Fechada')
  const changes: Array<{ row: SaleListRow; motivo: DeltaChange['motivo']; de?: string; para?: string }> = []
  let unchanged = 0
  for (const r of inWindow) {
    const d = dbState.get(r.sale_number)
    if (canceladasManual.has(r.sale_number)) {
      // Cancelamento manual: some do banco se ainda existir; nunca reinsere.
      if (d) changes.push({ row: r, motivo: 'cancelada-manual' })
      else unchanged++
      continue
    }
    if (!d) { changes.push({ row: r, motivo: 'nova' }); continue }
    const statusPara = mapStatus(r.status)
    if (statusPara !== (d.situacao ?? '')) {
      changes.push({ row: r, motivo: 'status', de: d.situacao ?? '—', para: statusPara }); continue
    }
    if (Math.abs(r.total_final_value - d.valor_total) >= EPS) {
      changes.push({ row: r, motivo: 'valor', de: d.valor_total.toFixed(2), para: r.total_final_value.toFixed(2) }); continue
    }
    if (Math.abs(r.total_revenue - d.receitas) >= EPS) {
      changes.push({ row: r, motivo: 'receita', de: d.receitas.toFixed(2), para: r.total_revenue.toFixed(2) }); continue
    }
    // Troca de setor: não mexe em valor/status/receita, então só a lista (custom field
    // "Setor") a revela. Sem isso, mudar o setor no Monde não refletia no dash.
    const setorPara = listSetorBruto(r.custom_fields)
    if ((setorPara ?? '') !== (d.setorBruto ?? '')) {
      changes.push({ row: r, motivo: 'setor', de: d.setorBruto ?? '—', para: setorPara ?? '—' }); continue
    }
    unchanged++
  }

  const novas = changes.filter((c) => c.motivo === 'nova').length
  const alteradas = changes.filter((c) => c.motivo === 'status' || c.motivo === 'valor' || c.motivo === 'receita' || c.motivo === 'setor').length

  // 6. Cap de segurança: as mais recentes vêm primeiro, então o excedente fica p/ o próximo ciclo.
  const capped = changes.length > maxDetails
  const toProcess = capped ? changes.slice(0, maxDetails) : changes
  const pending = capped ? changes.length - maxDetails : 0
  const sample: DeltaChange[] = toProcess.slice(0, 25).map((c) => ({
    venda_numero: c.row.sale_number, motivo: c.motivo, de: c.de, para: c.para,
  }))

  if (dryRun) {
    return {
      mode: 'delta', dryRun: true, pagesScanned, totalPages,
      listInWindow: inWindow.length, unchanged, novas, alteradas,
      detailsFetched: 0, salesInserted: 0, salesDeleted: 0, cancelledSkipped: 0,
      capped, pending, dateRange: null, sample,
    }
  }

  // Números a apagar (dedup) = tudo que será reprocessado, inclusive canceladas-manuais.
  const deltaNumeros = Array.from(new Set(toProcess.map((c) => c.row.sale_number)))
  // Detalhes a buscar: tudo menos as canceladas-manuais (essas só saem do banco).
  const fetchIds = toProcess.filter((c) => c.motivo !== 'cancelada-manual').map((c) => c.row.sale_id)

  if (deltaNumeros.length === 0) {
    return {
      mode: 'delta', dryRun: false, pagesScanned, totalPages,
      listInWindow: inWindow.length, unchanged, novas: 0, alteradas: 0,
      detailsFetched: 0, salesInserted: 0, salesDeleted: 0, cancelledSkipped: 0,
      capped: false, pending: 0, dateRange: null, sample: [],
    }
  }

  // 7. Busca o detalhe SÓ das novas/alteradas.
  const raws = await fetchSaleRaws(fetchIds)

  // 8. Cancelamento (produto/refund detectável na API) + manual.
  const cancelledCount = raws.filter((s) => isMondeSaleCancelled(s) || canceladasManual.has(s.sale_number)).length
  const activeSales = raws.filter((s) => !isMondeSaleCancelled(s) && !canceladasManual.has(s.sale_number))

  // 9. Carry-forward de produto (Excel) + uploads afetados, a partir do estado já lido.
  const existingProduto = new Map<number, string>()
  const affectedUploadIds = new Set<string>()
  for (const num of deltaNumeros) {
    const agg = dbState.get(num)
    if (!agg) continue
    if (agg.produto) existingProduto.set(num, agg.produto)
    agg.uploadIds.forEach((uid) => affectedUploadIds.add(uid))
  }

  // 10. Dedup: apaga só os números do delta.
  let salesDeleted = 0
  for (const numeros of chunk(deltaNumeros, DELETE_BATCH)) {
    const { count } = await supabase
      .from('vendas').select('*', { count: 'exact', head: true }).in('venda_numero', numeros)
    salesDeleted += count ?? 0
    const { error: delError } = await supabase.from('vendas').delete().in('venda_numero', numeros)
    if (delError) throw new Error(`Erro ao apagar lote (delta): ${delError.message}`)
  }

  // 11. Inserir as ativas (se houver) sob um novo registro de upload.
  let uploadId = ''
  let inserted = 0
  if (activeSales.length > 0) {
    const now = new Date().toISOString().slice(0, 10)
    const { data: uploadRecord, error: uploadError } = await supabase
      .from('uploads')
      .insert({
        nome_arquivo: `${MONDE_FILENAME_PREFIX}delta-${now}`,
        total_linhas: activeSales.length,
        linhas_inseridas: activeSales.length,
        linhas_atualizadas: salesDeleted,
        alertas_qualidade: [],
        status: 'success',
      })
      .select('id').single()
    if (uploadError || !uploadRecord) throw new Error(`Erro ao registrar sync delta: ${uploadError?.message}`)
    uploadId = uploadRecord.id

    const vendas = activeSales.flatMap((s) => {
      const prev = existingProduto.get(s.sale_number)
      return mapSaleToVendaLines(s).map((l) => ({
        ...l,
        produto: l.produto ?? prev ?? null,
        upload_id: uploadId,
      }))
    })
    for (let i = 0; i < vendas.length; i += INSERT_BATCH) {
      const batch = vendas.slice(i, i + INSERT_BATCH)
      const { error: insertError } = await supabase.from('vendas').insert(batch)
      if (insertError) {
        await supabase.from('uploads').update({ status: 'error' }).eq('id', uploadId)
        throw new Error(`Erro ao inserir lote delta ${Math.floor(i / INSERT_BATCH) + 1}: ${insertError.message}`)
      }
    }
    inserted = vendas.length
  }

  // 12. Limpar uploads que ficaram órfãos após o dedup (preserva o novo upload).
  await cleanOrphanUploads(supabase, Array.from(affectedUploadIds), uploadId || undefined)

  const dates = activeSales.map((s) => s.sale_date).filter(Boolean).sort()
  return {
    mode: 'delta', dryRun: false, pagesScanned, totalPages,
    listInWindow: inWindow.length, unchanged, novas, alteradas,
    detailsFetched: raws.length, salesInserted: inserted, salesDeleted, cancelledSkipped: cancelledCount,
    capped, pending,
    dateRange: dates.length ? { min: dates[0], max: dates[dates.length - 1] } : null,
    sample,
  }
}
