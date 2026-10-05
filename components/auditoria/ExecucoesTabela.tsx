'use client'

import { formatBRL, formatDate, formatNumber } from '@/lib/format'
import type { AuditoriaExecucao } from '@/lib/schemas'
import { Delta } from './AlteracoesTabela'

/** 'rodando' há mais de 10 min é conferência que morreu no meio (a trava vence aos 10 min). */
function status(e: AuditoriaExecucao): { label: string; cls: string } {
  if (e.status === 'ok') return { label: 'OK', cls: 'bg-green-100 text-green-700' }
  if (e.status === 'baseline') return { label: 'Foto inicial', cls: 'bg-blue-100 text-blue-700' }
  if (e.status === 'erro') return { label: 'Erro', cls: 'bg-red-100 text-red-700' }
  const minutos = (Date.now() - new Date(e.iniciado_em).getTime()) / 60_000
  return minutos > 10 ? { label: 'Interrompida', cls: 'bg-red-100 text-red-700' } : { label: 'Rodando', cls: 'bg-amber-100 text-amber-700' }
}

export function ExecucoesTabela({ execucoes }: { execucoes: AuditoriaExecucao[] }) {
  if (execucoes.length === 0) return <p className="text-sm text-slate-500 text-center py-6">Nenhuma conferência ainda.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
            <th className="text-left px-3 py-2.5 font-medium">Conferência</th>
            <th className="text-left px-3 py-2.5 font-medium">Status</th>
            <th className="text-right px-3 py-2.5 font-medium">Vendas Fechadas</th>
            <th className="text-right px-3 py-2.5 font-medium">Receita registrada</th>
            <th className="text-right px-3 py-2.5 font-medium">Alterações</th>
            <th className="text-right px-3 py-2.5 font-medium">Impacto</th>
            <th className="text-right px-3 py-2.5 font-medium">Vendas novas</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {execucoes.slice(0, 20).map((e) => {
            const st = status(e)
            const duracao = e.finalizado_em ? Math.round((new Date(e.finalizado_em).getTime() - new Date(e.iniciado_em).getTime()) / 1000) : null
            return (
              <tr key={e.id} className="hover:bg-slate-50 align-top">
                <td className="px-3 py-2">
                  <div className="text-slate-800">{formatDate(e.data_ref)} <span className="text-slate-400 text-xs">{new Date(e.iniciado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span></div>
                  <div className="text-xs text-slate-400">{e.origem === 'manual' ? 'manual' : 'automática'}{duracao !== null ? ` · ${duracao}s` : ''}</div>
                </td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${st.cls}`}>{st.label}</span>
                  {e.erro && <div className="text-xs text-red-600 mt-1 max-w-xs">{e.erro}</div>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{e.vendas_fechadas !== null ? formatNumber(e.vendas_fechadas) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{e.receita_fechada !== null ? formatBRL(Number(e.receita_fechada)) : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{e.alteracoes ?? '—'}</td>
                <td className="px-3 py-2 text-right">{e.impacto_receita !== null ? <Delta valor={Number(e.impacto_receita)} /> : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                  {e.vendas_novas ?? '—'}{e.receita_novas ? <div className="text-xs">{formatBRL(Number(e.receita_novas))}</div> : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
