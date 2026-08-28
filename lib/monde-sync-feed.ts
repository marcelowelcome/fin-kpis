/**
 * Sync Monde → banco pelos FEEDS PLANOS (`sales` + `products`).
 *
 * É o ÚNICO caminho de escrita da tabela `vendas` a partir da API. Substituiu o modelo
 * "lista + detalhe (`raw`) por venda", que era a origem comum de todos os bugs de 2026
 * (ver o cabeçalho de lib/monde-feed.ts) e que, além disso, era estruturalmente cego a
 * dois problemas:
 *
 *  1. VENDA CANCELADA ficava eternamente somada. A listagem SEM `from`/`to` não devolve
 *     venda cancelada, então ela nunca voltava para o delta e nunca era apagada.
 *     Custo medido em 2026-08-27: 17 vendas, R$ 45.079,69 de valor e R$ 15.765,93 de receita.
 *  2. CANCELAMENTO PARCIAL era matematicamente invisível. O delta comparava o
 *     `total_final_value` da lista (BRUTO, inclui produto cancelado) com o `valor_total`
 *     gravado (LÍQUIDO). Em 264 de 264 vendas de 2026 com produto cancelado o bruto não
 *     se move ao cancelar um produto — a checagem não podia funcionar.
 *
 * Agora `product_status` vem pronto no feed, por linha, então os dois casos são vistos
 * de graça.
 *
 * Dois modos:
 *  - `reconcile` (janela por data, sem `synced_since`): completo e idempotente. É o que
 *    garante o número certo, porque revisita a janela inteira.
 *  - `delta` (`synced_since` = marca d'água): barato. Descobre QUAIS MESES tiveram
 *     releitura e então lê esses meses POR INTEIRO. Ler o mês inteiro é deliberado: em
 *     delta puro a venda pode vir relida sem as linhas dela (ou o contrário), e aí uma
 *     venda viva apareceria "sem produto ativo" e seria apagada por engano.
 */

import { getSupabaseServer } from './supabase'
import {
  lerJanela,
  construirLinhas,
  lerVendas,
  lerLinhas,
  janelasMensais,
  type FeedSale,
  type FeedLine,
} from './monde-feed'
import type { VendaInput } from './schemas'

const INSERT_BATCH = 500
const DELETE_BATCH = 200
export const MONDE_FILENAME_PREFIX = 'monde-api-'

/** Janela padrão do sync corrente. Vendas anteriores só são tocadas pelo rebuild. */
export const SYNC_CUTOFF_DATE = '2026-01-01'

/** Chave em `sync_state` que guarda a marca d'água do `synced_since`. */
const WATERMARK_KEY = 'feed-delta'

/**
 * Sobreposição aplicada à marca d'água. `synced_at` é o instante em que o ESPELHO leu
 * do Monde; sem folga, um registro gravado no mesmo segundo da nossa leitura anterior
 * escaparia para sempre. 30 min é folgado e o custo de reler é zero (idempotente).
 */
const WATERMARK_OVERLAP_MS = 30 * 60 * 1000

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface FeedSyncOptions {
  /** data_venda >= from. Default SYNC_CUTOFF_DATE. */
  from?: string
  /** data_venda <= to. Default hoje. */
  to?: string
  /** Modo. 'delta' usa a marca d'água; 'reconcile' varre a janela inteira. */
  mode?: 'delta' | 'reconcile'
  /** Sobrepõe a marca d'água (ISO). Só faz sentido com mode 'delta'. */
  syncedSince?: string
  /** Não grava nada — só relata. */
  dryRun?: boolean
  /** Não move a marca d'água (usado pelo rebuild, que tem cursor próprio). */
  skipWatermark?: boolean
}

export interface FeedSyncResult {
  mode: 'delta' | 'reconcile'
  dryRun: boolean
  from: string
  to: string
  syncedSince: string | null
  /** Meses efetivamente lidos por inteiro. */
  mesesLidos: string[]
  vendasLidas: number
  linhasLidas: number
  linhasInseridas: number
  linhasApagadas: number
  /** Vendas removidas por estarem canceladas por inteiro. */
  canceladasVenda: number
  /** Linhas de produto descartadas por estarem canceladas/excluídas. */
  canceladasProduto: number
  /** Vendas removidas por não terem sobrado nenhum produto ativo. */
  semLinhaAtiva: number
  /** Vendas ignoradas por constarem na lista manual `vendas_canceladas`. */
  canceladasManual: number
  indefinidoCount: number
  dateRange: { min: string; max: string } | null
  uploadId: string
  watermark: string | null
}

/** Remove uploads que ficaram sem nenhuma venda após o dedup. */
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

async function lerMarcaDagua(
  supabase: ReturnType<typeof getSupabaseServer>,
): Promise<string | null> {
  const { data } = await supabase
    .from('sync_state').select('last_done_at').eq('key', WATERMARK_KEY).maybeSingle()
  return (data?.last_done_at as string | null) ?? null
}

