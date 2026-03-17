# ARCHITECTURE.md — DashWT
## Dashboard Executivo de Vendas · Welcome Trips

> **Leia este arquivo antes de qualquer outro.** Ele é a fonte de verdade da arquitetura do projeto.

---

## 1. Visão Geral

**DashWT** é um dashboard executivo web construído para substituir e evoluir o painel Excel de acompanhamento de vendas da Welcome Trips. É alimentado via upload de arquivos Excel exportados do sistema interno, com banco de dados no Supabase e hospedagem no Vercel.

| Atributo         | Valor                                         |
|------------------|-----------------------------------------------|
| Framework        | Next.js 14 (App Router)                       |
| Banco de Dados   | Supabase (PostgreSQL)                         |
| Hospedagem       | Vercel                                        |
| Linguagem        | TypeScript (strict mode)                      |
| UI               | Tailwind CSS + Recharts                       |
| Parsing Excel    | SheetJS (xlsx)                                |
| Validação        | Zod                                           |
| Autenticação     | Supabase Auth (email/senha)                   |

---

## 2. Estrutura de Diretórios

```
dashwt/
├── app/
│   ├── (dashboard)/              # Rota principal do dashboard
│   │   └── page.tsx
│   ├── upload/
│   │   └── page.tsx              # Tela de upload de arquivos
│   ├── historico/
│   │   └── page.tsx              # Histórico de uploads
│   ├── metas/
│   │   └── page.tsx              # Gestão de metas
│   ├── qualidade/
│   │   └── page.tsx              # Painel de qualidade de dados
│   └── api/
│       ├── upload/route.ts       # POST: processar upload Excel
│       ├── uploads/
│       │   ├── route.ts          # GET: listar histórico de uploads
│       │   └── [id]/route.ts     # DELETE: excluir upload + vendas
│       ├── dashboard/route.ts    # GET: KPIs agregados por período/setor
│       ├── metas/route.ts        # GET + POST + PUT: CRUD de metas
│       ├── qualidade/route.ts    # GET: score e alertas de qualidade
│       └── vendas/route.ts       # GET: listagem filtrada para drill-down
│
├── lib/
│   ├── schemas.ts                # Tipos TypeScript + schemas Zod
│   ├── supabase.ts               # Clientes Supabase (server e browser)
│   ├── excel-parser.ts           # Parsing SheetJS + normalização
│   ├── setor-mapper.ts           # setor_bruto → setor_grupo
│   ├── metrics.ts                # Cálculo de KPIs e agregações
│   └── data-quality.ts           # Regras de qualidade + scoring
│
├── components/
│   ├── dashboard/
│   │   ├── KPICard.tsx           # Card Fat.Meta / Realizado / %
│   │   ├── SectorBlock.tsx       # Bloco de setor (CORP/TRIPS/WEDDINGS)
│   │   ├── ConsolidadoWT.tsx     # Visão Welcome Trips consolidada
│   │   ├── PeriodSelector.tsx    # Seletor semana / mês / acumulado
│   │   └── DrillDownTable.tsx    # Tabela filtrável + exportação
│   ├── upload/
│   │   ├── UploadZone.tsx        # Drag & drop + validação de estrutura
│   │   ├── PreviewTable.tsx      # Pré-visualização antes de confirmar
│   │   └── QualityReport.tsx     # Relatório de alertas pós-parse
│   ├── metas/
│   │   └── MetasTable.tsx        # Tabela editável mês × setor
│   ├── history/
│   │   ├── UploadHistory.tsx     # Lista de uploads com ações
│   │   └── DeleteConfirmModal.tsx# Dupla confirmação de exclusão
│   ├── qualidade/
│   │   └── QualityDashboard.tsx  # Score + timeline de qualidade
│   └── ui/
│       ├── Badge.tsx             # Badge de status / severidade
│       ├── DataTable.tsx         # Tabela genérica reutilizável
│       └── LoadingSpinner.tsx    # Loading states
│
├── hooks/
│   ├── useDashboard.ts           # Fetch + estado do dashboard
│   ├── useUpload.ts              # Estado do fluxo de upload
│   └── useMetas.ts               # Fetch + mutações de metas
│
├── supabase/
│   ├── schema.sql                # DDL completo das tabelas
│   ├── rls.sql                   # Políticas de Row Level Security
│   └── seed.sql                  # Dados de metas iniciais (opcional)
│
├── types/
│   └── index.ts                  # Re-exports de todos os tipos
│
├── ARCHITECTURE.md               # (este arquivo)
├── AGENT_INSTRUCTIONS.md         # Regras para agentes de IA
├── PROMPT_CONTEXT.md             # Contexto por módulo
└── .env.local                    # Variáveis de ambiente (não versionar)
```

