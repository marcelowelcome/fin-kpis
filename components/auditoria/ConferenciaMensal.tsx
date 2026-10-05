'use client'

import { formatBRL, formatDate } from '@/lib/format'
import { AUDITORIA_TOLERANCIA } from '@/lib/auditoria'
import type { AuditoriaExecucao } from '@/lib/schemas'
import { Delta } from './AlteracoesTabela'

const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const COLUNAS = 7

/**
 * Receita das Fechadas por mês de venda, como cada conferência a registrou. Mês já
 * encerrado que muda de um dia para o outro é exatamente o que a auditoria procura.
 */
export function ConferenciaMensal({ execucoes, onMes }: { execucoes: AuditoriaExecucao[]; onMes?: (mes: string) => void }) {
  // Uma por dia (a última do dia), da mais antiga para a mais nova.
  const porDia = new Map<string, AuditoriaExecucao>()
  for (const e of execucoes) {
    if ((e.status !== 'ok' && e.status !== 'baseline') || !e.totais) continue
    const atual = porDia.get(e.data_ref)
    if (!atual || e.id > atual.id) porDia.set(e.data_ref, e)
  }
  const colunas = Array.from(porDia.values()).sort((a, b) => a.id - b.id).slice(-COLUNAS)
  if (colunas.length === 0) return null

  const ultima = colunas[colunas.length - 1]
  const meses = Object.keys(ultima.totais ?? {}).sort().reverse()

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <th className="text-left px-3 py-2.5 font-medium">Mês da venda</th>
            {colunas.map((c) => (
              <th key={c.id} className="text-right px-3 py-2.5 font-medium whitespace-nowrap">{formatDate(c.data_ref).slice(0, 5)}</th>
            ))}
            {colunas.length > 1 && <th className="text-right px-3 py-2.5 font-medium whitespace-nowrap">Variação no período</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {meses.map((mes) => {
            const valores = colunas.map((c) => c.totais?.[mes]?.receita ?? null)
            const primeiro = valores.find((v) => v !== null) ?? 0
            const variacao = (valores[valores.length - 1] ?? 0) - primeiro
            return (
              <tr key={mes} className="hover:bg-slate-50">
                <td className="px-3 py-2">
                  <button onClick={() => onMes?.(mes)} className="text-slate-800 hover:text-blue-600 font-medium" title="Ver as alterações deste mês">
                    {MESES[Number(mes.slice(5, 7)) - 1]}/{mes.slice(0, 4)}
                  </button>
                  <div className="text-xs text-slate-400">{ultima.totais?.[mes]?.vendas ?? 0} vendas · {ultima.totais?.[mes]?.linhas ?? 0} produtos</div>
                </td>
                {valores.map((v, i) => {
                  const ant = i > 0 ? valores[i - 1] : null
                  const d = v !== null && ant !== null ? v - ant : 0
                  const mudou = Math.abs(d) >= AUDITORIA_TOLERANCIA
                  return (
                    <td key={colunas[i].id} className={`px-3 py-2 text-right tabular-nums whitespace-nowrap ${mudou ? (d > 0 ? 'bg-green-50' : 'bg-red-50') : ''}`}>
                      <div className="text-slate-700">{v === null ? '—' : formatBRL(v)}</div>
                      {mudou && <Delta valor={d} className="text-xs" />}
                    </td>
                  )
                })}
                {colunas.length > 1 && (
                  <td className="px-3 py-2 text-right whitespace-nowrap"><Delta valor={variacao} /></td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="text-xs text-slate-400 px-3 py-2">
        Mês corrente sobe com as vendas novas do dia; nos meses anteriores, qualquer variação é alteração de venda já lançada.
      </p>
    </div>
  )
}
