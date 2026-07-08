'use client'

import { useState } from 'react'
import { useDashboard } from '@/hooks/useDashboard'
import { KPICard } from '@/components/dashboard/KPICard'
import { PeriodSelector } from '@/components/dashboard/PeriodSelector'
import { CompanyTabs } from '@/components/dashboard/CompanyTabs'
import { PipelineCard } from '@/components/dashboard/PipelineCard'
import { TopVendedores } from '@/components/dashboard/TopVendedores'
import { ForecastCard } from '@/components/dashboard/ForecastCard'
import { MonthlyChart } from '@/components/dashboard/MonthlyChart'
import { GroupEvolutionChart } from '@/components/dashboard/GroupEvolutionChart'
import { TopProdutos } from '@/components/dashboard/TopProdutos'
import { ExportButton } from '@/components/dashboard/ExportButton'
import { SyncButton } from '@/components/dashboard/SyncButton'
import { ContratosPopover, ContratosCard } from '@/components/dashboard/ContratosPopover'
import { formatBRL, formatDateTime } from '@/lib/format'
import type { VendaKPI, SetorKPI } from '@/lib/schemas'

function ContratosHighlight({ count, contratos }: { count: number; contratos: VendaKPI[] }) {
  return (
    <div className="mt-3 pt-3 border-t border-amber-100">
      <div className="flex items-center justify-between bg-amber-50 rounded-xl px-3 py-2.5">
        <div>
          <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wider mb-0.5">Contratos vendidos</p>
          <p className="text-2xl font-bold text-amber-900 tabular-nums">{count}</p>
        </div>
        {count > 0 && (
          <div className="text-xs text-amber-600">
            <ContratosPopover count={count} contratos={contratos} />
          </div>
        )}
        {count === 0 && (
          <span className="text-xs text-amber-400 italic">nenhum no período</span>
        )}
      </div>
    </div>
  )
}

/** Card de subcategoria de Weddings (Produção, Planejamento-WED, Hospedagem, Extras Conv.). */
function SubcategoriaCard({ label, kpi }: { label: string; kpi?: SetorKPI }) {
  if (!kpi) return null
  const percRecStr = kpi.percReceita !== null ? (kpi.percReceita * 100).toFixed(1) + '%' : '-'
  const receitaOk = kpi.receitaMetaPct > 0 && kpi.percReceita !== null && kpi.percReceita >= kpi.receitaMetaPct
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-slate-500 font-medium">{label}</p>
        {kpi.percRealizado !== null && (
          <span className={`text-xs font-bold ${kpi.percRealizado >= 1 ? 'text-green-600' : kpi.percRealizado >= 0.7 ? 'text-amber-600' : 'text-red-600'}`}>
            {(kpi.percRealizado * 100).toFixed(0)}%
          </span>
        )}
      </div>
      <p className="text-lg font-semibold text-slate-900 tabular-nums">{formatBRL(kpi.fatRealizado)}</p>
      {kpi.fatMeta > 0 && (
        <p className="text-xs text-slate-400 tabular-nums">Meta: {formatBRL(kpi.fatMeta)}</p>
      )}
      <div className="flex items-center gap-1.5 mt-1.5">
        <span className="text-xs text-slate-500">Rec: {formatBRL(kpi.receita)}</span>
        <span className={`text-xs font-semibold ${receitaOk ? 'text-green-600' : kpi.receitaMetaPct > 0 ? 'text-red-600' : 'text-slate-500'}`}>
          {percRecStr}
        </span>
      </div>
      <p className="text-xs text-slate-400 mt-0.5">{kpi.nVendas} produtos</p>
      {kpi.split && (
        <div className="mt-2 pt-2 border-t border-slate-100 flex items-center gap-3 text-xs text-slate-500">
          <span>WedMe <span className="font-semibold text-slate-700 tabular-nums">{(kpi.split.wedmePct * 100).toFixed(1)}%</span></span>
          <span>Weddings <span className="font-semibold text-slate-700 tabular-nums">{(kpi.split.weddingsPct * 100).toFixed(1)}%</span></span>
        </div>
      )}
    </div>
  )
}

