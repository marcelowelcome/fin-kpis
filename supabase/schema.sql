-- =============================================================
-- DashWT — Schema SQL
-- Dashboard Executivo de Vendas · Welcome Trips
-- =============================================================
-- NOTA: Venda Nº é o número do pedido, não um ID único por linha.
-- Um pedido pode ter múltiplos itens/produtos. A chave primária
-- é um SERIAL auto-incremento. Deduplicação é por upload:
-- a cada novo upload, os registros do upload anterior são
-- substituídos (delete + insert), garantindo estado atualizado.
-- =============================================================

-- Tabela: uploads (DEVE ser criada antes de vendas por causa da FK)
CREATE TABLE IF NOT EXISTS uploads (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_arquivo        TEXT NOT NULL,
  uploaded_at         TIMESTAMPTZ DEFAULT now(),
  total_linhas        INTEGER,
  linhas_inseridas    INTEGER,
  linhas_atualizadas  INTEGER,
  alertas_qualidade   JSONB DEFAULT '[]',
  status              TEXT CHECK (status IN ('success', 'warning', 'error'))
);

-- Tabela: vendas
-- Cada linha = um item/produto de um pedido (venda_numero)
CREATE TABLE IF NOT EXISTS vendas (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venda_numero    INTEGER NOT NULL,
  vendedor        TEXT NOT NULL,
  data_venda      DATE NOT NULL,
  pagante         TEXT NOT NULL,
  setor_bruto     TEXT,
  setor_grupo     TEXT NOT NULL,
  produto         TEXT,
  fornecedor      TEXT,
  representante   TEXT,
  valor_total     NUMERIC(12,2) NOT NULL DEFAULT 0,
  receitas        NUMERIC(12,2) DEFAULT 0,
  faturamento     NUMERIC(12,2) DEFAULT 0,
  upload_id       UUID REFERENCES uploads(id) ON DELETE CASCADE,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vendas_data ON vendas(data_venda);
CREATE INDEX IF NOT EXISTS idx_vendas_setor ON vendas(setor_grupo);
CREATE INDEX IF NOT EXISTS idx_vendas_upload ON vendas(upload_id);
CREATE INDEX IF NOT EXISTS idx_vendas_numero ON vendas(venda_numero);

-- Tabela: metas
-- Constraint única: exatamente uma meta por (ano, mês, setor)
CREATE TABLE IF NOT EXISTS metas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ano          INTEGER NOT NULL,
  mes          INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  setor_grupo  TEXT NOT NULL CHECK (setor_grupo IN ('CORP', 'TRIPS', 'WEDDINGS', 'WT')),
  fat_meta     NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (ano, mes, setor_grupo)
);
