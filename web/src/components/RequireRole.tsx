import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '@/lib/auth'
import { homeForRole, type Role } from '@/lib/session'

/** Exige sessão; se `roles` for informado, também exige um dos papéis. */
export function RequireRole({ roles }: { roles?: Role[] }) {
  const { session, signedOut } = useAuth()
  const location = useLocation()

  if (!session) {
    // Visita sem sessão: guarda a página para voltar após o login. Logout explícito: não guarda.
    return <Navigate to="/auth" replace state={signedOut ? undefined : { from: location.pathname }} />
  }
  if (roles && !roles.includes(session.user.role)) {
    return <Navigate to={homeForRole(session.user.role)} replace />
  }
  return <Outlet />
}
