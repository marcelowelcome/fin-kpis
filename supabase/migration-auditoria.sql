-- =============================================================
-- Migration: auditoria de receitas (Admin → Auditoria)
--
-- Conferência diária das vendas Fechadas dos últimos 6 meses (o "relatório de vendas
-- por produto" que o sync replica em `vendas`). A Edge Function `auditoria-receitas`
-- tira uma foto de cada venda, compara com a foto da conferência anterior e registra
-- cada alteração de receita — inclusive produto/venda cancelada — com o vendedor, o
-- setor e um motivo provável. As revisões feitas na aba viram aprendizado: o motivo
-- sugerido nas próximas alterações parecidas passa a seguir o que foi confirmado.
--
-- Só o service_role (Edge Function e API routes do Next) acessa: RLS sem policy.
-- =============================================================

-- Foto de cada venda na última conferência (uma linha por venda, todas as situações:
-- a Aberta fica guardada para reconhecer quando ela fecha ou quando uma Fechada reabre).
CREATE TABLE IF NOT EXISTS auditoria_vendas (
  venda_numero INTEGER PRIMARY KEY,
  data_venda   DATE NOT NULL,
  situacao     TEXT NOT NULL,
  vendedor     TEXT,
  setor_grupo  TEXT,
  setor_bruto  TEXT,
  pagante      TEXT,
  valor        NUMERIC NOT NULL DEFAULT 0,
  receita      NUMERIC NOT NULL DEFAULT 0,
  linhas       JSONB NOT NULL DEFAULT '[]',  -- [{produto, fornecedor, valor, receita}]
  hash         TEXT NOT NULL,                -- mudou → a venda é comparada produto a produto
  visto_desde  DATE NOT NULL,                -- primeira conferência em que apareceu
  conferido_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  alterado_em  TIMESTAMPTZ                   -- última alteração registrada
);

CREATE INDEX IF NOT EXISTS auditoria_vendas_data ON auditoria_vendas (data_venda);

-- Uma linha por conferência (cron diário ou botão "Rodar agora").
CREATE TABLE IF NOT EXISTS auditoria_execucoes (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  data_ref        DATE NOT NULL,                  -- dia da conferência (horário de Brasília)
  origem          TEXT NOT NULL DEFAULT 'cron',   -- cron | manual
  status          TEXT NOT NULL DEFAULT 'rodando',-- rodando | ok | baseline | erro
  iniciado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizado_em   TIMESTAMPTZ,
  janela_inicio   DATE,
  vendas_fechadas INTEGER,
  linhas_fechadas INTEGER,
  receita_fechada NUMERIC,
  valor_fechado   NUMERIC,
  alteracoes      INTEGER,
  impacto_receita NUMERIC,                        -- soma dos deltas de receita registrados
  vendas_novas    INTEGER,                        -- Fechadas novas no fluxo normal (não são alteração)
  receita_novas   NUMERIC,
  totais          JSONB,                          -- por mês de venda: {receita, valor, vendas, linhas, setores}
  erro            TEXT
);

CREATE INDEX IF NOT EXISTS auditoria_execucoes_data ON auditoria_execucoes (data_ref DESC);

-- Uma linha por venda alterada numa conferência.
-- receita/valor _antes e _depois são os do relatório de Fechadas: venda que sai das
-- Fechadas (cancelada, reaberta) vai a 0; venda que entra parte de 0.
CREATE TABLE IF NOT EXISTS auditoria_alteracoes (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  execucao_id       BIGINT REFERENCES auditoria_execucoes(id) ON DELETE CASCADE,
  detectado_em      DATE NOT NULL,
  venda_numero      INTEGER NOT NULL,
  data_venda        DATE,
  data_venda_antes  DATE,
  situacao          TEXT,
  situacao_antes    TEXT,
  vendedor          TEXT,
  vendedor_antes    TEXT,
  setor_grupo       TEXT,
  setor_grupo_antes TEXT,
  setor_bruto       TEXT,
  pagante           TEXT,
  receita_antes     NUMERIC NOT NULL DEFAULT 0,
  receita_depois    NUMERIC NOT NULL DEFAULT 0,
  delta_receita     NUMERIC NOT NULL DEFAULT 0,
  valor_antes       NUMERIC NOT NULL DEFAULT 0,
  valor_depois      NUMERIC NOT NULL DEFAULT 0,
  delta_valor       NUMERIC NOT NULL DEFAULT 0,
  tipo              TEXT NOT NULL,                -- o que mudou (fato)
  produtos          JSONB NOT NULL DEFAULT '[]',  -- produto a produto: cancelado/incluido/alterado/...
  explicacao        TEXT NOT NULL,
  evidencias        JSONB NOT NULL DEFAULT '[]',  -- contexto usado na explicação
  motivo_sugerido   TEXT NOT NULL,                -- por que mudou (hipótese)
  confianca         SMALLINT NOT NULL,            -- 0–100
  base_aprendizado  JSONB,                        -- regra × revisões que levaram ao motivo
  chaves            TEXT[] NOT NULL DEFAULT '{}', -- contextos em que a revisão vira aprendizado
  revisao           TEXT NOT NULL DEFAULT 'pendente', -- pendente | confirmada | corrigida
  motivo_real       TEXT,
  nota              TEXT,
  revisado_por      TEXT,
  revisado_em       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS auditoria_alteracoes_detectado ON auditoria_alteracoes (detectado_em DESC);
CREATE INDEX IF NOT EXISTS auditoria_alteracoes_venda ON auditoria_alteracoes (venda_numero);
CREATE INDEX IF NOT EXISTS auditoria_alteracoes_revisao ON auditoria_alteracoes (revisao);

ALTER TABLE auditoria_vendas ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE auditoria_alteracoes ENABLE ROW LEVEL SECURITY;

-- Trava contra duas conferências simultâneas (cron × botão).
INSERT INTO sync_state (key) VALUES ('auditoria-lock') ON CONFLICT (key) DO NOTHING;

-- Grava o resultado de uma conferência numa transação só: alterações, foto nova das
-- vendas que mudaram, vendas que saíram da janela e o fechamento da execução. Se cair
-- no meio, nada fica pela metade e a próxima conferência refaz a comparação.
CREATE OR REPLACE FUNCTION auditoria_gravar(
  p_execucao   BIGINT,
  p_alteracoes JSONB,
  p_estado     JSONB,
  p_apagar     INTEGER[],
  p_resumo     JSONB
) RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO auditoria_alteracoes (
    execucao_id, detectado_em, venda_numero, data_venda, data_venda_antes,
    situacao, situacao_antes, vendedor, vendedor_antes, setor_grupo, setor_grupo_antes,
    setor_bruto, pagante, receita_antes, receita_depois, delta_receita,
    valor_antes, valor_depois, delta_valor, tipo, produtos, explicacao, evidencias,
    motivo_sugerido, confianca, base_aprendizado, chaves
  )
  SELECT
    p_execucao, a.detectado_em, a.venda_numero, a.data_venda, a.data_venda_antes,
    a.situacao, a.situacao_antes, a.vendedor, a.vendedor_antes, a.setor_grupo, a.setor_grupo_antes,
    a.setor_bruto, a.pagante, a.receita_antes, a.receita_depois, a.delta_receita,
    a.valor_antes, a.valor_depois, a.delta_valor, a.tipo, a.produtos, a.explicacao, a.evidencias,
    a.motivo_sugerido, a.confianca, a.base_aprendizado, a.chaves
  FROM jsonb_populate_recordset(NULL::auditoria_alteracoes, COALESCE(p_alteracoes, '[]'::jsonb)) a;

  INSERT INTO auditoria_vendas
  SELECT * FROM jsonb_populate_recordset(NULL::auditoria_vendas, COALESCE(p_estado, '[]'::jsonb))
  ON CONFLICT (venda_numero) DO UPDATE SET
    data_venda = EXCLUDED.data_venda, situacao = EXCLUDED.situacao,
    vendedor = EXCLUDED.vendedor, setor_grupo = EXCLUDED.setor_grupo,
    setor_bruto = EXCLUDED.setor_bruto, pagante = EXCLUDED.pagante,
    valor = EXCLUDED.valor, receita = EXCLUDED.receita, linhas = EXCLUDED.linhas,
    hash = EXCLUDED.hash, conferido_em = EXCLUDED.conferido_em,
    alterado_em = COALESCE(EXCLUDED.alterado_em, auditoria_vendas.alterado_em);

  DELETE FROM auditoria_vendas WHERE venda_numero = ANY(COALESCE(p_apagar, '{}'));

  UPDATE auditoria_execucoes SET
    status          = COALESCE(p_resumo->>'status', 'ok'),
    finalizado_em   = now(),
    vendas_fechadas = (p_resumo->>'vendas_fechadas')::int,
    linhas_fechadas = (p_resumo->>'linhas_fechadas')::int,
    receita_fechada = (p_resumo->>'receita_fechada')::numeric,
    valor_fechado   = (p_resumo->>'valor_fechado')::numeric,
    alteracoes      = (p_resumo->>'alteracoes')::int,
    impacto_receita = (p_resumo->>'impacto_receita')::numeric,
    vendas_novas    = (p_resumo->>'vendas_novas')::int,
    receita_novas   = (p_resumo->>'receita_novas')::numeric,
    totais          = p_resumo->'totais'
  WHERE id = p_execucao;
END;
$$;

REVOKE ALL ON FUNCTION auditoria_gravar(BIGINT, JSONB, JSONB, INTEGER[], JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION auditoria_gravar(BIGINT, JSONB, JSONB, INTEGER[], JSONB) TO service_role;

-- Agendamento (aplicado à parte, com a anon key do projeto no lugar de <ANON_KEY>):
-- tenta de hora em hora das 06:15 às 11:15 (Brasília). A função só confere uma vez por
-- dia; as outras tentativas saem na hora. Assim um cron que falhe às 06:15 ("job startup
-- timeout" já aconteceu) não deixa o dia sem conferência.
--
-- SELECT cron.schedule('auditoria-receitas-diaria', '15 9-14 * * *', $$
--   select net.http_post(
--     url := 'https://<PROJECT_REF>.supabase.co/functions/v1/auditoria-receitas',
--     headers := '{"Content-Type":"application/json","Authorization":"Bearer <ANON_KEY>"}'::jsonb,
--     body := '{"origem":"cron"}'::jsonb,
--     timeout_milliseconds := 150000
--   );
-- $$);
