-- Migration: Adicionar coluna 'situacao' à tabela vendas
-- Data: 2026-03-17
-- Descrição: Campo indica se a venda está 'Aberta' ou 'Fechada'

ALTER TABLE vendas ADD COLUMN IF NOT EXISTS situacao TEXT;

COMMENT ON COLUMN vendas.situacao IS 'Status da venda: Aberta ou Fechada';
