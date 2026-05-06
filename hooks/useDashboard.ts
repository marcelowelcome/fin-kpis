'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { DashboardData } from '@/lib/schemas'

interface UseDashboardReturn {
  data: DashboardData | null
  loading: boolean
  error: string | null
  refetch: () => void
  periodo: string
  setPeriodo: (p: string) => void
  customInicio: string
  setCustomInicio: (d: string) => void
  customFim: string
  setCustomFim: (d: string) => void
  compareEnabled: boolean
  setCompareEnabled: (b: boolean) => void
  compareInicio: string
  setCompareInicio: (d: string) => void
  compareFim: string
  setCompareFim: (d: string) => void
  vendedorFilter: string | null
  setVendedorFilter: (v: string | null) => void
}

const LS_KEY = 'dashwt:period'
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface PeriodState {
  periodo: string
  customInicio: string
  customFim: string
  compareEnabled: boolean
  compareInicio: string
  compareFim: string
}

function readFromURL(searchParams: URLSearchParams): PeriodState | null {
  const p = searchParams.get('p')
  if (!p) return null
  const base: PeriodState = {
    periodo: p,
    customInicio: '',
    customFim: '',
    compareEnabled: false,
    compareInicio: '',
    compareFim: '',
  }
  if (p === 'custom') {
    const i = searchParams.get('i') ?? ''
    const f = searchParams.get('f') ?? ''
    if (!ISO_DATE_RE.test(i) || !ISO_DATE_RE.test(f)) return null
    base.customInicio = i
    base.customFim = f
  }
  const ci = searchParams.get('ci') ?? ''
  const cf = searchParams.get('cf') ?? ''
  if (ISO_DATE_RE.test(ci) && ISO_DATE_RE.test(cf)) {
    base.compareEnabled = true
    base.compareInicio = ci
    base.compareFim = cf
  }
  return base
}

function readFromLocalStorage(): PeriodState | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.periodo !== 'string' || !parsed.periodo) return null
    return {
      periodo: parsed.periodo,
      customInicio: typeof parsed.customInicio === 'string' ? parsed.customInicio : '',
      customFim: typeof parsed.customFim === 'string' ? parsed.customFim : '',
      compareEnabled: !!parsed.compareEnabled,
      compareInicio: typeof parsed.compareInicio === 'string' ? parsed.compareInicio : '',
      compareFim: typeof parsed.compareFim === 'string' ? parsed.compareFim : '',
    }
  } catch {
    return null
  }
}

function writeToLocalStorage(state: PeriodState) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(state))
  } catch {
    // localStorage indisponível ou cheio — silencioso
  }
}

function buildQueryString(state: PeriodState): string {
  const params = new URLSearchParams()
  params.set('p', state.periodo)
  if (state.periodo === 'custom') {
    if (state.customInicio) params.set('i', state.customInicio)
    if (state.customFim) params.set('f', state.customFim)
  }
  if (state.compareEnabled && state.compareInicio && state.compareFim) {
    params.set('ci', state.compareInicio)
    params.set('cf', state.compareFim)
  }
  return params.toString()
}

export function useDashboard(): UseDashboardReturn {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Default que o SSR e o primeiro render do cliente concordam — evita hydration mismatch.
  // O efeito abaixo hidrata a partir de URL ou localStorage e depois libera o fetch.
  const [periodo, setPeriodo] = useState('mes-corrente')
  const [customInicio, setCustomInicio] = useState('')
  const [customFim, setCustomFim] = useState('')
  const [compareEnabled, setCompareEnabled] = useState(false)
  const [compareInicio, setCompareInicio] = useState('')
  const [compareFim, setCompareFim] = useState('')
  const [vendedorFilter, setVendedorFilter] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const hydratedRef = useRef(false)

  // Hidratação: URL > localStorage > default. Roda só uma vez.
  useEffect(() => {
    if (hydratedRef.current) return
    hydratedRef.current = true

    const fromURL = readFromURL(new URLSearchParams(searchParams.toString()))
    const initial = fromURL ?? readFromLocalStorage()
    if (initial) {
      setPeriodo(initial.periodo)
      setCustomInicio(initial.customInicio)
      setCustomFim(initial.customFim)
      setCompareEnabled(initial.compareEnabled)
      setCompareInicio(initial.compareInicio)
      setCompareFim(initial.compareFim)
    }
    setHydrated(true)
  }, [searchParams])

  // Persistência: ao mudar período/comparação, escreve em URL (replace) + localStorage.
  useEffect(() => {
    if (!hydrated) return
    const state: PeriodState = {
      periodo, customInicio, customFim,
      compareEnabled, compareInicio, compareFim,
    }
    writeToLocalStorage(state)
    const qs = buildQueryString(state)
    router.replace(`?${qs}`, { scroll: false })
  }, [hydrated, periodo, customInicio, customFim, compareEnabled, compareInicio, compareFim, router])

  const fetchDashboard = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams({ periodo })
      if (periodo === 'custom' && customInicio && customFim) {
        params.set('inicio', customInicio)
        params.set('fim', customFim)
      }
      if (compareEnabled && compareInicio && compareFim) {
        params.set('compInicio', compareInicio)
        params.set('compFim', compareFim)
      }
      if (vendedorFilter) {
        params.set('vendedor', vendedorFilter)
      }

      const res = await fetch(`/api/dashboard?${params}`, { cache: 'no-store' })
      const json = await res.json()

      if (!res.ok) {
        setError(json.error?.message ?? 'Erro ao carregar dashboard')
        return
      }

      setData(json.data)
    } catch {
      setError('Erro de conexão ao carregar dashboard')
    } finally {
      setLoading(false)
    }
  }, [periodo, customInicio, customFim, compareEnabled, compareInicio, compareFim, vendedorFilter])

  // Só busca depois de hidratado, para evitar fetch com defaults antes da URL/localStorage ser lida.
  useEffect(() => {
    if (!hydrated) return
    fetchDashboard()
  }, [hydrated, fetchDashboard])

  return {
    data,
    loading,
    error,
    refetch: fetchDashboard,
    periodo,
    setPeriodo,
    customInicio,
    setCustomInicio,
    customFim,
    setCustomFim,
    compareEnabled,
    setCompareEnabled,
    compareInicio,
    setCompareInicio,
    compareFim,
    setCompareFim,
    vendedorFilter,
    setVendedorFilter,
  }
}