/** Bloco "Atendimento Conv." = Hospedagem + Extras Conv., com resultado consolidado (metas somadas). */
function AtendimentoConvGroup({ hospedagem, extras }: { hospedagem?: SetorKPI; extras?: SetorKPI }) {
  const fatRealizado = (hospedagem?.fatRealizado ?? 0) + (extras?.fatRealizado ?? 0)
  const fatMeta = (hospedagem?.fatMeta ?? 0) + (extras?.fatMeta ?? 0)
  const receita = (hospedagem?.receita ?? 0) + (extras?.receita ?? 0)
  const percRealizado = fatMeta > 0 ? fatRealizado / fatMeta : null
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/40 p-4">
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-sm font-semibold text-amber-900">Atendimento Conv.</p>
        {percRealizado !== null && (
          <span className={`text-xs font-bold ${percRealizado >= 1 ? 'text-green-600' : percRealizado >= 0.7 ? 'text-amber-600' : 'text-red-600'}`}>
            {(percRealizado * 100).toFixed(0)}%
          </span>
        )}
      </div>
      <p className="text-xl font-bold text-slate-900 tabular-nums">{formatBRL(fatRealizado)}</p>
      {fatMeta > 0 && (
        <p className="text-xs text-slate-500 tabular-nums mb-3">Meta: {formatBRL(fatMeta)} · Rec: {formatBRL(receita)}</p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SubcategoriaCard label="Hospedagem" kpi={hospedagem} />
        <SubcategoriaCard label="Extras Conv." kpi={extras} />
      </div>
    </div>
  )
}

const QUICK_PERIODS = [
  { key: 'acumulado-ano', label: `Acumulado ${new Date().getFullYear()}` },
  { key: 'mes-passado', label: 'Último mês' },
  { key: 'mes-corrente', label: 'Mês atual' },
  { key: 'ultimo-trimestre', label: 'Último trimestre' },
]

const EMPTY_PIPELINE = {
  aberta: { count: 0, valor: 0 },
  fechada: { count: 0, valor: 0 },
  taxaConversao: null,
}

const EMPTY_FORECAST = {
  projecao: 0,
  ritmoAtual: 0,
  diasRestantes: 0,
  diasDecorridos: 0,
  metaAtingivel: true,
}

export function DashboardClient() {
  const [activeTab, setActiveTab] = useState('group')
  const {
    data,
    loading,
    error,
    refetch,
    periodo,
    setPeriodo,
    customInicio,
    setCustomInicio,
    customFim,
    setCustomFim,
    compareEnabled,
    setCompareEnabled,
    compareInicio,
    setCompareInicio,
    compareFim,
    setCompareFim,
    vendedorFilter,
    setVendedorFilter,
  } = useDashboard()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
            <div className="flex items-center gap-3 mt-1">
              {data?.periodo && (
                <p className="text-xs text-slate-500">{data.periodo.label}</p>
              )}
              {data?.ultimaAtualizacao && (
                <p className="text-xs text-slate-400">
                  Atualizado {formatDateTime(data.ultimaAtualizacao)}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PeriodSelector
              periodo={periodo}
              setPeriodo={setPeriodo}
              customInicio={customInicio}
              setCustomInicio={setCustomInicio}
              customFim={customFim}
              setCustomFim={setCustomFim}
              compareEnabled={compareEnabled}
              setCompareEnabled={setCompareEnabled}
              compareInicio={compareInicio}
              setCompareInicio={setCompareInicio}
              compareFim={compareFim}
              setCompareFim={setCompareFim}
            />
            <SyncButton onSynced={refetch} />
            <ExportButton targetId="dashboard-content" filename={`dashboard-${periodo}`} />
          </div>
        </div>

        {/* Quick period shortcuts */}
        <div className="flex flex-wrap gap-2">
          {QUICK_PERIODS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setPeriodo(key); setCustomInicio(''); setCustomFim('') }}
              className={`px-3 py-1.5 text-sm font-medium rounded-full transition-colors ${
                periodo === key
                  ? 'bg-slate-900 text-white'
                  : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Company Tabs */}
        <CompanyTabs activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Erro */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Filtro ativo */}
      {vendedorFilter && (
        <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-2xl px-4 py-3">
          <span className="text-sm text-blue-700">
            Filtrando por: <strong>{vendedorFilter}</strong>
          </span>
          <button
            onClick={() => setVendedorFilter(null)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium underline"
          >
            Remover filtro
          </button>
        </div>
      )}

      {/* Dashboard content — capturado pelo ExportButton */}
      <div id="dashboard-content" className="space-y-6">

        {/* === GROUP TAB === */}
        {activeTab === 'group' && (() => {
          const f = data?.forecast?.total
          const expectedPct = f && (f.diasDecorridos + f.diasRestantes) > 0
            ? f.diasDecorridos / (f.diasDecorridos + f.diasRestantes)
            : null
          return (
          <div className="space-y-6">
            <KPICard
              label="Welcome Group (Consolidado)"
              fatMeta={data?.consolidado.fatMeta ?? 0}
              fatRealizado={data?.consolidado.fatRealizado ?? 0}
              percRealizado={data?.consolidado.percRealizado ?? null}
              receita={data?.consolidado.receita ?? 0}
              percReceita={data?.consolidado.percReceita ?? null}
              receitaMetaPct={data?.consolidado.receitaMetaPct}
              ticketMedio={data?.consolidado.ticketMedio}
              nVendas={data?.consolidado.nVendas}
              delta={data?.delta?.consolidado}
              deltaLabel={data?.deltaLabel}
              expectedPercent={expectedPct}
              loading={loading}
              accent="#1e293b"
            />

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <KPICard
                label="Corporativo"
                fatMeta={data?.corp.fatMeta ?? 0}
                fatRealizado={data?.corp.fatRealizado ?? 0}
                percRealizado={data?.corp.percRealizado ?? null}
                receita={data?.corp.receita ?? 0}
                percReceita={data?.corp.percReceita ?? null}
                receitaMetaPct={data?.corp.receitaMetaPct}
                ticketMedio={data?.corp.ticketMedio}
                nVendas={data?.corp.nVendas}
                delta={data?.delta?.corp}
                deltaLabel={data?.deltaLabel}
                expectedPercent={expectedPct}
                loading={loading}
                accent="#3b82f6"
              />
              <KPICard
                label="Trips"
                fatMeta={data?.trips.fatMeta ?? 0}
                fatRealizado={data?.trips.fatRealizado ?? 0}
                percRealizado={data?.trips.percRealizado ?? null}
                receita={data?.trips.receita ?? 0}
                percReceita={data?.trips.percReceita ?? null}
                receitaMetaPct={data?.trips.receitaMetaPct}
                ticketMedio={data?.trips.ticketMedio}
                nVendas={data?.trips.nVendas}
                delta={data?.delta?.trips}
                deltaLabel={data?.deltaLabel}
                expectedPercent={expectedPct}
                loading={loading}
                accent="#10b981"
              />
              <KPICard
                label="Weddings"
                fatMeta={data?.weddings.fatMeta ?? 0}
                fatRealizado={data?.weddings.fatRealizado ?? 0}
                percRealizado={data?.weddings.percRealizado ?? null}
                receita={data?.weddings.receita ?? 0}
                percReceita={data?.weddings.percReceita ?? null}
                receitaMetaPct={data?.weddings.receitaMetaPct}
                ticketMedio={data?.weddings.ticketMedio}
                nVendas={data?.weddings.nVendas}
                delta={data?.delta?.weddings}
                deltaLabel={data?.deltaLabel}
                expectedPercent={expectedPct}
                loading={loading}
                accent="#D4AC0D"
              >
                <ContratosHighlight
                  count={data?.weddings.nContratos ?? 0}
                  contratos={data?.weddings.contratosDetalhes ?? []}
                />
              </KPICard>
            </div>

            {/* Gráfico evolução multi-setor + Forecast */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <GroupEvolutionChart
                  trendTotal={data?.trend?.total ?? []}
                  trendCorp={data?.trend?.corp ?? []}
                  trendTrips={data?.trend?.trips ?? []}
                  trendWeddings={data?.trend?.weddings ?? []}
                  dailyTotal={data?.dailyTrend?.total}
                  dailyCorp={data?.dailyTrend?.corp}
                  dailyTrips={data?.dailyTrend?.trips}
                  dailyWeddings={data?.dailyTrend?.weddings}
                  loading={loading}
                />
              </div>
              <ForecastCard
                data={data?.forecast?.total ?? EMPTY_FORECAST}
                meta={data?.consolidado.fatMeta ?? 0}
                realizado={data?.consolidado.fatRealizado ?? 0}
                loading={loading}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <PipelineCard data={data?.pipeline?.total ?? EMPTY_PIPELINE} loading={loading} />
              <TopVendedores vendedores={data?.topVendedores?.total ?? []} loading={loading} activeVendedor={vendedorFilter} onSelect={setVendedorFilter} />
              <TopProdutos produtos={data?.topProdutos?.total ?? []} loading={loading} />
            </div>
          </div>
          )
        })()}

        {/* === TRIPS TAB === */}
        {activeTab === 'trips' && (() => {
          const f = data?.forecast?.trips
          const expectedPct = f && (f.diasDecorridos + f.diasRestantes) > 0
            ? f.diasDecorridos / (f.diasDecorridos + f.diasRestantes)
            : null
          return (
          <div className="space-y-6">
            <KPICard
              label="Trips — Lazer & Expedições"
              fatMeta={data?.trips.fatMeta ?? 0}
              fatRealizado={data?.trips.fatRealizado ?? 0}
              percRealizado={data?.trips.percRealizado ?? null}
              receita={data?.trips.receita ?? 0}
              percReceita={data?.trips.percReceita ?? null}
              receitaMetaPct={data?.trips.receitaMetaPct}
              ticketMedio={data?.trips.ticketMedio}
              nVendas={data?.trips.nVendas}
              delta={data?.delta?.trips}
              deltaLabel={data?.deltaLabel}
              expectedPercent={expectedPct}
              loading={loading}
              accent="#10b981"
            >
              {data?.trips.nTaxas !== undefined && data.trips.nTaxas > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-xs text-slate-500">
                    Taxas de Serviço: <strong className="text-slate-700">{data.trips.nTaxas}</strong>
                  </p>
                </div>
              )}
            </KPICard>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <MonthlyChart data={data?.trend?.trips ?? []} dailyData={data?.dailyTrend?.trips} color="#10b981" loading={loading} />
              </div>
              <ForecastCard
                data={data?.forecast?.trips ?? EMPTY_FORECAST}
                meta={data?.trips.fatMeta ?? 0}
                realizado={data?.trips.fatRealizado ?? 0}
                loading={loading}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <PipelineCard data={data?.pipeline?.trips ?? EMPTY_PIPELINE} loading={loading} />
              <TopVendedores vendedores={data?.topVendedores?.trips ?? []} loading={loading} activeVendedor={vendedorFilter} onSelect={setVendedorFilter} />
              <TopProdutos produtos={data?.topProdutos?.trips ?? []} loading={loading} />
            </div>
          </div>
          )
        })()}

        {/* === WEDDINGS TAB === */}
        {activeTab === 'weddings' && (() => {
          const f = data?.forecast?.weddings
          const expectedPct = f && (f.diasDecorridos + f.diasRestantes) > 0
            ? f.diasDecorridos / (f.diasDecorridos + f.diasRestantes)
            : null
          return (
          <div className="space-y-6">
            <KPICard
              label="Weddings"
              fatMeta={data?.weddings.fatMeta ?? 0}
              fatRealizado={data?.weddings.fatRealizado ?? 0}
              percRealizado={data?.weddings.percRealizado ?? null}
              receita={data?.weddings.receita ?? 0}
              percReceita={data?.weddings.percReceita ?? null}
              receitaMetaPct={data?.weddings.receitaMetaPct}
              ticketMedio={data?.weddings.ticketMedio}
              nVendas={data?.weddings.nVendas}
              delta={data?.delta?.weddings}
              deltaLabel={data?.deltaLabel}
              expectedPercent={expectedPct}
              loading={loading}
              accent="#D4AC0D"
            >
              <ContratosHighlight
                count={data?.weddings.nContratos ?? 0}
                contratos={data?.weddings.contratosDetalhes ?? []}
              />
            </KPICard>

            <ContratosCard
              count={data?.weddings.nContratos ?? 0}
              contratos={data?.weddings.contratosDetalhes ?? []}
            />

            {data?.weddings.subcategorias && Object.keys(data.weddings.subcategorias).length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                {/* Coluna esquerda: cards individuais */}
                <div className="space-y-4">
                  <SubcategoriaCard label="Planejamento-WED" kpi={data.weddings.subcategorias['Planejamento-WED']} />
                  <SubcategoriaCard label="Produção" kpi={data.weddings.subcategorias['Produção']} />
                </div>
                {/* Coluna direita: subsetor Atendimento Convidados */}
                <AtendimentoConvGroup
                  hospedagem={data.weddings.subcategorias['Hospedagem']}
                  extras={data.weddings.subcategorias['Extras Conv.']}
                />
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <MonthlyChart data={data?.trend?.weddings ?? []} dailyData={data?.dailyTrend?.weddings} color="#D4AC0D" loading={loading} />
              </div>
              <ForecastCard
                data={data?.forecast?.weddings ?? EMPTY_FORECAST}
                meta={data?.weddings.fatMeta ?? 0}
                realizado={data?.weddings.fatRealizado ?? 0}
                loading={loading}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <PipelineCard data={data?.pipeline?.weddings ?? EMPTY_PIPELINE} loading={loading} />
              <TopVendedores vendedores={data?.topVendedores?.weddings ?? []} loading={loading} activeVendedor={vendedorFilter} onSelect={setVendedorFilter} />
              <TopProdutos produtos={data?.topProdutos?.weddings ?? []} loading={loading} />
            </div>
          </div>
          )
        })()}

        {/* === CORP TAB === */}
        {activeTab === 'corp' && (() => {
          const f = data?.forecast?.corp
          const expectedPct = f && (f.diasDecorridos + f.diasRestantes) > 0
            ? f.diasDecorridos / (f.diasDecorridos + f.diasRestantes)
            : null
          return (
          <div className="space-y-6">
            <KPICard
              label="Corporativo"
              fatMeta={data?.corp.fatMeta ?? 0}
              fatRealizado={data?.corp.fatRealizado ?? 0}
              percRealizado={data?.corp.percRealizado ?? null}
              receita={data?.corp.receita ?? 0}
              percReceita={data?.corp.percReceita ?? null}
              receitaMetaPct={data?.corp.receitaMetaPct}
              ticketMedio={data?.corp.ticketMedio}
              nVendas={data?.corp.nVendas}
              delta={data?.delta?.corp}
              deltaLabel={data?.deltaLabel}
              expectedPercent={expectedPct}
              loading={loading}
              accent="#3b82f6"
            />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <MonthlyChart data={data?.trend?.corp ?? []} dailyData={data?.dailyTrend?.corp} color="#3b82f6" loading={loading} />
              </div>
              <ForecastCard
                data={data?.forecast?.corp ?? EMPTY_FORECAST}
                meta={data?.corp.fatMeta ?? 0}
                realizado={data?.corp.fatRealizado ?? 0}
                loading={loading}
              />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <PipelineCard data={data?.pipeline?.corp ?? EMPTY_PIPELINE} loading={loading} />
              <TopVendedores vendedores={data?.topVendedores?.corp ?? []} loading={loading} activeVendedor={vendedorFilter} onSelect={setVendedorFilter} />
              <TopProdutos produtos={data?.topProdutos?.corp ?? []} loading={loading} />
            </div>
          </div>
          )
        })()}

      </div>
    </div>
  )
}
