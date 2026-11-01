import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { cancelPath } from './logic'
import type { Disease, MyBooking, MyKind, Reminder } from './types'

export const patientKeys = {
  bookings: (kind: MyKind) => ['me', 'bookings', kind] as const,
  diseases: ['diseases', 'active'] as const,
  reminders: ['me', 'reminders'] as const,
}

// Respostas inesperadas (null, objeto) viram lista vazia em vez de quebrar a tela.
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

export const useMyBookings = (kind: MyKind) =>
  useQuery({
    queryKey: patientKeys.bookings(kind),
    queryFn: async () => list<MyBooking>(await api.get(`/me/${kind}`)),
  })

export const useDiseases = () =>
  useQuery({
    queryKey: patientKeys.diseases,
    queryFn: async () => list<Disease>(await api.get('/diseases?active=true')),
  })

export const useReminders = () =>
  useQuery({
    queryKey: patientKeys.reminders,
    queryFn: async () => list<Reminder>(await api.get('/me/reminders')),
  })

export function useCancelBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, id }: { kind: MyKind; id: string }) => api.patch<unknown>(cancelPath(kind, id), {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['me'] }),
  })
}
