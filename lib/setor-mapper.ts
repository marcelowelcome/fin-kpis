import type { SetorGrupo } from '@/lib/schemas'

/**
 * Mapeamento setor_bruto → setor_grupo.
 * Chaves em lowercase para comparação case-insensitive.
 * Fonte única de verdade — nunca duplicar em outro arquivo.
 */
const SETOR_MAP_EXATO: Record<string, SetorGrupo> = {
  corporativo: 'CORP',
  corp: 'CORP',
  lazer: 'TRIPS',
  trips: 'TRIPS',
  'expedições': 'TRIPS',
  expedicoes: 'TRIPS',
  'lazer e expedições': 'TRIPS',
  'lazer e expedicoes': 'TRIPS',
  weddings: 'WEDDINGS',
  wedme: 'WEDDINGS',
  'wed me': 'WEDDINGS',
  'produção': 'WEDDINGS',
  producao: 'WEDDINGS',
  'planejamento-wed': 'WEDDINGS',
  'planejamento wed': 'WEDDINGS',
  welcome: 'OUTROS',
  outros: 'OUTROS',
}

/**
 * Palavras-chave para matching parcial (fallback).
 * Ordem importa: primeiro match ganha.
 */
const SETOR_KEYWORDS: [string, SetorGrupo][] = [
  ['corporativ', 'CORP'],
  ['expedi', 'TRIPS'],
  ['lazer', 'TRIPS'],
  ['trips', 'TRIPS'],
  ['wedding', 'WEDDINGS'],
  ['wedme', 'WEDDINGS'],
  ['wed me', 'WEDDINGS'],
  ['producao', 'WEDDINGS'],
  ['produção', 'WEDDINGS'],
  ['planejamento', 'WEDDINGS'],
  ['welcome', 'OUTROS'],
]

/**
 * Converte o valor bruto do campo Setor do Excel para o grupo canônico.
 * Tenta match exato primeiro, depois parcial por keywords.
 *
 * @param setorBruto - Valor exato do campo Setor no Excel
 * @returns SetorGrupo mapeado
 */
export function mapSetor(setorBruto: string | null | undefined): SetorGrupo {
  if (!setorBruto || setorBruto.trim() === '') {
    return 'INDEFINIDO'
  }

  const normalizado = setorBruto.trim().toLowerCase()

  // 1. Match exato
  const exato = SETOR_MAP_EXATO[normalizado]
  if (exato) return exato

  // 2. Match parcial por keyword
  for (const [keyword, grupo] of SETOR_KEYWORDS) {
    if (normalizado.includes(keyword)) return grupo
  }

  return 'INDEFINIDO'
}

/**
 * Verifica se o setor faz parte do consolidado WT (participa de metas).
 */
export function isSetorWT(setor: SetorGrupo): boolean {
  return setor === 'CORP' || setor === 'TRIPS' || setor === 'WEDDINGS'
}

/**
 * Subcategorias de WEDDINGS para drill-down.
 * Mapeia setor_bruto → label de subcategoria.
 */
export function getWeddingsSubcategoria(setorBruto: string | null): string {
  if (!setorBruto) return 'Outros'
  const normalizado = setorBruto.trim().toLowerCase()
  switch (normalizado) {
    case 'weddings':
      return 'Weddings'
    case 'wedme':
      return 'WedMe'
    case 'produção':
    case 'producao':
      return 'Produção'
    case 'planejamento-wed':
      return 'Planejamento-WED'
    default:
      return 'Outros'
  }
}
