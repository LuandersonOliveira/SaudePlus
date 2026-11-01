import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { can, type Capability } from './capabilities'

/** Seção oculta pelo nível volta ao Início (o servidor também barra com 403). */
export function RequireCap({ cap, any }: { cap?: Capability; any?: Capability[] }) {
  const { session } = useAuth()
  const level = session?.user.admin_level
  const allowed = any ? any.some((c) => can(level, c)) : cap ? can(level, cap) : true
  return allowed ? <Outlet /> : <Navigate to="/admin" replace />
}
