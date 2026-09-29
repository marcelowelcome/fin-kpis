'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { VendedorRanking } from '@/lib/schemas'
import { formatBRL, getInitials, getShortName, AVATAR_COLORS } from '@/lib/format'

const VISIVEIS_PADRAO = 5

interface TopVendedoresProps {
  vendedores: VendedorRanking[]
  loading?: boolean
  activeVendedor?: string | null
  onSelect?: (vendedor: string | null) => void
  /** 'lista': um vendedor por linha (5 visíveis + "Ver todos").
   *  'colunas': todos os vendedores lado a lado, com a barra de meta na vertical. */
  layout?: 'lista' | 'colunas'
  /** Mostra só quem tem meta (M1) lançada no período, do tipo indicado. vendor_goals não
   *  guarda setor: hoje as metas de Trips são de receita e as de Corp de valor total. */
  somenteComMeta?: 'receita' | 'valor_total'
}

function fmtNum(v: number) {
  return Math.round(v).toLocaleString('pt-BR')
}

function temMeta(v: VendedorRanking) {
  return v.fatMeta != null && v.fatMeta > 0
}

function metaStatus(receitas: number, m1: number, m2: number | null, m3: number | null) {
  if (m3 && receitas >= m3) return { label: 'M3 ✓', color: 'text-emerald-600 bg-emerald-50' }
  if (m2 && receitas >= m2) return { label: `M3 ${Math.round((receitas / m3!) * 100)}%`, color: 'text-green-600 bg-green-50' }
  if (receitas >= m1)       return { label: `M2 ${m2 ? Math.round((receitas / m2) * 100) + '%' : '✓'}`, color: 'text-amber-600 bg-amber-50' }
  return { label: `${Math.round((receitas / m1) * 100)}% M1`, color: 'text-red-600 bg-red-50' }
}

/** Régua da barra de meta: 100% = maior meta cadastrada, cor pela meta atingida.
 *  Compartilhada pela barra horizontal (lista) e pela vertical (colunas). */
function metaBarData(receitas: number, m1: number, m2: number | null, m3: number | null) {
  const maxMeta = m3 ?? m2 ?? m1
  const pct = Math.min(receitas / maxMeta, 1)
  const m1Pct = m1 / maxMeta
  const m2Pct = m2 ? m2 / maxMeta : null

  const reachedM1 = receitas >= m1
  const reachedM2 = m2 ? receitas >= m2 : false
  const reachedM3 = m3 ? receitas >= m3 : false

  const barColor = reachedM3 ? 'bg-emerald-500'
    : reachedM2 ? 'bg-green-500'
    : reachedM1 ? 'bg-amber-400'
    : receitas / m1 >= 0.7 ? 'bg-amber-400'
    : 'bg-red-400'

  return { pct, m1Pct, m2Pct, barColor }
}

function MetaBar({ receitas, m1, m2, m3 }: { receitas: number; m1: number; m2: number | null; m3: number | null }) {
  const { pct, m1Pct, m2Pct, barColor } = metaBarData(receitas, m1, m2, m3)

  return (
    <div className="relative w-full h-2 bg-slate-100 rounded-full my-1.5">
      <div className={`absolute inset-y-0 left-0 rounded-full transition-all ${barColor}`} style={{ width: `${pct * 100}%` }} />
      <div className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-blue-300/80 rounded-full" style={{ left: `${m1Pct * 100}%` }} />
      {m2Pct && <div className="absolute top-[-2px] bottom-[-2px] w-0.5 bg-violet-300/80 rounded-full" style={{ left: `${m2Pct * 100}%` }} />}
    </div>
  )
}

/** A mesma barra de meta, em pé: enche de baixo para cima; o topo é a M3. */
function MetaColuna({ receitas, m1, m2, m3 }: { receitas: number; m1: number; m2: number | null; m3: number | null }) {
  const { pct, m1Pct, m2Pct, barColor } = metaBarData(receitas, m1, m2, m3)

  return (
    <div className="relative w-6 h-full bg-slate-100 rounded-t">
      <div className={`absolute inset-x-0 bottom-0 rounded-t transition-all ${barColor}`} style={{ height: `${pct * 100}%` }} />
      <div className="absolute left-[-4px] right-[-4px] h-0.5 translate-y-1/2 bg-blue-300/80 rounded-full" style={{ bottom: `${m1Pct * 100}%` }} />
      {m2Pct && <div className="absolute left-[-4px] right-[-4px] h-0.5 translate-y-1/2 bg-violet-300/80 rounded-full" style={{ bottom: `${m2Pct * 100}%` }} />}
    </div>
  )
}

