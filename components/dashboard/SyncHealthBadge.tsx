'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck, ShieldAlert, ShieldQuestion } from 'lucide-react'
import type { QualityAlert } from '@/lib/schemas'

interface QualidadeResponse {
  score: number
  alertas: QualityAlert[]
  geradoEm: string
}

/**
 * Indicador de confiança dos números, direto no cabeçalho do dashboard — não só em
 * /qualidade, que ninguém olha antes de uma reunião. Reusa o mesmo /api/qualidade que
 * já compara banco × API do Monde ao vivo (ano atual).
 *
 * Só os dois alarmes que significam "o valor em R$ está errado" (CANCELADA_NO_BANCO,
 * DIVERGENCIA_API) sobem para vermelho — os demais (produto/fornecedor nulo) não
 * afetam faturamento/receita, então não valem susto aqui.
 *
 * O vermelho já é a autocorreção falando: desde 2026-09-15 há dois pg_cron diários
 * (rebuild dos últimos 3 anos + reconcile do mês atual/anterior) que corrigem esse
 * tipo de divergência sozinhos — por isso a mensagem promete correção, não só alerta.
 */
const TIPOS_FINANCEIROS = new Set(['CANCELADA_NO_BANCO', 'DIVERGENCIA_API'])

export function SyncHealthBadge() {
  const [data, setData] = useState<QualidadeResponse | null>(null)
  const [erro, setErro] = useState(false)

  useEffect(() => {
    let cancelado = false
    function carregar() {
      fetch('/api/qualidade', { cache: 'no-store' })
        .then((res) => res.json())
        .then((d) => { if (!cancelado) { setData(d); setErro(false) } })
        .catch(() => { if (!cancelado) setErro(true) })
    }
    carregar()
    const id = setInterval(carregar, 5 * 60 * 1000)
    return () => { cancelado = true; clearInterval(id) }
  }, [])

  if (erro) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-slate-400">
        <ShieldQuestion className="w-3.5 h-3.5" />
        Não foi possível conferir os dados agora
      </span>
    )
  }

  if (!data) return null

  const financeiros = data.alertas.filter((a) => TIPOS_FINANCEIROS.has(a.tipo))
  const critico = financeiros.some((a) => a.severidade === 'CRITICO')
  const atencao = financeiros.some((a) => a.severidade === 'ATENCAO')

  if (critico) {
    const linhas = financeiros.reduce((s, a) => s + a.quantidade, 0)
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-700 bg-red-50 px-2.5 py-1 rounded-full">
        <ShieldAlert className="w-3.5 h-3.5" />
        Divergência detectada ({linhas} linha{linhas === 1 ? '' : 's'}) — autocorreção diária já agendada
      </span>
    )
  }

  if (atencao) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-700 bg-amber-50 px-2.5 py-1 rounded-full">
        <ShieldAlert className="w-3.5 h-3.5" />
        Pequena divergência com o Monde — dentro do esperado (sync roda 3x/dia)
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full">
      <ShieldCheck className="w-3.5 h-3.5" />
      Conferido contra o Monde agora — sem divergência
    </span>
  )
}
