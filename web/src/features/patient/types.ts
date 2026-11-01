// Contratos de /me/* e /diseases (ver server/src/routes/appointments|exams|reminders|diseases.routes.js).
import type { BookingStatus } from '@/features/staff/types'

export type MyKind = 'appointments' | 'exams'

/** Linha de GET /me/appointments e /me/exams. */
export interface MyBooking {
  id: string
  scheduled_at: string
  status: BookingStatus
  location?: string | null
  notes?: string | null
  unit_id?: string | null
  professional_id?: string | null
  // consultas
  specialty?: string | null
  doctor?: string | null
  // exames
  exam_type?: string | null
}

export type AlertLevel = 'alto' | 'medio' | 'baixo' | (string & {})

export interface Disease {
  id?: string | number
  name: string
  alert_level: AlertLevel
  description?: string | null
  region?: string | null
}

export interface Reminder {
  id: string | number
  title: string
  message?: string | null
  read: boolean | number
}

/** Item normalizado para as listas (consulta e exame no mesmo formato). */
export interface BookingItem extends MyBooking {
  kind: MyKind
  typeLabel: 'Consulta' | 'Exame'
  title: string
}
