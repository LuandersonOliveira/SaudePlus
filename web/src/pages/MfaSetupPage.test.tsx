import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RequireRole } from '@/components/RequireRole'
import { getToken } from '@/lib/session'
import { json, mockApi, renderApp, seedSession } from '@/test/utils'
import { MfaSetupPage } from './MfaSetupPage'

/**
 * ADR-0010: atendente e admin sem segundo fator recebem uma sessão restrita (`mfa_setup`) e só alcançam a tela
 * de configuração. Ao ativar, o servidor devolve um token novo, sem a marca, e o painel é liberado.
 */
const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'

function renderPages(route: string) {
  return renderApp(
    <Routes>
      <Route element={<RequireRole />}>
        <Route path="/seguranca/mfa" element={<MfaSetupPage />} />
      </Route>
      <Route element={<RequireRole roles={['atendente', 'admin']} />}>
        <Route path="/atendente/*" element={<p>painel do atendente</p>} />
      </Route>
      <Route path="/auth" element={<p>tela de login</p>} />
    </Routes>,
    { route, path: '/*' },
  )
}

const restrito = { id: 'u1', role: 'atendente', full_name: 'Ana Souza', email: 'ana@saude.app', mfa_setup: true }

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('sessão restrita (sem segundo fator)', () => {
  it('qualquer painel leva à tela de configuração', async () => {
    seedSession(restrito)
    mockApi({})
    renderPages('/atendente')
    expect(await screen.findByRole('heading', { name: 'Ative a verificação em duas etapas' })).toBeInTheDocument()
    expect(screen.queryByText('painel do atendente')).not.toBeInTheDocument()
  })

  it('gera a chave com a senha, mostra em grupos de 4 e ativa com o código: libera o painel com o token novo', async () => {
    seedSession(restrito)
    const m = mockApi({
      'POST /auth/mfa/setup': { secret: SECRET, otpauth_url: `otpauth://totp/Saude%2B:ana?secret=${SECRET}` },
      'POST /auth/mfa/enable': { ok: true, token: 'token-liberado', user: { id: 'u1', role: 'atendente', full_name: 'Ana Souza' } },
    })
    renderPages('/seguranca/mfa')

    await userEvent.type(await screen.findByLabelText('Confirme sua senha'), 'minha-senha-1')
    await userEvent.click(screen.getByRole('button', { name: 'Gerar código de configuração' }))
    await waitFor(() => expect(m.last('POST', '/auth/mfa/setup')?.body).toEqual({ password: 'minha-senha-1' }))

    expect(await screen.findByLabelText('Chave de configuração')).toHaveTextContent('JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP')
    expect(screen.getByRole('link', { name: 'Abrir no aplicativo autenticador' })).toHaveAttribute('href', expect.stringContaining('otpauth://totp/'))

    await userEvent.type(screen.getByLabelText('Código'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Ativar e continuar' }))
    await waitFor(() => expect(m.last('POST', '/auth/mfa/enable')?.body).toEqual({ code: '123456' }))

    expect(await screen.findByText('painel do atendente')).toBeInTheDocument()
    expect(getToken()).toBe('token-liberado')
    expect(JSON.parse(localStorage.getItem('saude_user') ?? '{}').mfa_setup).toBeUndefined()
  })

  it('senha errada avisa e continua na etapa da senha', async () => {
    seedSession(restrito)
    mockApi({ 'POST /auth/mfa/setup': () => json(401, { error: 'Senha incorreta.' }) })
    renderPages('/seguranca/mfa')
    await userEvent.type(await screen.findByLabelText('Confirme sua senha'), 'errada')
    await userEvent.click(screen.getByRole('button', { name: 'Gerar código de configuração' }))
    expect(await screen.findByText('Senha incorreta.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Chave de configuração')).not.toBeInTheDocument()
  })

  it('código errado avisa e mantém a restrição', async () => {
    seedSession(restrito)
    mockApi({
      'POST /auth/mfa/setup': { secret: SECRET, otpauth_url: 'otpauth://totp/x' },
      'POST /auth/mfa/enable': () => json(401, { error: 'Código inválido.' }),
    })
    renderPages('/seguranca/mfa')
    await userEvent.type(await screen.findByLabelText('Confirme sua senha'), 'minha-senha-1')
    await userEvent.click(screen.getByRole('button', { name: 'Gerar código de configuração' }))
    await userEvent.type(await screen.findByLabelText('Código'), '000000')
    await userEvent.click(screen.getByRole('button', { name: 'Ativar e continuar' }))
    expect(await screen.findByText('Código inválido.')).toBeInTheDocument()
    expect(screen.queryByText('painel do atendente')).not.toBeInTheDocument()
  })

  it('"Sair" encerra a sessão e leva ao login', async () => {
    seedSession(restrito)
    mockApi({ 'POST /auth/logout': { ok: true } })
    renderPages('/seguranca/mfa')
    await userEvent.click(await screen.findByRole('button', { name: 'Sair' }))
    expect(await screen.findByText('tela de login')).toBeInTheDocument()
  })
})

describe('quem não está restrito', () => {
  it('atendente com MFA ativo não tem o que configurar: vai ao painel', async () => {
    seedSession({ id: 'u1', role: 'atendente', full_name: 'Ana Souza' })
    mockApi({})
    renderPages('/seguranca/mfa')
    expect(await screen.findByText('painel do atendente')).toBeInTheDocument()
  })

  it('sem sessão, vai ao login', async () => {
    mockApi({})
    renderPages('/seguranca/mfa')
    expect(await screen.findByText('tela de login')).toBeInTheDocument()
  })
})