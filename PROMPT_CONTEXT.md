# PROMPT_CONTEXT.md — DashWT
## Contexto por Modulo — Para Uso em Sessoes de Desenvolvimento com Agentes de IA

> **Como usar este arquivo:**
> Ao iniciar uma sessao de desenvolvimento em um modulo especifico, copie a secao correspondente e cole no inicio do seu prompt para o agente. Isso garante que o agente tenha todo o contexto necessario sem precisar reprocessar o projeto inteiro.
>
> **Ultima atualizacao:** 2026-03-18

---

## MODULO 1 — `lib/schemas.ts` (IMPLEMENTADO)

**Proposito:** Define todos os tipos TypeScript e schemas Zod do projeto. E a fonte de verdade de tipos. Todo outro modulo importa daqui.

**Responsabilidades:**
- Tipos das entidades do banco: `Venda`, `VendaInput`, `Upload`, `Meta`, `QualityAlert`, `QualityAlertExemplo`
- Tipos dos KPIs calculados: `SetorKPI`, `TripsKPI`, `WeddingsKPI`, `DashboardData`, `SemanasData`
- Schema Zod para validacao do Excel: `VendaExcelSchema`
- Constantes: `SETOR_GRUPOS`, `SETOR_METAS`, `SETOR_LABELS`, `SETORES_WT`, `COLUNAS_OBRIGATORIAS`, `ALERTA_TIPOS`, `ALERTA_SEVERIDADES`
- Tipos das respostas das API Routes: `UploadResponse`, `DashboardResponse`, `ApiError`, `ParseResult`

**Tipos criticos (estado atual do codigo):**
```typescript
type SetorGrupo = 'CORP' | 'TRIPS' | 'WEDDINGS' | 'OUTROS' | 'INDEFINIDO'
type SetorMeta = 'CORP' | 'TRIPS' | 'WEDDINGS' | 'WT'

interface Venda {
  id: number               // BIGINT auto-incremento (PK)
  venda_numero: number     // Nr do pedido (NAO unico — um pedido pode ter N itens)
  vendedor: string
  data_venda: string       // ISO date string (YYYY-MM-DD)
  pagante: string
  setor_bruto: string | null
  setor_grupo: SetorGrupo
  produto: string | null
  fornecedor: string | null
  representante: string | null
  valor_total: number
  receitas: number
  faturamento: number       // = valor_total (mesma coluna Excel)
  situacao: string | null  // 'Aberta' ou 'Fechada'
  upload_id: string
  updated_at: string
}

interface VendaInput {
  // Mesmo que Venda, sem id, upload_id e updated_at
  venda_numero: number
  vendedor: string
  data_venda: string
  pagante: string
  setor_bruto: string | null
  setor_grupo: SetorGrupo
  produto: string | null
  fornecedor: string | null
  representante: string | null
  valor_total: number
  receitas: number
  faturamento: number
  situacao: string | null
}

interface SetorKPI {
  fatMeta: number
  fatRealizado: number
  percRealizado: number | null  // null se fatMeta === 0
  receita: number
  percReceita: number | null    // null se fatRealizado === 0
  ticketMedio: number           // 0 se nVendas === 0
  nVendas: number               // COUNT(DISTINCT venda_numero)
}

interface QualityAlertExemplo {
  venda_numero: number
  vendedor: string
  produto: string | null
  valor: number
  detalhe: string              // descricao curta do problema
}

interface QualityAlert {
  tipo: 'SETOR_NULO' | 'VALOR_NEGATIVO' | 'LINHA_NULA' | 'DUPLICATA_INTERNA' | 'SETOR_OUTROS'
  severidade: 'CRITICO' | 'ATENCAO' | 'AVISO' | 'INFO'
  quantidade: number
  descricao: string
  linhas_afetadas?: number[]
  exemplos?: QualityAlertExemplo[]    // ate 5 exemplos concretos
}
```

**Colunas obrigatorias do Excel (8):**
`Venda Nr`, `Vendedor`, `Data Venda`, `Pagante`, `Setor`, `Produto`, `Valor Total`, `Receitas`
**Coluna opcional:** `Situacao`
**NOTA:** "Faturamento" foi removido — "Valor Total" assume o papel de faturamento no sistema.

**Dependencias:** nenhuma (modulo base)
**Importado por:** todos os outros modulos

---

