import type { QualityAlert, QualityAlertExemplo } from '@/lib/schemas'
import type { SondaQualidade } from '@/lib/monde-feed'
import { formatBRL, formatDate } from '@/lib/format'

/**
 * Monitor de qualidade do SYNC com a API do Monde (distinto de lib/data-quality.ts,
 * que analisa lotes de upload de Excel).
 *
 * ── O que mudou em 2026-08-27 ─────────────────────────────────────────────────
 * Antes, cada alerta aqui era um PROBLEMA CONHECIDO: uma classe de campo que a API do
 * Monde havia parado de preencher (produto, fornecedor, casal, vendedor, setor). Esses
 * alertas viviam acesos, então não alarmavam nada — eram um relatório do que já se sabia.
 *
 * Com os feeds planos (`sales` + `products`) esses cinco campos passaram a vir 100%
 * resolvidos, e o sync deixou de ler o bloco `raw`, que era o que quebrava. O esperado
 * agora é ZERO em todos. Por isso os alertas de campo nulo foram reclassificados como
 * ALARME DE REGRESSÃO: se acenderem, a API voltou a omitir dado — não é mais "o de
 * sempre", é notícia.
 *
 * E foram acrescentados os três alarmes que realmente faltavam, montados sobre os
 * sinais que a equipe da API expôs (`total` nas listagens e `synced_at` como frescor):
 *   CANCELADA_NO_BANCO — venda que a API reporta cancelada e continua somando aqui.
 *                        Era o erro mais caro: R$ 45.079,69 em 2026, invisível porque a
 *                        listagem sem `from`/`to` não devolve venda cancelada.
 *   DIVERGENCIA_API    — contagem de linhas ativas banco × API. Pega cancelamento
 *                        parcial e venda que ficou de fora, sem baixar linha nenhuma.
 *   ESPELHO_ATRASADO   — o espelho não relê de hora em hora como se supunha (medido:
 *                        dois backfills em massa, 52% num dia e 36% em outro). Dado
 *                        velho invalida a leitura, e a causa é do lado deles.
 */

const MAX_EXEMPLOS = 5

/** Abaixo deste percentual de vendas relidas na janela de frescor, acende o alarme. */
const FRESCOR_MINIMO_PCT = 20

export interface SyncQualityRow {
  venda_numero: number
  data_venda: string
  vendedor: string
  setor_grupo: string
  produto: string | null
  fornecedor: string | null
  operacao: string | null
  valor_total: number
  situacao: string | null
}

function criarExemplo(row: SyncQualityRow, detalhe: string): QualityAlertExemplo {
  return {
    venda_numero: row.venda_numero,
    vendedor: row.vendedor,
    produto: row.produto,
    valor: row.valor_total,
    detalhe: `${formatDate(row.data_venda)} · ${detalhe}`,
  }
}

/** Agrega linhas de produto (1 por produto) em vendas únicas, somando valor. */
function porVenda(rows: SyncQualityRow[]): { venda_numero: number; valor: number; row: SyncQualityRow }[] {
  const m = new Map<number, { venda_numero: number; valor: number; row: SyncQualityRow }>()
  for (const r of rows) {
    const cur = m.get(r.venda_numero)
    if (cur) cur.valor += r.valor_total
    else m.set(r.venda_numero, { venda_numero: r.venda_numero, valor: r.valor_total, row: r })
  }
  return Array.from(m.values())
}

const SETORES_KPI = new Set(['CORP', 'TRIPS', 'WEDDINGS'])

