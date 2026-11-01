// Contratos de /catalog/* e /me/waitlist (ver server/src/routes/catalog.routes.js e me.waitlist.routes.js).
import type { MyKind } from '../types'

/** Tipo de serviço no catálogo (`tipo`). */
export type Tipo = 'consulta' | 'exame'

export const KIND_TIPO: Record<MyKind, Tipo> = { appointments: 'consulta', exams: 'exame' }

export interface CatalogService {
  name: string
  /** Em quantas unidades o serviço existe. */
  unidades: number
}

export interface SlotProfessional {
  id: string | null
  name: string | null
  job_title?: string | null
}

export interface SlotTime {
  hora: string
  professionals?: SlotProfessional[]
  professional_id?: string | null
  professional_name?: string | null
  job_title?: string | null
}

export interface SlotDay {
  date: string
  slots: SlotTime[]
}

export interface SlotUnit {
  id: string
  name: string
  type?: string | null
  neighborhood?: string | null
  totalVagas: number
  dias: SlotDay[]
}

export interface SlotsResponse {
  unidades?: SlotUnit[]
  totalVagas?: number
  reason?: string
}

/** Um par (horário × profissional) livre. */
export interface SlotEntry {
  hora: string
  professional_id: string | null
  professional_name: string | null
  job_title?: string | null
}

/** Vaga escolhida pelo paciente. */
export interface Selection {
  unit_id: string
  unit_name: string
  professional_id: string | null
  professional_name: string | null
  job_title?: string | null
  date: string
  hora: string
  /** "YYYY-MM-DD HH:MM:00" */
  scheduled_at: string
}

export interface BookingFormState {
  /** Nome do serviço, `OTHER` (caminho manual) ou vazio. */
  servico: string
  manualService: string
  manualUnitId: string
  /** Valor de <input type="datetime-local">. */
  manualWhen: string
  selecao: Selection | null
  /** Dia aberto por unidade (id da unidade → data). */
  diaAberto: Record<string, string>
  notes: string
}

export interface WaitlistEntry {
  id: string
  kind: Tipo
  service_name: string
  status: 'aguardando' | 'convertido' | 'cancelado' | (string & {})
  created_at: string
}

/** Corpo de POST/PUT /me/appointments|exams. */
export interface BookingPayload {
  specialty?: string
  exam_type?: string
  doctor?: string | null
  location: string
  scheduled_at: string
  notes: string
  unit_id: string | null
  professional_id: string | null
}
