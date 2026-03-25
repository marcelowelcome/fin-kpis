-- Migration: vendor_goals — metas individuais por vendedor
-- Executar no Supabase SQL Editor

CREATE TABLE IF NOT EXISTS vendor_goals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ano              INTEGER NOT NULL,
  mes              INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  vendedor         TEXT NOT NULL,
  fat_meta         NUMERIC(14,2) NOT NULL DEFAULT 0,
  receita_meta_pct NUMERIC(5,4) DEFAULT 0,   -- ex: 0.14 = 14%
  updated_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (ano, mes, vendedor)
);

CREATE INDEX IF NOT EXISTS idx_vendor_goals_ano ON vendor_goals(ano);
CREATE INDEX IF NOT EXISTS idx_vendor_goals_vendedor ON vendor_goals(vendedor);

-- RLS
ALTER TABLE vendor_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read vendor_goals"
  ON vendor_goals FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert vendor_goals"
  ON vendor_goals FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update vendor_goals"
  ON vendor_goals FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);
