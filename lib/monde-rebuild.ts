/**
 * Rebuild da base Monde dos últimos 3 anos, em CHUNKS resumáveis.
 *
 * Por que chunked: a janela de 3 anos não cabe numa invocação (Vercel limita a 300s).
 * Cada chamada processa alguns MESES a partir de um cursor (`sync_state.cursor_page`,
 * aqui interpretado como índice de mês) e avança. Quando fecha o ciclo, só recomeça
 * após `intervalDays`.
 *
 * Mudou em 2026-08-27: o cursor era de PÁGINAS da lista, porque o sync antigo abria
 * venda por venda. Agora o sync lê feeds planos por janela de data, então o cursor
 * natural é o mês. Além de mais simples, isso conserta um limite real do modelo antigo:
 * a lista vem ordenada por `sale_date DESC`, então um cursor de páginas varria sempre a
 * mesma faixa recente e nunca alcançava o passado de forma previsível.
 *
 * Cada mês é reconciliado por completo (apaga os números daquele mês e reinsere só as
 * linhas ativas), então o rebuild é idempotente e corrige cancelamento retroativo.
 */

import { getSupabaseServer } from './supabase'
import { runFeedSync, type FeedSyncResult } from './monde-sync-feed'
import { janelasMensais } from './monde-feed'

const STATE_KEY = 'rebuild-3y'
/** Meses reconciliados por execução. 2 meses ≈ 4 janelas de feed (~25s), com folga
 *  larga no teto de 300s do Vercel mesmo se o espelho estiver lento. */
const DEFAULT_MONTHS_PER_RUN = 2
const DEFAULT_INTERVAL_DAYS = 10
const REBUILD_YEARS = 3

/** Primeiro dia do mês de hoje menos N anos (YYYY-MM-DD). */
function inicioJanela(years: number): string {
  const d = new Date()
  d.setUTCFullYear(d.getUTCFullYear() - years)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function hojeISO(): string {
  return new Date().toISOString().slice(0, 10)
}

export interface RebuildResult {
  status: 'skipped' | 'started' | 'progress' | 'completed'
  reason?: string
  /** Índice do mês em que este chunk começou (1-based). */
  cursorMes: number
  proximoMes: number
  totalMeses: number
  janela: { from: string; to: string }
  mesesProcessados: Array<{ from: string; to: string }>
  running: boolean
  chunks: FeedSyncResult[]
}

export async function runRebuildChunk(opts: {
  monthsPerRun?: number
  intervalDays?: number
  force?: boolean
} = {}): Promise<RebuildResult> {
  const monthsPerRun = opts.monthsPerRun ?? DEFAULT_MONTHS_PER_RUN
  const intervalDays = opts.intervalDays ?? DEFAULT_INTERVAL_DAYS
  const from = inicioJanela(REBUILD_YEARS)
  const to = hojeISO()
  const meses = janelasMensais(from, to)
  const supabase = getSupabaseServer()

  const { data: state, error } = await supabase
    .from('sync_state').select('*').eq('key', STATE_KEY).single()
  if (error || !state) {
    throw new Error(
      `sync_state indisponível — aplique supabase/migration-sync-state.sql. (${error?.message ?? 'sem linha'})`,
    )
  }

  let running = state.running as boolean
  let cursorMes = state.cursor_page as number

  // Sem ciclo em andamento: só começa um novo se o intervalo passou (ou force).
  if (!running) {
    const lastDone = state.last_done_at ? new Date(state.last_done_at).getTime() : 0
    const due = opts.force || !lastDone || (Date.now() - lastDone) >= intervalDays * 86_400_000
    if (!due) {
      const nextDue = new Date(lastDone + intervalDays * 86_400_000).toISOString()
      return {
        status: 'skipped', reason: `próximo ciclo após ${nextDue}`,
        cursorMes, proximoMes: cursorMes, totalMeses: meses.length,
        janela: { from, to }, mesesProcessados: [], running: false, chunks: [],
      }
    }
    running = true
    cursorMes = 1
  }
  if (cursorMes < 1 || cursorMes > meses.length) cursorMes = 1

  // Processa até `monthsPerRun` meses a partir do cursor.
  const fatia = meses.slice(cursorMes - 1, cursorMes - 1 + monthsPerRun)
  const chunks: FeedSyncResult[] = []
  for (const mes of fatia) {
    // skipWatermark: o rebuild varre o passado e não deve mover a marca d'água do
    // delta corrente — senão o delta acharia que já leu tudo até agora.
    chunks.push(await runFeedSync({ mode: 'reconcile', from: mes.from, to: mes.to, skipWatermark: true }))
  }

  const proximoMes = cursorMes + fatia.length
  const done = proximoMes > meses.length
  const nowISO = new Date().toISOString()
  const inseridas = chunks.reduce((s, c) => s + c.linhasInseridas, 0)
  const canceladas = chunks.reduce((s, c) => s + c.canceladasVenda, 0)

  if (done) {
    await supabase.from('sync_state').update({
      running: false, cursor_page: 1, last_done_at: nowISO,
      note: `ciclo completo: ${meses.length} meses desde ${from}`,
      updated_at: nowISO,
    }).eq('key', STATE_KEY)
    return {
      status: 'completed', cursorMes, proximoMes, totalMeses: meses.length,
      janela: { from, to }, mesesProcessados: fatia, running: false, chunks,
    }
  }

  await supabase.from('sync_state').update({
    running: true, cursor_page: proximoMes,
    note: `mês ${cursorMes}→${proximoMes - 1} de ${meses.length}; +${inseridas} linhas, ${canceladas} cancelada(s)`,
    updated_at: nowISO,
  }).eq('key', STATE_KEY)

  return {
    status: cursorMes === 1 ? 'started' : 'progress',
    cursorMes, proximoMes, totalMeses: meses.length,
    janela: { from, to }, mesesProcessados: fatia, running: true, chunks,
  }
}
