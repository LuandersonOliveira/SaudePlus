// Contratos de /admin/professionals (ver server/src/routes/admin.professionals.routes.js).
export const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'] as const

export interface Professional {
  id: string
  name: string
  job_title?: string | null
  registry?: string | null
  active: number | boolean
  user_id?: string | null
  user_name?: string | null
}

export interface ProfessionalOffer {
  id: string
  professional_id: string
  unit_id: string
  kind: 'consulta' | 'exame' | (string & {})
  name: string
  unit_name: string
}

export interface WorkSchedule {
  id: string
  professional_id: string
  unit_id: string
  weekday: number
  start_time: string
  end_time: string
  slot_minutes: number
  unit_name: string
}

export interface ScheduleBlock {
  id: string
  professional_id: string
  unit_id: string
  starts_at: string
  ends_at: string
  reason?: string | null
  unit_name: string
}

export interface ProfessionalsData {
  professionals: Professional[]
  offers: ProfessionalOffer[]
  schedules: WorkSchedule[]
  blocks: ScheduleBlock[]
}

export const EMPTY_DATA: ProfessionalsData = { professionals: [], offers: [], schedules: [], blocks: [] }

/** A API já devolveu array puro em versões antigas; aceita os dois formatos. */
export function normalizeData(raw: unknown): ProfessionalsData {
  if (Array.isArray(raw)) return { ...EMPTY_DATA, professionals: raw as Professional[] }
  const r = (raw ?? {}) as Partial<ProfessionalsData>
  return {
    professionals: r.professionals ?? [],
    offers: r.offers ?? [],
    schedules: r.schedules ?? [],
    blocks: r.blocks ?? [],
  }
}

export const isActive = (p: { active: number | boolean }) => Number(p.active) === 1

const norm = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

export function filterProfessionals(list: Professional[], term: string): Professional[] {
  const t = norm(term.trim())
  if (!t) return list
  return list.filter((p) => norm([p.name, p.job_title, p.registry].join(' ')).includes(t))
}

/** Quantos vínculos, horários e bloqueios futuros o profissional tem. */
export function countsFor(data: ProfessionalsData, id: string) {
  return {
    offers: data.offers.filter((o) => o.professional_id === id).length,
    schedules: data.schedules.filter((s) => s.professional_id === id).length,
    blocks: data.blocks.filter((b) => b.professional_id === id).length,
  }
}

/** Acha o profissional pelo id ou, se for um atendente, pela conta de usuário ligada a ele. */
export function findProfessional(data: ProfessionalsData, ref: { professionalId?: string | null; userId?: string | null }) {
  if (ref.professionalId) {
    const byId = data.professionals.find((p) => p.id === ref.professionalId)
    if (byId) return byId
  }
  if (ref.userId) return data.professionals.find((p) => p.user_id === ref.userId) ?? null
  return null
}

export interface ProfessionalFormValues {
  name: string
  job_title: string
  registry: string
}
export const EMPTY_PROFESSIONAL: ProfessionalFormValues = { name: '', job_title: '', registry: '' }

export const validateProfessional = (v: ProfessionalFormValues): { name?: string } =>
  v.name.trim() ? {} : { name: 'Informe o nome do profissional.' }

export const professionalBody = (v: ProfessionalFormValues) => ({
  name: v.name.trim(),
  job_title: v.job_title.trim(),
  registry: v.registry.trim(),
})

// ---- vínculos ----
export interface OfferFormValues {
  unit_id: string
  kind: 'consulta' | 'exame'
  name: string
  reason: string
}
export const EMPTY_OFFER: OfferFormValues = { unit_id: '', kind: 'consulta', name: '', reason: '' }

export function validateOffer(v: OfferFormValues): { unit_id?: string; name?: string } {
  const e: { unit_id?: string; name?: string } = {}
  if (!v.unit_id) e.unit_id = 'Selecione a unidade.'
  if (!v.name.trim()) e.name = 'Informe a especialidade ou o exame.'
  return e
}

// ---- horários ----
export interface ScheduleFormValues {
  unit_id: string
  weekdays: number[]
  start_time: string
  end_time: string
  slot_minutes: string
  reason: string
}
export const EMPTY_SCHEDULE: ScheduleFormValues = {
  unit_id: '', weekdays: [], start_time: '', end_time: '', slot_minutes: '30', reason: '',
}

export interface ScheduleErrors {
  unit_id?: string
  weekdays?: string
  start_time?: string
  end_time?: string
  slot_minutes?: string
}

export function validateSchedule(v: ScheduleFormValues): ScheduleErrors {
  const e: ScheduleErrors = {}
  if (!v.unit_id) e.unit_id = 'Selecione a unidade.'
  if (!v.weekdays.length) e.weekdays = 'Selecione ao menos um dia da semana.'
  if (!v.start_time) e.start_time = 'Informe o início.'
  if (!v.end_time) e.end_time = 'Informe o fim.'
  // "HH:MM" compara certo como texto.
  else if (v.start_time && v.start_time >= v.end_time) e.end_time = 'O horário final deve ser depois do inicial.'
  const slot = Number(v.slot_minutes)
  if (!Number.isInteger(slot) || slot < 5 || slot > 240) e.slot_minutes = 'Duração entre 5 e 240 minutos.'
  return e
}

export const scheduleBody = (v: ScheduleFormValues, weekday: number) => ({
  unit_id: v.unit_id,
  weekday,
  start_time: v.start_time,
  end_time: v.end_time,
  slot_minutes: Number(v.slot_minutes),
  ...(v.reason.trim() ? { reason: v.reason.trim() } : {}),
})

// ---- bloqueios ----
export interface BlockFormValues {
  unit_id: string
  starts_at: string
  ends_at: string
  reason: string
}
export const EMPTY_BLOCK: BlockFormValues = { unit_id: '', starts_at: '', ends_at: '', reason: '' }

export interface BlockErrors {
  unit_id?: string
  starts_at?: string
  ends_at?: string
  reason?: string
}

export function validateBlock(v: BlockFormValues): BlockErrors {
  const e: BlockErrors = {}
  if (!v.unit_id) e.unit_id = 'Selecione a unidade.'
  if (!v.starts_at) e.starts_at = 'Informe o início.'
  if (!v.ends_at) e.ends_at = 'Informe o fim.'
  else if (v.starts_at && v.starts_at >= v.ends_at) e.ends_at = 'O fim do bloqueio deve ser depois do início.'
  if (!v.reason.trim()) e.reason = 'Informe o motivo (fica na trilha de auditoria).'
  return e
}

export const blockBody = (v: BlockFormValues) => ({
  unit_id: v.unit_id,
  starts_at: v.starts_at,
  ends_at: v.ends_at,
  reason: v.reason.trim(),
})

export const hhmm = (t: string) => String(t).slice(0, 5)

/** "2026-11-05T08:00:00.000Z"/"2026-11-05 08:00:00" -> "05/11/2026 08:00" sem passar pelo fuso. */
export function fmtBlockDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(s))
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : String(s)
}
