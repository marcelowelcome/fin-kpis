'use client'

import { useState, useEffect } from 'react'
import { QualityReport } from '@/components/upload/QualityReport'
import type { QualityAlert } from '@/lib/schemas'

interface QualidadeResponse {
  score: number
  alertas: QualityAlert[]
  totalVendas: number
  geradoEm: string
}

export default function QualidadePage() {
  const [data, setData] = useState<QualidadeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    fetch('/api/qualidade', { cache: 'no-store' })
      .then((res) => res.json())
      .then(setData)
      .catch(() => setErro(true))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Qualidade dos Dados</h1>
        <p className="text-sm text-slate-500 mt-1">
          Monitor do sync com a API do Monde (ano atual) — campos que a API parou de
          preencher em algum momento, causando classificação errada ou dado invisível
          no dashboard.
        </p>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 bg-slate-100 rounded-lg" />
          ))}
        </div>
      ) : erro || !data ? (
        <div className="text-center py-12 text-slate-500">
          <p>Não foi possível carregar o monitor de qualidade.</p>
        </div>
      ) : (
        <>
          <QualityReport alerts={data.alertas} score={data.score} />
          <p className="text-xs text-slate-400">
            {data.totalVendas} venda(s) analisadas · atualizado{' '}
            {new Date(data.geradoEm).toLocaleString('pt-BR')}
          </p>
        </>
      )}
    </div>
  )
}
