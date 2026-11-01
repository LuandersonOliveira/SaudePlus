import type { AgendaKind, Booking, BookingKindPath, BookingStatus, MeUser } from './types'

/** YYYY-MM-DD no fuso LOCAL. toISOString() converteria para UTC e, em UTC-3, o dia viraria às 21h. */
export function localDateStr(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const monthStr = (dateStr: string) => dateStr.slice(0, 7)

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return localDateStr(d)
}

export function addMonths(month: string, delta: number): string {
  const d = new Date(`${month}-01T00:00:00`)
  d.setMonth(d.getMonth() + delta)
  return monthStr(localDateStr(d))
}

/** Valor para <input type="datetime-local"> (minuto, fuso local). */
export function nowLocalForInput(now = new Date()): string {
  const d = new Date(now)
  d.setSeconds(0, 0)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

/** Teto de 1 ano à frente para agendamentos. */
export function maxLocalForInput(now = new Date()): string {
  const d = new Date(now)
  d.setFullYear(d.getFullYear() + 1)
  return nowLocalForInput(d)
}

/** "2026-11-03T09:30" -> "2026-11-03 09:30:00" (formato aceito pela API). */
export function toApiDateTime(local: string): string {
  const v = local.replace('T', ' ')
  return v.length === 16 ? `${v}:00` : v
}

export const kindToPath = (kind: AgendaKind): BookingKindPath => (kind === 'consulta' ? 'appointments' : 'exams')

export const STATUS_LABEL: Record<BookingStatus, string> = {
  pendente: 'Pendente',
  confirmado: 'Confirmado',
  para_remarcar: 'Para remarcar',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
}

export const OUTCOME_LABEL: Record<string, string> = {
  compareceu: 'Compareceu',
  faltou: 'Faltou',
  recusou: 'Recusou',
  desistiu: 'Desistiu',
  erro_agendamento: 'Erro de agendamento',
  profissional_indisponivel: 'Profissional indisponível',
}

export const RESCHEDULE_REASON_LABEL: Record<string, string> = {
  solicitado_pelo_paciente: 'Solicitado pelo paciente',
  profissional_inativado: 'Profissional inativado',
}

export type BadgeTone = 'default' | 'success' | 'warning' | 'danger' | 'muted'

export function statusTone(status: string): BadgeTone {
  switch (status) {
    case 'concluido':
    case 'confirmado':
      return 'success'
    case 'pendente':
    case 'para_remarcar':
      return 'warning'
    case 'cancelado':
      return 'danger'
    default:
      return 'default'
  }
}

/** Pendentes de hoje (consultas e exames) em ordem de horário — a "Fila do dia". */
export function buildTodayQueue(
  appointments: Booking[],
  exams: Booking[],
  today = localDateStr(),
): Array<Booking & { kind: BookingKindPath }> {
  const only = (rows: Booking[], kind: BookingKindPath) =>
    rows.filter((r) => r.scheduled_at.slice(0, 10) === today && r.status === 'pendente').map((r) => ({ ...r, kind }))
  return [...only(appointments, 'appointments'), ...only(exams, 'exams')].sort(
    (a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
  )
}

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

const JOB_ROLES: Record<string, string> = {
  recepcionista: 'Recepcionista',
  tecnico_enfermagem: 'Técnico(a) de Enfermagem',
  'tecnico de enfermagem': 'Técnico(a) de Enfermagem',
  enfermeiro: 'Enfermeiro(a)',
  'enfermeiro(a)': 'Enfermeiro(a)',
  enfermeira: 'Enfermeiro(a)',
  medico: 'Médico(a)',
  'medico(a)': 'Médico(a)',
  motorista: 'Motorista',
  'auxiliar administrativo': 'Auxiliar Administrativo',
  administrativo: 'Auxiliar Administrativo',
  agente_saude: 'Agente Comunitário de Saúde',
  'agente de saude': 'Agente Comunitário de Saúde',
  'agente comunitario de saude': 'Agente Comunitário de Saúde',
  atendente: 'Atendente',
  psicologo: 'Psicólogo(a)',
  'psicologo(a)': 'Psicólogo(a)',
  dentista: 'Cirurgião(a)-Dentista',
  odontologista: 'Cirurgião(a)-Dentista',
}

export function formatJobRole(role?: string | null): string {
  if (!role) return ''
  const key = norm(role)
  if (JOB_ROLES[key]) return JOB_ROLES[key]
  // Cargo livre cadastrado pelo admin: só destaca a primeira letra de cada palavra.
  return key
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

const TRACKED = ['social_name', 'birth_date', 'gender', 'rg', 'cns', 'phone', 'cep', 'street', 'neighborhood', 'city', 'state'] as const

/** % de campos opcionais do perfil preenchidos. */
export function profileCompleteness(user?: MeUser | null): number {
  const filled = TRACKED.filter((k) => {
    const v = user?.[k]
    return v !== null && v !== undefined && String(v).trim() !== ''
  }).length
  return Math.round((filled / TRACKED.length) * 100)
}

export function fmtSimpleDate(d?: string | null): string {
  if (!d) return '—'
  // Data pura ("1985-04-02"): formata direto. new Date() a trata como UTC e, em UTC-3, mostraria 01/04.
  const pure = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d)
  if (pure) return `${pure[3]}/${pure[2]}/${pure[1]}`
  const date = new Date(d)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('pt-BR')
}

export const hhmm = (scheduledAt?: string | null) => String(scheduledAt ?? '').slice(11, 16)
