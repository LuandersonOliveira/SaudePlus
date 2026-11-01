import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { normalizeData, type ProfessionalsData } from './logic'

export const useProfessionals = (enabled = true) =>
  useQuery({
    queryKey: ['admin', 'professionals', 'full'],
    enabled,
    queryFn: async (): Promise<ProfessionalsData> => normalizeData(await api.get<unknown>('/admin/professionals')),
  })

/** Qualquer mudança refaz a lista completa, as opções de vínculo com atendentes e os números do Início. */
function useInvalidate() {
  const qc = useQueryClient()
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['admin'] }), qc.invalidateQueries({ queryKey: ['catalog'] })])
}

const base = (id: string) => `/admin/professionals/${encodeURIComponent(id)}`

export function useCreateProfessional() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ id: string }>('/admin/professionals', body),
    onSuccess: invalidate,
  })
}

/** Desativar devolve `moved`: quantos atendimentos futuros foram para a fila de remarcação. */
export function useUpdateProfessional() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch<{ ok: boolean; moved?: number }>(base(id), body),
    onSuccess: invalidate,
  })
}

export function useAddProfessionalOffer() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.post<{ id: string }>(`${base(id)}/offers`, body),
    onSuccess: invalidate,
  })
}

export function useAddSchedule() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.post<{ id: string }>(`${base(id)}/schedules`, body),
    onSuccess: invalidate,
  })
}

export function useAddBlock() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => api.post<{ id: string }>(`${base(id)}/blocks`, body),
    onSuccess: invalidate,
  })
}

export type RemovableKind = 'offers' | 'schedules' | 'blocks'

export function useRemoveItem() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, kind, itemId }: { id: string; kind: RemovableKind; itemId: string }) =>
      api.delete<unknown>(`${base(id)}/${kind}/${encodeURIComponent(itemId)}`),
    onSuccess: invalidate,
  })
}