## MODULO 2 — `lib/supabase.ts` (IMPLEMENTADO)

**Proposito:** Centraliza a criacao dos clientes Supabase.

**Funcoes exportadas:**
- `getSupabaseBrowser()`: usa `NEXT_PUBLIC_SUPABASE_ANON_KEY` via `createBrowserClient` do `@supabase/ssr`
- `getSupabaseServer()`: usa `SUPABASE_SERVICE_ROLE_KEY` via `createClient` do `@supabase/supabase-js`. Lanca erro se a key nao estiver definida.

**Variaveis de ambiente:**
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY       <- nunca expor no cliente
```

**Dependencias:** `@supabase/supabase-js`, `@supabase/ssr`

---

## MODULO 3 — `lib/setor-mapper.ts` (IMPLEMENTADO)

**Proposito:** Converte o valor bruto do campo `Setor` do Excel para o grupo canonico usado no banco e nos KPIs.

**Funcoes exportadas:**
- `mapSetor(setorBruto: string | null | undefined): SetorGrupo` — comparacao case-insensitive com trim
- `isSetorWT(setor: string): boolean` — retorna true para CORP, TRIPS, WEDDINGS
- `getWeddingsSubcategoria(setorBruto: string | null): string` — retorna subcategoria para drill-down

**Regra de mapeamento:**
```
Corporativo       -> CORP
Lazer             -> TRIPS
Expedicoes        -> TRIPS
Weddings          -> WEDDINGS
WedMe             -> WEDDINGS
Producao          -> WEDDINGS
Planejamento-WED  -> WEDDINGS
Welcome           -> OUTROS
null / ""         -> INDEFINIDO
(qualquer outro)  -> INDEFINIDO
```

**Dependencias:** `lib/schemas.ts`

---

## MODULO 4 — `lib/excel-parser.ts` (IMPLEMENTADO)

**Proposito:** Transforma o arquivo Excel bruto em um array tipado, validado e pronto para insert.

**Funcao principal:** `parseExcel(buffer: ArrayBuffer): ParseResult`

**Fluxo:**
1. Le workbook via SheetJS
2. Busca aba `modelo-exportacao-final` (ou primeira aba se nao encontrada)
3. Valida 10 colunas obrigatorias
4. Para cada linha: mapeia colunas, normaliza valores, aplica `mapSetor()`
5. Remove linhas nulas (registra alerta LINHA_NULA)
6. Executa `analyzeQuality()` do data-quality.ts
7. Retorna `{ rows: VendaInput[], alerts: QualityAlert[], totalLinhas: number, score: number }`

**Mapeamento de colunas Excel -> banco:**
```
"Venda Nr"     -> venda_numero   (numero inteiro)
"Vendedor"     -> vendedor
"Data Venda"   -> data_venda     (ISO date string via parseDate)
"Pagante"      -> pagante
"Setor"        -> setor_bruto + setor_grupo (via setor-mapper.ts)
"Produto"      -> produto
"Fornecedor"   -> fornecedor
"Representante"-> representante
"Valor Total"  -> valor_total E faturamento (mesmo valor, numero float)
"Receitas"     -> receitas       (numero float)
"Situacao"     -> situacao       (texto: 'Aberta' ou 'Fechada')
```

**Erros lancados (como ParseError, nao throw Error):**
- `EMPTY_WORKBOOK`: Arquivo sem abas
- `EMPTY_SHEET`: Aba vazia
- `MISSING_COLUMNS`: Lista colunas faltantes

**NOTA:** Nao deduplica por venda_numero — um pedido pode ter N itens. Todas as linhas sao mantidas.

**Dependencias:** `xlsx` (SheetJS), `lib/schemas.ts`, `lib/setor-mapper.ts`, `lib/data-quality.ts`

---

## MODULO 5 — `lib/data-quality.ts` (IMPLEMENTADO)

**Proposito:** Define e executa todas as regras de qualidade de dados. Produz score e alertas com ate 5 exemplos concretos cada.

**Funcao principal:** `analyzeQuality(rows: VendaInput[]): { score: number, alerts: QualityAlert[], breakdown: QualityBreakdown }`

**Regras implementadas:**

| Regra | Tipo | Severidade | Impacto no score |
|-------|------|------------|-----------------|
| `setor_grupo === 'INDEFINIDO'` | SETOR_NULO | CRITICO | -5/occ, max -30 |
| `valor_total < 0` OU `receitas < 0` | VALOR_NEGATIVO | ATENCAO | -2/occ, max -20 |
| Linha completamente nula | LINHA_NULA | AVISO | -1/occ, max -10 |
| Duplicata real (mesma combinacao `venda_numero\|produto\|valor_total`) | DUPLICATA_INTERNA | ATENCAO | -5/occ, max -20 |
| `setor_grupo === 'OUTROS'` | SETOR_OUTROS | INFO | sem impacto |

**IMPORTANTE sobre duplicatas:** venda_numero repetido e ESPERADO (um pedido pode ter N itens). Duplicata real = mesma combinacao de `venda_numero + produto + valor_total`.

**Exemplos:** Cada alerta inclui ate 5 exemplos concretos (`QualityAlertExemplo`) com venda_numero, vendedor, produto e detalhe do problema. Esses exemplos sao persistidos no JSONB da tabela `uploads`.

**Dependencias:** `lib/schemas.ts`

---

## MODULO 6 — `lib/metrics.ts` (IMPLEMENTADO)

**Proposito:** Calcula todos os KPIs do dashboard. Unica fonte de logica de negocio para calculos.

**Funcoes exportadas:**
```typescript
calcSetorKPI(vendas: Venda[], meta: number, setorGrupos: SetorGrupo | SetorGrupo[]): SetorKPI
calcDashboard(vendas: Venda[], metas: Meta[], periodo: { inicio: Date; fim: Date }): DashboardData
countContratos(vendas: Venda[]): number
countTaxas(vendas: Venda[]): number
calcSemanasMes(vendas: Venda[], ano: number, mes: number): SemanasData[]
getPeriodDates(periodo: string, inicio?: string, fim?: string): { inicio: Date; fim: Date; label: string }
```

**Regras criticas:**
- WT = CORP + TRIPS + WEDDINGS. Nunca incluir OUTROS ou INDEFINIDO.
- `percRealizado = fatRealizado / fatMeta`. Se `fatMeta === 0`, retorna `null`.
- `percReceita = receita / fatRealizado`. Se `fatRealizado === 0`, retorna `null`.
- `ticketMedio = fatRealizado / nVendas`. Se `nVendas === 0`, retorna `0`.
- `nVendas = COUNT(DISTINCT venda_numero)` (usa Set)
- Meta WT: quando `METAS_WT_AUTO = true`, soma CORP + TRIPS + WEDDINGS (nao usa meta WT manual)
- Weddings subcategorias: agrupa por `getWeddingsSubcategoria(setor_bruto)` sem metas individuais

**Periodos suportados:** `semana-atual`, `mes-corrente`, `acumulado-ano`, `custom`

**Dependencias:** `lib/schemas.ts`, `lib/setor-mapper.ts`

---

## MODULO 7 — `app/api/upload/route.ts` (IMPLEMENTADO)

**Proposito:** Endpoint POST que recebe o arquivo Excel, processa, e persiste no Supabase.

**Fluxo real (delete + insert, NAO upsert):**
```
POST /api/upload  (multipart/form-data, campo "file")
  |
  |-- 1. Extrair arquivo do FormData (max 5MB, .xlsx only)
  |-- 2. Converter para ArrayBuffer e parsear via excel-parser.ts
  |-- 3. Identificar todos os venda_numero no arquivo
  |-- 4. Contar registros existentes para esses venda_numero
  |-- 5. DELETE registros existentes (em lotes de 500)
  |-- 6. INSERT registro na tabela 'uploads' com alertas JSONB
  |-- 7. INSERT todas as linhas com upload_id (em lotes de 500)
  +-- 8. Retornar UploadResponse
