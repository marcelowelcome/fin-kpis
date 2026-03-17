# PROMPT_CONTEXT.md — DashWT
## Contexto por Módulo — Para Uso em Sessões de Desenvolvimento com Agentes de IA

> **Como usar este arquivo:**
> Ao iniciar uma sessão de desenvolvimento em um módulo específico, copie a seção correspondente e cole no início do seu prompt para o agente. Isso garante que o agente tenha todo o contexto necessário sem precisar reprocessar o projeto inteiro.

---

## MÓDULO 1 — `lib/schemas.ts`

**Propósito:** Define todos os tipos TypeScript e schemas Zod do projeto. É a fonte de verdade de tipos. Todo outro módulo importa daqui.

**Responsabilidades:**
- Tipos das entidades do banco: `Venda`, `Upload`, `Meta`, `QualityAlert`
- Tipos dos KPIs calculados: `SetorKPI`, `DashboardData`, `WeddingsKPI`
- Schema Zod para validação do Excel parseado linha a linha: `VendaExcelSchema`
- Constantes: `SETOR_GRUPOS`, `SETOR_LABELS`, `METAS_SETORES`, `SEVERIDADES_ALERTA`
- Tipos das respostas das API Routes: `UploadResponse`, `DashboardResponse`

**Tipos críticos para implementar:**
```typescript
type SetorGrupo = 'CORP' | 'TRIPS' | 'WEDDINGS' | 'OUTROS' | 'INDEFINIDO'
type SetorMeta = 'CORP' | 'TRIPS' | 'WEDDINGS' | 'WT'

interface Venda {
  venda_numero: number
  vendedor: string
  data_venda: string           // ISO date string
  pagante: string
  setor_bruto: string | null
  setor_grupo: SetorGrupo
  produto: string | null
  fornecedor: string | null
  representante: string | null
  valor_total: number
  receitas: number
  faturamento: number
  upload_id: string
  updated_at: string
}

interface SetorKPI {
  fatMeta: number
  fatRealizado: number
  percRealizado: number
  receita: number
  percReceita: number
  ticketMedio: number
  nVendas: number
}

interface QualityAlert {
  tipo: 'SETOR_NULO' | 'VALOR_NEGATIVO' | 'LINHA_NULA' | 'DUPLICATA_INTERNA' | 'SETOR_OUTROS'
  severidade: 'CRITICO' | 'ATENCAO' | 'AVISO' | 'INFO'
  quantidade: number
  descricao: string
  linhas_afetadas?: number[]
}
```

**Dependências:** nenhuma (módulo base)  
**Importado por:** todos os outros módulos

---

## MÓDULO 2 — `lib/supabase.ts`

**Propósito:** Centraliza a criação dos clientes Supabase. Exporta dois clientes distintos: um para uso em componentes React (anon key) e outro para API Routes (service role key).

**Responsabilidades:**
- `createBrowserClient()`: usa `NEXT_PUBLIC_SUPABASE_ANON_KEY`, seguro para o browser
- `createServerClient()`: usa `SUPABASE_SERVICE_ROLE_KEY`, **apenas em API Routes**
- Tipagem do banco via Database type gerado pelo Supabase CLI

**Padrão de implementação:**
```typescript
// Para componentes / hooks
import { createBrowserClient } from '@supabase/ssr'
export const supabaseBrowser = createBrowserClient(url, anonKey)

// Para API Routes (server only)
import { createClient } from '@supabase/supabase-js'
export const supabaseServer = createClient(url, serviceRoleKey)
```

