'use client'

import { useState, useCallback, useRef } from 'react'

interface UploadZoneProps {
  onFile: (file: File) => void
  disabled?: boolean
}

export function UploadZone({ onFile, disabled = false }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (disabled) return

      const file = e.dataTransfer.files[0]
      if (file) onFile(file)
    },
    [onFile, disabled]
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) onFile(file)
    },
    [onFile]
  )

  return (
    <div
      className={`relative border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
        isDragging
          ? 'border-blue-400 bg-blue-50'
          : disabled
          ? 'border-slate-200 bg-slate-50 opacity-60'
          : 'border-slate-300 bg-white hover:border-slate-400 cursor-pointer'
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx"
        onChange={handleChange}
        className="hidden"
        disabled={disabled}
      />
      <div className="space-y-3">
        <div className="text-4xl">
          {isDragging ? '📥' : '📤'}
        </div>
        <p className="text-lg font-medium text-slate-700">
          {isDragging ? 'Solte o arquivo aqui' : 'Arraste o arquivo .xlsx ou clique para selecionar'}
        </p>
        <p className="text-sm text-slate-500">
          Formato aceito: Excel (.xlsx) - Máximo 5MB
        </p>
      </div>
    </div>
  )
}
