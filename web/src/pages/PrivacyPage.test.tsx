import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { describeDpo } from '@/lib/publicStats'
import { PrivacyPage } from './PrivacyPage'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PrivacyPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('describeDpo', () => {
  it('mostra nome e e-mail quando configurado; senão pede configuração', () => {
    expect(describeDpo({ configured: true, name: 'Ana', email: 'dpo@x.gov.br' })).toBe('Ana — dpo@x.gov.br')
    expect(describeDpo({ configured: false })).toContain('a definir pela Secretaria')
    expect(describeDpo({ configured: true, name: 'Ana' })).toContain('a definir pela Secretaria')
  })
})

describe('PrivacyPage', () => {
  it('mostra a política e o contato do encarregado nos dois pontos', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      json(200, { configured: true, name: 'Ana', email: 'dpo@x.gov.br' }),
    )
    setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Política de Privacidade' })).toBeInTheDocument()
    expect(screen.getByText('Versão v1-2026-10-09')).toBeInTheDocument()
    expect(await screen.findAllByText('Ana — dpo@x.gov.br')).toHaveLength(2)
  })

  it('mostra indisponível quando a API falha', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(500, { error: 'x' }))
    setup()
    expect(await screen.findAllByText('indisponível no momento — tente mais tarde.')).toHaveLength(2)
  })

  it('a seção de contato existe como âncora #dpo (o rodapé linka para ela)', () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, {}))
    const { container } = setup()
    expect(container.querySelector('#dpo')).toHaveTextContent('Contato')
  })
})
