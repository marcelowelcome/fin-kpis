-- Adiciona a data de cancelamento do produto/venda à tabela vendas.
-- Fonte: coluna "Data Cancelamento" do relatório Monde (Vendas por produto).
-- Regra: valor não-nulo = produto cancelado → NÃO deve entrar em nenhum KPI do
-- dashboard (o dashboard filtra `data_cancelamento IS NULL`).
ALTER TABLE vendas ADD COLUMN IF NOT EXISTS data_cancelamento DATE;

-- Índice parcial: acelera o filtro do dashboard (só as linhas ativas).
CREATE INDEX IF NOT EXISTS idx_vendas_nao_cancelada
  ON vendas(data_venda)
  WHERE data_cancelamento IS NULL;
