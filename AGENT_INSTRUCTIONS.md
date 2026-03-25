# AGENT_INSTRUCTIONS.md — DashWT

> **Leia ARCHITECTURE.md antes deste arquivo.**
> Regras obrigatórias para qualquer agente de IA trabalhando no projeto.
> Última atualização: 2026-03-18

---

## Regras Obrigatórias

### REGRA 1 — Datas são STRINGS ISO, nunca Date objects

Datas de negócio são `"YYYY-MM-DD"` do browser ao SQL. **NUNCA** `new Date('YYYY-MM-DD')`.

```typescript
// ❌ FATAL — timezone shift
const d = new Date('2025-01-01') // UTC midnight → Dec 31 em BRT

// ✅ CERTO — string direto
const inicio = '2025-01-01'
await supabase.from('vendas').gte('data_venda', inicio)
```

Para aritmética de calendário: `new Date(year, month-1, day)` → converter de volta para string com `localDateToISO()`.

---

### REGRA 2 — Supabase: paginar com ORDER BY id

Max 1000 rows por request. Sempre paginar:

```typescript
while (true) {
  const { data } = await supabase.from('vendas').select(COLS)
    .order('id', { ascending: true }).range(offset, offset + 999)
  if (!data?.length) break
  all.push(...data)
  if (data.length < 1000) break
  offset += 1000
}
```

---

### REGRA 3 — Fetch client-side: `cache: 'no-store'`

Todo `fetch()` no browser para API routes:

```typescript
const res = await fetch(`/api/dashboard?${params}`, { cache: 'no-store' })
```

---

### REGRA 4 — Upload: deduplicação por range de datas

```typescript
// ❌ ERRADO — destrói dados de outros períodos
await supabase.from('vendas').delete().in('venda_numero', batch)

// ✅ CERTO — escopo por período
await supabase.from('vendas').delete()
  .gte('data_venda', minDate).lte('data_venda', maxDate)
```

---

### REGRA 5 — Service role key apenas em API Routes

`SUPABASE_SERVICE_ROLE_KEY` nunca no browser. Usar `getSupabaseServer()`.

---

### REGRA 6 — Lógica de negócio em `lib/`, não em componentes

Componentes = renderização. Cálculos = `lib/metrics.ts`, `lib/data-quality.ts`.

---

### REGRA 7 — `force-dynamic` + `revalidate=0` em toda API Route GET

```typescript
export const dynamic = 'force-dynamic'
export const revalidate = 0
```

---

### REGRA 8 — venda_numero NÃO é único

Um pedido tem N itens. PK é `id`. Nunca upsert com `onConflict: 'venda_numero'`.

---

### REGRA 9 — WT = CORP + TRIPS + WEDDINGS

Nunca incluir OUTROS ou INDEFINIDO nos KPIs consolidados.
Na página de Metas, a coluna WT é **read-only** e calculada automaticamente (fat = soma, % rec = média ponderada por valor total).

---

### REGRA 10 — Shared API utils

- `jsonError()` de `lib/api-utils.ts` — nunca definir local em API routes.
- `getAuthUser(request)` — verifica auth + role. Usar em rotas admin.
- `todayISO()` — retorna "YYYY-MM-DD" local. Nunca usar `new Date().toISOString().split('T')[0]`.
- `getInitials()` e `AVATAR_COLORS` em `lib/format.ts` — nunca duplicar em componentes.

---

### REGRA 11 — Score de qualidade: fonte única

Usar `calcScoreFromAlerts()` de `lib/data-quality.ts`. Nunca replicar lógica.

---

### REGRA 12 — Situação é opcional

Não está em `COLUNAS_OBRIGATORIAS`. Fallback: `raw['Situação'] ?? raw['Situacao'] ?? raw['situacao']`.

---

### REGRA 13 — Tabs por empresa são client-side state

Dashboard usa state `activeTab` (group|trips|weddings|corp). Não criar rotas separadas.

---

### REGRA 14 — Forecast e Delta

