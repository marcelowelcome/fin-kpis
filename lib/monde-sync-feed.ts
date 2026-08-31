/**
 * Sync Monde → banco pelos FEEDS PLANOS (`sales` + `products`).
 *
 * É o ÚNICO caminho de escrita da tabela `vendas` a partir da API. Substituiu o modelo
 * "lista + detalhe (`raw`) por venda", que era a origem comum de todos os bugs de 2026
 * (ver o cabeçalho de lib/monde-feed.ts) e que era estruturalmente cego a dois erros:
 *
 *  1. VENDA CANCELADA ficava eternamente somada. A listagem SEM `from`/`to` não devolve
 *     venda cancelada, então ela nunca voltava ao delta e nunca era apagada.
 *  2. CANCELAMENTO PARCIAL era matematicamente invisível: o delta comparava o
 *     `total_final_value` da lista (BRUTO) com o `valor_total` gravado (LÍQUIDO), e em
 *     264/264 vendas de 2026 com produto cancelado o bruto não se move.
 *
 * ── Escrita: por que mês a mês, e por que apagar e gravar no MESMO lote ──────────
 * A primeira versão deste arquivo lia a janela inteira, apagava TODOS os números vistos
 * e só então criava o registro de upload e inseria. Em 2026-08-31 isso apagou agosto
 * inteiro (1.069 linhas) e 329 linhas de julho: a Edge Function foi morta pelo limite de
 * tempo entre o apagar e o inserir. Como o registro de upload só nascia depois do
 * delete, o estrago não deixou nem rastro de erro — o dashboard zerou em silêncio.
 *
 * Agora:
 *  - o registro de upload nasce ANTES de qualquer delete, então toda escrita tem rastro;
 *  - processa um MÊS por vez e, dentro do mês, apaga e insere no MESMO lote de ~150
 *    números: uma morte súbita perde no máximo um lote, que a próxima rodada refaz;
 *  - TRAVA: mês que devolve vendas mas ZERO linhas de produto é pulado inteiro. Isso é
 *    sintoma de falha no feed `products`, e sem a trava toda venda do mês pareceria
 *    "sem produto ativo" e seria apagada.
 */

import { getSupabaseServer } from './supabase'
import {
  lerJanela,
  construirLinhas,
  contarVendas,
  contarLinhas,
  janelasMensais,
} from './monde-feed'
import type { VendaInput } from './schemas'

/** Números de venda apagados e reinseridos por lote. Menor = menos perda se morrer. */
const CHUNK_NUMEROS = 150
const INSERT_BATCH = 500
export const MONDE_FILENAME_PREFIX = 'monde-api-'

/** Janela padrão do sync corrente. Datas anteriores só são tocadas pelo rebuild. */
export const SYNC_CUTOFF_DATE = '2026-01-01'

/** Chave em `sync_state` que guarda a marca d'água do `synced_since`. */
const WATERMARK_KEY = 'feed-delta'

/**
 * Folga da marca d'água. `synced_at` é o instante em que o ESPELHO leu do Monde; sem
 * folga, um registro gravado no mesmo segundo da leitura anterior escaparia para sempre.
 * Reler é idempotente, então o custo é zero.
 */
const WATERMARK_OVERLAP_MS = 30 * 60 * 1000

/**
 * Meses processados por invocação. A Edge Function irmã é morta com IDLE_TIMEOUT aos
 * 150s e ler um mês inteiro dos dois feeds custa ~10s. Aqui (Node) o teto é maior, mas
 * mantemos o mesmo comportamento para que os dois caminhos convirjam igual.
 */
const MAX_MESES_POR_RUN = 4

/**
 * Marca d'água POR MÊS, em `sync_state.note` como JSON.
 *
 * Uma marca global não converge quando o trabalho não cabe numa invocação: se a rodada
 * processa 2 dos 5 meses afetados e não avança a marca, a próxima detecta os MESMOS 5 e
 * refaz os 2 primeiros para sempre. Com marca por mês, o mês já reconciliado sai da fila.
 */
