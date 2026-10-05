'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ScanSearch, Play, Loader2, Download, Brain, History, CalendarRange, X } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useAuditoria } from '@/hooks/useAuditoria'
import { formatBRL, formatDate, formatDateTime, formatNumber, formatPercent } from '@/lib/format'
import { resumirAlteracoes } from '@/lib/auditoria'
import { exportarAuditoriaXlsx } from '@/lib/auditoria-export'
import { AUDITORIA_TIPO_LABELS, SETOR_LABELS, type AuditoriaTipo, type SetorGrupo } from '@/lib/schemas'
import { AlteracoesTabela, Delta } from '@/components/auditoria/AlteracoesTabela'
import { ImpactoGrupos } from '@/components/auditoria/ImpactoGrupos'
import { ConferenciaMensal } from '@/components/auditoria/ConferenciaMensal'
import { AprendizadoPainel } from '@/components/auditoria/AprendizadoPainel'
import { ExecucoesTabela } from '@/components/auditoria/ExecucoesTabela'

const PERIODOS = [
  { dias: 7, label: '7 dias' },
  { dias: 30, label: '30 dias' },
  { dias: 90, label: '90 dias' },
  { dias: 365, label: '12 meses' },
]

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const mesLabel = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]}/${mes.slice(0, 4)}`

type Revisao = 'todas' | 'pendente' | 'revisada'
type Direcao = 'todas' | 'queda' | 'alta'

export default function AuditoriaPage() {
  const { isAdmin, loading: authLoading } = useAuth()
  const { data, loading, error, dias, setDias, executando, executar, revisar, desfazer } = useAuditoria()

  const [setor, setSetor] = useState<string | null>(null)
  const [vendedor, setVendedor] = useState<string | null>(null)
  const [tipo, setTipo] = useState<string | null>(null)
  const [mes, setMes] = useState<string | null>(null)
  const [revisao, setRevisao] = useState<Revisao>('todas')
  const [direcao, setDirecao] = useState<Direcao>('todas')
  const [busca, setBusca] = useState('')
  const [aviso, setAviso] = useState<string | null>(null)

  const alteracoes = useMemo(() => data?.alteracoes ?? [], [data])

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    return alteracoes.filter((a) => {
      if (setor && (a.setor_grupo ?? 'INDEFINIDO') !== setor) return false
      if (vendedor && (a.vendedor ?? 'Sem vendedor') !== vendedor) return false
      if (tipo && a.tipo !== tipo) return false
      if (mes && (a.data_venda ?? a.data_venda_antes ?? '').slice(0, 7) !== mes && (a.data_venda_antes ?? '').slice(0, 7) !== mes) return false
      if (revisao === 'pendente' && a.revisao !== 'pendente') return false
      if (revisao === 'revisada' && a.revisao === 'pendente') return false
      if (direcao === 'queda' && a.delta_receita > -0.05) return false
      if (direcao === 'alta' && a.delta_receita < 0.05) return false
      if (termo && !String(a.venda_numero).includes(termo) && !(a.pagante ?? '').toLowerCase().includes(termo) &&
        !(a.vendedor ?? '').toLowerCase().includes(termo)) return false
      return true
    })
  }, [alteracoes, setor, vendedor, tipo, mes, revisao, direcao, busca])

  const resumo = useMemo(() => resumirAlteracoes(filtradas), [filtradas])
  const ultima = data?.execucoes.find((e) => e.status === 'ok' || e.status === 'baseline') ?? null
  const soBaseline = !!data && data.execucoes.length > 0 && data.execucoes.every((e) => e.status !== 'ok')
  const temFiltro = !!(setor || vendedor || tipo || mes || revisao !== 'todas' || direcao !== 'todas' || busca)

  const limpar = () => {
    setSetor(null); setVendedor(null); setTipo(null); setMes(null)
    setRevisao('todas'); setDirecao('todas'); setBusca('')
  }

  const rodar = async () => {
    setAviso(null)
    const r = await executar()
    if (!r) return
    if (r.emAndamento) setAviso('Já há uma conferência em andamento. Tente de novo em alguns minutos.')
    else if (r.baseline) setAviso(`Foto inicial registrada: ${formatNumber(r.vendas ?? 0)} vendas. As alterações aparecem a partir da próxima conferência.`)
    else setAviso(`Conferência concluída: ${r.alteracoes ?? 0} alteração(ões) nova(s).`)
  }

  if (authLoading) {
    return <div className="animate-pulse h-40 bg-white rounded-2xl border border-slate-200" />
  }
  if (!isAdmin) {
    return (
      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center">
        <h1 className="text-xl font-semibold text-slate-900">Acesso restrito</h1>
        <p className="text-sm text-slate-500 mt-2">Você não tem permissão para acessar esta página.</p>
        <Link href="/" className="inline-block mt-4 text-sm text-blue-600 hover:text-blue-700 underline">Voltar ao dashboard</Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <section className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex items-start gap-3">
          <ScanSearch className="h-6 w-6 text-slate-700 mt-1" />
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Auditoria de receitas</h1>
            <p className="text-sm text-slate-500 mt-1 max-w-2xl">
              Conferência diária do relatório de vendas por produto: vendas Fechadas dos últimos 6 meses
              {ultima?.janela_inicio ? ` (desde ${formatDate(ultima.janela_inicio)})` : ''}, incluindo produtos e vendas canceladas.
              Cada mudança de receita aparece com vendedor, setor, o produto a produto e o motivo provável.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-start md:items-end gap-2 shrink-0">
          <button
            onClick={rodar}
            disabled={executando}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {executando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            {executando ? 'Conferindo…' : 'Rodar conferência agora'}
          </button>
          <p className="text-xs text-slate-400">
            {ultima
              ? <>Última: {formatDateTime(ultima.finalizado_em ?? ultima.iniciado_em)} · {formatNumber(ultima.vendas_fechadas ?? 0)} vendas · {formatBRL(Number(ultima.receita_fechada ?? 0))}</>
              : 'Nenhuma conferência ainda'}
            <br />Automática todo dia às 06h15
          </p>
        </div>
      </section>

      {aviso && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800 flex items-start justify-between gap-3">
          <span>{aviso}</span>
          <button onClick={() => setAviso(null)} className="text-blue-600"><X size={16} /></button>
        </div>
      )}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">{error}</div>
      )}
      {soBaseline && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
          A primeira conferência registrou as receitas de todas as vendas da janela. Alteração é sempre em relação
          à conferência anterior, então as primeiras aparecem a partir da próxima rodada automática.
        </div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 bg-white rounded-2xl border border-slate-200 animate-pulse" />)}
        </div>
      ) : data && (
        <>
          {/* Período e KPIs */}
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <CalendarRange size={16} className="text-slate-400" />
              <span className="text-sm text-slate-500">Detectadas nos últimos</span>
              <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                {PERIODOS.map((p) => (
                  <button
                    key={p.dias}
                    onClick={() => setDias(p.dias)}
                    className={`px-3 py-1 text-sm rounded-md transition-colors ${dias === p.dias ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              {loading && <Loader2 size={14} className="animate-spin text-slate-400" />}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Kpi titulo="Vendas alteradas" valor={formatNumber(resumo.total)} detalhe={`${resumo.pendentes} pendente(s) de revisão`} />
              <Kpi
                titulo="Impacto líquido na receita"
                valor={<Delta valor={resumo.impacto} className="text-2xl" />}
                detalhe="soma das altas e quedas"
              />
              <Kpi
                titulo="Quedas · Altas"
                valor={<span className="text-2xl"><span className="text-red-600">{resumo.quedas}</span><span className="text-slate-300"> · </span><span className="text-green-600">{resumo.altas}</span></span>}
                detalhe={<><Delta valor={resumo.somaQuedas} className="text-xs" /> · <Delta valor={resumo.somaAltas} className="text-xs" /></>}
              />
              <Kpi
                titulo="Acerto do motivo sugerido"
                valor={data.precisao.precisao === null ? '—' : formatPercent(data.precisao.precisao)}
                detalhe={data.precisao.revisadas > 0 ? `${data.precisao.acertos} de ${data.precisao.revisadas} revisadas` : 'aparece após as primeiras revisões'}
              />
            </div>
          </section>

          {/* Onde mudou */}
          {alteracoes.length > 0 && (
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <ImpactoGrupos
                titulo="Por setor"
                grupos={resumo.porSetor}
                rotulo={(c) => SETOR_LABELS[c as SetorGrupo] ?? c}
                ativo={setor}
                onSelect={setSetor}
              />
              <ImpactoGrupos titulo="Por vendedor" grupos={resumo.porVendedor} ativo={vendedor} onSelect={setVendedor} />
              <ImpactoGrupos
                titulo="Por tipo de alteração"
                grupos={resumo.porTipo}
                rotulo={(c) => AUDITORIA_TIPO_LABELS[c as AuditoriaTipo] ?? c}
                ativo={tipo}
                onSelect={setTipo}
              />
            </section>
          )}

          {/* Relatório */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900 mr-2">Alterações</h2>
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Venda, cliente ou vendedor"
                className="px-3 py-1.5 border border-slate-300 rounded-lg text-sm w-52 focus:ring-2 focus:ring-blue-500 outline-none"
              />
              <select value={revisao} onChange={(e) => setRevisao(e.target.value as Revisao)} className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
                <option value="todas">Todas as revisões</option>
                <option value="pendente">Pendentes</option>
                <option value="revisada">Revisadas</option>
              </select>
              <select value={direcao} onChange={(e) => setDirecao(e.target.value as Direcao)} className="px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm bg-white">
                <option value="todas">Altas e quedas</option>
                <option value="queda">Só quedas</option>
                <option value="alta">Só altas</option>
              </select>
              {[
                setor && { k: 'setor', label: `Setor: ${setor}`, limpar: () => setSetor(null) },
                vendedor && { k: 'vendedor', label: `Vendedor: ${vendedor}`, limpar: () => setVendedor(null) },
                tipo && { k: 'tipo', label: AUDITORIA_TIPO_LABELS[tipo as AuditoriaTipo] ?? tipo, limpar: () => setTipo(null) },
                mes && { k: 'mes', label: `Vendas de ${mesLabel(mes)}`, limpar: () => setMes(null) },
              ].filter(Boolean).map((f) => {
                const filtro = f as { k: string; label: string; limpar: () => void }
                return (
                  <button key={filtro.k} onClick={filtro.limpar} className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-50 text-blue-700 text-xs hover:bg-blue-100">
                    {filtro.label} <X size={12} />
                  </button>
                )
              })}
              {temFiltro && <button onClick={limpar} className="text-xs text-slate-500 hover:text-slate-700 underline">limpar filtros</button>}
              <button
                onClick={() => exportarAuditoriaXlsx(filtradas, `auditoria-receitas-${hojeLocal()}.xlsx`)}
                disabled={filtradas.length === 0}
                className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-40"
              >
                <Download size={14} /> Exportar Excel
              </button>
            </div>
            <AlteracoesTabela alteracoes={filtradas} onRevisar={revisar} onDesfazer={desfazer} />
          </section>

          {/* Receita registrada por mês */}
          {data.execucoes.some((e) => e.totais) && (
            <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-4 border-b border-slate-200">
                <h2 className="text-base font-semibold text-slate-900">Receita registrada por mês</h2>
                <p className="text-xs text-slate-500 mt-0.5">Receita das vendas Fechadas, por mês da venda, em cada conferência. Clique no mês para ver as alterações dele.</p>
              </div>
              <ConferenciaMensal execucoes={data.execucoes} onMes={setMes} />
            </section>
          )}

          {/* Aprendizado */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Brain size={18} className="text-violet-500" />
              <h2 className="text-base font-semibold text-slate-900">Aprendizado</h2>
            </div>
            <AprendizadoPainel precisao={data.precisao} padroes={data.padroes} />
          </section>

          {/* Histórico */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-4 border-b border-slate-200 flex items-center gap-2">
              <History size={18} className="text-slate-500" />
              <h2 className="text-base font-semibold text-slate-900">Conferências</h2>
            </div>
            <ExecucoesTabela execucoes={data.execucoes} />
          </section>
        </>
      )}
    </div>
  )
}

function hojeLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function Kpi({ titulo, valor, detalhe }: { titulo: string; valor: React.ReactNode; detalhe: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5">
      <div className="text-xs font-medium text-slate-500">{titulo}</div>
      <div className="text-2xl font-bold text-slate-900 mt-1">{valor}</div>
      <div className="text-xs text-slate-400 mt-1">{detalhe}</div>
    </div>
  )
}
