import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster } from '@/components/ui/sonner'
import { AuthProvider } from '@/lib/auth'
import { AuthPage } from './AuthPage'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

function setup(entry = '/auth') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <AuthProvider>
        <Toaster />
        <Routes>
          <Route path="/auth" element={<><AuthPage /><Where /></>} />
          <Route path="/admin" element={<p>área admin</p>} />
          <Route path="/dashboard" element={<p>área paciente</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  )
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('login', () => {
  it('valida campos antes de chamar a API', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Informe o e-mail')).toBeInTheDocument()
    expect(f).not.toHaveBeenCalled()
  })

  it('redireciona o admin para /admin e grava a sessão', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      json(200, { token: 't', refreshToken: 'r', user: { role: 'admin', name: 'Ana' } }),
    )
    setup()
    await userEvent.type(screen.getByLabelText('E-mail'), 'ana@x.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'segredo')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    await waitFor(() => expect(screen.getByText('área admin')).toBeInTheDocument())
    expect(localStorage.getItem('saude_token')).toBe('t')
  })

  it('conta com MFA: pede o código e envia {ticket, code}', async () => {
    const f = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json(200, { mfa_required: true, mfa_ticket: 'tk-1' }))
      .mockResolvedValueOnce(json(200, { token: 't', refreshToken: 'r', user: { role: 'paciente' } }))
    setup()
    await userEvent.type(screen.getByLabelText('E-mail'), 'a@x.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'segredo')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))

    await userEvent.type(await screen.findByLabelText('Código'), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Verificar e entrar' }))

    await waitFor(() => expect(screen.getByText('área paciente')).toBeInTheDocument())
    const [url, init] = f.mock.calls[1]
    expect(String(url)).toContain('/auth/mfa/verify')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ ticket: 'tk-1', code: '123456' })
  })

  it('mostra o erro do servidor em credenciais inválidas', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(401, { error: 'Credenciais inválidas' }))
    setup()
    await userEvent.type(screen.getByLabelText('E-mail'), 'a@x.com')
    await userEvent.type(screen.getByLabelText('Senha'), 'errada')
    await userEvent.click(screen.getByRole('button', { name: 'Entrar' }))
    expect(await screen.findByText('Credenciais inválidas')).toBeInTheDocument()
  })
})

describe('cadastro', () => {
  async function preencherEtapa1(extra: { nascimento?: string } = {}) {
    await userEvent.click(screen.getByRole('tab', { name: 'Criar conta' }))
    await userEvent.type(screen.getByLabelText(/Nome completo/), 'Maria Silva')
    await userEvent.type(screen.getByLabelText(/Data de nascimento/), extra.nascimento ?? '1990-01-01')
    await userEvent.type(screen.getByLabelText(/CPF/), '52998224725')
    await userEvent.type(screen.getByLabelText(/Celular/), '87988887777')
  }

  it('aplica máscara e só avança com a etapa 1 válida', async () => {
    setup()
    await userEvent.click(screen.getByRole('tab', { name: 'Criar conta' }))
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(await screen.findByText('Informe seu nome completo.')).toBeInTheDocument()
    expect(screen.queryByLabelText(/E-mail/)).not.toBeInTheDocument()

    await preencherEtapa1()
    expect(screen.getByLabelText(/CPF/)).toHaveValue('529.982.247-25')
    expect(screen.getByLabelText(/Celular/)).toHaveValue('(87) 98888-7777')
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(await screen.findByLabelText(/Confirmar senha/)).toBeInTheDocument()
  })

  it('menor de idade exige responsável', async () => {
    setup()
    const ano = new Date().getFullYear() - 10
    await preencherEtapa1({ nascimento: `${ano}-01-01` })
    expect(await screen.findByLabelText(/responsável legal/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    expect(await screen.findByText(/responsável legal para menores/)).toBeInTheDocument()
  })

  it('envia o payload do legado e volta ao login com o e-mail preenchido', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(201, { message: 'Conta criada!' }))
    setup()
    await preencherEtapa1()
    await userEvent.click(screen.getByRole('button', { name: 'Continuar' }))
    await userEvent.type(await screen.findByLabelText(/E-mail/), 'maria@x.com')
    await userEvent.type(screen.getByLabelText(/^Senha/), 'secreta123')
    await userEvent.type(screen.getByLabelText(/Confirmar senha/), 'secreta123')
    await userEvent.click(screen.getByRole('button', { name: 'Criar conta' }))

    await waitFor(() => expect(screen.getByLabelText('E-mail')).toHaveValue('maria@x.com'))
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)).toMatchObject({
      role: 'paciente', email: 'maria@x.com', full_name: 'Maria Silva', cpf: '529.982.247-25',
      mobile: '(87) 98888-7777', guardian_name: null, job_role: null,
    })
  })
})

describe('recuperação de senha', () => {
  it('pede o link e mostra a mensagem da API', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(200, { message: 'Enviamos o link.' }))
    setup()
    await userEvent.click(screen.getByRole('button', { name: 'Esqueci minha senha' }))
    await userEvent.type(screen.getByLabelText('E-mail'), 'a@x.com')
    await userEvent.click(screen.getByRole('button', { name: 'Enviar link' }))
    expect(await screen.findByText('Enviamos o link.')).toBeInTheDocument()
    expect(String(f.mock.calls[0][0])).toContain('/auth/password/forgot')
  })

  it('link com token abre a nova senha e tira o token da URL', async () => {
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json(200, {}))
    setup('/auth?tab=reset&token=abc123')
    expect(screen.getByRole('form', { name: 'Criar nova senha' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/auth$/))

    await userEvent.type(screen.getByLabelText('Nova senha'), 'novasenha1')
    await userEvent.type(screen.getByLabelText('Repita a senha'), 'novasenha1')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }))

    await waitFor(() => expect(screen.getByRole('form', { name: 'Entrar na conta' })).toBeInTheDocument())
    expect(String(f.mock.calls[0][0])).toContain('/auth/password/reset')
    expect(JSON.parse((f.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      token: 'abc123', password: 'novasenha1',
    })
  })

  it('link de reset sem token cai no pedido do link', () => {
    setup('/auth?tab=reset')
    expect(screen.getByRole('form', { name: 'Pedir redefinição de senha' })).toBeInTheDocument()
  })

  it('senhas diferentes não chamam a API', async () => {
    const f = vi.spyOn(globalThis, 'fetch')
    setup('/auth?tab=reset&token=abc')
    await userEvent.type(screen.getByLabelText('Nova senha'), 'novasenha1')
    await userEvent.type(screen.getByLabelText('Repita a senha'), 'diferente1')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar nova senha' }))
    expect(await screen.findByText('As senhas não conferem.')).toBeInTheDocument()
    expect(f).not.toHaveBeenCalled()
  })
})