async function gravarMarcaDagua(
  supabase: ReturnType<typeof getSupabaseServer>,
  iso: string,
  note: string,
): Promise<void> {
  const now = new Date().toISOString()
  await supabase.from('sync_state').upsert(
    { key: WATERMARK_KEY, cursor_page: 1, running: false, last_done_at: iso, note, updated_at: now },
    { onConflict: 'key' },
  )
}

/** Prefixo YYYY-MM de uma data ISO. */
function mesDe(data: string): string {
  return data.slice(0, 7)
}

/**
 * Descobre quais meses tiveram releitura desde `syncedSince`, consultando os DOIS feeds
 * (uma venda pode ser relida sem as linhas e vice-versa). Devolve os meses, não as
 * vendas: o passo seguinte lê o mês inteiro para manter venda e linha coerentes.
 *
 * Sonda a JANELA INTEIRA de uma vez, não mês a mês: o conjunto relido é pequeno, então
 * são ~2 requisições em vez de uma por mês. Isso importa porque a Edge Function do
 * Supabase limita as requisições de SAÍDA e a versão mês-a-mês estourava o limite.
 */
async function mesesAfetados(
  from: string,
  to: string,
  syncedSince: string,
): Promise<string[]> {
  const meses = new Set<string>()
  const [vendas, linhas] = await Promise.all([
    lerVendas({ from, to, syncedSince }),
    lerLinhas({ from, to, syncedSince }),
  ])
  for (const v of vendas) if (v.sale_date) meses.add(mesDe(v.sale_date))
  for (const l of linhas) if (l.sale_date) meses.add(mesDe(l.sale_date))
  return Array.from(meses).sort()
}

/**
 * Sincroniza a janela: lê os feeds, aplica a régua de soma, apaga do banco TODOS os
 * números de venda vistos e reinsere só as linhas ativas.
 *
 * O apaga-e-reinsere por número é o que torna a operação idempotente e o que remove
 * cancelada e cancelamento parcial sem precisar de UPDATE cirúrgico: a venda cancelada
 * entra em `vistos` (é apagada) e não gera linha (não volta).
 */
