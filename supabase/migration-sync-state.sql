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

-- Linha única usada pelo rebuild de 3 anos.
INSERT INTO sync_state (key) VALUES ('rebuild-3y')
ON CONFLICT (key) DO NOTHING;

-- Apenas o service_role (cron) acessa; RLS ligado sem policy = negado para anon/auth.
ALTER TABLE sync_state ENABLE ROW LEVEL SECURITY;