- **Forecast:** `calcForecast()` em metrics.ts. Projeção = realizado + (ritmo × dias restantes).
- **Delta:** `calcDelta()` + `getPreviousPeriodRange()`. Comparação com período equivalente anterior.
- Ambos calculados no `calcDashboard()` e retornados pela API.

---

### REGRA 15 — VendaKPI vs Venda

- `Venda` = tipo completo do banco (todas as colunas)
- `VendaKPI` = tipo leve para cálculos (sem pagante, fornecedor, representante)
- Dashboard e metrics.ts usam `VendaKPI` para performance

---

### REGRA 16 — Export PDF

Usa `html2canvas` + `jsPDF`. Captura `#dashboard-content` do DOM. Lazy-loaded (dynamic import).

---

## Checklist antes de entregar código

- [ ] Datas são strings ISO end-to-end?
- [ ] Supabase: `.order('id').range()` se pode ter >1000 rows?
- [ ] Fetch client: `{ cache: 'no-store' }`?
- [ ] API Route: `dynamic = 'force-dynamic'` + `revalidate = 0`?
- [ ] Upload: dedup por range de datas?
- [ ] Service role key apenas em API Routes?
- [ ] API routes admin usam `getAuthUser()` + role check?
- [ ] Erros de API via `jsonError()` de `lib/api-utils.ts` (não local)?
- [ ] Lógica em `lib/`, não em componentes?
- [ ] WT exclui OUTROS e INDEFINIDO?
- [ ] Score usa `calcScoreFromAlerts()`?
- [ ] Novos tipos em `lib/schemas.ts`?
- [ ] Componente trata estado vazio?

---

## Features implementadas (Sprint 1 + 2)

| Feature | Componentes | Lógica |
|---------|------------|--------|
| Dashboard com tabs (Group/Trips/Weddings/Corp) | `CompanyTabs`, `KPICard`, `page.tsx` | `calcDashboard()`, `calcSetorKPI()` |
| Gráfico evolução mensal | `MonthlyChart` (Recharts) | `calcMonthlySeries()` |
| Pipeline (aberta/fechada) | `PipelineCard` | `calcPipeline()` |
| Top vendedores (por setor) | `TopVendedores` | `calcTopVendedores()` |
| Top produtos (por setor) | `TopProdutos` | `calcTopProdutos()` |
| Forecast projeção | `ForecastCard` | `calcForecast()` |
| Delta vs período anterior | Badge ↑↓ no `KPICard` | `calcDelta()`, `getPreviousPeriodRange()` |
| Export PDF | `ExportButton` | html2canvas + jsPDF (lazy) |
| Página vendedores | `/vendedores/page.tsx` | `/api/insights/vendedores` |
| Upload Excel | `UploadZone`, `PreviewTable`, `QualityReport` | `parseExcel()`, `analyzeQuality()` |
| Qualidade dados | `/qualidade/page.tsx` | `calcScoreFromAlerts()` |
| Metas mensais | `MetasTable` | API upsert (WT = auto-soma, read-only na UI) |
| Histórico uploads | `UploadHistory`, `DeleteConfirmModal` | API CRUD + cascade |
| UI moderna | Lucide icons, rounded-2xl, pills | Tailwind + clean minimal |

---

## Backlog Sprint 3

| Feature | Prioridade | Dados necessários |
|---------|-----------|-------------------|
| Top clientes (pagante) | Alta | pagante (já existe) |
| Gráficos adicionais (bar chart, sparklines) | Alta | Recharts já instalado |
| Metas por vendedor | Alta | Nova tabela vendor_goals |
| Alertas automáticos | Média | Nova tabela alerts |
| Análise de fornecedores | Média | fornecedor (já existe) |
| Drill-down vendas (modal/page) | Média | API /api/vendas já existe |
| Relatórios por email | Baixa | Vercel Cron |
| Audit trail de metas | Baixa | Nova tabela |
| Soft deletes | Baixa | Nova coluna deleted_at |
| Dark mode | Baixa | Tailwind theme provider |
