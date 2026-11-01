import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, semRetry } from './api'
import { getToken, setSession } from './session'

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
  it('renova o token em 401 e repete a requisição uma vez', async () => {
    setSession('velho', { role: 'admin' }, 'refresh-1')
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(401, { error: 'expirado' }))
      .mockResolvedValueOnce(json(200, { token: 'novo', user: { role: 'admin' }, refreshToken: 'refresh-2' }))
      .mockResolvedValueOnce(json(200, { ok: true }))

    await expect(api.get('/auth/me')).resolves.toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(getToken()).toBe('novo')
  })

  it('limpa a sessão e lança ApiError quando o refresh falha', async () => {
    setSession('velho', { role: 'admin' }, 'refresh-1')
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(401, { error: 'expirado' }))
      .mockResolvedValueOnce(json(401, {}))

    await expect(api.get('/appointments')).rejects.toMatchObject({ status: 401, message: 'expirado' })
    expect(getToken()).toBeNull()
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
