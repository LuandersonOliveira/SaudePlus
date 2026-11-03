import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { login as apiLogin, logout as apiLogout, restoreSession, verifyMfa as apiVerifyMfa, type LoginResponse } from './api'
import { getSession, hasSessionHint, type Session } from './session'

interface AuthContextValue {
  session: Session | null
  /**
   * alse enquanto a sessão está sendo recuperada pelo cookie de refresh (o access token só existe em
   * memória, ADR-0011). Rotas protegidas e a tela de login esperam por isto antes de decidir.
   */
  ready: boolean
  /**
   * `true` depois de um "Sair" explícito (até o próximo login). As rotas protegidas usam para NÃO
   * guardar "voltar para onde estava": quem sai e entra com outra conta não deve cair na página da anterior.
   */
  signedOut: boolean
  login: (email: string, password: string) => Promise<LoginResponse>
  verifyMfa: (ticket: string, code: string) => Promise<LoginResponse>
  logout: () => void
  /** Relê a sessão do storage (após refresh ou edição do perfil). */
  refresh: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<Session | null>(() => getSession())
  const [signedOut, setSignedOut] = useState(false)
  // Sem token em memória mas com usuário guardado: pode haver sessão no cookie, então tenta recuperá-la.
  const [ready, setReady] = useState(() => getSession() !== null || !hasSessionHint())

  useEffect(() => {
    if (ready) return
    let vivo = true
    // restoreSession compartilha uma única renovação em voo, então o efeito duplo do StrictMode não renova duas vezes.
    void restoreSession().finally(() => {
      if (!vivo) return
      setSessionState(getSession())
      setReady(true)
    })
    return () => {
      vivo = false
    }
  }, [ready])

  const refresh = useCallback(() => setSessionState(getSession()), [])

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiLogin(email, password)
    const s = getSession()
    setSessionState(s)
    if (s) setSignedOut(false)
    return data
  }, [])

  const verifyMfa = useCallback(async (ticket: string, code: string) => {
    const data = await apiVerifyMfa(ticket, code)
    const s = getSession()
    setSessionState(s)
    if (s) setSignedOut(false)
    return data
  }, [])

  const logout = useCallback(() => {
    apiLogout()
    setSessionState(null)
    setSignedOut(true)
  }, [])

  const value = useMemo(
    () => ({ session, ready, signedOut, login, verifyMfa, logout, refresh }),
    [session, ready, signedOut, login, verifyMfa, logout, refresh],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>')
  return ctx
}
