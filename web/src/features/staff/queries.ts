import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type {
  AgendaDay,
  AgendaFilters,
  AgendaMonthDay,
  AgendaReport,
  Booking,
  BookingEvent,
  BookingKindPath,
  HealthUnit,
  MeUser,
  Patient,
  PatientHistory,
} from './types'

const qs = (params: Record<string, string | undefined>) => {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v)
  return sp.toString()
}

function agendaQuery(base: Record<string, string>, f: AgendaFilters) {
  return qs({
    ...base,
    tipo: f.tipo,
    status: f.status,
    unit_id: f.unitId,
    professional_id: f.professionalId.trim(),
  })
}

export const staffKeys = {
  all: ['staff'] as const,
  bookings: (kind: BookingKindPath) => ['staff', 'bookings', kind] as const,
}

export const useBookings = (kind: BookingKindPath) =>
  useQuery({ queryKey: staffKeys.bookings(kind), queryFn: () => api.get<Booking[]>(`/staff/${kind}?limit=100`) })

export const useAgendaDay = (date: string, filters: AgendaFilters) =>
  useQuery({
    queryKey: ['staff', 'agenda', 'day', date, filters],
    queryFn: () => api.get<AgendaDay>(`/staff/agenda?${agendaQuery({ date }, filters)}`),
  })

export const useAgendaMonth = (month: string, filters: AgendaFilters) =>
  useQuery({
    queryKey: ['staff', 'agenda', 'month', month, filters],
    queryFn: async () => {
      const data = await api.get<{ days: AgendaMonthDay[] }>(`/staff/agenda/month?${agendaQuery({ month }, filters)}`)
      return data?.days ?? []
    },
  })

export const useAgendaReport = (from: string, to: string, enabled: boolean) =>
  useQuery({
    queryKey: ['staff', 'agenda', 'report', from, to],
    queryFn: () => api.get<AgendaReport>(`/staff/agenda/reports?${qs({ from, to })}`),
    enabled,
  })

export const useHealthUnits = () =>
  useQuery({ queryKey: ['health-units'], queryFn: () => api.get<HealthUnit[]>('/health-units'), staleTime: 10 * 60_000 })

/** Serviços (especialidades/tipos de exame) oferecidos pela unidade. */
export const useOffers = (unitId: string, kind: 'consulta' | 'exame') =>
  useQuery({
    queryKey: ['catalog', 'offers', unitId, kind],
    queryFn: () => api.get<string[]>(`/catalog/offers?${qs({ unit_id: unitId, kind })}`),
    enabled: !!unitId,
  })

export interface CatalogProfessional {
  id: string
  name: string
  job_title?: string | null
}

/** Profissionais da unidade habilitados para o serviço. */
export const useCatalogProfessionals = (unitId: string, kind: 'consulta' | 'exame', name: string) =>
  useQuery({
    queryKey: ['catalog', 'professionals', unitId, kind, name],
    queryFn: () => api.get<CatalogProfessional[]>(`/catalog/professionals?${qs({ unit_id: unitId, kind, name })}`),
    enabled: !!unitId && !!name,
  })

export const usePatientSearch =(q: string) =>
  useQuery({
    queryKey: ['staff', 'patients', q],
    queryFn: () => api.get<Patient[]>(`/staff/patients?${qs({ q })}`),
    enabled: q.trim().length > 0,
  })

export const usePatientHistory = (id: string | null) =>
  useQuery({
    queryKey: ['staff', 'patient-history', id],
    queryFn: () => api.get<PatientHistory>(`/staff/patients/${encodeURIComponent(id!)}/history`),
    enabled: !!id,
  })

export const useBookingEvents = (kind: string | null, bookingId: string | null) =>
  useQuery({
    queryKey: ['staff', 'booking-events', kind, bookingId],
    queryFn: () => api.get<BookingEvent[]>(`/staff/booking-events?${qs({ kind: kind!, booking_id: bookingId! })}`),
    enabled: !!kind && !!bookingId,
  })

export const useMe = () =>
  useQuery({ queryKey: ['me'], queryFn: async () => (await api.get<{ user: MeUser }>('/auth/me')).user })

export interface ExportData {
  privacy_version?: string
  profile?: { consent_at?: string | null; privacy_version?: string }
  [key: string]: unknown
}

export const useMeExport = () =>
  useQuery({ queryKey: ['me', 'export'], queryFn: () => api.get<ExportData>('/auth/me/export') })

export interface BookingChange {
  kind: BookingKindPath
  id: string
  body: {
    status?: string
    outcome?: string
    reschedule_reason?: string
    scheduled_at?: string
  }
}

/** PATCH /staff/:kind/:id — confirma, cancela, conclui ou remarca; refaz todas as leituras da agenda. */
export function useUpdateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, id, body }: BookingChange) =>
      api.patch<unknown>(`/staff/${kind}/${encodeURIComponent(id)}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: staffKeys.all }),
  })
}

export interface NewBookingInput {
  kind: 'consulta' | 'exame'
  user_id: string
  unit_id: string
  professional_id: string | null
  scheduled_at: string
  location: string
  service: string
}

export function useCreateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, service, ...rest }: NewBookingInput) =>
      api.post<unknown>(kind === 'consulta' ? '/staff/appointments' : '/staff/exams', {
        ...rest,
        ...(kind === 'consulta' ? { specialty: service } : { exam_type: service }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: staffKeys.all }),
  })
}