type MarcaPorMes = Record<string, string>

function lerMarcas(note: string | null): MarcaPorMes {
  if (!note) return {}
  try {
    const o = JSON.parse(note)
    return o && typeof o === 'object' && o.meses ? (o.meses as MarcaPorMes) : {}
  } catch {
    // Antes de 2026-08-31 o campo guardava texto livre; tratar como "sem marca".
    return {}
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function mesDe(data: string): string {
  return data.slice(0, 7)
}

export interface FeedSyncOptions {
  /** data_venda >= from. Default SYNC_CUTOFF_DATE. */
  from?: string
  /** data_venda <= to. Default hoje. */
  to?: string
  /** 'delta' usa a marca d'água; 'reconcile' varre a janela inteira. */
  mode?: 'delta' | 'reconcile'
  /** Sobrepõe a marca d'água (ISO). Só faz sentido com mode 'delta'. */
  syncedSince?: string
  /** Não grava nada — só relata. */
  dryRun?: boolean
  /** Não move a marca d'água (para backfill pontual). */
  skipWatermark?: boolean
}

export interface FeedSyncResult {
  mode: 'delta' | 'reconcile'
  dryRun: boolean
  from: string
  to: string
  syncedSince: string | null
  mesesLidos: string[]
  /** Meses pulados pela trava de segurança (vendas sem nenhuma linha de produto). */
  mesesPulados: string[]
  /** Meses afetados que não couberam nesta rodada; a próxima os pega. */
  pendentes: number
  vendasLidas: number
  linhasLidas: number
  linhasInseridas: number
  linhasApagadas: number
  canceladasVenda: number
  canceladasProduto: number
  semLinhaAtiva: number
  canceladasManual: number
  indefinidoCount: number
  dateRange: { min: string; max: string } | null
  uploadId: string
  watermark: string | null
}

/**
 * Remove uploads que ficaram sem nenhuma venda. Faz UMA consulta agregando os
 * upload_id ainda em uso, em vez de um COUNT por upload: a versão anterior era O(n)
 * idas ao banco e foi a principal suspeita de estourar o tempo da Edge Function.
 */
async function cleanOrphanUploads(
  supabase: ReturnType<typeof getSupabaseServer>,
  uploadIds: string[],
  keepId?: string,
): Promise<void> {
  const candidatos = uploadIds.filter((id) => id !== keepId)
  if (candidatos.length === 0) return

  const emUso = new Set<string>()
  for (const lote of chunk(candidatos, 100)) {
    const { data } = await supabase
      .from('vendas').select('upload_id').in('upload_id', lote).limit(10000)
    for (const r of data ?? []) if (r.upload_id) emUso.add(r.upload_id as string)
  }

  const orfaos = candidatos.filter((id) => !emUso.has(id))
  for (const lote of chunk(orfaos, 100)) {
    await supabase.from('uploads').delete().in('id', lote)
  }
}

async function lerEstado(
  supabase: ReturnType<typeof getSupabaseServer>,
): Promise<{ global: string | null; marcas: MarcaPorMes }> {
  const { data } = await supabase
    .from('sync_state').select('last_done_at, note').eq('key', WATERMARK_KEY).maybeSingle()
  return {
    global: (data?.last_done_at as string | null) ?? null,
    marcas: lerMarcas((data?.note as string | null) ?? null),
  }
}

/**
 * Descobre quais meses o espelho releu desde `syncedSince`, consultando os DOIS feeds
 * (uma venda pode ser relida sem as linhas e vice-versa). Usa só a CONTAGEM: pedir uma
 * linha e ler o `total` custa 2 requisições por mês, contra as dezenas que a paginação
 * completa custava.
 */
async function mesesAfetados(
  meses: Array<{ from: string; to: string }>,
  global: string | null,
  marcas: MarcaPorMes,
): Promise<{ afetados: Array<{ from: string; to: string }>; menorDesde: string | null }> {
  const afetados: Array<{ from: string; to: string }> = []
  let menorDesde: string | null = null
  for (const mes of meses) {
    const rotulo = mesDe(mes.from)
    const marcaDoMes = marcas[rotulo]
    const base = marcaDoMes ?? global
    if (!base) { afetados.push(mes); continue }
    // Mês COM marca própria já foi reconciliado inteiro: pergunta a partir de 1 ms
    // depois da marca. Sem esse +1 ms o próprio registro que definiu a marca volta na
    // contagem (o filtro é inclusivo) e o mês é redetectado para sempre.
    const desde = marcaDoMes
      ? new Date(new Date(marcaDoMes).getTime() + 1).toISOString()
      : new Date(new Date(base).getTime() - WATERMARK_OVERLAP_MS).toISOString()
    if (!menorDesde || desde < menorDesde) menorDesde = desde
    const [nv, nl] = await Promise.all([
      contarVendas({ ...mes, syncedSince: desde }),
      contarLinhas({ ...mes, syncedSince: desde }),
    ])
    if (nv > 0 || nl > 0) afetados.push(mes)
  }
  afetados.sort((a, b) => a.from.localeCompare(b.from))
  return { afetados, menorDesde }
}

/**
 * Sincroniza a janela. Lê os feeds mês a mês, aplica a régua de soma e reescreve cada
 * mês apagando e inserindo no mesmo lote de números.
 *
 * O apaga-e-reinsere por número é o que torna a operação idempotente e o que remove
 * cancelada e cancelamento parcial sem UPDATE cirúrgico: a venda cancelada entra no
 * lote apagado e não gera linha de volta.
 */
export async function runFeedSync(opts: FeedSyncOptions = {}): Promise<FeedSyncResult> {
  const from = opts.from ?? SYNC_CUTOFF_DATE
  const to = opts.to ?? hojeISO()
  const mode = opts.mode ?? 'reconcile'
  const dryRun = !!opts.dryRun
  const supabase = getSupabaseServer()

  const todosMeses = janelasMensais(from, to)

  // ── 1. Quais meses ler ────────────────────────────────────────────────────
  let syncedSince: string | null = null
  let aLer = todosMeses
  let marcas: MarcaPorMes = {}
  let pendentes = 0

  if (mode === 'delta') {
    const estado = await lerEstado(supabase)
    marcas = estado.marcas
    const global = opts.syncedSince ?? estado.global
    if (global || Object.keys(marcas).length > 0) {
      const r = await mesesAfetados(todosMeses, global, marcas)
      syncedSince = r.menorDesde
      pendentes = Math.max(0, r.afetados.length - MAX_MESES_POR_RUN)
      aLer = r.afetados.slice(0, MAX_MESES_POR_RUN)
    }
    // Sem marca nenhuma: primeiro run do delta = reconciliação completa.
  }

  const vazio: FeedSyncResult = {
    mode, dryRun, from, to, syncedSince,
    mesesLidos: [], mesesPulados: [], pendentes: 0,
    vendasLidas: 0, linhasLidas: 0, linhasInseridas: 0, linhasApagadas: 0,
    canceladasVenda: 0, canceladasProduto: 0, semLinhaAtiva: 0, canceladasManual: 0,
    indefinidoCount: 0, dateRange: null, uploadId: '', watermark: null,
  }
  if (aLer.length === 0) return vazio

  // ── 2. Cancelamento MANUAL (contorno de junho/2026) ───────────────────────
  // As 7 entradas já são cobertas pela régua (os produtos delas vêm `canceled`), mas
  // seguimos honrando: é barato e é a única saída manual se o espelho voltar a errar.
  const { data: cancRows } = await supabase.from('vendas_canceladas').select('venda_numero')
  const canceladasManual = new Set((cancRows ?? []).map((r) => r.venda_numero as number))

  // ── 3. Registro de upload ANTES de qualquer delete ────────────────────────
  // Sem isso, uma morte entre apagar e inserir não deixa rastro nenhum — foi o que
  // escondeu a perda de agosto/2026 até o dashboard zerar.
  let uploadId = ''
  if (!dryRun) {
    const { data: up, error } = await supabase
      .from('uploads')
      .insert({
        nome_arquivo: `${MONDE_FILENAME_PREFIX}${mode}-${hojeISO()}`,
        total_linhas: 0, linhas_inseridas: 0, linhas_atualizadas: 0,
        // 'warning' = em andamento. A tabela só aceita success/warning/error
        // (schema.sql:21), então é o rótulo disponível para "ainda não terminou":
        // um registro que fique em 'warning' significa rodada morta no meio.
        alertas_qualidade: [], status: 'warning',
      })
      .select('id').single()
    if (error || !up) throw new Error(`Erro ao registrar sync: ${error?.message}`)
    uploadId = up.id
  }

  // ── 4. Um mês por vez ─────────────────────────────────────────────────────
  const mesesLidos: string[] = []
  const mesesPulados: string[] = []
  const affectedUploadIds = new Set<string>()
  const todasDatas: string[] = []
  const vendasIndefinidas = new Set<number>()
  let vendasLidas = 0, linhasLidas = 0, inseridas = 0, apagadas = 0
  let canceladasVenda = 0, canceladasProduto = 0, semLinhaAtiva = 0, manualIgnoradas = 0
  let maxSynced: string | null = null

  try {
    for (const mes of aLer) {
      const rotulo = mesDe(mes.from)
      const { vendas, linhas } = await lerJanela(mes)
      vendasLidas += vendas.length
      linhasLidas += linhas.length

      // TRAVA: vendas sem nenhuma linha de produto = falha do feed `products`.
      // Sem ela, todas as vendas do mês seriam classificadas "sem produto ativo" e
      // apagadas. Foi assim que agosto/2026 sumiu.
      if (vendas.length > 0 && linhas.length === 0) {
        mesesPulados.push(rotulo)
        continue
      }
      if (vendas.length === 0) continue

      let maxDoMes: string | null = null
      for (const v of vendas) {
        if (v.synced_at && (!maxSynced || v.synced_at > maxSynced)) maxSynced = v.synced_at
        if (v.synced_at && (!maxDoMes || v.synced_at > maxDoMes)) maxDoMes = v.synced_at
      }

      const elegiveis = vendas.filter((v) => !canceladasManual.has(v.sale_number))
      manualIgnoradas += vendas.length - elegiveis.length

      // Carry-forward do produto já gravado (rede de segurança; hoje a API resolve 100%).
      const numeros = Array.from(new Set(vendas.map((v) => v.sale_number)))
      const produtoAnterior = new Map<number, string>()
      for (const lote of chunk(numeros, CHUNK_NUMEROS)) {
        const { data: rows } = await supabase
          .from('vendas').select('venda_numero, upload_id, produto').in('venda_numero', lote)
        for (const r of rows ?? []) {
          if (r.upload_id) affectedUploadIds.add(r.upload_id as string)
          if (r.produto && !produtoAnterior.has(r.venda_numero)) {
            produtoAnterior.set(r.venda_numero, r.produto as string)
          }
        }
      }

      const c = construirLinhas(elegiveis, linhas, { produtoAnterior })
      canceladasVenda += c.canceladasVenda
      canceladasProduto += c.canceladasProduto
      semLinhaAtiva += c.semLinhaAtiva

      for (const l of c.linhas) {
        todasDatas.push(l.data_venda)
        if (l.setor_grupo === 'INDEFINIDO') vendasIndefinidas.add(l.venda_numero)
      }

      if (dryRun) { mesesLidos.push(rotulo); continue }

      const porVenda = new Map<number, VendaInput[]>()
      for (const l of c.linhas) {
        const arr = porVenda.get(l.venda_numero)
        if (arr) arr.push(l); else porVenda.set(l.venda_numero, [l])
      }

      // Apaga e insere no MESMO lote: morte súbita perde só este lote.
      for (const lote of chunk(numeros, CHUNK_NUMEROS)) {
        const { error: delErr } = await supabase.from('vendas').delete().in('venda_numero', lote)
        if (delErr) throw new Error(`Erro ao apagar lote (${rotulo}): ${delErr.message}`)
        apagadas += lote.length

        const novas = lote.flatMap((n) => (porVenda.get(n) ?? []).map((l) => ({ ...l, upload_id: uploadId })))
        for (let i = 0; i < novas.length; i += INSERT_BATCH) {
          const { error: insErr } = await supabase.from('vendas').insert(novas.slice(i, i + INSERT_BATCH))
          if (insErr) throw new Error(`Erro ao inserir lote (${rotulo}): ${insErr.message}`)
        }
        inseridas += novas.length
      }

      // Mês reconciliado: grava a marca dele para sair da fila na próxima rodada.
      if (maxDoMes) marcas[rotulo] = maxDoMes
      mesesLidos.push(rotulo)
    }
  } catch (err) {
    if (uploadId) {
      await supabase.from('uploads')
        .update({ status: 'error', linhas_inseridas: inseridas, total_linhas: inseridas })
        .eq('id', uploadId)
    }
    throw err
  }

  const datas = todasDatas.sort()
  const dateRange = datas.length ? { min: datas[0], max: datas[datas.length - 1] } : null

  if (dryRun) {
    return {
      ...vazio, mesesLidos, mesesPulados, pendentes,
      vendasLidas, linhasLidas, dryRun: true,
      canceladasVenda, canceladasProduto, semLinhaAtiva, canceladasManual: manualIgnoradas,
      indefinidoCount: vendasIndefinidas.size, dateRange, watermark: maxSynced,
    }
  }

  // ── 5. Fecha o upload, faxina e marca d'água ──────────────────────────────
  await supabase.from('uploads')
    .update({ status: 'success', total_linhas: inseridas, linhas_inseridas: inseridas, linhas_atualizadas: apagadas })
    .eq('id', uploadId)

  await cleanOrphanUploads(supabase, Array.from(affectedUploadIds), uploadId)

  // Só move a marca d'água se NENHUM mês foi pulado: pular é sinal de leitura
  // incompleta, e avançar a marca faria o mês pulado nunca mais ser revisitado.
  // Mês pulado pela trava NÃO recebe marca — continua na fila até ser lido inteiro.
  if (!opts.skipWatermark && mesesLidos.length > 0) {
    const resumo = `${mode}: ${mesesLidos.join(', ')} · ${inseridas} linhas · ` +
      `${canceladasVenda} cancelada(s)` +
      (mesesPulados.length ? ` · PULADOS: ${mesesPulados.join(', ')}` : '') +
      (pendentes ? ` · ${pendentes} mês(es) na fila` : '')
    await supabase.from('sync_state').upsert({
      key: WATERMARK_KEY, cursor_page: 1, running: false,
      last_done_at: maxSynced ?? null,
      note: JSON.stringify({ resumo, meses: marcas }),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'key' })
  }

  return {
    mode, dryRun: false, from, to, syncedSince,
    mesesLidos, mesesPulados, pendentes,
    vendasLidas, linhasLidas, linhasInseridas: inseridas, linhasApagadas: apagadas,
    canceladasVenda, canceladasProduto, semLinhaAtiva, canceladasManual: manualIgnoradas,
    indefinidoCount: vendasIndefinidas.size, dateRange, uploadId, watermark: maxSynced,
  }
}
