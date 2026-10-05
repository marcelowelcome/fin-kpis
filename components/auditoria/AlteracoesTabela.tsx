'use client'

import { Fragment, useState } from 'react'
import { ChevronDown, ChevronRight, Check, Undo2, Loader2, Brain } from 'lucide-react'
import { formatBRL, formatDate, formatDateTime } from '@/lib/format'
import { AUDITORIA_TOLERANCIA } from '@/lib/auditoria'
import {
  AUDITORIA_MOTIVOS,
  AUDITORIA_MOTIVO_LABELS,
  AUDITORIA_TIPO_LABELS,
  type AuditoriaAlteracao,
  type AuditoriaMotivo,
  type AuditoriaProduto,
} from '@/lib/schemas'

const VISIVEIS_PADRAO = 50

const MUDANCA_ESTILO: Record<AuditoriaProduto['mudanca'], { label: string; cls: string }> = {
  cancelado: { label: 'Cancelado', cls: 'bg-red-100 text-red-700' },
  incluido: { label: 'Incluído', cls: 'bg-green-100 text-green-700' },
  alterado: { label: 'Valor alterado', cls: 'bg-amber-100 text-amber-700' },
  reclassificado: { label: 'Renomeado', cls: 'bg-blue-100 text-blue-700' },
  saiu: { label: 'Fora do relatório', cls: 'bg-slate-200 text-slate-600' },
  igual: { label: 'Sem mudança', cls: 'bg-slate-100 text-slate-500' },
}

export function Delta({ valor, className = '' }: { valor: number; className?: string }) {
  if (Math.abs(valor) < AUDITORIA_TOLERANCIA) return <span className={`text-slate-400 ${className}`}>—</span>
  return (
    <span className={`font-medium tabular-nums ${valor > 0 ? 'text-green-600' : 'text-red-600'} ${className}`}>
      {valor > 0 ? '+' : '−'}{formatBRL(Math.abs(valor))}
    </span>
  )
}

function RevisaoBadge({ a }: { a: AuditoriaAlteracao }) {
  if (a.revisao === 'confirmada') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Confirmada</span>
  if (a.revisao === 'corrigida') return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">Corrigida</span>
  return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">Pendente</span>
}

interface Props {
  alteracoes: AuditoriaAlteracao[]
  onRevisar: (id: number, motivo: AuditoriaMotivo, nota: string) => Promise<boolean>
  onDesfazer: (id: number) => Promise<boolean>
}

