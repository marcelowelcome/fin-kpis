'use client'

import { useState } from 'react'

interface DeleteConfirmModalProps {
  isOpen: boolean
  uploadId: string
  nomeArquivo: string
  totalVendas: number
  onConfirm: (uploadId: string) => Promise<void>
  onClose: () => void
}

export function DeleteConfirmModal({
  isOpen,
  uploadId,
  nomeArquivo,
  totalVendas,
  onConfirm,
  onClose,
}: DeleteConfirmModalProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [confirmText, setConfirmText] = useState('')
  const [deleting, setDeleting] = useState(false)

  if (!isOpen) return null

  const handleConfirm = async () => {
    setDeleting(true)
    await onConfirm(uploadId)
    setDeleting(false)
    setStep(1)
    setConfirmText('')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
        {step === 1 ? (
          <>
            <h2 className="text-lg font-bold text-slate-900 mb-3">
              Excluir Upload
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              O arquivo <strong>{nomeArquivo}</strong> contém{' '}
              <strong>{totalVendas}</strong> registros. Ao excluir, todos os
              registros de venda associados serão permanentemente removidos do
              banco de dados.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                Continuar
              </button>
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-slate-900 mb-3">
              Confirmar Exclusao
            </h2>
            <p className="text-sm text-slate-600 mb-4">
              Para confirmar, digite <strong>EXCLUIR</strong> no campo abaixo:
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Digite EXCLUIR"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-red-500"
              autoFocus
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setStep(1)
                  setConfirmText('')
                }}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
              >
                Voltar
              </button>
              <button
                onClick={handleConfirm}
                disabled={confirmText !== 'EXCLUIR' || deleting}
                className="px-4 py-2 text-sm text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {deleting ? 'Excluindo...' : 'Confirmar Exclusao'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
