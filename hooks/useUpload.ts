'use client'

import { useState, useCallback } from 'react'
import { parseExcel, isParseError } from '@/lib/excel-parser'
import type { VendaInput, QualityAlert, UploadResponse } from '@/lib/schemas'

export type UploadState = 'idle' | 'parsing' | 'preview' | 'uploading' | 'success' | 'error'

interface UseUploadReturn {
  state: UploadState
  rows: VendaInput[]
  alerts: QualityAlert[]
  score: number
  totalLinhas: number
  uploadResponse: UploadResponse | null
  error: string | null
  fileName: string | null
  handleFile: (file: File) => void
  confirmUpload: () => Promise<void>
  reset: () => void
}

export function useUpload(): UseUploadReturn {
  const [state, setState] = useState<UploadState>('idle')
  const [rows, setRows] = useState<VendaInput[]>([])
  const [alerts, setAlerts] = useState<QualityAlert[]>([])
  const [score, setScore] = useState(100)
  const [totalLinhas, setTotalLinhas] = useState(0)
  const [uploadResponse, setUploadResponse] = useState<UploadResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileRef, setFileRef] = useState<File | null>(null)

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.xlsx')) {
      setError('Apenas arquivos .xlsx são aceitos.')
      setState('error')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setError('Arquivo excede o limite de 5MB.')
      setState('error')
      return
    }

    setState('parsing')
    setFileName(file.name)
    setFileRef(file)
    setError(null)

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer
        const result = parseExcel(buffer)
        setRows(result.rows)
        setAlerts(result.alerts)
        setScore(result.score)
        setTotalLinhas(result.totalLinhas)
        setState('preview')
      } catch (err) {
        if (isParseError(err)) {
          setError(err.message)
        } else {
          setError('Erro ao processar o arquivo.')
        }
        setState('error')
      }
    }
    reader.onerror = () => {
      setError('Erro ao ler o arquivo.')
      setState('error')
    }
    reader.readAsArrayBuffer(file)
  }, [])

  const confirmUpload = useCallback(async () => {
    if (!fileRef) return

    setState('uploading')
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', fileRef)

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      })

      const json = await res.json()

      if (!res.ok) {
        setError(json.error?.message ?? 'Erro ao fazer upload.')
        setState('error')
        return
      }

      setUploadResponse(json)
      setState('success')
    } catch {
      setError('Erro de conexão ao fazer upload.')
      setState('error')
    }
  }, [fileRef])

  const reset = useCallback(() => {
    setState('idle')
    setRows([])
    setAlerts([])
    setScore(100)
    setTotalLinhas(0)
    setUploadResponse(null)
    setError(null)
    setFileName(null)
    setFileRef(null)
  }, [])

  return {
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
  }
}
