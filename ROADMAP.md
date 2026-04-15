# ROADMAP — DashWT

> Planejamento das próximas sprints do Dashboard Executivo de Vendas · Welcome Group.
> Última atualização: 2026-04-15

Este documento complementa [ARCHITECTURE.md](ARCHITECTURE.md) e descreve o backlog priorizado. Cada sprint tem objetivo de negócio claro, entregáveis concretos e critérios de aceite. O plano é revisado ao final de cada sprint.

---

## Estado atual (pós Sprint 2.5)

**Entregues até aqui:**
- Dashboard executivo com tabs por empresa (Group / Trips / Weddings / Corp)
- KPI cards com delta, barra de progresso, marcador de expectativa temporal e tooltip rico
- Gráfico de evolução Mensal/Diário com meta por vendedor consolidada
- Pipeline (Aberta vs Fechada) com taxa de conversão
- Top 5 vendedores (com meta individual via `vendor_goals`) e Top 8 produtos por setor
- Forecast de fim de período
- Metas mensais por setor (CRUD, WT auto-soma) + Metas por vendedor (valor_total ou receita)
- Upload Excel com quality scoring; Auth Supabase + RLS
- Export PDF (html2canvas + jsPDF)
- Meta proporcional para períodos sub-mensais (ex: semana atual)
- Popover de contratos Weddings para auditar a contagem

**Regra de contagem confirmada (2026-04-15):** `nContratos` considera apenas produto "Contrato de Casamento".

---

## Sprint 3 — "Para quem vendemos?" (2 semanas)

**Objetivo:** Fechar a pergunta "quem é o cliente" e introduzir monitoramento ativo.

### 3.1 Top Clientes (pagante) — **Alta**
- Ranking por receita, frequência e concentração de risco (Top 1 = X% do total).
- Página `/clientes` com filtro por setor/período + card "Top Clientes" no dashboard.
- Métrica de concentração (Herfindahl simplificado ou top-5 %).
- **Dados:** campo `pagante` já existe no banco, sem migração.
- **Aceite:** ranking bate com planilha de controle; modal ao clicar em cliente lista suas vendas.

### 3.2 Alertas automáticos — **Alta**
- Regras iniciais:
  - Vendedor sem vendas há > 7 dias
  - Setor < 70% do ritmo esperado no período corrente
  - Upload mais recente com > 3 dias
  - Queda > 20% vs período anterior em qualquer setor
- Nova tabela `alerts` (id, tipo, severidade, payload_json, dismissed_at, created_at).
- Badge no header + página `/alertas` com histórico.
- **Aceite:** alertas gerados ao calcular o dashboard; dispensáveis; não re-geram se ainda ativos.

### 3.3 Drill-down em KPIs — **Média**
- Padrão visual (seguindo o popover de contratos):
  - Clique/hover em "Vendas", "Ticket Médio" ou "Receita" → lista das vendas subjacentes
  - Reutilizar `VendaKPI` e padrão `filterX` + `countX` já estabelecido em `lib/metrics.ts`
- **Aceite:** cada métrica "contábil" tem um drill-down auditável.

**Débito técnico incluído:** aplicar padrão do popover de contratos à métrica `nTaxas` (Trips).

---

## Sprint 4 — "Com quem compramos?" + UX mobile (2 semanas)

**Objetivo:** Visibilidade de fornecedores e tornar o dashboard utilizável em mobile.

### 4.1 Análise de Fornecedores — **Alta**
- Página `/fornecedores` com ranking por volume e por setor.
- Concentração de supplier (risco: fornecedor X responde por Y% do custo).
- Evolução temporal por fornecedor top-10.
- **Dados:** campo `fornecedor` já existe.
- **Aceite:** identifica fornecedores com concentração > 30%; permite comparar período.

### 4.2 Mobile + Touch — **Alta**
- Popovers hover-only (contratos, expected-progress) com variante click-to-toggle no mobile.
- Tabs + KPI cards responsivos abaixo de 640px.
- Tabelas (`/vendedores`, `/metas`, futuras `/clientes`) com scroll horizontal controlado.
- **Aceite:** todos os fluxos principais funcionam em iPhone SE (375px) sem overflow.