```

**Resposta de sucesso:**
```typescript
interface UploadResponse {
  uploadId: string
  totalLinhas: number
  inseridas: number
  atualizadas: number
  alertas: QualityAlert[]
  score: number
  status: 'success' | 'warning'   // warning se houver alerta CRITICO
}
```

**Erros tratados:**
- `FILE_MISSING` (400), `INVALID_FORMAT` (400), `FILE_TOO_LARGE` (400)
- `NO_VALID_ROWS` (400), `MISSING_COLUMNS` (400)
- `DB_ERROR` (500), `INTERNAL_ERROR` (500)

**Em caso de erro no insert:** Atualiza status do upload para 'error' antes de retornar.

**Dependencias:** `lib/excel-parser.ts`, `lib/supabase.ts`, `lib/schemas.ts`

---

## MODULO 8 — `app/api/uploads/route.ts` e `[id]/route.ts` (IMPLEMENTADO)

**Proposito:** Gerenciamento do historico de uploads.

**IMPORTANTE:** Ambas as rotas exportam `export const dynamic = 'force-dynamic'` para evitar cache do Next.js.

**GET `/api/uploads`:** Lista todos os uploads ordenados por `uploaded_at DESC`. Retorna `{ uploads: Upload[] }`.

**GET `/api/uploads/[id]`:** Detalhe de um upload + contagem de vendas associadas. Retorna `{ upload: Upload, totalVendas: number }`.

**DELETE `/api/uploads/[id]`:**
1. Requer body `{ confirmacao: "EXCLUIR" }` (senao 400 `CONFIRMATION_REQUIRED`)
2. Verificar que o upload existe (senao 404)
3. Contar vendas que serao removidas (para informar)
4. Deletar upload (ON DELETE CASCADE cuida das vendas)
5. Retornar `{ deleted: true, uploadId, nomeArquivo, vendasRemovidas }`

**Dependencias:** `lib/supabase.ts`, `lib/schemas.ts`

---

## MODULO 9 — `app/api/dashboard/route.ts` (IMPLEMENTADO)

**Proposito:** Agrega KPIs para o dashboard. Exporta `force-dynamic`.

**GET `/api/dashboard?periodo=mes-corrente`**

**Parametros de query:**
- `periodo`: `semana-atual | mes-corrente | acumulado-ano | custom`
- `inicio`, `fim`: ISO date strings (obrigatorios se periodo = custom)

**Fluxo:**
1. Calcular datas com `getPeriodDates()`
2. Buscar vendas no intervalo de datas
3. Buscar metas do ano/meses abrangidos
4. Agregar metas (para acumulado-ano, soma fat_meta por setor)
5. Chamar `calcDashboard()` e retornar `{ data: DashboardData }`

**Dependencias:** `lib/metrics.ts`, `lib/supabase.ts`, `lib/schemas.ts`

---

## MODULO 10 — `app/api/metas/route.ts` (IMPLEMENTADO)

**Proposito:** CRUD de metas mensais por setor. Exporta `force-dynamic` implicitamente (tem GET com parametros).

**GET `/api/metas?ano=2026`:** Retorna `{ metas: Meta[] }` ordenadas por mes + setor.

**POST `/api/metas`:** Upsert de metas.
```typescript
// Body
{ metas: Array<{ ano: number, mes: number, setor_grupo: SetorMeta, fat_meta: number }> }
```
Usa `supabase.from('metas').upsert(..., { onConflict: 'ano,mes,setor_grupo' })`.
Valida cada meta com `MetaInputSchema` (Zod).
Retorna `{ saved: number }`.

**Dependencias:** `lib/supabase.ts`, `lib/schemas.ts`

---

## MODULO 11 — `app/api/qualidade/route.ts` (IMPLEMENTADO)

**Proposito:** Score e timeline de qualidade dos uploads. Exporta `force-dynamic`.

**GET `/api/qualidade`:** Busca ultimos 20 uploads, recalcula score de cada um, retorna:
```typescript
{
  ultimoScore: number | null,
  timeline: Array<{ uploadId, nomeArquivo, uploadedAt, totalLinhas, score, alertas, status }>,
  ultimoUpload: object | null
}
```

**Dependencias:** `lib/supabase.ts`, `lib/schemas.ts`

---

## MODULO 12 — `app/api/vendas/route.ts` (IMPLEMENTADO)

**Proposito:** Listagem filtrada de vendas para drill-down. Exporta `force-dynamic`.

**GET `/api/vendas`** — Filtros via query params:
- `setor_grupo`, `vendedor` (ilike), `produto` (ilike), `pagante` (ilike)
- `data_inicio`, `data_fim`
- `valor_min`, `valor_max` (sobre faturamento)
- `limit` (default 100, max 1000), `offset` (default 0)

Retorna `{ vendas: Venda[], total: number, limit: number, offset: number }`.

**Dependencias:** `lib/supabase.ts`, `lib/schemas.ts`

---

## MODULO 13 — `components/dashboard/KPICard.tsx` (IMPLEMENTADO)

**Props:**
```typescript
interface KPICardProps {
  label: string
  fatMeta: number
  fatRealizado: number
  percRealizado: number | null
  receita: number
  percReceita: number | null
  ticketMedio: number
  nVendas: number
  loading?: boolean
  onClick?: () => void
  accent?: string          // cor da borda lateral
  children?: React.ReactNode  // conteudo extra (nTaxas, nContratos)
}
```

**Layout:** Grid 2x2 com Fat. Realizado + %, Meta, Receita + %, Vendas + Ticket Medio. Barra de progresso. Skeleton para loading.

**Cores para percRealizado:**
- >= 1.0 (100%+): verde `#27AE60`
- >= 0.7 (70-99%): laranja `#F39C12`
- < 0.7 (abaixo de 70%): vermelho `#E74C3C`
- null (sem meta): cinza

