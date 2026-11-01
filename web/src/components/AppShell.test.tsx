import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequireRole } from '@/components/RequireRole'
import PatientRoutes from '@/features/patient/PatientRoutes'
import { mockApi, renderApp, seedSession } from '@/test/utils'

function Auth() {
  const l = useLocation()
  return (
    <div>
      <p>tela de login</p>
      <pre data-testid="from">{JSON.stringify(l.state)}</pre>
    </div>
  )
}

beforeEach(() => {
  localStorage.clear()
  seedSession({ id: 'p1', role: 'paciente', full_name: 'Maria Lima', email: 'maria@x.com' })
  mockApi({ 'GET /me/': [], 'GET /diseases': [], 'GET /auth/me': { user: {} }, 'POST /auth/logout': {} })
})
afterEach(() => vi.restoreAllMocks())

describe('endereço inexistente nas áreas autenticadas', () => {
  it('/dashboard/nao-existe volta ao Início do painel (não deixa página em branco)', async () => {
    renderApp(
      <Routes>
        <Route element={<RequireRole roles={['paciente']} />}>
          <Route path="/dashboard/*" element={<PatientRoutes />} />
        </Route>
        <Route path="/auth" element={<Auth />} />
      </Routes>,
      { route: '/dashboard/nao-existe', path: '/*' },
    )
    expect(await screen.findByText('Acompanhe seus agendamentos, exames e alertas de saúde.')).toBeInTheDocument()
  })
})

describe('RequireRole — voltar para onde estava', () => {
  it('visita sem sessão a uma página protegida guarda o destino para depois do login', async () => {
    localStorage.clear() // sem sessão
    renderApp(
      <Routes>
        <Route element={<RequireRole roles={['paciente']} />}>
          <Route path="/dashboard/*" element={<p>área protegida</p>} />
        </Route>
        <Route path="/auth" element={<Auth />} />
      </Routes>,
      { route: '/dashboard/agendamentos', path: '/*' },
    )
    expect(await screen.findByText('tela de login')).toBeInTheDocument()
    expect(screen.getByTestId('from')).toHaveTextContent('"from":"/dashboard/agendamentos"')
  })
})

describe('AppShell — Sair', () => {
  it('encerra a sessão e vai ao login SEM guardar a página anterior', async () => {
    renderApp(
      <Routes>
        <Route element={<RequireRole roles={['paciente']} />}>
          <Route path="/dashboard/*" element={<PatientRoutes />} />
        </Route>
        <Route path="/auth" element={<Auth />} />
      </Routes>,
      { route: '/dashboard/agendamentos', path: '/*' },
    )
    await userEvent.click((await screen.findAllByRole('button', { name: 'Sair' }))[0])

    expect(await screen.findByText('tela de login')).toBeInTheDocument()
    // sem isto, entrar com outra conta cairia em /dashboard/agendamentos da conta anterior
    expect(screen.getByTestId('from')).not.toHaveTextContent('from')
    await waitFor(() => expect(localStorage.getItem('saude_token')).toBeNull())
  })
})
