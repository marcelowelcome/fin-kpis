'use client'

import { useUpload } from '@/hooks/useUpload'
import { UploadZone } from '@/components/upload/UploadZone'
import { PreviewTable } from '@/components/upload/PreviewTable'
import { QualityReport } from '@/components/upload/QualityReport'
import Link from 'next/link'

export default function UploadPage() {
  const {
    state,
    rows,
    alerts,
    score,
    totalLinhas,
    uploadResponse,
    error,
    fileName,
    handleFile,
    confirmUpload,
    reset,
  } = useUpload()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Upload de Dados</h1>
        <p className="text-sm text-slate-500 mt-1">
          Importe o arquivo Excel exportado do sistema de gestao
        </p>
      </div>

      {/* Zona de upload */}
      {(state === 'idle' || state === 'error') && (
        <UploadZone
          onFile={handleFile}
          disabled={state !== 'idle' && state !== 'error'}
        />
      )}

      {/* Erro */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm text-red-700">{error}</p>
          <button
            onClick={reset}
            className="mt-2 text-sm text-red-600 underline hover:no-underline"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* Parsing */}
      {state === 'parsing' && (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-3 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-600">Processando {fileName}...</p>
        </div>
      )}

      {/* Preview */}
      {state === 'preview' && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-600">
              Arquivo: <strong>{fileName}</strong>
            </p>
            <div className="flex gap-2">
              <button
                onClick={reset}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg border border-slate-200 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={confirmUpload}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-900 hover:bg-slate-800 rounded-lg transition-colors"
              >
                Confirmar Upload ({rows.length} registros)
              </button>
            </div>
          </div>

          <QualityReport alerts={alerts} score={score} />
          <PreviewTable rows={rows} totalLinhas={totalLinhas} />
        </>
      )}

      {/* Uploading */}
      {state === 'uploading' && (
        <div className="text-center py-12">
          <div className="w-8 h-8 border-3 border-slate-200 border-t-slate-600 rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-slate-600">Enviando dados para o servidor...</p>
        </div>
      )}

      {/* Sucesso */}
      {state === 'success' && uploadResponse && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-6">
          <h2 className="text-lg font-bold text-green-800 mb-3">Upload concluido com sucesso!</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div>
              <p className="text-xs text-green-600">Total de linhas</p>
              <p className="text-lg font-bold text-green-800">{uploadResponse.totalLinhas}</p>
            </div>
            <div>
              <p className="text-xs text-green-600">Inseridas</p>
              <p className="text-lg font-bold text-green-800">{uploadResponse.inseridas}</p>
            </div>
            <div>
              <p className="text-xs text-green-600">Atualizadas</p>
              <p className="text-lg font-bold text-green-800">{uploadResponse.atualizadas}</p>
            </div>
            <div>
              <p className="text-xs text-green-600">Score de Qualidade</p>
              <p className="text-lg font-bold text-green-800">{uploadResponse.score}/100</p>
            </div>
          </div>
          <div className="flex gap-3">
            <Link
              href="/"
              className="px-4 py-2 text-sm font-medium text-white bg-green-700 hover:bg-green-800 rounded-lg transition-colors"
            >
              Ver Dashboard
            </Link>
            <button
              onClick={reset}
              className="px-4 py-2 text-sm text-green-700 hover:bg-green-100 rounded-lg border border-green-300 transition-colors"
            >
              Novo Upload
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
