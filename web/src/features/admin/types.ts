// Contratos de /admin/* (ver server/src/routes/admin.routes.js).
import type { Booking } from '@/features/staff/types'

export interface AdminStats {
  users: { total: number; pending: number; inactive: number }
  units: { total: number; active: number }
  diseases: { total: number; active: number }
}

export interface AuditRow {
  id?: string | number
  action: string
  entity_type: string
  entity_id?: string | null
  details?: string | null
  created_at: string
  actor_name?: string | null
  actor_email?: string | null
  /** 1 quando o ator já não existe (a API usa LEFT JOIN). */
  actor_missing?: number | boolean
}

/** Resposta do modo paginado (`page`/`pageSize`). */
export interface Paged<T> {
  data: T[]
  total: number
}

export type AdminBookingKind = 'appointments' | 'exams'

/** Linha de GET /admin/appointments e /admin/exams (inclui o paciente). */
export interface AdminBooking extends Booking {
  user_email?: string | null
  duration_minutes?: number | null
}

export interface ChainResult {
  ok: boolean
  checked: number
  head?: string
  firstBad?: string | number
  reason?: string
}

export interface AuditFilters {
  entityType: string
  action: string
  pageSize: number
}
