-- Migration: Expandir metas para subcategorias Weddings + meta % receita
-- Data: 2026-03-18
-- Descrição:
--   1. Alterar CHECK constraint para permitir subcategorias de Weddings
--   2. Adicionar coluna receita_meta_pct (meta de % receita sobre faturamento)

-- 1. Expandir CHECK constraint de setor_grupo
ALTER TABLE metas DROP CONSTRAINT IF EXISTS metas_setor_grupo_check;
ALTER TABLE metas ADD CONSTRAINT metas_setor_grupo_check
  CHECK (setor_grupo IN (
    'CORP', 'TRIPS', 'WEDDINGS', 'WT',
    'WEDDINGS-WEDME', 'WEDDINGS-PRODUCAO', 'WEDDINGS-PLANEJAMENTO', 'WEDDINGS-WEDDINGS'
  ));

-- 2. Adicionar coluna de meta % receita
ALTER TABLE metas ADD COLUMN IF NOT EXISTS receita_meta_pct NUMERIC(5,4) DEFAULT 0;

COMMENT ON COLUMN metas.receita_meta_pct IS 'Meta de receita como % do faturamento (ex: 0.14 = 14%)';

-- 3. Atualizar UNIQUE constraint para incluir novos setor_grupo
-- (a constraint existente já cobre qualquer valor de setor_grupo, não precisa alterar)
