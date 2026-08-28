/**
 * Entradas de sincronização Monde → banco.
 *
 * Este arquivo era a implementação do sync "lista + detalhe (`raw`) por venda". Toda a
 * lógica foi para lib/monde-sync-feed.ts, que lê os FEEDS PLANOS (`sales` + `products`)
 * — ver o cabeçalho de lá para o histórico de bugs que motivou a troca.
 *
 * O que sobrou aqui são os dois nomes que as rotas já chamavam, agora delegando:
 *   runMondeSync       → reconciliação da janela (completa, garante o número)
 *   runMondeSyncDelta  → delta pela marca d'água (barato, para o botão/cron)
 *
 * ATENÇÃO: as rotas do Vercel (/api/monde/sync, /api/cron/*) só funcionam se
 * MONDE_DATA_API_KEY estiver nas env vars do Vercel. Hoje ela NÃO está — o caminho de
 * escrita em produção é a Edge Function `monde-sync` do Supabase (chamada pelo pg_cron
 * e pelo botão "Atualizar"). Estas rotas servem para execução local e backfill manual.
 */

import { runFeedSync, SYNC_CUTOFF_DATE, MONDE_FILENAME_PREFIX, type FeedSyncResult } from './monde-sync-feed'

export { SYNC_CUTOFF_DATE, MONDE_FILENAME_PREFIX }
export type { FeedSyncResult }

export interface SyncOptions {
  /** 'full' varre desde 1900 (backfill); 'incremental' usa a janela corrente. */
  mode?: 'incremental' | 'full'
  /** data_venda >= from. Sobrepõe o default do modo. */
  from?: string
  /** data_venda <= to. Default hoje. */
  to?: string
  /** Compatibilidade: mesmo efeito de `from`. */
  cutoff?: string
  dryRun?: boolean
}

/** Reconciliação: lê a janela inteira e reescreve o que ela cobre. Idempotente. */
export async function runMondeSync(opts: SyncOptions = {}): Promise<FeedSyncResult> {
  const from = opts.from ?? opts.cutoff ?? (opts.mode === 'full' ? '2015-01-01' : SYNC_CUTOFF_DATE)
  return runFeedSync({ mode: 'reconcile', from, to: opts.to, dryRun: opts.dryRun })
}

export interface DeltaSyncOptions {
  from?: string
  to?: string
  cutoff?: string
  /** Sobrepõe a marca d'água (ISO). */
  syncedSince?: string
  dryRun?: boolean
}

/** Delta: só os meses que o espelho releu desde a última marca d'água. */
export async function runMondeSyncDelta(opts: DeltaSyncOptions = {}): Promise<FeedSyncResult> {
  return runFeedSync({
    mode: 'delta',
    from: opts.from ?? opts.cutoff ?? SYNC_CUTOFF_DATE,
    to: opts.to,
    syncedSince: opts.syncedSince,
    dryRun: opts.dryRun,
  })
}
