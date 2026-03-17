import type { SetorGrupo } from '@/lib/schemas'

/**
 * Mapeamento setor_bruto → setor_grupo.
 * Chaves em lowercase para comparação case-insensitive.
 * Fonte única de verdade — nunca duplicar em outro arquivo.
 */
const SETOR_MAP: Record<string, SetorGrupo> = {
  corporativo: 'CORP',
  lazer: 'TRIPS',
  'expedições': 'TRIPS',
  expedicoes: 'TRIPS',
  weddings: 'WEDDINGS',
  wedme: 'WEDDINGS',
  'produção': 'WEDDINGS',
  producao: 'WEDDINGS',
  'planejamento-wed': 'WEDDINGS',
  welcome: 'OUTROS',
}

/**
 * Converte o valor bruto do campo Setor do Excel para o grupo canônico.
 * Comparação case-insensitive com trim().
 *
 * @param setorBruto - Valor exato do campo Setor no Excel
 * @returns SetorGrupo mapeado
 */
export function mapSetor(setorBruto: string | null | undefined): SetorGrupo {
  if (!setorBruto || setorBruto.trim() === '') {
    return 'INDEFINIDO'
  }

  const normalizado = setorBruto.trim().toLowerCase()
  return SETOR_MAP[normalizado] ?? 'INDEFINIDO'
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
