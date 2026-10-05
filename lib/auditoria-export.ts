/**
 * Exporta o relatório da auditoria para Excel: uma aba com uma linha por venda alterada
 * e outra com o produto a produto. O xlsx é carregado só no clique (é pesado).
 */

import {
  AUDITORIA_MOTIVO_LABELS,
  AUDITORIA_TIPO_LABELS,
  type AuditoriaAlteracao,
} from '@/lib/schemas'

const MUDANCA_LABEL: Record<string, string> = {
  cancelado: 'Cancelado', incluido: 'Incluído', alterado: 'Valor alterado',
  reclassificado: 'Renomeado', saiu: 'Fora do relatório', igual: 'Sem mudança',
}

export async function exportarAuditoriaXlsx(alteracoes: AuditoriaAlteracao[], nomeArquivo: string): Promise<void> {
  const XLSX = await import('xlsx')

  const vendas = alteracoes.map((a) => ({
    'Detectado em': a.detectado_em,
    'Venda nº': a.venda_numero,
    'Data da venda': a.data_venda ?? a.data_venda_antes,
    'Data antes': a.data_venda_antes !== a.data_venda ? a.data_venda_antes : null,
    Vendedor: a.vendedor,
    'Vendedor antes': a.vendedor_antes !== a.vendedor ? a.vendedor_antes : null,
    Setor: a.setor_grupo,
    'Setor (Monde)': a.setor_bruto,
    'Setor antes': a.setor_grupo_antes !== a.setor_grupo ? a.setor_grupo_antes : null,
    Cliente: a.pagante,
    'Situação antes': a.situacao_antes,
    'Situação depois': a.situacao,
    'O que mudou': AUDITORIA_TIPO_LABELS[a.tipo] ?? a.tipo,
    'Receita antes': a.receita_antes,
    'Receita depois': a.receita_depois,
    'Δ Receita': a.delta_receita,
    'Valor antes': a.valor_antes,
    'Valor depois': a.valor_depois,
    'Δ Valor': a.delta_valor,
    Explicação: a.explicacao,
    Contexto: a.evidencias.join(' | '),
    'Motivo sugerido': AUDITORIA_MOTIVO_LABELS[a.motivo_sugerido] ?? a.motivo_sugerido,
    'Confiança (%)': a.confianca,
    Revisão: a.revisao,
    'Motivo real': a.motivo_real ? AUDITORIA_MOTIVO_LABELS[a.motivo_real] ?? a.motivo_real : null,
    Nota: a.nota,
    'Revisado por': a.revisado_por,
  }))

  const produtos = alteracoes.flatMap((a) => a.produtos.map((p) => ({
    'Detectado em': a.detectado_em,
    'Venda nº': a.venda_numero,
    Vendedor: a.vendedor,
    Setor: a.setor_grupo,
    Produto: p.produto,
    Fornecedor: p.fornecedor,
    Mudança: MUDANCA_LABEL[p.mudanca] ?? p.mudanca,
    'Produto antes': p.produto_antes ?? null,
    'Fornecedor antes': p.fornecedor_antes ?? null,
    'Valor antes': p.valor_antes,
    'Valor depois': p.valor_depois,
    'Receita antes (rateada)': p.receita_antes,
    'Receita depois (rateada)': p.receita_depois,
  })))

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(vendas), 'Alterações')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(produtos), 'Produtos')
  XLSX.writeFile(wb, nomeArquivo)
}
