'use client'

import type { VendaInput } from '@/lib/schemas'
import { formatBRL } from '@/lib/format'
import { SETOR_LABELS } from '@/lib/schemas'

interface PreviewTableProps {
  rows: VendaInput[]
  totalLinhas: number
}

export function PreviewTable({ rows, totalLinhas }: PreviewTableProps) {
  const preview = rows.slice(0, 20)

  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">
          Pre-visualizacao ({totalLinhas} linhas no arquivo, {rows.length} validas)
        </h3>
        {rows.length > 20 && (
          <span className="text-xs text-slate-500">Exibindo primeiras 20 linhas</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b">
              <th className="px-3 py-2 text-left font-medium text-slate-600">Venda N</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Vendedor</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Data</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Pagante</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Setor</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Produto</th>
              <th className="px-3 py-2 text-left font-medium text-slate-600">Situacao</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">Faturamento</th>
              <th className="px-3 py-2 text-right font-medium text-slate-600">Receita</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {preview.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50">
                <td className="px-3 py-2 font-mono">{row.venda_numero}</td>
                <td className="px-3 py-2 max-w-[150px] truncate">{row.vendedor}</td>
                <td className="px-3 py-2">{row.data_venda}</td>
                <td className="px-3 py-2 max-w-[150px] truncate">{row.pagante}</td>
                <td className="px-3 py-2">
                  <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                    row.setor_grupo === 'INDEFINIDO' ? 'bg-red-100 text-red-700' :
                    row.setor_grupo === 'OUTROS' ? 'bg-slate-100 text-slate-600' :
                    'bg-blue-50 text-blue-700'
                  }`}>
                    {SETOR_LABELS[row.setor_grupo] ?? row.setor_grupo}
                  </span>
                </td>
                <td className="px-3 py-2 max-w-[150px] truncate">{row.produto ?? '-'}</td>
                <td className="px-3 py-2">
                  {row.situacao ? (
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${
                      row.situacao.toLowerCase() === 'fechada'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-amber-100 text-amber-700'
                    }`}>
                      {row.situacao}
                    </span>
                  ) : (
                    <span className="text-slate-400">-</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right font-mono">{formatBRL(row.faturamento)}</td>
                <td className="px-3 py-2 text-right font-mono">{formatBRL(row.receitas)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
