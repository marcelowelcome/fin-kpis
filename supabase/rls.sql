-- =============================================================
-- DashWT — Row Level Security (MVP)
-- Ferramenta interna: autenticados podem ler tudo.
-- Escritas passam por API Routes com service role key (bypass RLS).
-- =============================================================

ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE metas ENABLE ROW LEVEL SECURITY;

-- Leitura para usuários autenticados
CREATE POLICY "Authenticated users can read uploads"
  ON uploads FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read vendas"
  ON vendas FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can read metas"
  ON metas FOR SELECT
  TO authenticated
  USING (true);
