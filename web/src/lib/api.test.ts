import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, logout, restoreSession, semRetry } from './api'
import { getToken, hasSessionHint, setSession } from './session'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('semRetry', () => {
  it('exclui só rotas de credencial, não /auth/me', () => {
    expect(semRetry('/auth/login')).toBe(true)
    expect(semRetry('/auth/mfa/verify')).toBe(true)
    expect(semRetry('/auth/me')).toBe(false)
  })
})

describe('api.request', () => {
  it('renova o token em 401 pelo COOKIE e repete a requisição uma vez', async () => {
    setSession('velho', { role: 'admin' })
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(401, { error: 'expirado' }))
      .mockResolvedValueOnce(json(200, { token: 'novo', user: { role: 'admin' } }))
      .mockResolvedValueOnce(json(200, { ok: true }))

    await expect(api.get('/auth/me')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(getToken()).toBe('novo')

    // ADR-0011: a renovação não manda refresh token no corpo; quem identifica a sessão é o cookie HttpOnly.
    const [url, init] = fetchMock.mock.calls[1]
    expect(String(url)).toBe('/api/auth/refresh')
    expect((init as RequestInit).body).toBe('{}')
    expect(localStorage.getItem('saude_refresh')).toBeNull()
    expect(localStorage.getItem('saude_token')).toBeNull()
  })

  it('limpa a sessão e lança ApiError quando o refresh falha', async () => {
    setSession('velho', { role: 'admin' })
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(401, { error: 'expirado' }))
      .mockResolvedValueOnce(json(401, {}))

    await expect(api.get('/appointments')).rejects.toMatchObject({ status: 401, message: 'expirado' })
    expect(getToken()).toBeNull()
    expect(hasSessionHint()).toBe(false)
  })

  it('várias requisições em 401 ao mesmo tempo compartilham UMA renovação', async () => {
    // Renovar duas vezes com o mesmo cookie derrubaria a sessão: o servidor trata o reuso como roubo.
    setSession('velho', { role: 'admin' })
    let refreshes = 0
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/auth/refresh')) {
        refreshes += 1
        await new Promise((r) => setTimeout(r, 20))
        return json(200, { token: 'novo', user: { role: 'admin' } })
      }
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization
      return auth === 'Bearer novo' ? json(200, { ok: url }) : json(401, { error: 'expirado' })
    })

    const [a, b, c] = await Promise.all([api.get('/a'), api.get('/b'), api.get('/c')])
    expect([a, b, c]).toEqual([{ ok: '/api/a' }, { ok: '/api/b' }, { ok: '/api/c' }])
    expect(refreshes).toBe(1)
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/auth/refresh'))).toHaveLength(1)
  })

  it('usa a Web Locks API para renovar uma aba por vez, quando existe', async () => {
    setSession('velho', { role: 'admin' })
    const request = vi.fn(async (_nome: string, cb: () => Promise<unknown>) => cb())
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(200, { token: 'novo', user: { role: 'admin' } }))

    await expect(restoreSession()).resolves.toBe(true)
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe('saude-refresh-sessao')
    vi.unstubAllGlobals()
  })

  it('visitante sem sessão guardada não dispara renovação em 401', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(401, { error: 'sem sessão' }))
    await expect(api.get('/algo')).rejects.toMatchObject({ status: 401 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('não tenta refresh em /auth/login', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(401, { error: 'Credenciais inválidas' }))
    await expect(api.post('/auth/login', {})).rejects.toBeInstanceOf(ApiError)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('devolve null em 204', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(null, { status: 204 }))
    await expect(api.delete('/x')).resolves.toBeNull()
  })
})

describe('sessão (ADR-0011)', () => {
  it('o access token fica em memória e o localStorage guarda só o usuário', () => {
    setSession('tok-secreto', { role: 'paciente', full_name: 'Maria' })
    expect(getToken()).toBe('tok-secreto')
    const guardado = Object.keys(localStorage).map((k) => `${k}=${localStorage.getItem(k)}`).join('\n')
    expect(guardado).not.toContain('tok-secreto')
    expect(localStorage.getItem('saude_user')).toContain('Maria')
  })

  it('restoreSession: sem cookie válido, limpa o usuário guardado', async () => {
    setSession('velho', { role: 'admin' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(401, { error: 'Sessão expirada. Entre novamente.' }))
    await expect(restoreSession()).resolves.toBe(false)
    expect(hasSessionHint()).toBe(false)
    expect(getToken()).toBeNull()
  })

  it('logout avisa o servidor (o cookie vai junto) e limpa a sessão local', () => {
    setSession('t', { role: 'admin' })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { ok: true }))
    logout()
    expect(String(fetchMock.mock.calls[0][0])).toBe('/api/auth/logout')
    expect((fetchMock.mock.calls[0][1] as RequestInit).body).toBe('{}')
    expect(getToken()).toBeNull()
    expect(hasSessionHint()).toBe(false)
  })

  it('apaga os tokens que versões antigas guardavam no localStorage', async () => {
    localStorage.setItem('saude_token', 'legado-1')
    localStorage.setItem('saude_refresh', 'legado-2')
    vi.resetModules()
    await import('./session')
    expect(localStorage.getItem('saude_token')).toBeNull()
    expect(localStorage.getItem('saude_refresh')).toBeNull()
  })
})