import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { AdminUnit, OfferKind, UnitOffer } from './logic'

export const useAdminUnits = () =>
  useQuery({
    queryKey: ['admin', 'units'],
    queryFn: async () => {
      const data = await api.get<AdminUnit[]>('/health-units/manage')
      return Array.isArray(data) ? data : []
    },
  })

export const useUnitOffers = (unitId: string) =>
  useQuery({
    queryKey: ['admin', 'unit-offers', unitId],
    enabled: !!unitId,
    queryFn: async () => {
      const data = await api.get<UnitOffer[]>(`/health-units/${encodeURIComponent(unitId)}/offers`)
      return Array.isArray(data) ? data : []
    },
  })

/** Unidade ou serviço mudou: refaz as listas do admin e o catálogo que o resto do app usa. */
function useInvalidate() {
  const qc = useQueryClient()
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['admin'] }),
      qc.invalidateQueries({ queryKey: ['health-units'] }),
      qc.invalidateQueries({ queryKey: ['catalog'] }),
    ])
}

export function useCreateUnit() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ id: string }>('/health-units', body),
    onSuccess: invalidate,
  })
}

export function useUpdateUnit() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch<unknown>(`/health-units/${encodeURIComponent(id)}`, body),
    onSuccess: invalidate,
  })
}

export function useAddOffer() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ unitId, kind, name }: { unitId: string; kind: OfferKind; name: string }) =>
      api.post<{ id: string }>(`/health-units/${encodeURIComponent(unitId)}/offers`, { kind, name }),
    onSuccess: invalidate,
  })
}

export function useDeleteOffer() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ unitId, offerId }: { unitId: string; offerId: string }) =>
      api.delete<unknown>(`/health-units/${encodeURIComponent(unitId)}/offers/${encodeURIComponent(offerId)}`),
    onSuccess: invalidate,
  })
}
