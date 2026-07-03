/**
 * Rebuild incremental da base Monde dos últimos 3 anos, em CHUNKS resumáveis.
 *
 * Por quê chunked: a janela de 3 anos tem ~500 páginas / ~25 mil vendas — não cabe
 * numa única invocação (Vercel limita a 300s). Cada chamada processa um pedaço de
 * páginas a partir de um cursor (tabela sync_state) e avança; o ciclo completo se
 * espalha por vários dias. Quando termina, só reinicia após `intervalDays`.
 *
 * Sem perda de dados: usa runMondeSync (mode 'full') que deduplica por NÚMERO DA
 * VENDA — cada chunk substitui só os números que buscou. Só insere vendas >= cutoff.
 *
 * Cron sugerido: diário (vercel.json) → progride ~40 págs/dia; o ciclo completo leva
 * ~vários dias (mais que antes, pois cada venda exige uma chamada de detalhe na API de
 * Dados), depois aguarda 10 dias desde a conclusão para recomeçar.
 */

import { getSupabaseServer } from './supabase'
import { runMondeSync, type SyncRunResult } from './monde-sync-runner'

const STATE_KEY = 'rebuild-3y'
// 40 págs × 50 vendas = 2.000 detalhes/execução (~200s @ 12 req/s), dentro do teto de
// 300s do Vercel. Menor que antes (60) porque a API de Dados exige 1 detalhe por venda
// (ver lib/monde-client): o ciclo completo leva mais dias, mas o resultado é o mesmo.
const DEFAULT_PAGES_PER_RUN = 40
const DEFAULT_INTERVAL_DAYS = 10
const REBUILD_YEARS = 3

/** Data de corte = hoje menos N anos (YYYY-MM-DD). */
function cutoffISO(years: number): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - years)
  return d.toISOString().slice(0, 10)
}

export interface RebuildResult {
  status: 'skipped' | 'started' | 'progress' | 'completed'
  reason?: string
  cursorPage: number
  nextPage: number
  cutoff: string
  running: boolean
  chunk?: SyncRunResult
}

export async function runRebuildChunk(opts: {
  pagesPerRun?: number
  intervalDays?: number
  force?: boolean
} = {}): Promise<RebuildResult> {
  const pagesPerRun = opts.pagesPerRun ?? DEFAULT_PAGES_PER_RUN
  const intervalDays = opts.intervalDays ?? DEFAULT_INTERVAL_DAYS
  const cutoff = cutoffISO(REBUILD_YEARS)
  const supabase = getSupabaseServer()

  const { data: state, error } = await supabase
    .from('sync_state').select('*').eq('key', STATE_KEY).single()
  if (error || !state) {
    throw new Error(`sync_state indisponível — aplique supabase/migration-sync-state.sql. (${error?.message ?? 'sem linha'})`)
  }

  let running = state.running as boolean
  let cursorPage = state.cursor_page as number

  // Sem ciclo em andamento: só começa um novo se o intervalo passou (ou force).
  if (!running) {
    const lastDone = state.last_done_at ? new Date(state.last_done_at).getTime() : 0
    const due = opts.force || !lastDone || (Date.now() - lastDone) >= intervalDays * 86_400_000
    if (!due) {
      const nextDueISO = new Date(lastDone + intervalDays * 86_400_000).toISOString()
      return { status: 'skipped', reason: `próximo ciclo após ${nextDueISO}`, cursorPage, nextPage: cursorPage, cutoff, running: false }
    }
    running = true
    cursorPage = 1
  }

  // Processa um chunk (dedup por número da venda; insere só vendas >= cutoff).
  const chunk = await runMondeSync({ mode: 'full', startPage: cursorPage, maxPages: pagesPerRun, cutoff })

  const reachedEnd = chunk.nextPage > chunk.totalPages
  const done = reachedEnd || chunk.reachedCutoff
  const nowISO = new Date().toISOString()

  if (done) {
    await supabase.from('sync_state').update({
      running: false,
      cursor_page: 1,
      last_done_at: nowISO,
      note: `ciclo completo até pág ${chunk.nextPage - 1} (cutoff ${cutoff})`,
      updated_at: nowISO,
    }).eq('key', STATE_KEY)
    return { status: 'completed', cursorPage, nextPage: chunk.nextPage, cutoff, running: false, chunk }
  }

  await supabase.from('sync_state').update({
    running: true,
    cursor_page: chunk.nextPage,
    note: `pág ${cursorPage}→${chunk.nextPage - 1}; +${chunk.salesInserted} vendas`,
    updated_at: nowISO,
  }).eq('key', STATE_KEY)
  return { status: cursorPage === 1 ? 'started' : 'progress', cursorPage, nextPage: chunk.nextPage, cutoff, running: true, chunk }
}
