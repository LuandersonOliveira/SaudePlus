import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/lib/auth'
import { describeStats } from '@/lib/publicStats'
import { setSession } from '@/lib/session'
import { LandingPage } from './LandingPage'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/admin" element={<p>área admin</p>} />
            <Route path="/dashboard" element={<p>área paciente</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('describeStats', () => {
  it('lista só o que existe e nunca inventa número', () => {
    expect(describeStats({ units: 5, services: 0, professionals: 12 })).toBe(
      'Rede agora: 5 unidades da rede • 12 profissionais.',
    )
    expect(describeStats({})).toBeNull()
    expect(describeStats(null)).toBeNull()
  })
})

describe('LandingPage', () => {
  it('mostra hero, passos, recursos e CTAs para o cadastro', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(500, {}))
    setup()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Marque sua consulta')
    expect(screen.getByRole('link', { name: 'Criar minha conta grátis' })).toHaveAttribute('href', '/auth?tab=signup')
    expect(screen.getByRole('link', { name: 'Já tenho conta' })).toHaveAttribute('href', '/auth')
    expect(screen.getAllByRole('listitem')).toHaveLength(3) // os 3 passos de "Como funciona"
    expect(screen.getByRole('heading', { name: 'Tudo que você precisa' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Política de Privacidade' })).toHaveAttribute('href', '/privacy')
  })

  it('exibe a prova social vinda de /public/stats', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { units: 4, services: 20, professionals: 9 }))
    setup()
    expect(await screen.findByText(/4 unidades da rede • 20 serviços • 9 profissionais/)).toBeInTheDocument()
  })

  it('omite a prova social se a API falhar', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(500, { error: 'x' }))
    setup()
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled())
    expect(screen.queryByText(/Rede agora/)).not.toBeInTheDocument()
  })

  it('redireciona quem já está logado para o painel do papel', () => {
    setSession('t', { role: 'admin' }, 'r')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, {}))
    setup()
    expect(screen.getByText('área admin')).toBeInTheDocument()
  })
})
