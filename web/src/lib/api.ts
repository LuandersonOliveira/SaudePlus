import { clearSession, getRefreshToken, getToken, setSession, type SessionUser } from './session'

// Em dev o Vite faz proxy de /api -> :4000; em produção o Express serve o build
// e a API sob o mesmo prefixo. VITE_API_BASE permite apontar para outro host.
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** 4xx traz a mensagem do servidor (já em português); 5xx vira texto genérico. */
export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof ApiError && e.status < 500 ? e.message : fallback
}

// Só as rotas de credencial ficam fora do retry de refresh. Excluir todo /auth/
// deslogaria quem abre "Minha conta" com o access token (15 min) expirado.
const AUTH_NO_RETRY = ['/auth/login', '/auth/signup', '/auth/refresh', '/auth/logout', '/auth/mfa/']
export const semRetry = (path: string) => AUTH_NO_RETRY.some((p) => path.startsWith(p))

interface RefreshResponse {
  token?: string
  user?: SessionUser
  refreshToken?: string
}

async function tryRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return false
  try {
    const res = await fetch(API_BASE + '/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) return false
    const data = (await res.json()) as RefreshResponse
    if (!data?.token || !data.user) return false
    setSession(data.token, data.user, data.refreshToken)
    return true
  } catch {
    return false
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

async function request<T>(method: Method, path: string, body?: unknown, retried = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`

  const res = await fetch(API_BASE + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })

  if (res.status === 204) return null as T

  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* resposta sem corpo JSON */
  }

  if (!res.ok) {
    if (res.status === 401 && !retried && !semRetry(path) && (await tryRefresh())) {
      return request<T>(method, path, body, true)
    }
    if (res.status === 401) clearSession()
    const d = data as { error?: string; message?: string } | null
    // `status` separa validação (4xx, mensagem do servidor já em português)
    // de falha de servidor (5xx, genérica).
    throw new ApiError(d?.error || d?.message || `Erro inesperado (${res.status})`, res.status)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  delete: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
}

/** GET autenticado que devolve o arquivo (CSV etc.), com a mesma renovação de token do `api`. */
export async function getBlob(path: string, retried = false): Promise<Blob> {
  const token = getToken()
  const res = await fetch(API_BASE + path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (!res.ok) {
    if (res.status === 401 && !retried && (await tryRefresh())) return getBlob(path, true)
    if (res.status === 401) clearSession()
    let message = ''
    try {
      message = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      /* sem corpo JSON */
    }
    throw new ApiError(message || `Erro inesperado (${res.status})`, res.status)
  }
  return res.blob()
}

/** Dispara o download de um Blob no navegador. */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export interface LoginResponse {
  token?: string
  user?: SessionUser
  refreshToken?: string
  mfa_required?: boolean
  mfa_ticket?: string
}

export interface MessageResponse {
  message?: string
}

/** 2º fator: troca o ticket do login + código TOTP por uma sessão. */
export async function verifyMfa(ticket: string, code: string): Promise<LoginResponse> {
  const data = await api.post<LoginResponse>('/auth/mfa/verify', { ticket, code })
  if (data?.token && data.user) setSession(data.token, data.user, data.refreshToken)
  return data
}

export const signup = (payload: Record<string, unknown>) =>
  api.post<MessageResponse>('/auth/signup', payload)
export const forgotPassword = (email: string) =>
  api.post<MessageResponse>('/auth/password/forgot', { email })
export const resetPassword = (token: string, password: string) =>
  api.post<MessageResponse>('/auth/password/reset', { token, password })

export async function login(email: string, password: string): Promise<LoginResponse> {
  const data = await api.post<LoginResponse>('/auth/login', { email, password })
  // Login com MFA responde { mfa_required, mfa_token } SEM `token`: não grava sessão.
  if (data?.token && data.user) setSession(data.token, data.user, data.refreshToken)
  return data
}

export function logout() {
  const refreshToken = getRefreshToken()
  if (refreshToken) {
    // Revoga no servidor (best-effort); o logout local vale mesmo se a rede falhar.
    fetch(API_BASE + '/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {})
  }
  clearSession()
}
