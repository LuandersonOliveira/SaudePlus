import { fmtDate } from '@/lib/validators'
import type { HealthUnit } from '@/features/staff/types'
import type { MyBooking, MyKind } from '../types'
import type {
  BookingFormState,
  BookingPayload,
  Selection,
  SlotDay,
  SlotEntry,
  SlotUnit,
} from './types'

/** Valor do <select> de serviço que abre o caminho manual ("Outra/Outro (especificar)"). */
export const OTHER = '__outro'

export const EMPTY_FORM: BookingFormState = {
  servico: '',
  manualService: '',
  manualUnitId: '',
  manualWhen: '',
  selecao: null,
  diaAberto: {},
  notes: '',
}

export const isManual = (s: Pick<BookingFormState, 'servico'>) => s.servico === OTHER

export const COPY: Record<MyKind, { serviceLabel: string; otherLabel: string; customMissing: string; emptyServices: string; newTitle: string; editTitle: string; successCreate: string; successEdit: string; noun: string }> = {
  appointments: {
    serviceLabel: 'Especialidade *',
    otherLabel: 'Outra (especificar)',
    customMissing: 'Informe a especialidade.',
    emptyServices: 'Nenhuma especialidade com vaga no momento. Use "Outra (especificar)" se precisar.',
    newTitle: 'Agendar consulta',
    editTitle: 'Editar consulta',
    successCreate: 'Consulta agendada',
    successEdit: 'Consulta atualizada',
    noun: 'Consulta',
  },
  exams: {
    serviceLabel: 'Tipo de exame *',
    otherLabel: 'Outro (especificar)',
    customMissing: 'Por favor, informe qual é o exame.',
    emptyServices: 'Nenhum exame com vaga no momento. Use "Outro (especificar)" se precisar.',
    newTitle: 'Agendar exame',
    editTitle: 'Editar exame',
    successCreate: 'Exame agendado',
    successEdit: 'Exame atualizado',
    noun: 'Exame',
  },
}

/** "ter., 03/11" a partir de "2026-11-03". */
export function fmtDayLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  if (Number.isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
}

/**
 * Um horário pode ter VÁRIOS profissionais livres. Achatar cada par (hora × profissional)
 * mostra a verdade: às 09:00 com Ana e Beto livres, aparecem "09:00 Ana" e "09:00 Beto".
 */
export function slotEntries(day: SlotDay): SlotEntry[] {
  const out: SlotEntry[] = []
  for (const t of day.slots) {
    const profs = t.professionals?.length
      ? t.professionals
      : [{ id: t.professional_id ?? null, name: t.professional_name ?? null, job_title: t.job_title }]
    for (const p of profs) {
      out.push({ hora: t.hora, professional_id: p.id ?? null, professional_name: p.name ?? null, job_title: p.job_title })
    }
  }
  return out
}

function toSelection(u: SlotUnit, e: SlotEntry, date: string): Selection {
  return {
    unit_id: u.id,
    unit_name: u.name,
    professional_id: e.professional_id,
    professional_name: e.professional_name,
    job_title: e.job_title,
    date,
    hora: e.hora,
    scheduled_at: `${date} ${e.hora}:00`,
  }
}

/** Acha o par (hora × profissional) nas vagas atuais; sem `professionalId`, qualquer profissional serve. */
export function findSlot(
  units: SlotUnit[] | undefined,
  unitId: string,
  scheduledAt: string,
  professionalId?: string | null,
): Selection | null {
  const date = scheduledAt.slice(0, 10)
  const hora = scheduledAt.slice(11, 16)
  const u = units?.find((x) => x.id === unitId)
  const day = u?.dias.find((d) => d.date === date)
  if (!u || !day) return null
  const e = slotEntries(day).find((x) => x.hora === hora && (!professionalId || (x.professional_id ?? '') === professionalId))
  return e ? toSelection(u, e, date) : null
}

export function pickSlot(units: SlotUnit[], unitId: string, date: string, hora: string, professionalId: string | null): Selection | null {
  const u = units.find((x) => x.id === unitId)
  const day = u?.dias.find((d) => d.date === date)
  if (!u || !day) return null
  const e = slotEntries(day).find((x) => x.hora === hora && (x.professional_id ?? '') === (professionalId ?? ''))
  return e ? toSelection(u, e, date) : null
}

export const sameSlot = (a: Selection | null, unitId: string, date: string, hora: string, professionalId: string | null) =>
  !!a && a.unit_id === unitId && a.date === date && a.hora === hora && (a.professional_id ?? '') === (professionalId ?? '')

/** Pronto para enviar: guiado (serviço + vaga) ou manual (serviço digitado + unidade + data/hora). */
export function isReady(s: BookingFormState): boolean {
  if (isManual(s)) return !!(s.manualService.trim() && s.manualUnitId && s.manualWhen)
  return !!(s.servico && s.selecao)
}

/** Valor para <input type="datetime-local"> a partir de "YYYY-MM-DD HH:MM:SS". */
export const toDatetimeLocalValue = (s?: string | null) => (s ? s.replace(' ', 'T').slice(0, 16) : '')

