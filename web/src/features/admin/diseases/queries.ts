import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { AdminDisease } from './logic'

export const useAdminDiseases = () =>
  useQuery({
    queryKey: ['admin', 'diseases'],
    queryFn: async () => {
      const data = await api.get<AdminDisease[]>('/admin/diseases')
      return Array.isArray(data) ? data : []
    },
  })

/** Depois de qualquer mudança refaz a lista, os números do Início e os alertas que o paciente vê. */
function useInvalidate() {
  const qc = useQueryClient()
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['admin'] }), qc.invalidateQueries({ queryKey: ['diseases'] })])
}

export function useCreateDisease() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post<{ id: string }>('/admin/diseases', body),
    onSuccess: invalidate,
  })
}

export function useUpdateDisease() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      api.patch<unknown>(`/admin/diseases/${encodeURIComponent(id)}`, body),
    onSuccess: invalidate,
  })
}

export function useDeleteDisease() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.delete<unknown>(`/admin/diseases/${encodeURIComponent(id)}`),
    onSuccess: invalidate,
  })
}
