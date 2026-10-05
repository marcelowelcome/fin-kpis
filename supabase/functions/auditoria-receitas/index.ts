/**
 * Supabase Edge Function: auditoria-receitas
 *
 * Conferência diária das receitas das vendas Fechadas dos últimos 6 meses (aba
 * Admin → Auditoria do dashboard). Lê o "relatório de vendas por produto" que o sync
 * mantém em `vendas`, compara cada venda com a foto da conferência anterior
 * (`auditoria_vendas`) e grava em `auditoria_alteracoes` o que mudou, com vendedor,
 * setor, produto a produto, uma explicação e o motivo provável (motor.ts).
 *
 * Não fala com o Monde. O que o Monde diz hoje vem do índice do sync
 * (`monde_v3_vendas`): status, produtos ativos, receita e quando a venda foi relida.
 *
 * Escopo: vendas Fechadas. Venda Aberta também é fotografada (para reconhecer quando
 * fecha ou quando uma Fechada reabre), mas mudança só entre Abertas não é reportada.
 * Produto/venda cancelada some de `vendas`; a foto anterior guarda o que havia, então
 * o cancelamento aparece com o valor e a receita que saíram.
 *
 * Acionamento:
 *   pg_cron (anon key)          → no máximo uma conferência por dia (as demais saem na hora);
 *   botão "Rodar agora" (Next)  → { force: true } com a service role: confere de novo.
 * A primeira conferência só fotografa (status 'baseline'): alteração é sempre em
 * relação a uma conferência anterior.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  type Conhecimento,
  type Foto,
  type HistoricoVenda,
  type Indice,
  type LinhaBanco,
  type Paradeiro,
  type Revisao,
  detectar,
  montarConhecimento,
  montarFotos,
  parecidas,
  round2,
  sugerirMotivo,
  totaisPorMes,
} from './motor.ts'

// ─── Configuração ─────────────────────────────────────────────────────────────

/** Janela: do 1º dia do mês, N meses atrás, até hoje. */
const JANELA_MESES = 6
/** O sync apaga e regrava cada venda: espera e relê as que sumiram antes de chamá-las de canceladas. */
const RECHECAGEM_MS = 6000
const LOCK_VENCIDO_MS = 10 * 60_000
const PAGINA = 1000
const LOTE_IN = 150
const LOTE_GRAVACAO = 500

const COLS_VENDAS = 'id, venda_numero, data_venda, situacao, vendedor, setor_grupo, setor_bruto, pagante, produto, fornecedor, valor_total, receitas'

// deno-lint-ignore no-explicit-any
type Sb = any

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

