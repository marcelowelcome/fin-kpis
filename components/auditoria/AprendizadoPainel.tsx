'use client'

import { Brain } from 'lucide-react'
import { formatDate, formatPercent } from '@/lib/format'
import { AUDITORIA_MOTIVO_LABELS, type AuditoriaPadrao, type AuditoriaPrecisao } from '@/lib/schemas'

/**
 * O que o motor aprendeu: quanto o motivo sugerido acerta (por semana de detecção — se
 * as revisões estão ensinando, a curva sobe) e os contextos em que as revisões já
 * definiram o motivo.
 */
export function AprendizadoPainel({ precisao, padroes }: { precisao: AuditoriaPrecisao; padroes: AuditoriaPadrao[] }) {
  if (precisao.revisadas === 0) {
    return (
      <div className="text-sm text-slate-500 py-6 text-center max-w-xl mx-auto">
        <Brain className="mx-auto mb-2 text-slate-300" size={28} />
        Nenhuma alteração revisada ainda. Cada revisão (confirmar ou corrigir o motivo) vira um
        exemplo para o motor: a partir de duas revisões concordantes num mesmo contexto — tipo de
        alteração, setor, produto, fornecedor ou vendedor — a sugestão passa a seguir o que foi revisado.
      </div>
    )
  }

  const semanas = precisao.porSemana.slice(-8)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-5">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Acerto do motivo sugerido por semana</h4>
          <div className="flex items-end gap-2 h-28">
            {semanas.map((s) => (
              <div key={s.semana} className="flex-1 flex flex-col items-center gap-1 h-full" title={`${s.acertos} de ${s.revisadas} revisadas`}>
                <span className="text-[11px] text-slate-500 tabular-nums">{Math.round(s.precisao * 100)}%</span>
                <div className="w-full flex-1 bg-slate-100 rounded-t relative">
                  <div className="absolute inset-x-0 bottom-0 bg-violet-400 rounded-t" style={{ height: `${s.precisao * 100}%` }} />
                </div>
                <span className="text-[10px] text-slate-400">{formatDate(s.semana).slice(0, 5)}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Semana em que a alteração foi detectada · {precisao.acertos} de {precisao.revisadas} sugestões confirmadas.</p>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Acerto por motivo sugerido</h4>
          <ul className="space-y-1.5 text-sm">
            {precisao.porMotivo.map((m) => (
              <li key={m.motivo} className="flex items-center gap-3">
                <span className="flex-1 text-slate-700 truncate">{AUDITORIA_MOTIVO_LABELS[m.motivo] ?? m.motivo}</span>
                <span className="text-xs text-slate-400 tabular-nums">{m.acertos}/{m.sugeridas}</span>
                <span className={`w-14 text-right text-xs font-medium tabular-nums ${m.precisao >= 0.7 ? 'text-green-600' : m.precisao >= 0.4 ? 'text-amber-600' : 'text-red-600'}`}>
                  {formatPercent(m.precisao)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Padrões aprendidos</h4>
        {padroes.length === 0 ? (
          <p className="text-sm text-slate-500">Ainda não há contexto com duas revisões ou mais.</p>
        ) : (
          <ul className="space-y-2.5">
            {padroes.map((p) => (
              <li key={p.chave} className="text-sm border border-slate-200 rounded-lg p-2.5">
                <div className="text-slate-500 text-xs first-letter:uppercase">{p.descricao}</div>
                <div className="flex items-center justify-between gap-2 mt-0.5">
                  <span className="font-medium text-slate-800">→ {AUDITORIA_MOTIVO_LABELS[p.motivo] ?? p.motivo}</span>
                  <span className="text-xs text-slate-400 whitespace-nowrap">{Math.round(p.share * 100)}% de {p.revisoes} revisões</span>
                </div>
                {p.nota && <div className="text-xs text-slate-500 mt-1 italic">Ex.: {p.nota}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
