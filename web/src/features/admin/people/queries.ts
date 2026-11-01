import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { unpage } from '../logic'
import type { AdminUserDetail, AdminUserRow, ProfessionalOption, UserFilters, UserHistory } from './types'

export const USERS_PAGE_SIZE = 25

export const peopleKeys = {
  list: (f: UserFilters) => ['admin', 'users', 'list', f] as const,
  detail: (id: string) => ['admin', 'users', 'detail', id] as const,
  history: (id: string) => ['admin', 'users', 'history', id] as const,
}

/** Lista paginada que acumula ("Carregar mais"). Um filtro novo recomeça da página 1. */
export function useAdminUsers(filters: UserFilters) {
  return useInfiniteQuery({
    queryKey: peopleKeys.list(filters),
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      const p = new URLSearchParams({ page: String(pageParam), pageSize: String(USERS_PAGE_SIZE) })
      if (filters.q.trim()) p.set('q', filters.q.trim())
      if (filters.role) p.set('role', filters.role)
      if (filters.status) p.set('status', filters.status)
      const { rows, total } = unpage(await api.get<{ data: AdminUserRow[]; total: number } | AdminUserRow[]>(`/admin/users?${p.toString()}`))
      return { rows, total, page: pageParam as number }
    },
    getNextPageParam: (last) => (last.page * USERS_PAGE_SIZE < last.total ? last.page + 1 : undefined),
  })
}

/** Perfil completo. NOTA: o servidor audita a leitura de documentos (admin_view_user_docs). */
export const useAdminUser = (id: string | null) =>
  useQuery({
    queryKey: peopleKeys.detail(id ?? ''),
    enabled: !!id,
    queryFn: () => api.get<AdminUserDetail>(`/admin/users/${encodeURIComponent(id!)}`),
    gcTime: 0, // dados pessoais não ficam em cache depois de fechar o diálogo
  })

export const useUserHistory = (id: string | null) =>
  useQuery({
    queryKey: peopleKeys.history(id ?? ''),
    enabled: !!id,
    queryFn: () => api.get<UserHistory>(`/admin/history?userId=${encodeURIComponent(id!)}`),
    gcTime: 0,
  })

/** Profissionais ativos (para vincular a um atendente). A API devolve array ou {professionals}. */
export const useProfessionalOptions = (enabled: boolean) =>
  useQuery({
    queryKey: ['admin', 'professionals', 'options'],
    enabled,
    queryFn: async () => {
      const data = await api.get<ProfessionalOption[] | { professionals?: ProfessionalOption[] }>('/admin/professionals')
      return Array.isArray(data) ? data : (data.professionals ?? [])
    },
  })

/** POST (novo) ou PATCH (editar). Atualiza listas e os números do Início. */
export function useSaveUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: Record<string, unknown> }) =>
      id ? api.patch<unknown>(`/admin/users/${encodeURIComponent(id)}`, body) : api.post<unknown>('/admin/users', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  })
}

export function useDeleteUser() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.delete<unknown>(`/admin/users/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin'] }),
  })
}
