/**
 * Auditoria de receitas — resumos da aba Admin → Auditoria.
 *
 * A detecção e o motivo sugerido são calculados na Edge Function `auditoria-receitas`
 * (supabase/functions/auditoria-receitas/motor.ts). Aqui ficam só os agregados da
 * tela: impacto por setor/vendedor/tipo, precisão das sugestões e o que o motor já
 * aprendeu com as revisões.
 */

import type {
  AuditoriaAlteracao,
  AuditoriaGrupo,
  AuditoriaMotivo,
  AuditoriaPadrao,
  AuditoriaPrecisao,
  AuditoriaResumo,
  AuditoriaTipo,
} from '@/lib/schemas'
import { AUDITORIA_TIPO_LABELS } from '@/lib/schemas'

/** Abaixo disso a diferença é arredondamento do rateio (mesmo valor do motor). */
export const AUDITORIA_TOLERANCIA = 0.05

/** Alteração já revisada, só com o que a precisão e o aprendizado usam. */
export type AuditoriaRevisada = Pick<
  AuditoriaAlteracao,
  'id' | 'venda_numero' | 'detectado_em' | 'motivo_sugerido' | 'motivo_real' | 'chaves' | 'nota'
>

function agrupar(alts: AuditoriaAlteracao[], chave: (a: AuditoriaAlteracao) => string): AuditoriaGrupo[] {
  const m = new Map<string, AuditoriaGrupo>()
  for (const a of alts) {
    const k = chave(a)
    const g = m.get(k) ?? { chave: k, n: 0, impacto: 0, quedas: 0, altas: 0 }
    g.n++
    g.impacto += a.delta_receita
    if (a.delta_receita <= -AUDITORIA_TOLERANCIA) g.quedas++
    if (a.delta_receita >= AUDITORIA_TOLERANCIA) g.altas++
    m.set(k, g)
  }
  return Array.from(m.values())
    .map((g) => ({ ...g, impacto: round2(g.impacto) }))
    .sort((a, b) => Math.abs(b.impacto) - Math.abs(a.impacto) || b.n - a.n)
}

export function resumirAlteracoes(alts: AuditoriaAlteracao[]): AuditoriaResumo {
  let somaQuedas = 0
  let somaAltas = 0
  let quedas = 0
  let altas = 0
  for (const a of alts) {
    if (a.delta_receita <= -AUDITORIA_TOLERANCIA) { quedas++; somaQuedas += a.delta_receita }
    if (a.delta_receita >= AUDITORIA_TOLERANCIA) { altas++; somaAltas += a.delta_receita }
  }
  return {
    total: alts.length,
    impacto: round2(somaQuedas + somaAltas),
    somaQuedas: round2(somaQuedas),
    somaAltas: round2(somaAltas),
    quedas,
    altas,
    pendentes: alts.filter((a) => a.revisao === 'pendente').length,
    porSetor: agrupar(alts, (a) => a.setor_grupo ?? 'INDEFINIDO'),
    porVendedor: agrupar(alts, (a) => a.vendedor ?? 'Sem vendedor'),
    porTipo: agrupar(alts, (a) => a.tipo),
  }
}

/** Segunda-feira da semana da data (YYYY-MM-DD), sem passar por UTC. */
export function inicioSemana(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const dow = (dt.getDay() + 6) % 7
  dt.setDate(dt.getDate() - dow)
  return toISO(dt)
}

/** Data ISO N dias antes (aritmética de calendário local). */
export function diasAntes(iso: string, dias: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return toISO(new Date(y, m - 1, d - dias))
}

