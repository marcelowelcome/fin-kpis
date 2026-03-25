'use client'

import { useVendorGoals } from '@/hooks/useVendorGoals'
import { VendorGoalsTable } from '@/components/metas-vendedor/VendorGoalsTable'

export default function MetasVendedorPage() {
  const { goals, vendedores, loading, error, saving, ano, setAno, saveGoals } = useVendorGoals()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Metas por Vendedor</h1>
          <p className="text-sm text-slate-500 mt-1">
            Cadastre metas individuais de valor total por vendedor
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAno(ano - 1)}
            className="px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            ←
          </button>
          <span className="px-4 py-2 text-sm font-bold text-slate-900 bg-white border border-slate-200 rounded-lg tabular-nums">
            {ano}
          </span>
          <button
            onClick={() => setAno(ano + 1)}
            className="px-3 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50"
          >
            →
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 animate-pulse">
          <div className="h-4 bg-slate-100 rounded w-48 mb-4" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-8 bg-slate-50 rounded" />
            ))}
          </div>
        </div>
      ) : (
        <VendorGoalsTable
          goals={goals}
          vendedores={vendedores}
          ano={ano}
          saving={saving}
          onSave={saveGoals}
        />
      )}
    </div>
  )
}
