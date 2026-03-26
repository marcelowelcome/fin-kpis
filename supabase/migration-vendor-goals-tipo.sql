-- Migration: adicionar tipo_meta a vendor_goals
-- Executar no Supabase SQL Editor

ALTER TABLE vendor_goals
  ADD COLUMN IF NOT EXISTS tipo_meta TEXT NOT NULL DEFAULT 'valor_total'
  CHECK (tipo_meta IN ('valor_total', 'receita'));

COMMENT ON COLUMN vendor_goals.tipo_meta IS 'Tipo da meta: valor_total (VT) ou receita';
