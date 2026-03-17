'use client'

import { useDashboard } from '@/hooks/useDashboard'
import { KPICard } from '@/components/dashboard/KPICard'
import { PeriodSelector } from '@/components/dashboard/PeriodSelector'
import { formatBRL, formatDateTime } from '@/lib/format'

export default function DashboardPage() {
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
  } = useDashboard()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Dashboard Executivo</h1>
          {data?.ultimaAtualizacao && (
            <p className="text-xs text-slate-500 mt-1">
              Ultima atualizacao: {formatDateTime(data.ultimaAtualizacao)}
            </p>
          )}
        </div>
        <PeriodSelector
          periodo={periodo}
          setPeriodo={setPeriodo}
          customInicio={customInicio}
          setCustomInicio={setCustomInicio}
          customFim={customFim}
          setCustomFim={setCustomFim}
        />
      </div>

      {/* Erro */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Período */}
      {data?.periodo && (
        <p className="text-sm text-slate-500">
          Periodo: {data.periodo.label}
        </p>
      )}

      {/* Consolidado WT */}
      <div>
        <KPICard
          label="Welcome Trips (Consolidado)"
          fatMeta={data?.consolidado.fatMeta ?? 0}
          fatRealizado={data?.consolidado.fatRealizado ?? 0}
          percRealizado={data?.consolidado.percRealizado ?? null}
          receita={data?.consolidado.receita ?? 0}
          percReceita={data?.consolidado.percReceita ?? null}
          ticketMedio={data?.consolidado.ticketMedio}
          nVendas={data?.consolidado.nVendas}
          loading={loading}
          accent="#1e293b"
        />
      </div>

      {/* Setores */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* CORP */}
        <KPICard
          label="Corporativo"
          fatMeta={data?.corp.fatMeta ?? 0}
          fatRealizado={data?.corp.fatRealizado ?? 0}
          percRealizado={data?.corp.percRealizado ?? null}
          receita={data?.corp.receita ?? 0}
          percReceita={data?.corp.percReceita ?? null}
          ticketMedio={data?.corp.ticketMedio}
          nVendas={data?.corp.nVendas}
          loading={loading}
          accent="#3b82f6"
        />

        {/* TRIPS */}
        <KPICard
          label="Lazer & Expedicoes"
          fatMeta={data?.trips.fatMeta ?? 0}
          fatRealizado={data?.trips.fatRealizado ?? 0}
          percRealizado={data?.trips.percRealizado ?? null}
          receita={data?.trips.receita ?? 0}
          percReceita={data?.trips.percReceita ?? null}
          ticketMedio={data?.trips.ticketMedio}
          nVendas={data?.trips.nVendas}
          loading={loading}
          accent="#10b981"
        >
          {data?.trips.nTaxas !== undefined && data.trips.nTaxas > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100">
              <p className="text-xs text-slate-500">
                Taxas de Servico: <strong className="text-slate-700">{data.trips.nTaxas}</strong>
              </p>
            </div>
          )}
        </KPICard>

        {/* WEDDINGS */}
        <KPICard
          label="Weddings"
          fatMeta={data?.weddings.fatMeta ?? 0}
          fatRealizado={data?.weddings.fatRealizado ?? 0}
          percRealizado={data?.weddings.percRealizado ?? null}
          receita={data?.weddings.receita ?? 0}
          percReceita={data?.weddings.percReceita ?? null}
          ticketMedio={data?.weddings.ticketMedio}
          nVendas={data?.weddings.nVendas}
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
          {data?.weddings.subcategorias && Object.keys(data.weddings.subcategorias).length > 0 && (
            <div className="mt-2 space-y-1">
              {Object.entries(data.weddings.subcategorias).map(([sub, kpi]) => (
                <div key={sub} className="flex justify-between text-xs">
                  <span className="text-slate-500">{sub}</span>
                  <span className="font-medium text-slate-700">
                    {formatBRL(kpi.fatRealizado)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </KPICard>
      </div>
    </div>
  )
}