**Variáveis de ambiente necessárias:**
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY       ← nunca expor no cliente
```

**Dependências:** `@supabase/supabase-js`, `@supabase/ssr`

---

## MÓDULO 3 — `lib/setor-mapper.ts`

**Propósito:** Converte o valor bruto do campo `Setor` do Excel para o grupo canônico usado no banco e nos KPIs.

**Regra de mapeamento completa:**
```
Corporativo       → CORP
Lazer             → TRIPS
Expedições        → TRIPS
Weddings          → WEDDINGS
WedMe             → WEDDINGS
Produção          → WEDDINGS
Planejamento-WED  → WEDDINGS
Welcome           → OUTROS
null / ""         → INDEFINIDO
(qualquer outro)  → INDEFINIDO  (e deve gerar QualityAlert)
```

**Função principal a implementar:**
```typescript
function mapSetor(setorBruto: string | null | undefined): SetorGrupo
```

**Regras importantes:**
- A comparação deve ser case-insensitive e com trim()
- Valores desconhecidos → `INDEFINIDO` + gera alerta `SETOR_NULO` com severidade `CRITICO`
- `Welcome` → `OUTROS` + gera alerta `SETOR_OUTROS` com severidade `INFO`
- Esta é a **única** fonte de mapeamento. Nunca duplicar essa lógica em outro arquivo.

**Dependências:** `lib/schemas.ts`

---

## MÓDULO 4 — `lib/excel-parser.ts`

**Propósito:** Transforma o arquivo Excel bruto em um array de objetos tipados, validados e prontos para upsert. É chamado tanto no cliente (pré-visualização) quanto no servidor (persistência).

**Responsabilidades:**
1. Receber o arquivo como `ArrayBuffer`
2. Usar SheetJS para parsear a aba `modelo-exportacao-final`
3. Validar que as colunas obrigatórias estão presentes
4. Para cada linha: mapear colunas, normalizar valores, aplicar `mapSetor()`
5. Identificar e coletar alertas de qualidade (usando `lib/data-quality.ts`)
6. Retornar `{ rows: VendaInput[], alerts: QualityAlert[], totalLinhas: number }`

**Mapeamento de colunas Excel → banco:**
```
"Venda Nº"     → venda_numero   (número inteiro)
"Vendedor"     → vendedor
"Data Venda"   → data_venda     (converter para ISO date string)
"Pagante"      → pagante
"Setor"        → setor_bruto + setor_grupo (via setor-mapper.ts)
"Produto"      → produto
"Fornecedor"   → fornecedor
"Representante"→ representante
"Valor Total"  → valor_total    (número float)
"Receitas"     → receitas       (número float)
"Faturamento"  → faturamento    (número float)
```

**Validações:**
- Se uma das colunas obrigatórias estiver ausente: lançar erro `MISSING_COLUMNS` com lista das colunas faltantes
- Linha completamente nula: ignorar + registrar alerta `LINHA_NULA`
- `Venda Nº` duplicado no mesmo arquivo: manter última ocorrência + alerta `DUPLICATA_INTERNA`

**Dependências:** `xlsx` (SheetJS), `lib/schemas.ts`, `lib/setor-mapper.ts`, `lib/data-quality.ts`

---

## MÓDULO 5 — `lib/data-quality.ts`

**Propósito:** Define e executa todas as regras de qualidade de dados. Produz o score de qualidade e os alertas estruturados de um conjunto de linhas.

**Função principal:**
```typescript
function analyzeQuality(rows: VendaInput[]): {
  score: number              // 0-100
  alerts: QualityAlert[]
  breakdown: QualityBreakdown
}
```

**Regras implementadas:**

| Regra | Tipo | Severidade | Impacto no score |
|-------|------|------------|-----------------|
| `setor_grupo === 'INDEFINIDO'` | SETOR_NULO | CRITICO | -5 por ocorrência, max -30 |
| `faturamento < 0` OU `receitas < 0` | VALOR_NEGATIVO | ATENCAO | -2 por ocorrência, max -20 |
| Linha completamente nula | LINHA_NULA | AVISO | -1 por ocorrência, max -10 |
| `venda_numero` duplicado no arquivo | DUPLICATA_INTERNA | CRITICO | -5 por ocorrência, max -20 |
| `setor_grupo === 'OUTROS'` | SETOR_OUTROS | INFO | sem impacto no score |

**Score:** inicia em 100, deduz conforme tabela acima. Mínimo: 0.

**Dependências:** `lib/schemas.ts`

---

## MÓDULO 6 — `lib/metrics.ts`

**Propósito:** Calcula todos os KPIs do dashboard a partir das vendas e metas. É a única fonte de lógica de negócio para cálculos.

**Funções principais:**
```typescript
// KPI de um setor em um período
function calcSetorKPI(
  vendas: Venda[],
  meta: number,
  setorGrupo: SetorGrupo | SetorGrupo[]
): SetorKPI

// KPI completo do dashboard (todos os setores)
function calcDashboard(
  vendas: Venda[],
  metas: Meta[],
  periodo: { inicio: Date; fim: Date }
): DashboardData

