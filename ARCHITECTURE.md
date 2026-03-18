# ARCHITECTURE.md — DashWT
## Dashboard Executivo de Vendas · Welcome Trips

> **Leia este arquivo antes de qualquer outro.** Ele é a fonte de verdade da arquitetura do projeto.
> Última atualização: 2026-03-18

---

## 1. Visão Geral

**DashWT** é um dashboard executivo web construído para substituir e evoluir o painel Excel de acompanhamento de vendas da Welcome Trips. É alimentado via upload de arquivos Excel exportados do sistema interno, com banco de dados no Supabase e hospedagem no Vercel.

| Atributo         | Valor                                         |
|------------------|-----------------------------------------------|
| Framework        | Next.js 14 (App Router)                       |
| Banco de Dados   | Supabase (PostgreSQL)                         |
| Hospedagem       | Vercel                                        |
| Linguagem        | TypeScript (strict mode)                      |
| UI               | Tailwind CSS + Lucide React (ícones)          |
| Gráficos         | Recharts (disponível, uso futuro)             |
| Parsing Excel    | SheetJS (xlsx)                                |
| Validação        | Zod                                           |
| Autenticação     | Supabase Auth (email/senha)                   |
| Export           | html2canvas + jsPDF                           |

---

## 2. Estrutura de Diretórios

```
fin-kpis/
├── app/
│   ├── page.tsx                    # Dashboard — tabs Group/Trips/Weddings/Corp
│   ├── vendedores/page.tsx         # Ranking completo de vendedores + filtros
│   ├── upload/page.tsx             # Upload + Histórico de uploads
│   ├── metas/page.tsx              # Gestão de metas mensais
│   ├── qualidade/page.tsx          # Painel de qualidade de dados
│   ├── login/page.tsx              # Tela de login
│   ├── layout.tsx                  # Layout raiz (sidebar + content)
│   ├── error.tsx                   # Error boundary
│   ├── not-found.tsx               # 404
│   ├── globals.css                 # Estilos globais + scrollbar
│   └── api/
│       ├── upload/route.ts         # POST: processar upload Excel
│       ├── uploads/
│       │   ├── route.ts            # GET: listar uploads
│       │   └── [id]/route.ts       # GET: detalhe | DELETE: excluir + cascata
│       ├── dashboard/route.ts      # GET: KPIs + pipeline + vendedores + forecast + delta + monthly
│       ├── insights/
│       │   └── vendedores/route.ts # GET: ranking vendedores com filtros
│       ├── metas/route.ts          # GET + POST: CRUD de metas
│       ├── qualidade/route.ts      # GET: score + timeline (usa calcScoreFromAlerts)
│       └── vendas/route.ts         # GET: listagem filtrada para drill-down
│
├── lib/
│   ├── schemas.ts                  # Tipos + Zod schemas (fonte de verdade de tipos)
│   ├── supabase.ts                 # Clientes Supabase (browser + server)
│   ├── excel-parser.ts             # Parsing SheetJS + normalização + ParseError class
│   ├── setor-mapper.ts             # setor_bruto → setor_grupo (exato + keyword)
│   ├── metrics.ts                  # KPIs, forecast, delta, pipeline, vendedores, produtos, monthly
│   ├── data-quality.ts             # Qualidade + scoring (calcScoreFromAlerts)
│   └── format.ts                   # Formatadores BRL, %, data, cores
│
├── components/
│   ├── dashboard/
│   │   ├── KPICard.tsx             # Card KPI com delta badge ↑↓
│   │   ├── PeriodSelector.tsx      # Pills período + calendário Lucide
│   │   ├── CompanyTabs.tsx         # Tabs: Group | Trips | Weddings | Corp
│   │   ├── PipelineCard.tsx        # Aberta vs Fechada + taxa conversão
│   │   ├── TopVendedores.tsx       # Ranking vendedores com avatars
│   │   ├── ForecastCard.tsx        # Projeção fim de período + ritmo diário
│   │   ├── MonthlyChart.tsx        # Recharts AreaChart evolução mensal vs meta
│   │   ├── TopProdutos.tsx         # Ranking produtos com barras
│   │   └── ExportButton.tsx        # Export PDF (html2canvas + jsPDF)
│   ├── upload/
│   │   ├── UploadZone.tsx          # Drag & drop
│   │   ├── PreviewTable.tsx        # Pré-visualização com badges
│   │   └── QualityReport.tsx       # Alertas com exemplos
│   ├── metas/
│   │   └── MetasTable.tsx          # Grid editável mês × setor
│   ├── history/
│   │   ├── UploadHistory.tsx       # Lista uploads + modal alertas
│   │   └── DeleteConfirmModal.tsx  # Confirmação dupla de exclusão
│   └── ui/
│       ├── Navigation.tsx          # Sidebar Lucide (desktop) + top bar (mobile)
│       ├── Badge.tsx               # Status / severidade
│       ├── DataTable.tsx           # Tabela genérica
│       └── LoadingSpinner.tsx      # Loading states
│
├── hooks/
│   ├── useDashboard.ts             # Fetch dashboard (cache: no-store)
│   ├── useUpload.ts                # State machine de upload
│   └── useMetas.ts                 # Fetch + mutações metas (cache: no-store)
│
├── supabase/
│   ├── schema.sql                  # DDL completo
│   ├── rls.sql                     # Row Level Security
│   ├── seed.sql                    # Dados iniciais (opcional)
│   └── migration-add-situacao.sql  # Coluna situacao
│
├── middleware.ts                   # Auth (protege páginas, exceto /login e /api)
├── ARCHITECTURE.md                 # (este arquivo)
└── AGENT_INSTRUCTIONS.md           # Regras para agentes IA
```

