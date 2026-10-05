/**
 * GET  /api/admin/auditoria?dias=30 — alterações detectadas no período, histórico de
 *      conferências, precisão do motivo sugerido e padrões aprendidos.
 * POST /api/admin/auditoria
 *      { action: 'revisar', id, motivo, nota? } — confirma ou corrige o motivo (vira aprendizado)
 *      { action: 'desfazer', id }               — volta a alteração para pendente
 *      { action: 'executar' }                   — roda a conferência agora (Edge Function)
 *
 * A conferência roda na Edge Function `auditoria-receitas` (pg_cron diário). Esta rota
 * só lê o resultado e grava as revisões. Restrita a admin.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseServer } from '@/lib/supabase'
import { getAuthUser, jsonError, todayISO } from '@/lib/api-utils'
import { calcPrecisao, diasAntes, padroesAprendidos, type AuditoriaRevisada } from '@/lib/auditoria'
import {
  AuditoriaAcaoSchema,
  type AuditoriaAlteracao,
  type AuditoriaExecucao,
  type AuditoriaResponse,
} from '@/lib/schemas'

export const dynamic = 'force-dynamic'
export const revalidate = 0
// "Rodar agora" espera a Edge Function (a conferência leva ~15–40 s).
export const maxDuration = 120

const PAGINA = 1000

const NUMERICOS = [
  'receita_antes', 'receita_depois', 'delta_receita', 'valor_antes', 'valor_depois', 'delta_valor',
] as const

async function paginar<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let offset = 0; ; offset += PAGINA) {
    const { data, error } = await consulta(offset, offset + PAGINA - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < PAGINA) break
  }
  return out
}

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthUser(request)
    if (!auth) return jsonError('UNAUTHORIZED', 'Usuário não autenticado.', 401)
    if (auth.role !== 'admin') return jsonError('FORBIDDEN', 'Acesso restrito a administradores.', 403)

    const diasParam = Number(request.nextUrl.searchParams.get('dias') ?? 30)
    const dias = Number.isFinite(diasParam) ? Math.min(Math.max(Math.round(diasParam), 1), 400) : 30
    const desde = diasAntes(todayISO(), dias)
    const supabase = getSupabaseServer()

    const [alteracoes, revisadas, execucoes] = await Promise.all([
      paginar<AuditoriaAlteracao>((de, ate) => supabase.from('auditoria_alteracoes')
        .select('*').gte('detectado_em', desde).order('id', { ascending: true }).range(de, ate)),
      paginar<AuditoriaRevisada>((de, ate) => supabase.from('auditoria_alteracoes')
        .select('id, venda_numero, detectado_em, motivo_sugerido, motivo_real, chaves, nota')
        .neq('revisao', 'pendente').order('id', { ascending: true }).range(de, ate)),
      supabase.from('auditoria_execucoes').select('*').order('id', { ascending: false }).limit(60)
        .then(({ data, error }) => {
          if (error) throw new Error(error.message)
          return (data ?? []) as AuditoriaExecucao[]
        }),
    ])

    const body: AuditoriaResponse = {
      dias,
      alteracoes: alteracoes
        .map((a) => {
          const n = { ...a }
          for (const k of NUMERICOS) n[k] = Number(a[k] ?? 0)
          return n
        })
        .sort((a, b) => b.detectado_em.localeCompare(a.detectado_em) || Math.abs(b.delta_receita) - Math.abs(a.delta_receita)),
      execucoes,
      precisao: calcPrecisao(revisadas),
      padroes: padroesAprendidos(revisadas),
    }
    return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (err) {
    console.error('Auditoria GET error:', err)
    return jsonError('INTERNAL_ERROR', String(err instanceof Error ? err.message : err), 500)
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthUser(request)
    if (!auth) return jsonError('UNAUTHORIZED', 'Usuário não autenticado.', 401)
    if (auth.role !== 'admin') return jsonError('FORBIDDEN', 'Acesso restrito a administradores.', 403)

    const parsed = AuditoriaAcaoSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return jsonError('VALIDATION_ERROR', 'Ação inválida.', 400)
    const acao = parsed.data
    const supabase = getSupabaseServer()

    if (acao.action === 'executar') {
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/auditoria-receitas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}` },
        body: JSON.stringify({ force: true }),
        cache: 'no-store',
      })
      const result = await res.json().catch(() => null)
      if (!res.ok || result?.ok === false) {
        return jsonError('AUDITORIA_ERROR', String(result?.error ?? `Edge Function respondeu ${res.status}`), 502)
      }
      return NextResponse.json({ result })
    }

    if (acao.action === 'desfazer') {
      const { error } = await supabase.from('auditoria_alteracoes')
        .update({ revisao: 'pendente', motivo_real: null, nota: null, revisado_por: null, revisado_em: null })
        .eq('id', acao.id)
      if (error) return jsonError('DB_ERROR', error.message, 500)
      return NextResponse.json({ success: true })
    }

    const [{ data: alt, error: altErr }, { data: perfil }] = await Promise.all([
      supabase.from('auditoria_alteracoes').select('motivo_sugerido').eq('id', acao.id).single(),
      supabase.from('profiles').select('nome, email').eq('id', auth.userId).single(),
    ])
    if (altErr || !alt) return jsonError('NOT_FOUND', 'Alteração não encontrada.', 404)

    const { error } = await supabase.from('auditoria_alteracoes').update({
      revisao: acao.motivo === alt.motivo_sugerido ? 'confirmada' : 'corrigida',
      motivo_real: acao.motivo,
      nota: acao.nota || null,
      revisado_por: perfil?.nome || perfil?.email || auth.userId,
      revisado_em: new Date().toISOString(),
    }).eq('id', acao.id)
    if (error) return jsonError('DB_ERROR', error.message, 500)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Auditoria POST error:', err)
    return jsonError('INTERNAL_ERROR', String(err instanceof Error ? err.message : err), 500)
  }
}