export function checkSyncQuality(
  rows: SyncQualityRow[],
  sonda?: SondaQualidade | null,
): QualityAlert[] {
  const alerts: QualityAlert[] = []

  // ─── Alarmes de divergência banco × API ────────────────────────────────────

  if (sonda) {
    // 1. Venda cancelada que continuou no banco. É o erro de dinheiro direto: a venda
    //    foi cancelada no Monde e o dashboard segue somando valor e receita dela.
    const cancSet = new Set(sonda.canceladasNaApi)
    const presentes = porVenda(rows.filter((r) => cancSet.has(r.venda_numero)))
    if (presentes.length > 0) {
      const valor = presentes.reduce((s, v) => s + v.valor, 0)
      alerts.push({
        tipo: 'CANCELADA_NO_BANCO',
        severidade: 'CRITICO',
        quantidade: presentes.length,
        descricao:
          `${presentes.length} venda(s) CANCELADA(S) no Monde ainda somando no dashboard ` +
          `(${formatBRL(valor)}) — rode a reconciliação para removê-las`,
        linhas_afetadas: presentes.map((p) => p.venda_numero),
        exemplos: presentes.slice(0, MAX_EXEMPLOS).map(({ row }) =>
          criarExemplo(row, 'API reporta sale_status = canceled')
        ),
      })
    }

    // 2. Contagem de linhas ativas: banco × API. Diferença revela cancelamento parcial
    //    e venda que ficou de fora, sem precisar baixar as linhas.
    const linhasBanco = rows.length
    const diff = linhasBanco - sonda.linhasAtivasApi
    if (Math.abs(diff) > 0 && sonda.linhasAtivasApi > 0) {
      const sobrando = diff > 0
      alerts.push({
        tipo: 'DIVERGENCIA_API',
        severidade: Math.abs(diff) > 50 ? 'CRITICO' : 'ATENCAO',
        quantidade: Math.abs(diff),
        descricao:
          `Banco tem ${linhasBanco.toLocaleString('pt-BR')} linhas ativas e a API tem ` +
          `${sonda.linhasAtivasApi.toLocaleString('pt-BR')} — ${Math.abs(diff).toLocaleString('pt-BR')} ` +
          (sobrando
            ? 'sobrando aqui (provável cancelamento não propagado)'
            : 'faltando aqui (venda não sincronizada)'),
      })
    }

    // 3. Frescor do espelho. `synced_at` é o instante em que ELES leram do Monde: se
    //    quase nada foi relido na janela, o dado do dia pode estar velho na origem.
    if (sonda.vendasNaApi > 0) {
      const pct = (sonda.vendasRelidas / sonda.vendasNaApi) * 100
      if (pct < FRESCOR_MINIMO_PCT) {
        alerts.push({
          tipo: 'ESPELHO_ATRASADO',
          severidade: 'ATENCAO',
          quantidade: 1,
          descricao:
            `Só ${pct.toFixed(0)}% das vendas do ano foram relidas do Monde nas últimas ` +
            `${sonda.horas}h (${sonda.vendasRelidas.toLocaleString('pt-BR')} de ` +
            `${sonda.vendasNaApi.toLocaleString('pt-BR')}) — cancelamento ou alteração ` +
            `recente pode ainda não ter chegado ao espelho`,
        })
      }
    }
  }

  // ─── Alarmes de regressão (esperado: zero em todos) ────────────────────────

  // Setor indefinido: some de TODO o dashboard, inclusive do consolidado do Group.
  // Nota: em 2026 as 13 vendas que ficaram aqui eram, na verdade, vendas CANCELADAS
  // congeladas sem setor. Preencher o setor delas teria sido pior — jogaria venda
  // cancelada para dentro de Lazer/WedMe/Produção. A correção certa é removê-las, que
  // é o que a régua de soma faz agora.
  const semSetor = porVenda(rows.filter((r) => r.setor_grupo === 'INDEFINIDO'))
  if (semSetor.length > 0) {
    const valorTotal = semSetor.reduce((s, v) => s + v.valor, 0)
    alerts.push({
      tipo: 'SETOR_NULO',
      severidade: 'CRITICO',
      quantidade: semSetor.length,
      descricao: `${semSetor.length} venda(s) sem setor definido (${formatBRL(valorTotal)}) — invisíveis em todo o dashboard, inclusive no consolidado do Group`,
      exemplos: semSetor.slice(0, MAX_EXEMPLOS).map(({ row }) =>
        criarExemplo(row, `situação "${row.situacao ?? '—'}" · campo Setor vazio no Monde`)
      ),
    })
  }

  // Produto sem rótulo. Com os feeds isso só acontece se aparecer um `product_kind`
  // novo que não está em KIND_PRODUTO (lib/monde-feed.ts) — ou seja, é acionável.
  const semProduto = porVenda(rows.filter((r) => !r.produto && SETORES_KPI.has(r.setor_grupo)))
  if (semProduto.length > 0) {
    const valorTotal = semProduto.reduce((s, v) => s + v.valor, 0)
    alerts.push({
      tipo: 'PRODUTO_NULO',
      severidade: 'ATENCAO',
      quantidade: semProduto.length,
      descricao: `${semProduto.length} venda(s) sem produto identificado (${formatBRL(valorTotal)}) — contam no faturamento do setor, mas somem dos cards de Contratos/Taxas/subcategoria. Provável product_kind novo faltando em KIND_PRODUTO`,
      exemplos: semProduto.slice(0, MAX_EXEMPLOS).map(({ row }) =>
        criarExemplo(row, `${row.setor_grupo} · nem product_name_resolvido nem rótulo por kind`)
      ),
    })
  }

  // Fornecedor: hoje 100% resolvido pela API e ainda sem leitor no dashboard, então
  // segue como INFO — serve de sinal de que o feed mudou, não de problema de negócio.
  const semFornecedor = porVenda(rows.filter((r) => !r.fornecedor))
  if (semFornecedor.length > 0) {
    const valorTotal = semFornecedor.reduce((s, v) => s + v.valor, 0)
    alerts.push({
      tipo: 'FORNECEDOR_NULO',
      severidade: 'INFO',
      quantidade: semFornecedor.length,
      descricao: `${semFornecedor.length} venda(s) sem fornecedor (${formatBRL(valorTotal)}) — nenhum card lê esse campo hoje; serve como sinal de que supplier_name_resolvido regrediu`,
      exemplos: semFornecedor.slice(0, MAX_EXEMPLOS).map(({ row }) =>
        criarExemplo(row, `${row.produto ?? '(produto não identificado)'} · supplier_name_resolvido vazio`)
      ),
    })
  }

  // Contrato de casamento sem o nome do casal. Foi por aqui que passou 13 dias de
  // regressão sem ninguém ver (o campo `approver` do raw sumiu em 2026-08-14 e a coluna
  // ficou 100% nula). Agora vem de operation_product_name_resolvido.
  const contratoSemOperacao = porVenda(
    rows.filter((r) => (r.produto ?? '').toLowerCase() === 'contrato de casamento' && !r.operacao)
  )
  if (contratoSemOperacao.length > 0) {
    alerts.push({
      tipo: 'CONTRATO_SEM_OPERACAO',
      severidade: 'AVISO',
      quantidade: contratoSemOperacao.length,
      descricao: `${contratoSemOperacao.length} contrato(s) sem nome do casal — coluna "Operação Própria" fica em branco no card de Contratos`,
      exemplos: contratoSemOperacao.slice(0, MAX_EXEMPLOS).map(({ row }) =>
        criarExemplo(row, 'operation_product_name_resolvido vazio')
      ),
    })
  }

  // Venda sem vendedor atribuído.
  const semVendedor = porVenda(rows.filter((r) => r.vendedor === 'Sem vendedor'))
  if (semVendedor.length > 0) {
    const valorTotal = semVendedor.reduce((s, v) => s + v.valor, 0)
    alerts.push({
      tipo: 'VENDEDOR_AUSENTE',
      severidade: 'ATENCAO',
      quantidade: semVendedor.length,
      descricao: `${semVendedor.length} venda(s) sem vendedor atribuído (${formatBRL(valorTotal)}) — somem do card Top Vendedores`,
      exemplos: semVendedor.slice(0, MAX_EXEMPLOS).map(({ row }) =>
        criarExemplo(row, `${row.setor_grupo} · travel_agent_name vazio no Monde`)
      ),
    })
  }

  return alerts
}
