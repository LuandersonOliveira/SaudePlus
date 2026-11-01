import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/lib/auth'

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

type Reply = unknown | ((req: { url: string; method: string; body: unknown }) => unknown | Response)

export interface ApiCall {
  method: string
  path: string
  body: unknown
}

/**
 * Simula a API por rota. A chave é "MÉTODO /caminho" e casa por prefixo
 * (o /api do cliente é ignorado). Rota sem resposta devolve 404 e falha visível.
 */
export function mockApi(table: Record<string, Reply>) {
  const calls: ApiCall[] = []
  const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input).replace(/^\/api/, '')
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path: url, body })
    const key = Object.keys(table)
      .sort((a, b) => b.length - a.length)
      .find((k) => `${method} ${url}`.startsWith(k))
    if (!key) return json(404, { error: `sem mock para ${method} ${url}` })
    const reply = table[key]
    const out = typeof reply === 'function' ? (reply as (r: unknown) => unknown)({ url, method, body }) : reply
    return out instanceof Response ? out : json(200, out)
  })
  return { calls, spy, last: (method: string, prefix: string) => calls.filter((c) => c.method === method && c.path.startsWith(prefix)).at(-1) }
}

export const staffUser = { id: 'u1', role: 'atendente', full_name: 'Ana Souza', email: 'ana@saude.app', job_role: 'recepcionista' }

export function seedSession(user: object = staffUser) {
  localStorage.setItem('saude_token', 't')
  localStorage.setItem('saude_refresh', 'r')
  localStorage.setItem('saude_user', JSON.stringify(user))
}

/** Renderiza dentro de Router + React Query + Auth + Toaster, na rota dada. */
export function renderApp(
  ui: ReactElement,
  { route = '/', path = '/*' }: { route?: string | { pathname: string; state?: unknown }; path?: string } = {},
) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          <Toaster />
          <Routes>
            <Route path={path} element={ui} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}