---

## 3. Banco de Dados — Schema Supabase

### 3.1 Tabela `vendas`

`venda_numero` NÃO é único — um pedido tem N itens. PK é `BIGINT IDENTITY`.

**Deduplicação:** Delete por range de datas (min/max do arquivo) + Insert. Uploads de períodos diferentes não interferem.

```sql
CREATE TABLE vendas (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  venda_numero    INTEGER NOT NULL,
  vendedor        TEXT NOT NULL,
  data_venda      DATE NOT NULL,
  pagante         TEXT NOT NULL,
  setor_bruto     TEXT,
  setor_grupo     TEXT NOT NULL,   -- CORP | TRIPS | WEDDINGS | OUTROS | INDEFINIDO
  produto         TEXT,
  fornecedor      TEXT,
  representante   TEXT,
  valor_total     NUMERIC(12,2) NOT NULL DEFAULT 0,
  receitas        NUMERIC(12,2) DEFAULT 0,
  faturamento     NUMERIC(12,2) DEFAULT 0,
  situacao        TEXT,            -- 'Aberta' ou 'Fechada'
  upload_id       UUID REFERENCES uploads(id) ON DELETE CASCADE,
  updated_at      TIMESTAMPTZ DEFAULT now()
);
```

### 3.2 Tabela `uploads`
```sql
CREATE TABLE uploads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome_arquivo      TEXT NOT NULL,
  uploaded_at       TIMESTAMPTZ DEFAULT now(),
  total_linhas      INTEGER,
  linhas_inseridas  INTEGER,
  linhas_atualizadas INTEGER,
  alertas_qualidade JSONB DEFAULT '[]',
  status            TEXT CHECK (status IN ('success','warning','error'))
);
```

### 3.3 Tabela `metas`
```sql
CREATE TABLE metas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ano          INTEGER NOT NULL,
  mes          INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  setor_grupo  TEXT NOT NULL CHECK (setor_grupo IN ('CORP','TRIPS','WEDDINGS','WT')),
  fat_meta     NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (ano, mes, setor_grupo)
);
```

---

## 4. Dashboard — Estrutura de Dados

A API `/api/dashboard` retorna `DashboardData`:

