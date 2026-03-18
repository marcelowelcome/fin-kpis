'use client'

import { Package } from 'lucide-react'
import type { ProdutoRanking } from '@/lib/schemas'
import { formatBRL } from '@/lib/format'

interface TopProdutosProps {
  produtos: ProdutoRanking[]
  loading?: boolean
}

export function TopProdutos({ produtos, loading = false }: TopProdutosProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm animate-pulse">
        <div className="h-4 bg-slate-100 rounded w-32 mb-4" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 bg-slate-50 rounded-lg mb-2" />
        ))}
      </div>
    )
  }

  if (produtos.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
          Top Produtos
        </h3>
        <p className="text-sm text-slate-400">Nenhum dado disponível.</p>
      </div>
    )
  }

  const maxFat = produtos[0]?.faturamento || 1

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-4">
        Top Produtos
      </h3>

      <div className="space-y-2.5">
        {produtos.slice(0, 8).map((p, i) => {
          const pct = maxFat > 0 ? (p.faturamento / maxFat) * 100 : 0
          return (
            <div key={p.produto} className="flex items-start gap-3">
              <span className="text-xs font-medium text-slate-400 w-4 text-right shrink-0 mt-0.5">
                {i + 1}
              </span>
              <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                <Package size={14} className="text-slate-400" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <p className="text-xs font-medium text-slate-700 truncate">{p.produto}</p>
                  <p className="text-xs font-semibold text-slate-900 tabular-nums shrink-0 ml-2">
                    {formatBRL(p.faturamento)}
                  </p>
                </div>
                <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-200 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
                  Rec: {formatBRL(p.receitas)} ({p.faturamento > 0 ? ((p.receitas / p.faturamento) * 100).toFixed(1).replace('.', ',') : '0,0'}%)
                  {' · '}
                  {p.nVendas.toLocaleString('pt-BR')} vendas
                </p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