export interface BuiltBooking {
  payload: BookingPayload
  /** Para a tela de revisão. */
  doctor: string | null
}

/** Monta o corpo do POST/PUT; devolve a primeira mensagem de erro se algo faltar. */
export function buildPayload(
  kind: MyKind,
  s: BookingFormState,
  units: HealthUnit[],
): { ok: true; value: BuiltBooking } | { ok: false; error: string } {
  const copy = COPY[kind]
  if (!s.servico) return { ok: false, error: 'Escolha o serviço.' }

  let service = ''
  let location = ''
  let unitId: string | null = null
  let professionalId: string | null = null
  let doctor: string | null = null
  let scheduledAt = ''

  if (isManual(s)) {
    service = s.manualService.trim()
    if (!service) return { ok: false, error: copy.customMissing }
    if (!s.manualUnitId) return { ok: false, error: 'Selecione a unidade.' }
    if (!s.manualWhen) return { ok: false, error: 'Escolha a data e a hora do atendimento.' }
    scheduledAt = `${s.manualWhen.replace('T', ' ')}:00`
    location = units.find((u) => u.id === s.manualUnitId)?.name ?? ''
    unitId = s.manualUnitId
  } else if (s.selecao) {
    service = s.servico
    location = s.selecao.unit_name
    unitId = s.selecao.unit_id
    professionalId = s.selecao.professional_id
    doctor = s.selecao.professional_name
    scheduledAt = s.selecao.scheduled_at
  } else {
    return { ok: false, error: 'Escolha um horário livre abaixo.' }
  }

  const base = { location, scheduled_at: scheduledAt, notes: s.notes, unit_id: unitId, professional_id: professionalId || null }
  const payload: BookingPayload =
    kind === 'appointments' ? { specialty: service, doctor, ...base } : { exam_type: service, ...base }
  return { ok: true, value: { payload, doctor } }
}

export function reviewLines(kind: MyKind, p: BookingPayload, doctor: string | null): [string, string][] {
  const isAppt = kind === 'appointments'
  const rows: [string, string][] = [
    ['Tipo', isAppt ? 'Consulta' : 'Exame'],
    [isAppt ? 'Especialidade' : 'Exame', (isAppt ? p.specialty : p.exam_type) || '—'],
    ['Local', p.location || '—'],
    ['Profissional', doctor || 'A definir pela unidade'],
    ['Data e hora', fmtDate(p.scheduled_at.replace(' ', 'T'))],
  ]
  if (p.notes) rows.push(['Observações', p.notes])
  return rows
}

/** Estado inicial ao editar ou refazer um agendamento existente. */
export function stateFromRecord(
  kind: MyKind,
  record: MyBooking,
  opts: { rebook: boolean; serviceKnown: boolean; units: HealthUnit[] },
): BookingFormState {
  const service = (kind === 'appointments' ? record.specialty : record.exam_type) || ''
  const notes = opts.rebook ? '' : (record.notes ?? '')
  if (opts.serviceKnown) return { ...EMPTY_FORM, servico: service, notes }

  const byName = opts.units.find((u) => u.name === (record.location ?? ''))
  const unitId = record.unit_id && opts.units.some((u) => u.id === record.unit_id) ? record.unit_id : (byName?.id ?? '')
  return {
    ...EMPTY_FORM,
    servico: OTHER,
    manualService: service,
    manualUnitId: unitId,
    manualWhen: opts.rebook ? '' : toDatetimeLocalValue(record.scheduled_at),
    notes,
  }
}

/* ---------------- Rascunho local (formato v2, compatível com o legado) ---------------- */

export const draftKey = (userId: string | number | undefined, kind: MyKind) => `saude_draft_${userId ?? 'anon'}_${kind}`

interface Draft extends Omit<BookingFormState, 'diaAberto'> {
  v: 2
  manual: boolean
}

export function serializeDraft(s: BookingFormState): string | null {
  if (!s.servico && !s.notes) return null
  const d: Draft = {
    v: 2,
    servico: s.servico,
    manual: isManual(s),
    manualService: s.manualService,
    manualUnitId: s.manualUnitId,
    manualWhen: s.manualWhen,
    selecao: s.selecao,
    notes: s.notes,
  }
  return JSON.stringify(d)
}

/** Rascunhos antigos (sem `v:2`), corrompidos ou vazios são ignorados. */
export function parseDraft(raw: string | null): BookingFormState | null {
  if (!raw) return null
  try {
    const d = JSON.parse(raw) as Partial<Draft> | null
    if (!d || d.v !== 2 || (!d.servico && !d.notes)) return null
    return {
      // O legado guardava "__outra" para consulta e "__outro" para exame.
      servico: d.servico === '__outra' ? OTHER : (d.servico ?? ''),
      manualService: d.manualService ?? '',
      manualUnitId: d.manualUnitId ?? '',
      manualWhen: d.manualWhen ?? '',
      selecao: d.selecao ?? null,
      diaAberto: {},
      notes: d.notes ?? '',
    }
  } catch {
    return null
  }
}
