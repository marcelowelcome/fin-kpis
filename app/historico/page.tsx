'use client'

import { UploadHistory } from '@/components/history/UploadHistory'

export default function HistoricoPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Historico de Uploads</h1>
        <p className="text-sm text-slate-500 mt-1">
          Gerencie todos os arquivos importados
        </p>
      </div>
      <UploadHistory />
    </div>
  )
}