/** Hoje em Brasília (a função roda em UTC). */
function hojeBRT(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

function inicioJanela(hoje: string): string {
  const y = Number(hoje.slice(0, 4))
  const m = Number(hoje.slice(5, 7)) - JANELA_MESES
  const ano = m <= 0 ? y - 1 : y
  const mes = m <= 0 ? m + 12 : m
  return `${ano}-${String(mes).padStart(2, '0')}-01`
}

/** O gateway (verify_jwt) já validou a assinatura; aqui só se confere o papel. */
function ehServiceRole(req: Request): boolean {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const parte = token.split('.')[1]
  if (!parte) return false
  try {
    const payload = JSON.parse(atob(parte.replace(/-/g, '+').replace(/_/g, '/')))
    return payload?.role === 'service_role'
  } catch {
    return false
  }
}

// ─── Leitura ──────────────────────────────────────────────────────────────────

/**
 * Consulta com novas tentativas. O banco tem picos de I/O (o sync regrava vendas a cada
 * 2 min): a mesma leitura que leva 7 ms com cache quente já estourou o statement_timeout
 * de 8 s do PostgREST. Erro que persiste nas 4 tentativas derruba a conferência.
 */
async function consultar<T>(
  fn: () => PromiseLike<{ data: T | null; error: { message: string } | null }>,
  oQue: string,
  repetirSe: RegExp = /./,
): Promise<T | null> {
  let ultimo = ''
  for (let tentativa = 0; tentativa < 4; tentativa++) {
    if (tentativa > 0) await sleep(3000 * tentativa)
    const { data, error } = await fn()
    if (!error) return data
    ultimo = error.message
    if (!repetirSe.test(ultimo)) break
  }
  throw new Error(`Erro em ${oQue}: ${ultimo}`)
}

/** Lê `vendas` paginando por id (o PostgREST corta em 1000). */
// deno-lint-ignore no-explicit-any
async function lerVendas(sb: Sb, filtro: (q: any) => any): Promise<LinhaBanco[]> {
  const out: LinhaBanco[] = []
  for (let offset = 0; ; offset += PAGINA) {
    const data = await consultar<LinhaBanco[]>(() => filtro(sb.from('vendas').select(COLS_VENDAS))
      .order('id', { ascending: true }).range(offset, offset + PAGINA - 1), 'vendas')
    out.push(...(data ?? []))
    if (!data || data.length < PAGINA) break
  }
  return out
}

async function lerVendasPorNumero(sb: Sb, numeros: number[]): Promise<LinhaBanco[]> {
  const out: LinhaBanco[] = []
  for (const lote of chunk(numeros, LOTE_IN)) out.push(...await lerVendas(sb, (q) => q.in('venda_numero', lote)))
  return out
}

interface EstadoVenda extends Foto {
  visto_desde: string
}

async function lerEstado(sb: Sb): Promise<Map<number, EstadoVenda>> {
  const m = new Map<number, EstadoVenda>()
  for (let offset = 0; ; offset += PAGINA) {
    // deno-lint-ignore no-explicit-any
    const data = await consultar<any[]>(() => sb.from('auditoria_vendas')
      .select('venda_numero, data_venda, situacao, vendedor, setor_grupo, setor_bruto, pagante, valor, receita, linhas, hash, visto_desde')
      .order('venda_numero', { ascending: true }).range(offset, offset + PAGINA - 1), 'a foto anterior')
    for (const r of data ?? []) {
      m.set(r.venda_numero, { ...r, valor: Number(r.valor), receita: Number(r.receita) })
    }
    if (!data || data.length < PAGINA) break
  }
  return m
}

async function lerIndice(sb: Sb, numeros: number[]): Promise<Map<number, Indice>> {
  const m = new Map<number, Indice>()
  for (const lote of chunk(numeros, LOTE_IN)) {
    // deno-lint-ignore no-explicit-any
    const data = await consultar<any[]>(() => sb.from('monde_v3_vendas')
      .select('sale_number, status, linhas_ativas, revenue, detail_at, updated_at').in('sale_number', lote), 'o índice do Monde')
    // Duas linhas com o mesmo número (venda recriada no Monde): vale a mais recente.
    const ordenado = [...(data ?? [])].sort((a, b) => String(a.updated_at ?? '').localeCompare(String(b.updated_at ?? '')))
    for (const r of ordenado) {
      m.set(r.sale_number, {
        status: r.status ?? null,
        linhas_ativas: r.linhas_ativas ?? null,
        revenue: r.revenue === null || r.revenue === undefined ? null : Number(r.revenue),
        detail_at: r.detail_at ?? null,
      })
    }
  }
  return m
}

async function lerCanceladasManuais(sb: Sb, numeros: number[]): Promise<Map<number, { motivo: string | null }>> {
  const m = new Map<number, { motivo: string | null }>()
  for (const lote of chunk(numeros, LOTE_IN)) {
    // deno-lint-ignore no-explicit-any
    const data = await consultar<any[]>(() => sb.from('vendas_canceladas').select('venda_numero, motivo').in('venda_numero', lote), 'cancelamentos manuais')
    for (const r of data ?? []) m.set(r.venda_numero, { motivo: r.motivo ?? null })
  }
  return m
}

async function lerHistorico(sb: Sb, numeros: number[]): Promise<Map<number, HistoricoVenda[]>> {
  const m = new Map<number, HistoricoVenda[]>()
  for (const lote of chunk(numeros, LOTE_IN)) {
    // deno-lint-ignore no-explicit-any
    const data = await consultar<any[]>(() => sb.from('auditoria_alteracoes')
      .select('venda_numero, tipo, detectado_em, receita_antes, receita_depois, id')
      .in('venda_numero', lote).order('id', { ascending: false }).limit(PAGINA), 'o histórico')
    for (const r of data ?? []) {
      const h = m.get(r.venda_numero) ?? []
      h.push({ tipo: r.tipo, detectado_em: r.detectado_em, receita_antes: Number(r.receita_antes), receita_depois: Number(r.receita_depois) })
      m.set(r.venda_numero, h)
    }
  }
  return m
}

/** Revisões humanas, da mais recente para a mais antiga: o aprendizado do motor. */
async function lerConhecimento(sb: Sb): Promise<{ conhecimento: Conhecimento; revisoes: number }> {
  const revs: Revisao[] = []
  for (let offset = 0; ; offset += PAGINA) {
    const data = await consultar<Revisao[]>(() => sb.from('auditoria_alteracoes')
      .select('id, venda_numero, chaves, motivo_real, nota')
      .neq('revisao', 'pendente').not('motivo_real', 'is', null)
      .order('id', { ascending: false }).range(offset, offset + PAGINA - 1), 'as revisões')
    revs.push(...(data ?? []))
    if (!data || data.length < PAGINA) break
  }
  return { conhecimento: montarConhecimento(revs), revisoes: revs.length }
}

// ─── Gravação ─────────────────────────────────────────────────────────────────

function linhaEstado(f: Foto, vistoDesde: string, agora: string, alterado: boolean) {
  return {
    venda_numero: f.venda_numero, data_venda: f.data_venda, situacao: f.situacao,
    vendedor: f.vendedor, setor_grupo: f.setor_grupo, setor_bruto: f.setor_bruto, pagante: f.pagante,
    valor: f.valor, receita: f.receita, linhas: f.linhas, hash: f.hash,
    visto_desde: vistoDesde, conferido_em: agora, alterado_em: alterado ? agora : null,
  }
}

function resumoFechadas(atual: Map<number, Foto>) {
  let vendas = 0, linhas = 0, receita = 0, valor = 0
  for (const f of atual.values()) {
    if (f.situacao !== 'Fechada') continue
    vendas++
    linhas += f.linhas.length
    receita += f.receita
    valor += f.valor
  }
  return { vendas_fechadas: vendas, linhas_fechadas: linhas, receita_fechada: round2(receita), valor_fechado: round2(valor), totais: totaisPorMes(atual.values()) }
}

// ─── Conferência ──────────────────────────────────────────────────────────────

async function conferir(sb: Sb, execId: number, hoje: string, inicio: string) {
  const agora = new Date().toISOString()
  const atual = montarFotos(await lerVendas(sb, (q) => q.gte('data_venda', inicio)))
  const estado = await lerEstado(sb)

  // Primeira conferência: só fotografa — relendo venda a venda (ver a releitura abaixo),
  // porque uma foto inicial torta viraria alteração falsa amanhã.
  if (estado.size === 0) {
    const relidas = montarFotos(await lerVendasPorNumero(sb, [...atual.keys()]))
    atual.clear()
    for (const [n, f] of relidas) if (f.data_venda >= inicio) atual.set(n, f)
    const linhas = [...atual.values()].map((f) => linhaEstado(f, hoje, agora, false))
    for (const lote of chunk(linhas, LOTE_GRAVACAO)) {
      const { error } = await sb.from('auditoria_vendas').upsert(lote, { onConflict: 'venda_numero' })
      if (error) throw new Error(`Erro ao gravar a foto inicial: ${error.message}`)
    }
    const resumo = { status: 'baseline', ...resumoFechadas(atual), alteracoes: 0, impacto_receita: 0, vendas_novas: 0, receita_novas: 0 }
    const { error } = await sb.rpc('auditoria_gravar', { p_execucao: execId, p_alteracoes: [], p_estado: [], p_apagar: [], p_resumo: resumo })
    if (error) throw new Error(`Erro ao fechar a conferência: ${error.message}`)
    return { baseline: true, vendas: atual.size, ...resumo, totais: undefined }
  }

  // Releitura das candidatas (novas, mudadas e sumidas), venda a venda. O sync apaga e
  // regrava cada venda que relê; a leitura paginada acima pode pegar uma venda no meio
  // disso — sem linha nenhuma, ou com as linhas velhas numa página e as novas noutra.
  // A releitura é uma consulta por lote, então vê cada venda inteira.
  let pendentes = [
    ...[...atual.values()].filter((f) => estado.get(f.venda_numero)?.hash !== f.hash).map((f) => f.venda_numero),
    ...[...estado.values()].filter((e) => e.data_venda >= inicio && !atual.has(e.venda_numero)).map((e) => e.venda_numero),
  ]
  const candidatas = pendentes.length
  const foraDaJanela = new Map<number, Foto>()
  for (let tentativa = 0; tentativa < 2 && pendentes.length > 0; tentativa++) {
    await sleep(RECHECAGEM_MS / (tentativa + 1))
    const relidas = montarFotos(await lerVendasPorNumero(sb, pendentes))
    const faltando: number[] = []
    for (const n of pendentes) {
      const f = relidas.get(n)
      if (!f) { faltando.push(n); continue }
      if (f.data_venda >= inicio) atual.set(n, f)
      else { atual.delete(n); foraDaJanela.set(n, f) }
    }
    for (const n of faltando) atual.delete(n)
    pendentes = faltando
  }

  const sumidas = [...estado.values()]
    .filter((e) => e.data_venda >= inicio && !atual.has(e.venda_numero))
    .map((e) => e.venda_numero)
  const paradeiros = new Map<number, Paradeiro>()
  if (sumidas.length > 0) {
    const ausentes = sumidas.filter((n) => !foraDaJanela.has(n))
    const [indiceSumidas, manuais] = await Promise.all([lerIndice(sb, sumidas), lerCanceladasManuais(sb, ausentes)])
    for (const n of sumidas) {
      paradeiros.set(n, { foto: foraDaJanela.get(n) ?? null, indice: indiceSumidas.get(n) ?? null, manual: manuais.get(n) ?? null })
    }
  }

  const novas: Foto[] = []
  const mudadas: Foto[] = []
  for (const f of atual.values()) {
    const e = estado.get(f.venda_numero)
    if (!e) novas.push(f)
    else if (e.hash !== f.hash) mudadas.push(f)
  }

  const [indice, historico, { conhecimento, revisoes }] = await Promise.all([
    lerIndice(sb, [...mudadas, ...novas].map((f) => f.venda_numero)),
    lerHistorico(sb, [...mudadas, ...novas].map((f) => f.venda_numero).concat(sumidas)),
    lerConhecimento(sb),
  ])

  // Cancelada ↔ nova parecida na mesma conferência (relançamento).
  const saidas = [...paradeiros.keys()].map((n) => estado.get(n)!).filter((e) => e.situacao === 'Fechada')
  const parecidaDe = new Map<number, number>()
  for (const s of saidas) {
    const nova = novas.find((f) => parecidas(s, f))
    if (nova) {
      parecidaDe.set(s.venda_numero, nova.venda_numero)
      parecidaDe.set(nova.venda_numero, s.venda_numero)
    }
  }

  const alteracoes: Record<string, unknown>[] = []
  const alteradas = new Set<number>()
  const registrar = (antes: Foto | null, depois: Foto | null, numero: number) => {
    const det = detectar(antes, depois, {
      hoje, inicioJanela: inicio,
      indice: indice.get(numero) ?? null,
      paradeiro: paradeiros.get(numero),
      historico: historico.get(numero) ?? [],
      parecida: parecidaDe.get(numero) ?? null,
    })
    if (!det) return
    const sug = sugerirMotivo(det, conhecimento)
    alteradas.add(numero)
    alteracoes.push({
      detectado_em: hoje,
      venda_numero: det.venda_numero,
      data_venda: det.data_venda, data_venda_antes: det.data_venda_antes,
      situacao: det.situacao, situacao_antes: det.situacao_antes,
      vendedor: det.vendedor, vendedor_antes: det.vendedor_antes,
      setor_grupo: det.setor_grupo, setor_grupo_antes: det.setor_grupo_antes,
      setor_bruto: det.setor_bruto, pagante: det.pagante,
      receita_antes: det.receita_antes, receita_depois: det.receita_depois, delta_receita: det.delta_receita,
      valor_antes: det.valor_antes, valor_depois: det.valor_depois, delta_valor: det.delta_valor,
      tipo: det.tipo,
      produtos: det.produtos,
      explicacao: [...det.fatos, sug.frase].join(' '),
      evidencias: det.evidencias,
      motivo_sugerido: sug.motivo,
      confianca: sug.confianca,
      base_aprendizado: { ...sug.base, aprendido: sug.aprendido },
      chaves: det.chaves,
    })
  }

  for (const f of mudadas) registrar(estado.get(f.venda_numero)!, f, f.venda_numero)
  for (const f of novas) registrar(null, f, f.venda_numero)
  for (const n of paradeiros.keys()) registrar(estado.get(n)!, null, n)

  // Foto nova: vendas novas e mudadas. Saem da foto as que sumiram e as que a janela deixou para trás.
  const gravarEstado = [
    ...novas.map((f) => linhaEstado(f, hoje, agora, alteradas.has(f.venda_numero))),
    ...mudadas.map((f) => linhaEstado(f, estado.get(f.venda_numero)!.visto_desde, agora, alteradas.has(f.venda_numero))),
  ]
  const apagar = [...estado.values()]
    .filter((e) => !atual.has(e.venda_numero))
    .map((e) => e.venda_numero)

  const novasFechadas = novas.filter((f) => f.situacao === 'Fechada' && !alteradas.has(f.venda_numero))
  const resumo = {
    status: 'ok',
    ...resumoFechadas(atual),
    alteracoes: alteracoes.length,
    impacto_receita: round2(alteracoes.reduce((s, a) => s + Number(a.delta_receita), 0)),
    vendas_novas: novasFechadas.length,
    receita_novas: round2(novasFechadas.reduce((s, f) => s + f.receita, 0)),
  }

  // Uma transação só (ver auditoria_gravar). Repete só erro que garante rollback (timeout,
  // deadlock); erro de rede pode ter gravado, e repetir duplicaria as alterações.
  await consultar(() => sb.rpc('auditoria_gravar', {
    p_execucao: execId, p_alteracoes: alteracoes, p_estado: gravarEstado, p_apagar: apagar, p_resumo: resumo,
  }), 'a gravação da conferência', /statement timeout|canceling statement|deadlock/i)

  return {
    baseline: false,
    vendas: atual.size,
    candidatas, novas: novas.length, mudadas: mudadas.length, sumidas: sumidas.length,
    revisoesUsadas: revisoes,
    ...resumo, totais: undefined,
  }
}

// ─── Entry point ──────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const sb = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')
  const body = await req.json().catch(() => ({}))
  const forcar = body?.force === true
  if (forcar && !ehServiceRole(req)) return json({ ok: false, error: 'rodar fora de hora exige a service role' }, 403)

  const hoje = hojeBRT()
  const inicio = inicioJanela(hoje)

  const jaFeitaHoje = async () => {
    if (forcar) return false
    const { data } = await sb.from('auditoria_execucoes')
      .select('id').eq('data_ref', hoje).in('status', ['ok', 'baseline']).limit(1)
    return !!data && data.length > 0
  }
  // As tentativas seguintes do cron no mesmo dia saem aqui, sem tocar na trava.
  if (await jaFeitaHoje()) return json({ ok: true, pulada: true, nota: 'a conferência de hoje já foi feita' })

  // Trava atômica: só segue quem acha a linha livre (ou com trava vencida).
  const inicioEm = new Date().toISOString()
  const vencida = new Date(Date.now() - LOCK_VENCIDO_MS).toISOString()
  const { data: trava } = await sb.from('sync_state')
    .update({ running: true, updated_at: inicioEm })
    .eq('key', 'auditoria-lock')
    .or(`running.eq.false,updated_at.lt.${vencida}`)
    .select('key')
  if (!trava || trava.length === 0) return json({ ok: true, emAndamento: true, nota: 'outra conferência em andamento' })

  let execId: number | null = null
  try {
    // De novo, já com a trava: outra chamada pode ter terminado a de hoje enquanto esta esperava.
    if (await jaFeitaHoje()) return json({ ok: true, pulada: true, nota: 'a conferência de hoje já foi feita' })

    const { data: ex, error } = await sb.from('auditoria_execucoes')
      .insert({ data_ref: hoje, origem: forcar ? 'manual' : 'cron', status: 'rodando', janela_inicio: inicio })
      .select('id').single()
    if (error || !ex) throw new Error(`Erro ao registrar a conferência: ${error?.message}`)
    execId = ex.id as number

    const r = await conferir(sb, execId, hoje, inicio)
    await sb.from('sync_state').update({ last_done_at: new Date().toISOString(), note: `conferência ${execId}: ${r.alteracoes} alteração(ões)` }).eq('key', 'auditoria-lock')
    return json({ ok: true, execucao: execId, dataRef: hoje, janelaInicio: inicio, ...r })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[auditoria-receitas] ERRO:', msg)
    if (execId) {
      await sb.from('auditoria_execucoes').update({ status: 'erro', erro: msg.slice(0, 1000), finalizado_em: new Date().toISOString() }).eq('id', execId)
    }
    return json({ ok: false, execucao: execId, error: msg }, 500)
  } finally {
    await sb.from('sync_state').update({ running: false, updated_at: new Date().toISOString() }).eq('key', 'auditoria-lock')
  }
})