// Nº de contratos Weddings
function countContratos(vendas: Venda[]): number
// WHERE produto IN ('Contrato de Casamento', 'Pacote de Casamento')

// Nº de taxas de serviço TRIPS
function countTaxas(vendas: Venda[]): number
// WHERE produto = 'Taxa de Serviço' AND setor_grupo = 'TRIPS'

// Semanas do mês corrente para granularidade semanal
function calcSemanasMes(vendas: Venda[], ano: number, mes: number): SemanasData[]
```

**Regras críticas:**
- WT = CORP + TRIPS + WEDDINGS. Nunca incluir OUTROS ou INDEFINIDO.
- `percRealizado = fatRealizado / fatMeta`. Se `fatMeta === 0`, retornar `null` (não dividir por zero).
- `percReceita = receita / fatRealizado`. Se `fatRealizado === 0`, retornar `null`.
- `ticketMedio = fatRealizado / nVendas`. Se `nVendas === 0`, retornar `0`.
- Semanas: usar ISO week number. Label: "S" + número da semana (ex: "S10", "S11").

**Dependências:** `lib/schemas.ts`

---

## MÓDULO 7 — `app/api/upload/route.ts`

**Propósito:** Endpoint POST que recebe o arquivo Excel, processa, e persiste no Supabase.

**Fluxo:**
```
POST /api/upload  (multipart/form-data, campo "file")
  │
  ├─ 1. Extrair arquivo do FormData
  ├─ 2. Converter para ArrayBuffer
  ├─ 3. Chamar excel-parser.ts → { rows, alerts, totalLinhas }
  ├─ 4. Upsert em lote na tabela `vendas`
  │      supabase.from('vendas').upsert(rows, { onConflict: 'venda_numero' })
  ├─ 5. Contar inseridas vs. atualizadas
  ├─ 6. INSERT na tabela `uploads` com metadados + alertas JSONB
  └─ 7. Retornar UploadResponse
```

**Resposta de sucesso:**
```typescript
interface UploadResponse {
  uploadId: string
  totalLinhas: number
  inseridas: number
  atualizadas: number
  alertas: QualityAlert[]
  status: 'success' | 'warning' | 'error'
}
```

**Erros a tratar:**
- Arquivo não enviado → 400 `FILE_MISSING`
- Colunas obrigatórias ausentes → 400 `MISSING_COLUMNS`
- Erro no Supabase → 500 `DB_ERROR`

**Nota:** Use `SUPABASE_SERVICE_ROLE_KEY` (client server). Nunca o anon key.

**Dependências:** `lib/excel-parser.ts`, `lib/supabase.ts`, `lib/schemas.ts`

---

## MÓDULO 8 — `app/api/uploads/route.ts` e `[id]/route.ts`

**Propósito:** Gerenciamento do histórico de uploads.

**GET `/api/uploads`:** Lista todos os uploads ordenados por `uploaded_at DESC`.

**DELETE `/api/uploads/[id]`:**
1. Verificar que o upload existe
2. Deletar o registro da tabela `uploads`
3. O `ON DELETE CASCADE` deleta automaticamente os registros de `vendas` associados
4. Retornar contagem de vendas removidas (buscar antes de deletar)

**Segurança:** DELETE requer que o corpo da requisição contenha `{ confirmacao: "EXCLUIR" }`. Se ausente → 400 `CONFIRMATION_REQUIRED`.

**Dependências:** `lib/supabase.ts`, `lib/schemas.ts`

---

## MÓDULO 9 — `app/api/dashboard/route.ts`

**Propósito:** Agrega KPIs para o dashboard. Recebe filtros de período e retorna `DashboardData`.

**GET `/api/dashboard?periodo=mes-corrente`**

**Parâmetros de query:**
```
periodo: 'semana-atual' | 'mes-corrente' | 'acumulado-ano' | 'custom'
inicio: string (ISO date, obrigatório se periodo='custom')
fim: string (ISO date, obrigatório se periodo='custom')
```

**Fluxo:**
1. Calcular datas `inicio` e `fim` com base no `periodo`
2. Buscar vendas do período no Supabase
3. Buscar metas do mês/ano no Supabase
4. Chamar `lib/metrics.ts → calcDashboard()`
5. Retornar `DashboardData`

**Dependências:** `lib/metrics.ts`, `lib/supabase.ts`, `lib/schemas.ts`

---

## MÓDULO 10 — `app/api/metas/route.ts`

**Propósito:** CRUD de metas mensais por setor.

**GET `/api/metas?ano=2026`:** Retorna todas as metas do ano.

**POST `/api/metas`:** Upsert de uma ou mais metas.
```typescript
// Body
{ metas: Array<{ ano, mes, setor_grupo, fat_meta }> }
```
Usa `INSERT ... ON CONFLICT (ano, mes, setor_grupo) DO UPDATE SET fat_meta = EXCLUDED.fat_meta, updated_at = now()`.

**Dependências:** `lib/supabase.ts`, `lib/schemas.ts`

---

## MÓDULO 11 — `components/dashboard/KPICard.tsx`

**Propósito:** Componente visual que exibe Fat. Meta, Fat. Realizado e % Realizado com cor condicional.

**Props:**
```typescript
interface KPICardProps {
  label: string              // ex: "CORP"
  fatMeta: number
  fatRealizado: number
  percRealizado: number | null
  receita: number
  percReceita: number | null
  loading?: boolean
  onClick?: () => void       // abre drill-down
}
```

**Regras de cor para `percRealizado`:**
- `>= 1.0` (100%+): verde `#27AE60`
- `>= 0.7` (70-99%): laranja `#F39C12`
- `< 0.7` (abaixo de 70%): vermelho `#E74C3C`
- `null` (sem meta): cinza

