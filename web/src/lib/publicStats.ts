import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export interface PublicStats {
  units?: number
  services?: number
  professionals?: number
}

/** Texto da prova social, ou null se não houver número real (nunca inventa). */
export function describeStats(s: PublicStats | null | undefined): string | null {
  if (!s) return null
  const parts: string[] = []
  if (s.units) parts.push(`${s.units} unidades da rede`)
  if (s.services) parts.push(`${s.services} serviços`)
  if (s.professionals) parts.push(`${s.professionals} profissionais`)
  return parts.length ? `Rede agora: ${parts.join(' • ')}.` : null
}

export interface PublicDpo {
  configured?: boolean
  name?: string
  email?: string
}

/** Contato do encarregado (art. 41 da LGPD), exatamente como o legado exibia. */
export function describeDpo(d: PublicDpo | null | undefined): string {
  return d?.configured && d.email
    ? `${d.name} — ${d.email}`
    : 'a definir pela Secretaria (configure DPO_NAME/DPO_EMAIL na API)'
}

export const DPO_UNAVAILABLE = 'indisponível no momento — tente mais tarde.'

export function usePublicDpo() {
  return useQuery({
    queryKey: ['public-dpo'],
    queryFn: () => api.get<PublicDpo>('/public/dpo'),
    retry: false,
    staleTime: 5 * 60_000,
  })
}

/** Estatísticas públicas; se a API falhar, o dado simplesmente some (sem retry). */
export function usePublicStats() {
  return useQuery({
    queryKey: ['public-stats'],
    queryFn: () => api.get<PublicStats>('/public/stats'),
    retry: false,
    staleTime: 5 * 60_000,
  })
}