---

## MODULO 14 — `components/upload/*` (IMPLEMENTADO)

**UploadZone.tsx:** Drag & drop + click. Aceita .xlsx, max 5MB. Props: `onFile(file: File)`, `disabled`.

**PreviewTable.tsx:** Exibe primeiras 20 linhas. Colunas: Venda Nr, Vendedor, Data, Pagante, Setor (badge colorido), Produto, Situacao (badge), Faturamento, Receita.

**QualityReport.tsx:** Score (cor condicional), lista de alertas com SeverityBadge, ate 5 exemplos expandidos por alerta com venda_numero, vendedor, produto, detalhe.

---

## MODULO 15 — `components/history/*` (IMPLEMENTADO)

**UploadHistory.tsx:** Lista uploads (nome, data, stats, alertas). Props: `refreshKey` para reload. Modal de alertas com exemplos. Botao excluir.

**DeleteConfirmModal.tsx:** Dupla confirmacao (Etapa 1: info + Continuar, Etapa 2: digitar "EXCLUIR"). Props: `isOpen, uploadId, nomeArquivo, totalVendas, onConfirm, onClose`.

---

## MODULO 16 — `hooks/*` (IMPLEMENTADO)

**useDashboard.ts:** Fetch `/api/dashboard`, controle de periodo (semana-atual, mes-corrente, acumulado-ano, custom), datas customizadas.

