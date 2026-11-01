export type Role = 'admin' | 'atendente' | 'profissional' | 'paciente' | (string & {})

export interface SessionUser {
  id?: number | string
  name?: string
  full_name?: string
  job_role?: string | null
  /** Nível administrativo (só para role=admin). */
  admin_level?: string | null
  email?: string
  role: Role
  [key: string]: unknown
}

export interface Session {
  token: string
  user: SessionUser
}

// Mesmas chaves do front legado: quem já está logado não precisa autenticar
// de novo durante a migração página a página.
const TOKEN_KEY = 'saude_token'
const USER_KEY = 'saude_user'
const REFRESH_KEY = 'saude_refresh'

export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const getRefreshToken = () => localStorage.getItem(REFRESH_KEY)

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
  localStorage.removeItem(REFRESH_KEY)
}

export function getStoredUser(): SessionUser | null {
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as SessionUser) : null
  } catch {
    // Conteúdo corrompido (inclusive a string "undefined" gravada por versões
    // antigas no login com MFA): descarta a sessão em vez de quebrar a página.
    clearSession()
    return null
  }
}

export function setSession(token: string, user: SessionUser, refreshToken?: string | null) {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(USER_KEY, JSON.stringify(user))
  if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken)
}

export function getSession(): Session | null {
  const token = getToken()
  const user = getStoredUser()
  return token && user ? { token, user } : null
}

/** Rota inicial de cada papel. */
export function homeForRole(role: Role): string {
  if (role === 'admin') return '/admin'
  if (role === 'atendente') return '/atendente'
  return '/dashboard'
}