/** Precisão do motivo sugerido: acerto = a revisão confirmou o motivo que o motor sugeriu. */
export function calcPrecisao(revisadas: AuditoriaRevisada[]): AuditoriaPrecisao {
  const validas = revisadas.filter((r) => r.motivo_real)
  const acertou = (r: AuditoriaRevisada) => r.motivo_real === r.motivo_sugerido
  const acertos = validas.filter(acertou).length

  const semanas = new Map<string, { revisadas: number; acertos: number }>()
  const motivos = new Map<AuditoriaMotivo, { sugeridas: number; acertos: number }>()
  for (const r of validas) {
    const s = inicioSemana(r.detectado_em)
    const sw = semanas.get(s) ?? { revisadas: 0, acertos: 0 }
    sw.revisadas++
    if (acertou(r)) sw.acertos++
    semanas.set(s, sw)

    const mv = motivos.get(r.motivo_sugerido) ?? { sugeridas: 0, acertos: 0 }
    mv.sugeridas++
    if (acertou(r)) mv.acertos++
    motivos.set(r.motivo_sugerido, mv)
  }

  return {
    revisadas: validas.length,
    acertos,
    precisao: validas.length > 0 ? acertos / validas.length : null,
    porSemana: Array.from(semanas.entries())
      .map(([semana, v]) => ({ semana, ...v, precisao: v.acertos / v.revisadas }))
      .sort((a, b) => a.semana.localeCompare(b.semana)),
    porMotivo: Array.from(motivos.entries())
      .map(([motivo, v]) => ({ motivo, ...v, precisao: v.acertos / v.sugeridas }))
      .sort((a, b) => b.sugeridas - a.sugeridas),
  }
}

/** Mesma leitura de chave do motor: "T:AJUSTE_RECEITA|D:queda|S:TRIPS" → "receita ajustada, receita caiu, setor TRIPS". */
export function descreverChave(chave: string): string {
  return chave.split('|').map((parte) => {
    const [k, ...resto] = parte.split(':')
    const v = resto.join(':')
    switch (k) {
      case 'T': return (AUDITORIA_TIPO_LABELS[v as AuditoriaTipo] ?? v).toLowerCase()
      case 'D': return v === 'alta' ? 'receita subiu' : v === 'queda' ? 'receita caiu' : 'receita estável'
      case 'S': return `setor ${v}`
      case 'P': return `produto ${v}`
      case 'F': return `fornecedor ${v}`
      case 'V': return `vendedor ${v}`
      default: return parte
    }
  }).join(', ')
}

/**
 * Contextos em que as revisões já ensinaram um motivo (≥ 2 revisões, como o motor exige
 * para preferir a chave). Mostra os mais revisados; entre chaves com o mesmo número de
 * revisões e o mesmo motivo, fica só a mais específica.
 */
export function padroesAprendidos(revisadas: AuditoriaRevisada[], limite = 12): AuditoriaPadrao[] {
  const m = new Map<string, { total: number; motivos: Map<AuditoriaMotivo, number>; notas: Map<AuditoriaMotivo, string> }>()
  for (const r of revisadas) {
    if (!r.motivo_real) continue
    for (const chave of r.chaves ?? []) {
      if (!chave.includes('|')) continue // "T:..." sozinho é geral demais para mostrar
      const v = m.get(chave) ?? { total: 0, motivos: new Map(), notas: new Map() }
      v.total++
      v.motivos.set(r.motivo_real, (v.motivos.get(r.motivo_real) ?? 0) + 1)
      if (r.nota && !v.notas.has(r.motivo_real)) v.notas.set(r.motivo_real, `venda ${r.venda_numero} — "${r.nota}"`)
      m.set(chave, v)
    }
  }

  const padroes: AuditoriaPadrao[] = []
  m.forEach((v, chave) => {
    if (v.total < 2) return
    const [motivo, n] = Array.from(v.motivos.entries()).sort((a, b) => b[1] - a[1])[0]
    padroes.push({ chave, descricao: descreverChave(chave), revisoes: v.total, motivo, share: n / v.total, nota: v.notas.get(motivo) ?? null })
  })

  const especificidade = (c: string) => c.split('|').length
  padroes.sort((a, b) => b.revisoes - a.revisoes || especificidade(b.chave) - especificidade(a.chave))
  const vistos = new Set<string>()
  return padroes.filter((p) => {
    const k = `${p.revisoes}|${p.motivo}|${p.chave.split('|')[0]}`
    if (vistos.has(k)) return false
    vistos.add(k)
    return true
  }).slice(0, limite)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