function dicaVendedor(v: VendedorRanking) {
  const linhas = [v.vendedor, `Receita ${formatBRL(v.receitas)}`, `Faturamento ${formatBRL(v.faturamento)}`]
  const metas: [string, number | null | undefined][] = [['M1', v.fatMeta], ['M2', v.metaM2], ['M3', v.metaM3]]
  for (const [nome, meta] of metas) {
    if (meta) linhas.push(`${nome} ${fmtNum(meta)} · ${Math.round((v.receitas / meta) * 100)}% atingido`)
  }
  return linhas.join('\n')
}

/** Todos os vendedores lado a lado, do maior faturamento (esquerda) para o menor.
 *  As linhas de valores (receita, M1–M3, faturamento) ficam alinhadas entre colunas;
 *  os rótulos à esquerda ficam fixos quando há rolagem. */
function VendedoresColunas({ vendedores, activeVendedor, onSelect }: Pick<TopVendedoresProps, 'vendedores' | 'activeVendedor' | 'onSelect'>) {
  const ordenados = [...vendedores].sort((a, b) => b.faturamento - a.faturamento)

  return (
    <div className="overflow-x-auto">
      <div className="flex w-max min-w-full text-[11px] tabular-nums">

        {/* Rótulos das linhas — mesmas alturas das células das colunas */}
        <div className="sticky left-0 z-10 bg-white shrink-0 pr-2">
          <div className="h-7" />
          <div className="h-40" />
          <div className="h-16" />
          <div className="h-5 flex items-center text-slate-400">Receita</div>
          <div className="h-5 flex items-center text-[10px] text-blue-600 font-medium">M1</div>
          <div className="h-5 flex items-center text-[10px] text-violet-500 font-medium">M2</div>
          <div className="h-5 flex items-center text-[10px] text-emerald-600 font-medium">M3</div>
          <div className="h-5 flex items-center text-slate-400">Faturamento</div>
        </div>

        {ordenados.map((v, i) => {
          const isActive = activeVendedor === v.vendedor
          const hasMetas = temMeta(v)
          const status = hasMetas ? metaStatus(v.receitas, v.fatMeta!, v.metaM2 ?? null, v.metaM3 ?? null) : null
          const [primeiroNome, ...resto] = getShortName(v.vendedor).split(' ')

          return (
            <div
              key={v.vendedor}
              title={dicaVendedor(v)}
              className={`flex-1 min-w-max max-w-48 rounded-xl transition-colors ${
                onSelect ? 'cursor-pointer hover:bg-slate-50' : ''
              } ${isActive ? 'bg-blue-50 ring-1 ring-inset ring-blue-200' : ''}`}
              onClick={() => onSelect?.(isActive ? null : v.vendedor)}
            >
              {/* % da meta */}
              <div className="h-7 min-w-[64px] flex items-center justify-center px-1">
                {status && (
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${status.color}`}>
                    {status.label}
                  </span>
                )}
              </div>

              {/* Barra de meta (vertical) sobre a linha de base */}
              <div className="h-40 flex items-end justify-center border-b border-slate-200">
                {hasMetas ? (
                  <MetaColuna
                    receitas={v.receitas}
                    m1={v.fatMeta!}
                    m2={v.metaM2 ?? null}
                    m3={v.metaM3 ?? null}
                  />
                ) : (
                  <span className="text-[10px] text-slate-300 mb-1">sem meta</span>
                )}
              </div>

              {/* Posição + Avatar + Nome */}
              <div className="h-16 flex flex-col items-center pt-2 px-1">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-medium text-slate-400">{i + 1}</span>
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-semibold ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}>
                    {getInitials(v.vendedor)}
                  </div>
                </div>
                <p className="mt-1 text-center font-semibold text-slate-800 leading-tight whitespace-nowrap">
                  {primeiroNome}
                  {resto.length > 0 && <><br />{resto.join(' ')}</>}
                </p>
              </div>

              {/* Receita / M1 / M2 / M3 / Faturamento */}
              <div className="h-5 flex items-center justify-center px-1 whitespace-nowrap font-semibold text-slate-700">
                {formatBRL(v.receitas)}
              </div>
              <div className="h-5 flex items-center justify-center px-1 whitespace-nowrap text-[10px] font-medium text-blue-600">
                {hasMetas ? fmtNum(v.fatMeta!) : <span className="text-slate-300">—</span>}
              </div>
              <div className="h-5 flex items-center justify-center px-1 whitespace-nowrap text-[10px] font-medium text-violet-500">
                {v.metaM2 ? fmtNum(v.metaM2) : <span className="text-slate-300">—</span>}
              </div>
              <div className="h-5 flex items-center justify-center px-1 whitespace-nowrap text-[10px] font-medium text-emerald-600">
                {v.metaM3 ? fmtNum(v.metaM3) : <span className="text-slate-300">—</span>}
              </div>
              <div className="h-5 flex items-center justify-center px-1 whitespace-nowrap font-semibold text-slate-900">
                {formatBRL(v.faturamento)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function TopVendedores({ vendedores: todos, loading = false, activeVendedor, onSelect, layout = 'lista', somenteComMeta }: TopVendedoresProps) {
  const [expanded, setExpanded] = useState(false)
  const vendedores = somenteComMeta
    ? todos.filter((v) => temMeta(v) && v.tipoMeta === somenteComMeta)
    : todos

  if (loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm animate-pulse">
        <div className="h-4 bg-slate-100 rounded w-32 mb-4" />
        {layout === 'colunas' ? (
          <div className="h-[352px] bg-slate-50 rounded-lg" />
        ) : (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 bg-slate-50 rounded-lg mb-3" />
          ))
        )}
      </div>
    )
  }

  if (vendedores.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Top Vendedores</h3>
        <p className="text-sm text-slate-400">
          {todos.length > 0 ? 'Nenhum vendedor com meta lançada no período.' : 'Nenhum dado disponível.'}
        </p>
      </div>
    )
  }

  const limparFiltro = activeVendedor && onSelect && (
    <button onClick={() => onSelect(null)} className="text-xs text-blue-600 hover:text-blue-700 font-medium">
      Limpar filtro
    </button>
  )

  if (layout === 'colunas') {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 mb-4">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            Top Vendedores
            {somenteComMeta && <span className="ml-2 font-normal normal-case tracking-normal text-slate-400">com meta lançada · por faturamento</span>}
          </h3>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded-full bg-blue-300" />M1</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 rounded-full bg-violet-300" />M2</span>
            <span>topo da barra = M3</span>
            {limparFiltro}
          </div>
        </div>
        <VendedoresColunas vendedores={vendedores} activeVendedor={activeVendedor} onSelect={onSelect} />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Top Vendedores</h3>
        {limparFiltro}
      </div>

      <div className="space-y-4">
        {(expanded ? vendedores : vendedores.slice(0, VISIVEIS_PADRAO)).map((v, i) => {
          const isActive = activeVendedor === v.vendedor
          const hasMetas = temMeta(v)
          const status = hasMetas ? metaStatus(v.receitas, v.fatMeta!, v.metaM2 ?? null, v.metaM3 ?? null) : null

          return (
            <div
              key={v.vendedor}
              className={`rounded-xl px-2 py-2 -mx-1 transition-colors ${
                onSelect ? 'cursor-pointer hover:bg-slate-50' : ''
              } ${isActive ? 'bg-blue-50 ring-1 ring-blue-200' : ''}`}
              onClick={() => onSelect?.(isActive ? null : v.vendedor)}
            >
              <div className="flex items-start gap-2.5">
                {/* Posição + Avatar */}
                <div className="flex items-center gap-1.5 shrink-0 pt-0.5">
                  <span className="text-[11px] font-medium text-slate-400 w-3">{i + 1}</span>
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}>
                    {getInitials(v.vendedor)}
                  </div>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">

                  {/* Linha 1: Nome + % meta */}
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <p className="text-sm font-semibold text-slate-800 truncate">{v.vendedor}</p>
                    {status && (
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 ${status.color}`}>
                        {status.label}
                      </span>
                    )}
                  </div>

                  {/* Linha 2: Receita */}
                  <div className="flex items-baseline gap-1.5 text-xs">
                    <span className="text-slate-400">Receita</span>
                    <span className="font-semibold text-slate-700 tabular-nums">{formatBRL(v.receitas)}</span>
                  </div>

                  {/* Linha 3: M1 / M2 / M3 */}
                  {hasMetas && (
                    <div className="flex items-center gap-2 text-[10px] mt-0.5">
                      <span className="text-blue-600 font-medium">M1 {fmtNum(v.fatMeta!)}</span>
                      {v.metaM2 && <span className="text-violet-500 font-medium">M2 {fmtNum(v.metaM2)}</span>}
                      {v.metaM3 && <span className="text-emerald-600 font-medium">M3 {fmtNum(v.metaM3)}</span>}
                    </div>
                  )}

                  {/* Linha 4: Barra de meta */}
                  {hasMetas && (
                    <MetaBar
                      receitas={v.receitas}
                      m1={v.fatMeta!}
                      m2={v.metaM2 ?? null}
                      m3={v.metaM3 ?? null}
                    />
                  )}

                  {/* Linha 5: Faturamento */}
                  <div className="flex items-baseline gap-1.5 text-xs">
                    <span className="text-slate-400">Faturamento</span>
                    <span className="font-semibold text-slate-900 tabular-nums">{formatBRL(v.faturamento)}</span>
                  </div>

                </div>
              </div>
            </div>
          )
        })}
      </div>

      {vendedores.length > VISIVEIS_PADRAO && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-center gap-1 mt-4 pt-3 border-t border-slate-100 text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          {expanded ? (
            <>
              Mostrar menos
              <ChevronUp size={14} />
            </>
          ) : (
            <>
              Ver todos ({vendedores.length})
              <ChevronDown size={14} />
            </>
          )}
        </button>
      )}
    </div>
  )
}
