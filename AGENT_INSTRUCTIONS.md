# AGENT_INSTRUCTIONS.md — DashWT

> **Leia ARCHITECTURE.md antes deste arquivo.**
> Este documento define as regras obrigatórias para qualquer agente de IA (Cursor, Windsurf, Claude Code etc.) trabalhando no projeto DashWT.

---

## Regras Obrigatórias

### REGRA 1 — Um módulo por sessão
Nunca modifique mais de um módulo em uma única sessão de trabalho. Conclua, teste e valide um módulo antes de avançar. Se perceber que a tarefa exige mudanças em múltiplos módulos, **pare e informe o usuário** antes de prosseguir.

**❌ Errado:** Alterar `lib/metrics.ts` e `components/dashboard/KPICard.tsx` na mesma resposta.  
**✅ Certo:** Concluir `lib/metrics.ts` → informar → iniciar `KPICard.tsx` na próxima sessão.

---

### REGRA 2 — Nunca reescrever o que não foi pedido
Se a tarefa é adicionar um campo a `lib/schemas.ts`, **não** refatore outras funções do arquivo. Se perceber um problema em outro trecho, **comente no chat** e aguarde autorização.

---

### REGRA 3 — Nunca expor a service role key no cliente
`SUPABASE_SERVICE_ROLE_KEY` é exclusiva de API Routes (`app/api/`). Qualquer operação de escrita (upload, metas, exclusão) **deve** passar por uma API Route server-side.

```typescript
// ❌ NUNCA — expõe a chave no bundle do browser
import { createClient } from '@supabase/supabase-js'
const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// ✅ SEMPRE — em app/api/*/route.ts
import { createClient } from '@/lib/supabase'  // usa server client internamente
```

---

### REGRA 4 — Toda lógica de negócio vai em `lib/`, não em componentes
Componentes React são responsáveis **apenas** por renderização e estado de UI. Qualquer cálculo, transformação de dados, mapeamento ou validação deve estar em `lib/`.

```typescript
// ❌ Errado — lógica de negócio no componente
function KPICard({ vendas }) {
  const realizado = vendas.filter(v => v.setor_grupo === 'CORP').reduce(...)
}

// ✅ Certo — componente recebe KPI já calculado
function KPICard({ fatMeta, fatRealizado, percRealizado }: SetorKPI) { ... }
```

---

### REGRA 5 — Toda função de `lib/` deve ter tipos explícitos
Nunca use `any`. Use os tipos definidos em `lib/schemas.ts`. Se um tipo novo for necessário, adicione-o em `lib/schemas.ts` primeiro.

```typescript
// ❌ Errado
function calcMetrics(data: any) { ... }

// ✅ Certo
function calcMetrics(vendas: Venda[], metas: Meta[]): DashboardData { ... }
```

---

### REGRA 6 — Upsert, nunca insert puro na tabela `vendas`
A tabela `vendas` usa `venda_numero` como chave primária. Todo insert **deve** usar `ON CONFLICT DO UPDATE` para garantir idempotência.

```typescript
// ✅ Sempre usar upsert
const { error } = await supabase
  .from('vendas')
  .upsert(rows, { onConflict: 'venda_numero' })
```

---

### REGRA 7 — Manter `setor_bruto` e `setor_grupo` separados
Ao processar o Excel, sempre salve o valor original do campo `Setor` em `setor_bruto` **e** o valor mapeado em `setor_grupo`. Use exclusivamente `lib/setor-mapper.ts` para fazer esse mapeamento. Nunca duplique a lógica de mapeamento em outro arquivo.

---

### REGRA 8 — WT = CORP + TRIPS + WEDDINGS (sem OUTROS, sem INDEFINIDO)
Nunca inclua registros com `setor_grupo IN ('OUTROS', 'INDEFINIDO')` nos cálculos de KPI de WT ou nos totais de qualquer setor principal. Esta regra está implementada em `lib/metrics.ts`. Se precisar de um total "bruto" para diagnóstico, crie uma função separada com nome explícito (ex: `calcTotalBruto()`).

