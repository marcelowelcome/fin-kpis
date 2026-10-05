'use client'

import type { AuditoriaGrupo } from '@/lib/schemas'
import { Delta } from './AlteracoesTabela'

interface Props {
  titulo: string
  grupos: AuditoriaGrupo[]
  rotulo?: (chave: string) => string
  ativo?: string | null
  onSelect?: (chave: string | null) => void
  limite?: number
}

/** Lista de impacto na receita por setor / vendedor / tipo; clicar filtra a tabela. */
export function ImpactoGrupos({ titulo, grupos, rotulo = (c) => c, ativo, onSelect, limite = 8 }: Props) {
  const maior = Math.max(...grupos.map((g) => Math.abs(g.impacto)), 1)
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
      <h3 className="text-sm font-semibold text-slate-900 mb-3">{titulo}</h3>
      {grupos.length === 0 ? (
        <p className="text-sm text-slate-400">—</p>
      ) : (
        <ul className="space-y-2">
          {grupos.slice(0, limite).map((g) => (
            <li key={g.chave}>
              <button
                onClick={() => onSelect?.(ativo === g.chave ? null : g.chave)}
                className={`w-full text-left rounded-lg px-2 py-1.5 transition-colors ${ativo === g.chave ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-slate-50'}`}
              >
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-slate-700 truncate">{rotulo(g.chave)}</span>
                  <Delta valor={g.impacto} className="text-xs" />
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${g.impacto < 0 ? 'bg-red-400' : 'bg-green-400'}`}
                      style={{ width: `${(Math.abs(g.impacto) / maior) * 100}%` }}
                    />
                  </div>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap tabular-nums">
                    {g.n} alt. · {g.quedas}↓ {g.altas}↑
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {grupos.length > limite && <p className="text-[11px] text-slate-400 mt-2">+ {grupos.length - limite} outros</p>}
    </div>
  )
}