---

## 3. Banco de Dados — Schema Supabase

### 3.1 Tabela `vendas`

Chave primária: `venda_numero` (INTEGER). Estratégia de upsert: `INSERT ... ON CONFLICT (venda_numero) DO UPDATE`.

```sql
CREATE TABLE vendas (
  venda_numero    INTEGER PRIMARY KEY,
  vendedor        TEXT NOT NULL,
  data_venda      DATE NOT NULL,
  pagante         TEXT NOT NULL,
  setor_bruto     TEXT,                        -- valor exato do Excel (auditoria)
  setor_grupo     TEXT NOT NULL,               -- CORP | TRIPS | WEDDINGS | OUTROS | INDEFINIDO
  produto         TEXT,
  fornecedor      TEXT,
  representante   TEXT,
  valor_total     NUMERIC(12,2) NOT NULL DEFAULT 0,
  receitas        NUMERIC(12,2) DEFAULT 0,
  faturamento     NUMERIC(12,2) DEFAULT 0,
  upload_id       UUID REFERENCES uploads(id) ON DELETE CASCADE,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_vendas_data ON vendas(data_venda);
CREATE INDEX idx_vendas_setor ON vendas(setor_grupo);
CREATE INDEX idx_vendas_upload ON vendas(upload_id);
```

### 3.2 Tabela `uploads`

Registra cada importação realizada. A exclusão de um upload cascateia para todos os registros de `vendas` com aquele `upload_id`.

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

Constraint única em `(ano, mes, setor_grupo)` para garantir exatamente uma meta por célula.

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

## 4. Mapeamento de Setores

O campo `Setor` do Excel pode conter diferentes valores. A função `mapSetor()` em `lib/setor-mapper.ts` faz a tradução:

| `setor_bruto` (Excel)  | `setor_grupo` (DB) | Incluso em metas? |
|------------------------|--------------------|-------------------|
| `Corporativo`          | `CORP`             | ✅ Sim             |
| `Lazer`                | `TRIPS`            | ✅ Sim             |
| `Expedições`           | `TRIPS`            | ✅ Sim             |
| `Weddings`             | `WEDDINGS`         | ✅ Sim             |
| `WedMe`                | `WEDDINGS`         | ✅ Sim             |
| `Produção`             | `WEDDINGS`         | ✅ Sim             |
| `Planejamento-WED`     | `WEDDINGS`         | ✅ Sim             |
| `Welcome`              | `OUTROS`           | ❌ Não             |
| `null` / `""`          | `INDEFINIDO`       | ❌ Não — alerta    |

O consolidado `WT` é sempre: `SUM(CORP) + SUM(TRIPS) + SUM(WEDDINGS)`. Nunca inclui OUTROS ou INDEFINIDO.

---

## 5. Fluxo de Upload — Passo a Passo