---

### REGRA 9 — Validação de estrutura do Excel antes de qualquer operação
Antes de qualquer processamento, verifique se as colunas obrigatórias estão presentes. Use `lib/excel-parser.ts` que já implementa essa validação. Nunca faça suposições sobre a ordem ou presença das colunas.

Colunas obrigatórias: `Venda Nº`, `Vendedor`, `Data Venda`, `Pagante`, `Setor`, `Produto`, `Valor Total`, `Receitas`, `Faturamento`.

---

### REGRA 10 — Alertas de qualidade são JSONB estruturado
O campo `alertas_qualidade` na tabela `uploads` é um array de objetos com schema fixo. Use sempre o tipo `QualityAlert` de `lib/schemas.ts`.

```typescript
interface QualityAlert {
  tipo: 'SETOR_NULO' | 'VALOR_NEGATIVO' | 'LINHA_NULA' | 'DUPLICATA_INTERNA' | 'SETOR_OUTROS'
  severidade: 'CRITICO' | 'ATENCAO' | 'AVISO' | 'INFO'
  quantidade: number
  descricao: string
  linhas_afetadas?: number[]    // índices das linhas no arquivo original
}
```

---

### REGRA 11 — Exclusão de upload é sempre cascata
Ao excluir um upload, **apenas** delete o registro da tabela `uploads`. A FK com `ON DELETE CASCADE` cuida automaticamente de deletar os registros de `vendas` associados. Nunca delete registros de `vendas` diretamente pela lógica da aplicação ao excluir um upload.

---

### REGRA 12 — Nunca hardcode labels de setor nos componentes
Todos os labels de exibição dos setores (ex: "CORP", "TRIPS", "WEDDINGS") devem vir de uma constante central. Use `SETOR_LABELS` de `lib/schemas.ts`.

```typescript
// ❌ Errado
<h2>CORP</h2>

// ✅ Certo
<h2>{SETOR_LABELS[setor]}</h2>
```

---

### REGRA 13 — API Routes retornam erros com estrutura padronizada
```typescript
// ✅ Sempre retornar erro estruturado
return NextResponse.json(
  { error: { code: 'UPLOAD_INVALID_COLUMNS', message: 'Coluna obrigatória ausente: Venda Nº' } },
  { status: 400 }
)
```

---

### REGRA 14 — Componentes de tabela devem suportar dados vazios
Todo componente que renderiza uma tabela deve lidar com `data = []` sem quebrar. Exibir um estado vazio explícito ("Nenhum dado encontrado") em vez de renderizar uma tabela vazia.

---

### REGRA 15 — Antes de criar um novo arquivo, verifique se já existe
Consulte `ARCHITECTURE.md` seção 2 (Estrutura de Diretórios). Se o arquivo que você pretende criar já existe no mapa, **edite o existente**. Nunca crie arquivos paralelos com nomes similares (ex: `metrics2.ts`, `metrics-new.ts`).

---

## Checklist antes de entregar qualquer código

- [ ] O código está no módulo correto conforme `ARCHITECTURE.md`?
- [ ] Tipos explícitos em todas as funções? Sem `any`?
- [ ] Lógica de negócio em `lib/`, não em componentes?
- [ ] `SUPABASE_SERVICE_ROLE_KEY` apenas em API Routes?
- [ ] Upsert em vez de insert para tabela `vendas`?
- [ ] `setor_bruto` e `setor_grupo` gravados separadamente?
- [ ] WT exclui OUTROS e INDEFINIDO do cálculo?
- [ ] Alertas de qualidade usam o tipo `QualityAlert`?
- [ ] Componente trata estado vazio (`data = []`)?
- [ ] Nenhum arquivo novo criado onde já existe um existente?
