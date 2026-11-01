import type { HealthUnit } from '@/features/staff/types'

// Contratos de /admin/diseases (ver server/src/routes/admin.routes.js).
export const ALERT_LEVELS = ['baixo', 'medio', 'alto'] as const
export type AlertLevelValue = (typeof ALERT_LEVELS)[number]

export interface AdminDisease {
  id: string
  name: string
  region?: string | null
  alert_level: AlertLevelValue | (string & {})
  description?: string | null
  /** 1 = ativo (aparece para os pacientes da região). */
  active: number | boolean
  created_at?: string
}

export interface DiseaseFormValues {
  name: string
  region: string
  alert_level: AlertLevelValue
  description: string
}

export const EMPTY_DISEASE: DiseaseFormValues = { name: '', region: '', alert_level: 'baixo', description: '' }

export const isActive = (d: Pick<AdminDisease, 'active'>) => Number(d.active) === 1

/** Minúsculas e sem acento, para o filtro não depender de como a pessoa digita. */
export const norm = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** Filtra por nome, descrição ou região (a API entrega tudo sem paginação nem filtro). */
export function filterDiseases(list: AdminDisease[], term: string): AdminDisease[] {
  const t = norm(term.trim())
  if (!t) return list
  return list.filter((d) => norm([d.name, d.description, d.region].join(' ')).includes(t))
}

/** Bairros distintos das unidades, em ordem alfabética: são as regiões que um alerta pode ter. */
export function regionsFrom(units: Pick<HealthUnit, 'neighborhood'>[]): string[] {
  return [...new Set(units.map((u) => u.neighborhood).filter((n): n is string => !!n))].sort((a, b) => a.localeCompare(b, 'pt-BR'))
}

export interface DiseaseErrors {
  name?: string
  region?: string
}

/** `requireRegion`: o cadastro exige a região (select); a edição aceita vazio (o servidor grava null). */
export function validateDisease(v: DiseaseFormValues, { requireRegion }: { requireRegion: boolean }): DiseaseErrors {
  const errors: DiseaseErrors = {}
  if (!v.name.trim()) errors.name = 'Informe o nome da doença.'
  if (requireRegion && !v.region.trim()) errors.region = 'Selecione a região/bairro.'
  return errors
}

/** Corpo de POST/PATCH com os textos aparados. */
export const diseaseBody = (v: DiseaseFormValues) => ({
  name: v.name.trim(),
  region: v.region.trim(),
  alert_level: v.alert_level,
  description: v.description.trim(),
})