**useUpload.ts:** State machine: `idle -> parsing -> preview -> uploading -> success/error`. Parse client-side via SheetJS, POST server-side. Retorna rows, alerts, score, totalLinhas, uploadResponse, error, fileName, handlers.

**useMetas.ts:** Fetch `/api/metas?ano=`, navegacao de ano, `saveMetas()`.

---

## MODULO 17 — Paginas `app/` (IMPLEMENTADO)

**`app/page.tsx` (Dashboard):** useDashboard + PeriodSelector + KPICards (consolidado + 3 setores). TRIPS mostra nTaxas, WEDDINGS mostra nContratos + subcategorias.

**`app/upload/page.tsx`:** Upload + Historico unificados. useUpload state machine no topo, UploadHistory embaixo com refreshKey sincronizado.

**`app/metas/page.tsx`:** useMetas + MetasTable editavel + navegacao de ano.

**`app/qualidade/page.tsx`:** Score do ultimo upload + timeline + alertas com exemplos.

**`app/login/page.tsx`:** Email/senha via Supabase Auth. Redirect para / apos login.

---

## Template de Prompt para Iniciar uma Sessao

```
Contexto do projeto:
- DashWT: Dashboard Executivo de Vendas da Welcome Trips
- Stack: Next.js 14 (App Router), Supabase, Vercel, TypeScript strict, Tailwind CSS, Recharts
- Leia ARCHITECTURE.md e AGENT_INSTRUCTIONS.md antes de comecar

Modulo desta sessao: [NOME DO MODULO]
Arquivo: [CAMINHO DO ARQUIVO]

[Cole aqui a secao de contexto do modulo de PROMPT_CONTEXT.md]

Tarefa:
[Descreva exatamente o que precisa ser implementado/alterado]

Restricoes:
- Nao modifique outros arquivos alem do informado
- Use os tipos de lib/schemas.ts
- Siga todas as regras de AGENT_INSTRUCTIONS.md
- Toda API Route GET precisa de: export const dynamic = 'force-dynamic'
```