```typescript
interface DashboardData {
  periodo: { inicio: string; fim: string; label: string }

  // KPIs por setor
  consolidado: SetorKPI          // WT = CORP + TRIPS + WEDDINGS
  corp: SetorKPI
  trips: TripsKPI                // + nTaxas
  weddings: WeddingsKPI          // + nContratos + subcategorias

  // Pipeline (Aberta vs Fechada) por setor
  pipeline: {
    total: PipelineData
    corp: PipelineData
    trips: PipelineData
    weddings: PipelineData
  }

  // Top 5 vendedores por setor
  topVendedores: {
    total: VendedorRanking[]
    corp: VendedorRanking[]
    trips: VendedorRanking[]
    weddings: VendedorRanking[]
  }

  // Projeção de fim de período
  forecast: {
    total: ForecastData
    corp: ForecastData
    trips: ForecastData
    weddings: ForecastData
  }

  // Delta vs período anterior (null se sem dados)
  delta: {
    consolidado: DeltaData | null
    corp: DeltaData | null
    trips: DeltaData | null
    weddings: DeltaData | null
  } | null

  ultimaAtualizacao: string | null
}
```

### Tipos auxiliares:
```typescript
interface SetorKPI {
  fatMeta, fatRealizado, percRealizado, receita, percReceita, ticketMedio, nVendas
}

interface PipelineData {
  aberta: { count, valor }
  fechada: { count, valor }
  taxaConversao: number | null
}

interface VendedorRanking {
  vendedor, faturamento, receitas, nVendas, ticketMedio
}

interface ForecastData {
  projecao, ritmoAtual, diasRestantes, diasDecorridos, metaAtingivel
}

interface DeltaData {
  valor, percentual  // (atual - anterior) / anterior
}
```

---

## 5. UI — Navegação por Empresa

O dashboard usa **client-side tabs** (sem mudança de rota):

| Tab | Conteúdo |
|-----|----------|
| **Group** | Consolidado WT + 3 cards setoriais + Forecast + Pipeline geral + Top 5 vendedores |
| **Trips** | KPI Trips detalhado + taxas + Forecast + Pipeline + Top 5 vendedores Trips |
| **Weddings** | KPI Weddings + subcategorias em cards + Forecast + Pipeline + Top 5 vendedores |
| **Corp** | KPI Corp + Forecast + Pipeline + Top 5 vendedores Corp |

**Estilo visual:** Clean minimal (Linear/Vercel) — fundo branco, cards `rounded-2xl shadow-sm`, ícones Lucide SVG, sidebar escura.

---

## 6. Regras de Negócio Críticas

1. **venda_numero NÃO é único.** PK é `id` (BIGINT auto).
2. **Dedup por range de datas** (não por venda_numero).
3. **WT = CORP + TRIPS + WEDDINGS.** OUTROS/INDEFINIDO excluídos.
4. **Datas são strings ISO end-to-end.** Nunca `new Date('YYYY-MM-DD')`.
5. **Supabase: paginar com `.order('id').range()`.** Max 1000 rows por request.
6. **Fetch client: `{ cache: 'no-store' }`.** Em todo hook.
7. **API routes: `export const dynamic = 'force-dynamic'` + `revalidate = 0`.**
8. **Score de qualidade:** fonte única em `calcScoreFromAlerts()` de `data-quality.ts`.
9. **Situação é opcional.** Fallback: `Situação` → `Situacao` → `situacao`.
10. **Forecast:** `projecao = realizado + (ritmo_diário × dias_restantes)`.
11. **Delta:** compara com período anterior equivalente (mês anterior, semana anterior, ano anterior).
12. **Export PDF:** `html2canvas` + `jsPDF`, captura `#dashboard-content`.

---

## 7. Decisões de Arquitetura

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| PK vendas | `BIGINT IDENTITY` | venda_numero não é único |
| Dedup upload | Range de datas | Períodos não interferem |
| Parsing | Client + Server | Preview imediato + segurança |
| Setor mapper | Exato + keyword | Variações como "Lazer e Expedições" |
| Datas | Strings ISO | Evita timezone bugs |
| Paginação | `.order('id').range()` loop | Supabase max 1000 rows |
| Cache client | `no-store` | Dados sempre frescos |
| API routes | `force-dynamic` + `revalidate=0` | Next.js cacheia por padrão |
| Tabs empresa | Client-side state | Sem reload, dados já carregados |
| Ícones | Lucide React | SVG leve, tree-shakeable |
| Export | html2canvas + jsPDF | Captura visual sem server rendering |
| Score qualidade | `calcScoreFromAlerts()` | Fonte única, sem duplicação |
| Delta | `getPreviousPeriodRange()` | Período comparável automático |

---

## 8. Variáveis de Ambiente

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...     # Apenas API Routes
```