```
[Browser]
  │
  ├─ 1. Usuário seleciona .xlsx
  ├─ 2. SheetJS parseia no cliente (client-side apenas)
  ├─ 3. Valida colunas obrigatórias
  ├─ 4. Executa regras de qualidade (data-quality.ts)
  ├─ 5. Exibe PreviewTable + QualityReport
  ├─ 6. Usuário confirma
  │
[POST /api/upload]
  │
  ├─ 7. Re-parseia no servidor (segurança)
  ├─ 8. Aplica setor-mapper.ts em cada linha
  ├─ 9. Upsert em lote na tabela `vendas`
  │      INSERT ON CONFLICT (venda_numero) DO UPDATE SET ...
  ├─ 10. Registra resultado na tabela `uploads`
  └─ 11. Retorna { insertadas, atualizadas, alertas, uploadId }
```

---

## 6. Estrutura de KPIs

Toda agregação de KPI passa por `lib/metrics.ts`. A API Route `/api/dashboard` chama `metrics.ts` com os filtros de período e retorna o objeto abaixo:

```typescript
interface DashboardData {
  periodo: { inicio: string; fim: string; label: string }
  consolidado: SetorKPI          // WT
  corp: SetorKPI
  trips: SetorKPI & { nTaxas: number }
  weddings: SetorKPI & {
    nContratos: number
    subcategorias: Record<string, SetorKPI>  // WedMe, Produção, Planejamento-WED
  }
  ultimaAtualizacao: string      // data do upload mais recente
}

interface SetorKPI {
  fatMeta: number
  fatRealizado: number
  percRealizado: number          // fatRealizado / fatMeta
  receita: number
  percReceita: number            // receita / fatRealizado
  ticketMedio: number
  nVendas: number
}
```

---

## 7. Regras de Negócio Críticas

1. **Deduplicação**: `venda_numero` é a chave única. Upsert sempre, nunca insert puro.
2. **WT ≠ soma de tudo**: WT = CORP + TRIPS + WEDDINGS apenas. OUTROS e INDEFINIDO ficam fora.
3. **Weddings consolidado**: qualquer cálculo de WEDDINGS some WedMe + Weddings + Produção + Planejamento-WED.
4. **Semanas**: a granularidade semanal usa número ISO da semana (`date_part('week', data_venda)`). Exibir como "S10", "S11" etc.
5. **Valores negativos**: são mantidos no banco (representam cancelamentos/estornos). Entram nos cálculos, mas são sinalizados no painel de qualidade.
6. **Metas WT**: podem ser informadas manualmente OU calculadas como soma de CORP + TRIPS + WEDDINGS. Comportamento configurável via constante `METAS_WT_AUTO` em `lib/metrics.ts`.
7. **Nº de Contratos WEDDINGS**: `COUNT(venda_numero) WHERE produto IN ('Contrato de Casamento', 'Pacote de Casamento')`.
8. **Nº de Taxas TRIPS**: `COUNT(venda_numero) WHERE produto = 'Taxa de Serviço' AND setor_grupo = 'TRIPS'`.

---

## 8. Variáveis de Ambiente

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...     # Apenas em API Routes, nunca no client
```

**Nunca expor `SUPABASE_SERVICE_ROLE_KEY` no browser.** Toda operação de escrita (upload, metas, exclusão) deve passar por API Routes server-side.

---

## 9. Decisões de Arquitetura

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Parsing Excel | Client-side (pré-view) + Server-side (persistência) | Feedback imediato ao usuário sem round-trip desnecessário |
| Upsert | `ON CONFLICT DO UPDATE` | Garante idempotência em uploads repetidos |
| `setor_bruto` separado de `setor_grupo` | Duas colunas | Permite auditoria do valor original sem perder o mapeamento |
| `alertas_qualidade` como JSONB | Array estruturado | Permite consultar alertas sem parsear texto |
| Cascata `ON DELETE CASCADE` | uploads → vendas | Exclusão de upload limpa automaticamente os registros filhos |
| API Routes para escrita | Next.js server | `SUPABASE_SERVICE_ROLE_KEY` nunca vaza para o cliente |
