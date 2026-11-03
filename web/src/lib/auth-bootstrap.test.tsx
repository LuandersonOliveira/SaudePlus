import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequireRole } from '@/components/RequireRole'
import { AuthProvider } from './auth'
import { getToken, setSession } from './session'

/**
 * ADR-0011: o access token só existe em memória. Ao recarregar a página ele some, e o AuthProvider o
 * recupera pelo cookie de refresh ANTES de as rotas protegidas decidirem entre painel e login.
 */
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function montar() {
  return render(
    <MemoryRouter initialEntries={['/painel']}>
      <AuthProvider>
        <Routes>
          <Route element={<RequireRole roles={['paciente']} />}>
            <Route path="/painel" element={<p>painel do paciente</p>} />
          </Route>
          <Route path="/auth" element={<p>tela de login</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

// "Recarregou a página" = há usuário guardado no localStorage e nenhum token em memória
// (o setup global zera o token de cada teste; os casos abaixo gravam só o usuário).
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('recuperação da sessão ao abrir a página', () => {
  it('com usuário guardado e cookie válido: espera, renova e mostra o painel (sem passar pelo login)', async () => {
    localStorage.setItem('saude_user', JSON.stringify({ role: 'paciente', full_name: 'Maria' }))
    let liberar: (r: Response) => void = () => {}
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>((r) => { liberar = r }))

    montar()
    expect(screen.getByRole('status')).toHaveTextContent('Recuperando sua sessão')
    expect(screen.queryByText('tela de login')).not.toBeInTheDocument()

    liberar(json(200, { token: 'novo', user: { role: 'paciente', full_name: 'Maria' } }))
    expect(await screen.findByText('painel do paciente')).toBeInTheDocument()
    expect(getToken()).toBe('novo')
  })

  it('com usuário guardado mas cookie vencido: cai no login e esquece o usuário', async () => {
    localStorage.setItem('saude_user', JSON.stringify({ role: 'paciente' }))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(401, { error: 'Sessão expirada. Entre novamente.' }))

    montar()
    expect(await screen.findByText('tela de login')).toBeInTheDocument()
    expect(localStorage.getItem('saude_user')).toBeNull()
  })

  it('visitante (sem usuário guardado) vai direto ao login, sem chamar a API', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
    montar()
    expect(await screen.findByText('tela de login')).toBeInTheDocument()
    expect(f).not.toHaveBeenCalled()
  })

  it('com sessão já em memória (acabou de logar): mostra o painel sem renovar', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
    setSession('t', { role: 'paciente' })
    montar()
    expect(await screen.findByText('painel do paciente')).toBeInTheDocument()
    expect(f).not.toHaveBeenCalled()
  })

  it('papel errado depois de recuperar a sessão é redirecionado', async () => {
    localStorage.setItem('saude_user', JSON.stringify({ role: 'admin' }))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(json(200, { token: 'n', user: { role: 'admin' } }))
    render(
      <MemoryRouter initialEntries={['/painel']}>
        <AuthProvider>
          <Routes>
            <Route element={<RequireRole roles={['paciente']} />}>
              <Route path="/painel" element={<p>painel do paciente</p>} />
            </Route>
            <Route path="/admin" element={<p>area admin</p>} />
            <Route path="*" element={<p>outra</p>} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.queryByText('painel do paciente')).not.toBeInTheDocument())
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})