export function AlteracoesTabela({ alteracoes, onRevisar, onDesfazer }: Props) {
  const [aberta, setAberta] = useState<number | null>(null)
  const [mostrarTodas, setMostrarTodas] = useState(false)
  const visiveis = mostrarTodas ? alteracoes : alteracoes.slice(0, VISIVEIS_PADRAO)

  if (alteracoes.length === 0) {
    return <p className="text-sm text-slate-500 text-center py-10">Nenhuma alteração com esses filtros.</p>
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <th className="w-8" />
              <th className="text-left px-3 py-2.5 font-medium">Detectado</th>
              <th className="text-left px-3 py-2.5 font-medium">Venda</th>
              <th className="text-left px-3 py-2.5 font-medium">Vendedor · Setor</th>
              <th className="text-left px-3 py-2.5 font-medium">O que mudou</th>
              <th className="text-right px-3 py-2.5 font-medium">Receita antes → depois</th>
              <th className="text-right px-3 py-2.5 font-medium">Δ Receita</th>
              <th className="text-left px-3 py-2.5 font-medium">Motivo provável</th>
              <th className="text-left px-3 py-2.5 font-medium">Revisão</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visiveis.map((a) => {
              const expandida = aberta === a.id
              const motivo = a.motivo_real ?? a.motivo_sugerido
              return (
                <Fragment key={a.id}>
                  <tr
                    className={`cursor-pointer transition-colors ${expandida ? 'bg-blue-50/40' : 'hover:bg-slate-50'}`}
                    onClick={() => setAberta(expandida ? null : a.id)}
                  >
                    <td className="pl-3 text-slate-400">
                      {expandida ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{formatDate(a.detectado_em)}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <div className="font-medium text-slate-900">nº {a.venda_numero}</div>
                      <div className="text-xs text-slate-400">{a.data_venda || a.data_venda_antes ? formatDate((a.data_venda ?? a.data_venda_antes)!) : '—'}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="text-slate-800">{a.vendedor ?? '—'}</div>
                      <div className="text-xs text-slate-400">{a.setor_grupo ?? '—'}{a.setor_bruto && a.setor_bruto !== a.setor_grupo ? ` · ${a.setor_bruto}` : ''}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 whitespace-nowrap">
                        {AUDITORIA_TIPO_LABELS[a.tipo] ?? a.tipo}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums whitespace-nowrap">
                      {formatBRL(a.receita_antes)} → {formatBRL(a.receita_depois)}
                    </td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap"><Delta valor={a.delta_receita} /></td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 text-slate-700">
                        {a.base_aprendizado?.aprendido && a.revisao === 'pendente' && (
                          <span title="Sugestão aprendida com revisões anteriores"><Brain size={14} className="text-violet-500 shrink-0" /></span>
                        )}
                        <span className="line-clamp-1">{AUDITORIA_MOTIVO_LABELS[motivo] ?? motivo}</span>
                      </div>
                      {a.revisao === 'pendente' && <div className="text-xs text-slate-400">{a.confianca}% de confiança</div>}
                    </td>
                    <td className="px-3 py-2.5"><RevisaoBadge a={a} /></td>
                  </tr>
                  {expandida && (
                    <tr className="bg-blue-50/20">
                      <td colSpan={9} className="px-6 pb-5 pt-2">
                        <Detalhe a={a} onRevisar={onRevisar} onDesfazer={onDesfazer} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {alteracoes.length > VISIVEIS_PADRAO && (
        <div className="text-center py-3 border-t border-slate-100">
          <button onClick={() => setMostrarTodas(!mostrarTodas)} className="text-sm text-blue-600 hover:text-blue-700">
            {mostrarTodas ? 'Mostrar menos' : `Ver todas as ${alteracoes.length} alterações`}
          </button>
        </div>
      )}
    </div>
  )
}

function Detalhe({ a, onRevisar, onDesfazer }: { a: AuditoriaAlteracao } & Omit<Props, 'alteracoes'>) {
  const [motivo, setMotivo] = useState<AuditoriaMotivo>(a.motivo_real ?? a.motivo_sugerido)
  const [nota, setNota] = useState(a.nota ?? '')
  const [salvando, setSalvando] = useState(false)

  const salvar = async () => {
    setSalvando(true)
    await onRevisar(a.id, motivo, nota)
    setSalvando(false)
  }
  const desfazer = async () => {
    setSalvando(true)
    await onDesfazer(a.id)
    setSalvando(false)
  }

  const mudouAtribuicao = (a.vendedor_antes && a.vendedor_antes !== a.vendedor) || (a.setor_grupo_antes && a.setor_grupo_antes !== a.setor_grupo)
  const produtos = [...a.produtos].sort((x, y) => Number(x.mudanca === 'igual') - Number(y.mudanca === 'igual'))

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
      <div className="lg:col-span-2 space-y-4">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Explicação</h4>
          <p className="text-sm text-slate-700 leading-relaxed">{a.explicacao}</p>
        </div>

        {a.evidencias.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Contexto</h4>
            <ul className="text-sm text-slate-600 list-disc pl-5 space-y-0.5">
              {a.evidencias.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Info label="Cliente" valor={a.pagante ?? '—'} />
          <Info label="Situação" valor={a.situacao_antes === a.situacao || !a.situacao_antes ? (a.situacao ?? 'Fora do banco') : `${a.situacao_antes} → ${a.situacao ?? 'fora do banco'}`} />
          <Info label="Valor (Fechadas)" valor={`${formatBRL(a.valor_antes)} → ${formatBRL(a.valor_depois)}`} />
          {mudouAtribuicao
            ? <Info label="Antes" valor={`${a.vendedor_antes ?? '—'} · ${a.setor_grupo_antes ?? '—'}`} />
            : <Info label="Data da venda" valor={a.data_venda_antes && a.data_venda && a.data_venda_antes !== a.data_venda ? `${formatDate(a.data_venda_antes)} → ${formatDate(a.data_venda)}` : formatDate((a.data_venda ?? a.data_venda_antes)!)} />}
        </div>

        {produtos.length > 0 && (
          <div>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Produto a produto</h4>
            <div className="overflow-x-auto border border-slate-200 rounded-lg bg-white">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-500">
                    <th className="text-left px-3 py-2 font-medium">Produto · Fornecedor</th>
                    <th className="text-left px-3 py-2 font-medium">Mudança</th>
                    <th className="text-right px-3 py-2 font-medium">Valor</th>
                    <th className="text-right px-3 py-2 font-medium">Receita</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {produtos.map((p, i) => {
                    const est = MUDANCA_ESTILO[p.mudanca]
                    return (
                      <tr key={i} className={p.mudanca === 'igual' ? 'text-slate-400' : 'text-slate-700'}>
                        <td className="px-3 py-1.5">
                          {p.produto ?? 'Produto sem nome'}{p.fornecedor ? <span className="text-slate-400"> · {p.fornecedor}</span> : null}
                          {p.mudanca === 'reclassificado' && (
                            <div className="text-slate-400">antes: {p.produto_antes ?? '—'}{p.fornecedor_antes ? ` · ${p.fornecedor_antes}` : ''}</div>
                          )}
                        </td>
                        <td className="px-3 py-1.5"><span className={`inline-flex px-1.5 py-0.5 rounded text-[11px] font-medium ${est.cls}`}>{est.label}</span></td>
                        <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                          {Math.abs(p.valor_depois - p.valor_antes) < AUDITORIA_TOLERANCIA ? formatBRL(p.valor_depois) : `${formatBRL(p.valor_antes)} → ${formatBRL(p.valor_depois)}`}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                          {Math.abs(p.receita_depois - p.receita_antes) < AUDITORIA_TOLERANCIA ? formatBRL(p.receita_depois) : `${formatBRL(p.receita_antes)} → ${formatBRL(p.receita_depois)}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">A receita por produto é rateada pelo valor; a receita que vale é a da venda.</p>
          </div>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3 h-fit">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">Revisão</h4>
          <p className="text-xs text-slate-500 mt-0.5">
            Confirme ou corrija o motivo. A revisão ensina o motor: alterações parecidas passam a vir com o motivo certo.
          </p>
        </div>
        <div className="text-xs bg-slate-50 rounded-lg p-2.5 text-slate-600">
          Sugerido: <span className="font-medium text-slate-800">{AUDITORIA_MOTIVO_LABELS[a.motivo_sugerido]}</span> ({a.confianca}%)
          {a.base_aprendizado && a.base_aprendizado.revisoes > 0 && (
            <div className="mt-1 text-violet-700">Baseado em {a.base_aprendizado.revisoes} revisão(ões): {a.base_aprendizado.descricao}</div>
          )}
        </div>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Motivo real</span>
          <select
            value={motivo}
            onChange={(e) => setMotivo(e.target.value as AuditoriaMotivo)}
            className="mt-1 w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none"
          >
            {AUDITORIA_MOTIVOS.map((m) => <option key={m} value={m}>{AUDITORIA_MOTIVO_LABELS[m]}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">Nota (opcional)</span>
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="Ex.: over da cia aérea lançado depois do fechamento"
            className="mt-1 w-full px-2.5 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            onClick={salvar}
            disabled={salvando}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {salvando ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {motivo === a.motivo_sugerido ? 'Confirmar' : 'Salvar correção'}
          </button>
          {a.revisao !== 'pendente' && (
            <button
              onClick={desfazer}
              disabled={salvando}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg disabled:opacity-50"
            >
              <Undo2 size={14} /> Desfazer
            </button>
          )}
        </div>
        {a.revisado_em && (
          <p className="text-xs text-slate-400">Revisado por {a.revisado_por ?? '—'} em {formatDateTime(a.revisado_em)}</p>
        )}
      </div>
    </div>
  )
}

function Info({ label, valor }: { label: string; valor: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-slate-700">{valor}</div>
    </div>
  )
}
