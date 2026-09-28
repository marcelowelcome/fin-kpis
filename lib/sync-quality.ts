import type { QualityAlert, QualityAlertExemplo } from '@/lib/schemas'
import type { SondaQualidade } from '@/lib/monde-indice'
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
 * Os três alarmes de divergência comparam `vendas` com o índice que a Edge Function
 * `monde-sync` mantém a partir da API oficial do Monde (v3, desde 2026-09-28; antes era
 * o espelho do TTARS, desligado em 02/10/2026):
 *   CANCELADA_NO_BANCO — venda que o Monde reporta cancelada e continua somando aqui.
 *   DIVERGENCIA_API    — venda com produto ativo no Monde que falta aqui, ou venda sem
 *                        produto ativo que sobrou aqui.
 *   ESPELHO_ATRASADO   — o sync parou de ler a lista do Monde, ou venda nova/alterada
 *                        está há mais de 1 h esperando o detalhe.
 */

const MAX_EXEMPLOS = 5

/** Sem leitura da lista do Monde há mais que isto, o sync está parado. */
const LISTA_ATRASADA_HORAS = 2

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

    // 2. Banco × último detalhe lido do Monde, venda a venda.
    const noBanco = new Set(rows.map((r) => r.venda_numero))
    const faltando = sonda.comAtivoNaApi.filter((n) => !noBanco.has(n))
    const semAtivo = new Set(sonda.semAtivoNaApi)
    const sobrando = porVenda(rows.filter((r) => semAtivo.has(r.venda_numero)))
    const diff = faltando.length + sobrando.length
    if (diff > 0) {
      const partes: string[] = []
      if (faltando.length) partes.push(`${faltando.length} com produto ativo no Monde faltando aqui`)
      if (sobrando.length) partes.push(`${sobrando.length} sem produto ativo no Monde sobrando aqui`)
      alerts.push({
        tipo: 'DIVERGENCIA_API',
        severidade: diff > 10 ? 'CRITICO' : 'ATENCAO',
        quantidade: diff,
        descricao: `Banco × Monde: ${partes.join(' e ')}`,
        linhas_afetadas: [...faltando, ...sobrando.map((s) => s.venda_numero)],
      })
    }

    // 3. Sync parado: lista sem leitura recente ou fila de vendas novas empacada.
    const horasSemLista = sonda.listaLidaEm
      ? (Date.now() - new Date(sonda.listaLidaEm).getTime()) / 3_600_000
      : Infinity
    if (horasSemLista > LISTA_ATRASADA_HORAS || sonda.filaAtrasada > 0) {
      const motivos: string[] = []
      if (horasSemLista > LISTA_ATRASADA_HORAS) {
        motivos.push(Number.isFinite(horasSemLista)
          ? `lista do Monde sem leitura há ${horasSemLista.toFixed(0)}h`
          : 'lista do Monde nunca lida')
      }
      if (sonda.filaAtrasada > 0) {
        motivos.push(`${sonda.filaAtrasada} venda(s) nova(s)/alterada(s) esperando há mais de 1h`)
      }
      alerts.push({
        tipo: 'ESPELHO_ATRASADO',
        severidade: 'ATENCAO',
        quantidade: 1,
        descricao: `Sync com o Monde atrasado: ${motivos.join('; ')} — alteração recente pode ainda não estar no dashboard`,
      })
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

  // Produto sem rótulo. Só acontece se aparecer um tipo de produto novo que não está em
  // KIND_PRODUTO (supabase/functions/monde-sync) — ou seja, é acionável.
  const semProduto = porVenda(rows.filter((r) => !r.produto && SETORES_KPI.has(r.setor_grupo)))
  if (semProduto.length > 0) {
    const valorTotal = semProduto.reduce((s, v) => s + v.valor, 0)
    alerts.push({
      tipo: 'PRODUTO_NULO',
      severidade: 'ATENCAO',
      quantidade: semProduto.length,
      descricao: `${semProduto.length} venda(s) sem produto identificado (${formatBRL(valorTotal)}) — contam no faturamento do setor, mas somem dos cards de Contratos/Taxas/subcategoria. Provável tipo de produto novo faltando em KIND_PRODUTO`,
      exemplos: semProduto.slice(0, MAX_EXEMPLOS).map(({ row }) =>
        criarExemplo(row, `${row.setor_grupo} · sem nome no catálogo nem rótulo por tipo`)
      ),
    })
  }

  // Fornecedor: resolvido pelo sync via /people e ainda sem leitor no dashboard, então
  // segue como INFO — serve de sinal de que o feed mudou, não de problema de negócio.
  const semFornecedor = porVenda(rows.filter((r) => !r.fornecedor))
  if (semFornecedor.length > 0) {
    const valorTotal = semFornecedor.reduce((s, v) => s + v.valor, 0)
    alerts.push({
      tipo: 'FORNECEDOR_NULO',
      severidade: 'INFO',
      quantidade: semFornecedor.length,
      descricao: `${semFornecedor.length} venda(s) sem fornecedor (${formatBRL(valorTotal)}) — nenhum card lê esse campo hoje; serve como sinal de que o fornecedor deixou de vir do Monde`,
      exemplos: semFornecedor.slice(0, MAX_EXEMPLOS).map(({ row }) =>
        criarExemplo(row, `${row.produto ?? '(produto não identificado)'} · fornecedor vazio no Monde`)
      ),
    })
  }

  // Contrato de casamento sem o nome do casal. Foi por aqui que passou 13 dias de
  // regressão sem ninguém ver (o campo `approver` do raw sumiu em 2026-08-14 e a coluna
  // ficou 100% nula). Agora vem do nome, no catálogo, da `operation` da venda.
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
        criarExemplo(row, 'operação própria sem nome no catálogo do Monde')
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
        criarExemplo(row, `${row.setor_grupo} · vendedor vazio no Monde`)
      ),
    })
  }

  return alerts
}
