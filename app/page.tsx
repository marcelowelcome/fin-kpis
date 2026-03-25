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
import { TopProdutos } from '@/components/dashboard/TopProdutos'
import { ExportButton } from '@/components/dashboard/ExportButton'
import { formatBRL, formatDateTime } from '@/lib/format'

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

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState('group')
  const {
    data,
    loading,
    error,
    periodo,
    setPeriodo,
    customInicio,
    setCustomInicio,
    customFim,
    setCustomFim,
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
            />
            <ExportButton targetId="dashboard-content" filename={`dashboard-${periodo}`} />
          </div>
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

            {/* Gráfico evolução mensal + Forecast */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <MonthlyChart
                  data={data?.trend?.total ?? []}
                  color="#1e293b"
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
                <MonthlyChart data={data?.trend?.trips ?? []} color="#10b981" loading={loading} />
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
              {data?.weddings.nContratos !== undefined && data.weddings.nContratos > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-xs text-slate-500">
                    Contratos: <strong className="text-slate-700">{data.weddings.nContratos}</strong>
                  </p>
                </div>
              )}
            </KPICard>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2">
                <MonthlyChart data={data?.trend?.weddings ?? []} color="#D4AC0D" loading={loading} />
              </div>
              <ForecastCard
                data={data?.forecast?.weddings ?? EMPTY_FORECAST}
                meta={data?.weddings.fatMeta ?? 0}
                realizado={data?.weddings.fatRealizado ?? 0}
                loading={loading}
              />
            </div>

            {data?.weddings.subcategorias && Object.keys(data.weddings.subcategorias).length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {Object.entries(data.weddings.subcategorias).map(([sub, kpi]) => {
                  const percRecStr = kpi.percReceita !== null ? (kpi.percReceita * 100).toFixed(1) + '%' : '-'
                  const receitaOk = kpi.receitaMetaPct > 0 && kpi.percReceita !== null && kpi.percReceita >= kpi.receitaMetaPct
                  return (
                    <div key={sub} className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-xs text-slate-500 font-medium">{sub}</p>
                        {kpi.percRealizado !== null && (
                          <span className={`text-xs font-bold ${kpi.percRealizado >= 1 ? 'text-green-600' : kpi.percRealizado >= 0.7 ? 'text-amber-600' : 'text-red-600'}`}>
                            {(kpi.percRealizado * 100).toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <p className="text-lg font-semibold text-slate-900 tabular-nums">
                        {formatBRL(kpi.fatRealizado)}
                      </p>
                      {kpi.fatMeta > 0 && (
                        <p className="text-xs text-slate-400 tabular-nums">Meta: {formatBRL(kpi.fatMeta)}</p>
                      )}
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <span className="text-xs text-slate-500">Rec: {formatBRL(kpi.receita)}</span>
                        <span className={`text-xs font-semibold ${receitaOk ? 'text-green-600' : kpi.receitaMetaPct > 0 ? 'text-red-600' : 'text-slate-500'}`}>
                          {percRecStr}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{kpi.nVendas} vendas</p>
                    </div>
                  )
                })}
              </div>
            )}

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
                <MonthlyChart data={data?.trend?.corp ?? []} color="#3b82f6" loading={loading} />
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