### 4.3 Acessibilidade básica — **Média**
- Popovers respondem a `focus`/`blur` e `Esc`.
- `aria-expanded`, `aria-controls`, foco visível.
- Contraste AA em textos pequenos dos cards.
- **Aceite:** Lighthouse A11y ≥ 90 nas páginas principais.

### 4.4 Incluir drill-downs no export PDF — **Baixa**
- Seção opcional "Detalhamento" ao final do PDF com as listas dos popovers.
- **Aceite:** checkbox no export; PDF continua ≤ 3 MB.

---

## Sprint 5 — Automação & Confiabilidade (2 semanas)

**Objetivo:** Reduzir trabalho manual recorrente e proteger dados históricos.

### 5.1 Relatórios por email — **Alta**
- Vercel Cron: diário (resumo D-1) e semanal (segunda 8h).
- Templates HTML simples (não PDF) com KPIs principais + top 3 alertas.
- Config por usuário: quais relatórios receber.
- **Aceite:** Marcelo recebe o semanal sem intervenção; unsubscribe funciona.

### 5.2 Audit trail de metas — **Média**
- Tabela `metas_history` e `vendor_goals_history` (trigger ou código aplicativo).
- Tela read-only mostrando "de/para, quem, quando" por meta.
- **Aceite:** qualquer alteração de meta é rastreável por 12 meses.

### 5.3 Soft delete de uploads — **Média**
- Coluna `deleted_at` em `uploads`; UI de lixeira com restore em 30 dias.
- Vendas ficam órfãs (ou são escondidas) enquanto upload está deletado.
- **Aceite:** upload deletado por engano pode ser restaurado sem intervenção técnica.

### 5.4 Dark mode — **Baixa**
- Theme provider + toggle no header.
- Revisar paletas de gráficos Recharts.
- **Aceite:** toggle persiste; nenhum card fica ilegível.

---

## Backlog — sem sprint alocada

Ideias maduras o suficiente para virarem ticket, mas sem prioridade confirmada:

- **Comparativo YoY** — toggle "vs ano anterior" em gráficos e KPI cards.
- **Forecast com sazonalidade** — hoje é linear; considerar peso por mês histórico.
- **Webhooks de upload** — disparar recálculo + alerta quando novo Excel chega.
- **Exportação Excel** — inverso do upload, para consumo em outras ferramentas.
- **Multi-moeda** — se houver operação fora do BRL.
- **Dashboard "mobile-first"** — versão enxuta para celular (não apenas responsiva).

---

## Princípios de priorização

Ao reavaliar este roadmap ao final de cada sprint, aplicar nesta ordem:

1. **Decisão de negócio primeiro.** Se Marcelo precisa do dado para uma decisão de curto prazo, sobe.
2. **Reuso de dados existentes** antes de pedir migração de schema.
3. **Entregáveis testáveis** — se não cabe na sprint com aceite claro, dividir.
4. **Débito técnico quando bloqueia feature** — não como sprint dedicada.
5. **UX mobile e a11y** — tratadas como feature, não como polimento final.

---

## Histórico de sprints

| Sprint | Período | Tema | Status |
|---|---|---|---|
| 1 | 2026-02 | MVP — KPIs + Upload + Auth | ✅ |
| 2 | 2026-03 (1ª half) | Recharts + Pipeline + Forecast + Export | ✅ |
| 2.5 | 2026-03-25 → 2026-04-15 | Vendor goals + daily chart + meta proporcional + popover contratos | ✅ |
| 3 | 2026-04-16 → 2026-04-30 | **Clientes + Alertas** | 🔜 planejada |
| 4 | 2026-05 (1ª half) | Fornecedores + Mobile/A11y | 🗓️ |
| 5 | 2026-05 (2ª half) | Automação + Confiabilidade | 🗓️ |
