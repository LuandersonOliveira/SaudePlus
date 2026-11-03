import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { SessionLoading } from '@/components/SessionLoading'
import { useAuth } from '@/lib/auth'
import { homeForRole, type Role } from '@/lib/session'

/** Tela de configuração do segundo fator: a única que a sessão restrita alcança (ADR-0010). */
export const MFA_SETUP_PATH = '/seguranca/mfa'

/** Exige sessão; se `roles` for informado, também exige um dos papéis. */
export function RequireRole({ roles }: { roles?: Role[] }) {
  const { session, ready, signedOut } = useAuth()
  const location = useLocation()

  if (!ready) return <SessionLoading />

  if (!session) {
    // Visita sem sessão: guarda a página para voltar após o login. Logout explícito: não guarda.
    return <Navigate to="/auth" replace state={signedOut ? undefined : { from: location.pathname }} />
  }
  // Atendente/admin sem segundo fator: só a tela de configuração. A API já barra o resto com 403.
  if (session.user.mfa_setup && location.pathname !== MFA_SETUP_PATH) {
    return <Navigate to={MFA_SETUP_PATH} replace />
  }
  if (roles && !roles.includes(session.user.role)) {
    return <Navigate to={homeForRole(session.user.role)} replace />
  }
  return <Outlet />
}
