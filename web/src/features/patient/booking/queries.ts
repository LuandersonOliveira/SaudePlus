import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { MyKind } from '../types'
import { type BookingPayload, type CatalogService, KIND_TIPO, type SlotsResponse, type WaitlistEntry } from './types'

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/** Catálogo de serviços (especialidades/exames) com vaga em alguma unidade. */
export const useServices = (kind: MyKind) =>
  useQuery({
    queryKey: ['catalog', 'services', kind],
    queryFn: async () => list<CatalogService>(await api.get(`/catalog/services?tipo=${KIND_TIPO[kind]}`)),
    staleTime: 5 * 60_000,
  })

/** Vagas livres dos próximos 30 dias. `excludeId` libera a vaga do próprio agendamento ao editar. */
export const useSlots = (kind: MyKind, service: string, excludeId: string | null, enabled: boolean) =>
  useQuery({
    queryKey: ['catalog', 'slots', kind, service, excludeId],
    queryFn: async () => {
      const p = new URLSearchParams({ tipo: KIND_TIPO[kind], name: service, days: '30' })
      if (excludeId) p.set('exclude_id', excludeId)
      const data = await api.get<SlotsResponse>(`/catalog/slots?${p.toString()}`)
      return { unidades: data?.unidades ?? [], totalVagas: Number(data?.totalVagas ?? 0), reason: data?.reason }
    },
    enabled: enabled && !!service,
    staleTime: 0,
    gcTime: 0,
  })

export const useWaitlist = () =>
  useQuery({ queryKey: ['me', 'waitlist'], queryFn: async () => list<WaitlistEntry>(await api.get('/me/waitlist')) })

export function useJoinWaitlist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, service }: { kind: MyKind; service: string }) =>
      api.post<unknown>('/me/waitlist', { kind: KIND_TIPO[kind], service_name: service }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me', 'waitlist'] }),
  })
}

export function useLeaveWaitlist() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete<unknown>(`/me/waitlist/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me', 'waitlist'] }),
  })
}

/** POST (novo) ou PUT (edição) em /me/appointments|exams. Refaz as listas do paciente. */
export function useSaveMyBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, editingId, payload }: { kind: MyKind; editingId: string | null; payload: BookingPayload }) =>
      editingId
        ? api.put<unknown>(`/me/${kind}/${encodeURIComponent(editingId)}`, payload)
        : api.post<unknown>(`/me/${kind}`, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}
