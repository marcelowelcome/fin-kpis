'use client'

import { useMetas } from '@/hooks/useMetas'
import { MetasTable } from '@/components/metas/MetasTable'

export default function MetasPage() {
  const { metas, loading, error, saving, ano, setAno, saveMetas } = useMetas()

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Metas de Faturamento</h1>
          <p className="text-sm text-slate-500 mt-1">
            Cadastre as metas mensais por setor
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAno(ano - 1)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            ←
          </button>
          <span className="px-4 py-2 text-sm font-bold text-slate-900 bg-white border border-slate-200 rounded-lg">
            {ano}
          </span>
          <button
            onClick={() => setAno(ano + 1)}
            className="px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            →
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 bg-slate-100 rounded" />
          ))}
        </div>
      ) : (
        <MetasTable
          metas={metas}
          ano={ano}
          saving={saving}
          onSave={saveMetas}
        />
      )}
    </div>
  )
}
