// Contratos da API /staff (ver server/src/routes/staff.routes.js e utils/booking-status.js).

export const BOOKING_STATUS = ['pendente', 'confirmado', 'para_remarcar', 'concluido', 'cancelado'] as const
export type BookingStatus = (typeof BOOKING_STATUS)[number]

// Valores aceitos pelo servidor em `outcome` (validateOutcome).
export const BOOKING_OUTCOMES = [
  'compareceu',
  'faltou',
  'recusou',
  'desistiu',
  'erro_agendamento',
  'profissional_indisponivel',
] as const
export type BookingOutcome = (typeof BOOKING_OUTCOMES)[number]

/** Segmento de rota do PATCH /staff/:kind/:id e das listas. */
export type BookingKindPath = 'appointments' | 'exams'
/** `kind` devolvido pela grade da agenda. */
export type AgendaKind = 'consulta' | 'exame'

/** Linha de GET /staff/appointments e /staff/exams. */
export interface Booking {
  id: string
  scheduled_at: string
  status: BookingStatus
  specialty?: string | null
  doctor?: string | null
  exam_type?: string | null
  location?: string | null
  reason?: string | null
  user_name?: string | null
}

/** Item de GET /staff/agenda. */
export interface AgendaItem {
  kind: AgendaKind
  id: string
  scheduled_at: string
  duration_minutes: number | null
  status: BookingStatus
  outcome: BookingOutcome | null
  reschedule_reason: string | null
  service_name: string | null
  user_id: string
  user_name: string | null
  user_priority: string | null
  professional_name: string | null
  unit_name: string | null
}

export interface AgendaSummary {
  total: number
  pendente: number
  confirmado: number
  para_remarcar: number
  concluido: number
  cancelado: number
  consultas: number
  exames: number
}

export interface AgendaDay {
  items: AgendaItem[]
  summary: AgendaSummary
}

export interface AgendaMonthDay {
  date: string
  total: number
}

export interface AgendaFilters {
  tipo: 'all' | AgendaKind
  status: '' | BookingStatus
  unitId: string
  professionalId: string
}

export interface AgendaReport {
  total?: number
  totals?: {
    confirmados?: number
    concluidos?: number
    cancelados?: number
    para_remarcar?: number
    faltas?: number
  }
  occupancy_rate: number | null
  absence_rate: number | null
}

export interface HealthUnit {
  id: string
  name?: string | null
  neighborhood?: string | null
}

export interface Patient {
  id: string
  full_name: string | null
  email: string | null
  phone?: string | null
  birth_date?: string | null
  account_status?: 'ativo' | 'inativo' | 'pendente' | null
}

export interface PatientHistory {
  user: {
    full_name: string
    birth_date?: string | null
    gender?: string | null
    blood_type?: string | null
    mobile?: string | null
  }
  appointments: Booking[]
  exams: Booking[]
}

export interface BookingEvent {
  event_type: string
  created_at: string
  reason?: string | null
}

/** Perfil devolvido por GET /auth/me (campos usados na tela "Minha conta"). */
export interface MeUser {
  full_name?: string | null
  social_name?: string | null
  birth_date?: string | null
  gender?: string | null
  job_role?: string | null
  cpf?: string | null
  rg?: string | null
  cns?: string | null
  mobile?: string | null
  phone?: string | null
  cep?: string | null
  street?: string | null
  address_number?: string | null
  neighborhood?: string | null
  city?: string | null
  state?: string | null
  [key: string]: unknown
}