**Formato de valores:** BRL. Ex: `R$ 1.234.567,89` via `Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`.

**Dependências:** `lib/schemas.ts`

---

## MÓDULO 12 — `components/upload/UploadZone.tsx`

**Propósito:** Interface de drag & drop para seleção do arquivo Excel. Primeira etapa do fluxo de upload.

**Comportamento:**
1. Aceita apenas `.xlsx`
2. Ao selecionar: chama `lib/excel-parser.ts` no cliente para pré-visualização
3. Exibe loading enquanto parseia
4. Em caso de erro de estrutura (colunas ausentes): exibe mensagem de erro clara com as colunas faltantes
5. Em caso de sucesso: passa `{ rows, alerts }` para `PreviewTable.tsx`

**Estado interno:**
```typescript
type UploadState = 'idle' | 'parsing' | 'preview' | 'uploading' | 'success' | 'error'
```

**Dependências:** `lib/excel-parser.ts`, `lib/schemas.ts`, `components/upload/PreviewTable.tsx`

---

## MÓDULO 13 — `components/history/DeleteConfirmModal.tsx`

**Propósito:** Modal de dupla confirmação para exclusão de um upload.

**Fluxo em duas etapas:**
- **Etapa 1:** Informa o usuário: "Este upload contém X vendas. Ao excluir, todos os registros serão permanentemente removidos do banco de dados."
  - Botões: "Cancelar" e "Continuar"
- **Etapa 2:** Campo de texto onde o usuário deve digitar literalmente `EXCLUIR` para habilitar o botão de confirmação final.
  - Botão "Confirmar Exclusão" fica desabilitado até o texto correto ser digitado.

**Props:**
```typescript
interface DeleteConfirmModalProps {
  isOpen: boolean
  uploadId: string
  nomeArquivo: string
  totalVendas: number
  onConfirm: (uploadId: string) => Promise<void>
  onClose: () => void
}
```

**Dependências:** nenhuma de negócio — apenas UI

---

## Template de Prompt para Iniciar uma Sessão

Ao iniciar o desenvolvimento de qualquer módulo, use este template:

```
Contexto do projeto:
- DashWT: Dashboard Executivo de Vendas da Welcome Trips
- Stack: Next.js 14 (App Router), Supabase, Vercel, TypeScript strict, Tailwind CSS, Recharts
- Leia ARCHITECTURE.md e AGENT_INSTRUCTIONS.md antes de começar

Módulo desta sessão: [NOME DO MÓDULO]
Arquivo: [CAMINHO DO ARQUIVO]

[Cole aqui a seção de contexto do módulo de PROMPT_CONTEXT.md]

Tarefa:
[Descreva exatamente o que precisa ser implementado/alterado]

Restrições:
- Não modifique outros arquivos além do informado
- Use os tipos de lib/schemas.ts
- Siga todas as regras de AGENT_INSTRUCTIONS.md
```
