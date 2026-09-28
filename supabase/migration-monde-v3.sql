-- =============================================================
-- Migration: leitura direta da API oficial do Monde (v3)
--
-- Substitui a API de Dados do TTARS (monde-data), desligada em 02/10/2026.
-- O Monde v3 não filtra venda por data, não tem "alterado desde", devolve 50 por
-- página e aguenta ~1 chamada a cada 1,3 s. Produto, Setor e nomes só vêm abrindo
-- cada venda (/sales/{id}). Por isso o sync mantém um ÍNDICE próprio das vendas
-- (lido da lista, barato) e uma FILA de detalhe (caro, uma chamada por venda).
-- =============================================================

-- Uma linha por venda vista na lista do Monde.
CREATE TABLE IF NOT EXISTS monde_v3_vendas (
  sale_id       UUID PRIMARY KEY,            -- `id` da venda no Monde: é o que abre /sales/{id}
  sale_number   INTEGER NOT NULL,            -- número da venda (= vendas.venda_numero)
  sale_date     DATE,
  status        TEXT,                        -- opened | closed | canceled
  final_amount  NUMERIC,                     -- totals.final_amount (valor)
  revenue       NUMERIC,                     -- totals.revenue (receita)
  balance       NUMERIC,                     -- totals.balance (em aberto). Pago = final_amount − balance
  list_hash     TEXT,                        -- status + data + totals da lista: mudou → reabre a venda
  listed_at     TIMESTAMPTZ,                 -- última vez que a venda apareceu na lista
  detail_at     TIMESTAMPTZ,                 -- última vez que /sales/{id} foi lido e gravado em `vendas`
  linhas_ativas INTEGER,                     -- produtos ativos no último detalhe (0 = some do dashboard)
  prioridade    SMALLINT NOT NULL DEFAULT 2, -- 0 nova/alterada · 1 carga inicial · 2 revisão periódica
  refresh_at    TIMESTAMPTZ,                 -- quando reabrir a venda
  diff_valor    NUMERIC,                     -- 1ª leitura v3 − o que havia no banco (auditoria da troca)
  diff_receita  NUMERIC,
  erro          TEXT,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS monde_v3_vendas_fila ON monde_v3_vendas (refresh_at, prioridade);
CREATE INDEX IF NOT EXISTS monde_v3_vendas_numero ON monde_v3_vendas (sale_number);
CREATE INDEX IF NOT EXISTS monde_v3_vendas_data ON monde_v3_vendas (sale_date);

-- Cache de nomes: o Monde manda pessoa, fornecedor, produto e campo personalizado
-- só como {id}. Cada nome novo é uma chamada; guardá-lo evita repetir.
--   tipo = 'person'       → /people/{id}
--          'product'      → /products/{id}
--          'custom_field' → /custom_fields?resource=sales
CREATE TABLE IF NOT EXISTS monde_v3_nomes (
  tipo       TEXT NOT NULL,
  id         TEXT NOT NULL,
  nome       TEXT,
  extra      JSONB,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (tipo, id)
);

-- Só o service_role (Edge Function / backend) acessa: RLS sem policy = negado a anon.
ALTER TABLE monde_v3_vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE monde_v3_nomes ENABLE ROW LEVEL SECURITY;

-- Estado do sync v3 (ver supabase/functions/monde-sync/index.ts):
--   'v3-lista' → cursor da varredura da lista (página), fim do último ciclo
--   'v3-lock'  → trava contra duas rodadas simultâneas (cron × botão)
INSERT INTO sync_state (key) VALUES ('v3-lista') ON CONFLICT (key) DO NOTHING;
INSERT INTO sync_state (key) VALUES ('v3-lock') ON CONFLICT (key) DO NOTHING;
