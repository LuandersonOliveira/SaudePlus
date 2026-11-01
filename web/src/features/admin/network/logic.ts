// Contratos de /health-units/manage e /health-units/:id/offers (ver server/src/routes/units.routes.js).
export const UNIT_TYPES = ['ubs', 'hospital', 'clinica', 'caps', 'outro'] as const
export type UnitType = (typeof UNIT_TYPES)[number]

export const UNIT_TYPE_LABEL: Record<string, string> = {
  ubs: 'UBS / PSF',
  hospital: 'Hospital',
  clinica: 'Clínica',
  caps: 'CAPS',
  outro: 'Outro',
}

export interface AdminUnit {
  id: string
  name: string
  type: UnitType | (string & {})
  neighborhood?: string | null
  /** 1 = ativa (aparece nos formulários de agendamento). */
  active: number | boolean
  created_at?: string
}

export const OFFER_KINDS = ['consulta', 'exame'] as const
export type OfferKind = (typeof OFFER_KINDS)[number]

export const OFFER_KIND_LABEL: Record<OfferKind, string> = { consulta: 'Consulta', exame: 'Exame' }

export interface UnitOffer {
  id: string
  kind: OfferKind | (string & {})
  name: string
  active: number | boolean
}

export interface UnitFormValues {
  name: string
  type: UnitType
  neighborhood: string
}

export const EMPTY_UNIT: UnitFormValues = { name: '', type: 'ubs', neighborhood: '' }

export const isActive = (u: { active: number | boolean }) => Number(u.active) === 1

const norm = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** Filtra por nome, tipo (rótulo) ou bairro. */
export function filterUnits(list: AdminUnit[], term: string): AdminUnit[] {
  const t = norm(term.trim())
  if (!t) return list
  return list.filter((u) => norm([u.name, UNIT_TYPE_LABEL[u.type] ?? u.type, u.neighborhood].join(' ')).includes(t))
}

export function filterOffers(list: UnitOffer[], term: string): UnitOffer[] {
  const t = norm(term.trim())
  if (!t) return list
  return list.filter((o) => norm(o.name).includes(t))
}

export interface UnitErrors {
  name?: string
}

export function validateUnit(v: UnitFormValues): UnitErrors {
  return v.name.trim() ? {} : { name: 'Informe o nome da unidade.' }
}

export const unitBody = (v: UnitFormValues) => ({ name: v.name.trim(), type: v.type, neighborhood: v.neighborhood.trim() })
