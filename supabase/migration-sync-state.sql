-- =============================================================
-- Migration: sync_state
-- Cursor de progresso do rebuild incremental da base Monde (últimos 3 anos).
-- Aplicar no Supabase (SQL Editor) antes de ativar o cron /api/cron/monde-rebuild.
-- =============================================================

CREATE TABLE IF NOT EXISTS sync_state (
  key          TEXT PRIMARY KEY,
  cursor_page  INTEGER NOT NULL DEFAULT 1,  -- próxima página a processar no ciclo atual
  running      BOOLEAN NOT NULL DEFAULT false, -- ciclo de rebuild em andamento?
  last_done_at TIMESTAMPTZ,                 -- fim do último ciclo completo
  note         TEXT,                        -- diagnóstico do último run
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- Linha única usada pelo rebuild de 3 anos (lib/monde-rebuild.ts).
-- Aqui `cursor_page` é o índice do MÊS na janela de 3 anos, não uma página de lista.
INSERT INTO sync_state (key) VALUES ('rebuild-3y')
ON CONFLICT (key) DO NOTHING;

-- Marca d'água do sync delta por feeds (lib/monde-sync-feed.ts e a Edge Function
-- monde-sync). `last_done_at` guarda o maior `synced_at` já lido do espelho; o delta
-- pergunta ao Monde só o que foi relido depois disso, com 30 min de folga.
-- O código faz upsert desta linha, então ela não é obrigatória — está aqui para que um
-- ambiente novo já nasça com o estado explícito.
INSERT INTO sync_state (key) VALUES ('feed-delta')
ON CONFLICT (key) DO NOTHING;

-- Apenas o service_role (cron) acessa; RLS ligado sem policy = negado para anon/auth.
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;
