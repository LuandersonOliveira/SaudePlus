import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { localDateStr } from '@/features/staff/logic'
import { collectBookingsUntil, unpage } from './logic'
import type { AdminBooking, AdminBookingKind, AdminStats, AuditFilters, AuditRow, ChainResult, Paged } from './types'

export const adminKeys = {
  stats: ['admin', 'stats'] as const,
  bookings: (kind: AdminBookingKind) => ['admin', 'bookings', kind] as const,
  activity: ['admin', 'activity'] as const,
  audit: (f: AuditFilters) => ['admin', 'audit', f] as const,
}

export const useAdminStats = () => useQuery({ queryKey: adminKeys.stats, queryFn: () => api.get<AdminStats>('/admin/stats') })

/** Agendamentos de hoje em diante (até 5 páginas de 100). Falha vira "sem dados" para o Início não quebrar. */
export const useAdminBookings = (kind: AdminBookingKind, enabled: boolean) =>
  useQuery({
    queryKey: adminKeys.bookings(kind),
    enabled,
    queryFn: () =>
      collectBookingsUntil(
        (page, pageSize) => api.get<Paged<AdminBooking> | AdminBooking[]>(`/admin/${kind}?page=${page}&pageSize=${pageSize}`),
        localDateStr(),
      ),
  })

/** Últimas 5 ações da auditoria (card "Atividade recente"). */
export const useRecentActivity = (enabled: boolean) =>
  useQuery({
    queryKey: adminKeys.activity,
    enabled,
    queryFn: async () => unpage(await api.get<AuditRow[] | Paged<AuditRow>>('/admin/audit-log?limit=5')).rows,
  })

/** Auditoria paginada que acumula ("Carregar mais"). `page`/`pageSize` ativam o modo paginado da API. */
export function useAuditLog(filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: adminKeys.audit(filters),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const p = new URLSearchParams({ page: String(pageParam), pageSize: String(filters.pageSize) })
      if (filters.entityType) p.set('entityType', filters.entityType)
      if (filters.action) p.set('action', filters.action)
      const { rows, total } = unpage(await api.get<AuditRow[] | Paged<AuditRow>>(`/admin/audit-log?${p.toString()}`))
      return { rows, total, page: pageParam as number }
    },
    getNextPageParam: (last) => (last.page * filters.pageSize < last.total ? last.page + 1 : undefined),
  })
}

/**
 * Confirma, cancela ou reagenda qualquer agendamento: PATCH /admin/:kind/:id (a auditoria registra
 * `admin_update`, diferente das rotas /staff). Refaz agendamentos, números do Início e atividade.
 */
export function useAdminUpdateBooking() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ kind, id, body }: { kind: AdminBookingKind; id: string; body: { status?: string; scheduled_at?: string; reschedule_reason?: string } }) =>
      api.patch<unknown>(`/admin/${kind}/${encodeURIComponent(id)}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  })
}

/** Verifica a cadeia de hashes da trilha (integridade). */
export const useVerifyAudit = () => useMutation({ mutationFn: () => api.get<ChainResult>('/admin/audit-log/verify') })