export async function runFeedSync(opts: FeedSyncOptions = {}): Promise<FeedSyncResult> {
  const from = opts.from ?? SYNC_CUTOFF_DATE
  const to = opts.to ?? hojeISO()
  const mode = opts.mode ?? 'reconcile'
  const dryRun = !!opts.dryRun
  const supabase = getSupabaseServer()

  // ─── 1. Que janelas ler ─────────────────────────────────────────────────────
  let syncedSince: string | null = null
  let mesesLidos: string[]

  if (mode === 'delta') {
    const wm = opts.syncedSince ?? (await lerMarcaDagua(supabase))
    if (wm) {
      syncedSince = new Date(new Date(wm).getTime() - WATERMARK_OVERLAP_MS).toISOString()
      mesesLidos = await mesesAfetados(from, to, syncedSince)
    } else {
      // Sem marca d'água ainda: primeiro run do delta = reconciliação completa.
      mesesLidos = janelasMensais(from, to).map((m) => mesDe(m.from))
    }
  } else {
    mesesLidos = janelasMensais(from, to).map((m) => mesDe(m.from))
  }

  // ─── 2. Ler os meses afetados POR INTEIRO (sem synced_since) ────────────────
  const vendas: FeedSale[] = []
  const linhas: FeedLine[] = []
  for (const mes of janelasMensais(from, to)) {
    if (!mesesLidos.includes(mesDe(mes.from))) continue
    const { vendas: vs, linhas: ls } = await lerJanela(mes)
    vendas.push(...vs)
    linhas.push(...ls)
  }

  const maxSynced = vendas.reduce<string | null>(
    (mx, v) => (v.synced_at && (!mx || v.synced_at > mx) ? v.synced_at : mx),
    null,
  )

  if (vendas.length === 0) {
    return {
      mode, dryRun, from, to, syncedSince, mesesLidos,
      vendasLidas: 0, linhasLidas: 0, linhasInseridas: 0, linhasApagadas: 0,
      canceladasVenda: 0, canceladasProduto: 0, semLinhaAtiva: 0, canceladasManual: 0,
      indefinidoCount: 0, dateRange: null, uploadId: '', watermark: null,
    }
  }

  // ─── 3. Lista de cancelamento MANUAL ───────────────────────────────────────
  // A tabela `vendas_canceladas` foi um contorno de junho/2026, quando a API não expunha
  // cancelamento algum. Hoje as 7 entradas dela já são cobertas pela régua (os produtos
  // delas vêm `product_status = 'canceled'`), mas seguimos honrando-a: é barata e é a
  // única saída manual caso o espelho volte a errar.
  const { data: cancRows } = await supabase.from('vendas_canceladas').select('venda_numero')
  const canceladasManual = new Set((cancRows ?? []).map((r) => r.venda_numero as number))

  // ─── 4. Estado atual: carry-forward de produto + uploads afetados ──────────
  const vistosTodos = Array.from(new Set(vendas.map((v) => v.sale_number)))
  const produtoAnterior = new Map<number, string>()
  const affectedUploadIds = new Set<string>()
  let linhasApagadas = 0

  for (const numeros of chunk(vistosTodos, DELETE_BATCH)) {
    const { data: rows } = await supabase
      .from('vendas').select('venda_numero, upload_id, produto').in('venda_numero', numeros)
    for (const r of rows ?? []) {
      if (r.upload_id) affectedUploadIds.add(r.upload_id)
      if (r.produto && !produtoAnterior.has(r.venda_numero)) {
        produtoAnterior.set(r.venda_numero, r.produto as string)
      }
    }
    linhasApagadas += rows?.length ?? 0
  }

  // ─── 5. Aplicar a régua ────────────────────────────────────────────────────
  const vendasElegiveis = vendas.filter((v) => !canceladasManual.has(v.sale_number))
  const construido = construirLinhas(vendasElegiveis, linhas, { produtoAnterior })
  const manualIgnoradas = vendas.length - vendasElegiveis.length

  const indefinidoCount = new Set(
    construido.linhas.filter((l) => l.setor_grupo === 'INDEFINIDO').map((l) => l.venda_numero),
  ).size
  const datas = construido.linhas.map((l) => l.data_venda).filter(Boolean).sort()
  const dateRange = datas.length ? { min: datas[0], max: datas[datas.length - 1] } : null

  if (dryRun) {
    return {
      mode, dryRun: true, from, to, syncedSince, mesesLidos,
      vendasLidas: vendas.length, linhasLidas: linhas.length,
      linhasInseridas: 0, linhasApagadas: 0,
      canceladasVenda: construido.canceladasVenda,
      canceladasProduto: construido.canceladasProduto,
      semLinhaAtiva: construido.semLinhaAtiva,
      canceladasManual: manualIgnoradas,
      indefinidoCount, dateRange, uploadId: '', watermark: maxSynced,
    }
  }

  // ─── 6. Dedup: apaga TODOS os números vistos ───────────────────────────────
  for (const numeros of chunk(vistosTodos, DELETE_BATCH)) {
    const { error } = await supabase.from('vendas').delete().in('venda_numero', numeros)
    if (error) throw new Error(`Erro ao apagar lote para dedup: ${error.message}`)
  }

  // ─── 7. Inserir as linhas ativas ───────────────────────────────────────────
  let uploadId = ''
  let inseridas = 0
  if (construido.linhas.length > 0) {
    const { data: uploadRecord, error: uploadError } = await supabase
      .from('uploads')
      .insert({
        nome_arquivo: `${MONDE_FILENAME_PREFIX}${mode}-${hojeISO()}`,
        total_linhas: construido.linhas.length,
        linhas_inseridas: construido.linhas.length,
        linhas_atualizadas: linhasApagadas,
        alertas_qualidade: [],
        status: 'success',
      })
      .select('id').single()
    if (uploadError || !uploadRecord) {
      throw new Error(`Erro ao registrar sync: ${uploadError?.message}`)
    }
    uploadId = uploadRecord.id

    const comUpload = construido.linhas.map((l: VendaInput) => ({ ...l, upload_id: uploadId }))
    for (let i = 0; i < comUpload.length; i += INSERT_BATCH) {
      const batch = comUpload.slice(i, i + INSERT_BATCH)
      const { error } = await supabase.from('vendas').insert(batch)
      if (error) {
        await supabase.from('uploads').update({ status: 'error' }).eq('id', uploadId)
        throw new Error(`Erro ao inserir lote ${Math.floor(i / INSERT_BATCH) + 1}: ${error.message}`)
      }
    }
    inseridas = comUpload.length
  }

  // ─── 8. Faxina e marca d'água ──────────────────────────────────────────────
  await cleanOrphanUploads(supabase, Array.from(affectedUploadIds), uploadId || undefined)

  if (!opts.skipWatermark && maxSynced) {
    await gravarMarcaDagua(
      supabase,
      maxSynced,
      `${mode}: ${mesesLidos.length} mês(es), ${inseridas} linhas, ${construido.canceladasVenda} cancelada(s)`,
    )
  }

  return {
    mode, dryRun: false, from, to, syncedSince, mesesLidos,
    vendasLidas: vendas.length, linhasLidas: linhas.length,
    linhasInseridas: inseridas, linhasApagadas,
    canceladasVenda: construido.canceladasVenda,
    canceladasProduto: construido.canceladasProduto,
    semLinhaAtiva: construido.semLinhaAtiva,
    canceladasManual: manualIgnoradas,
    indefinidoCount, dateRange, uploadId, watermark: maxSynced,
  }
}
