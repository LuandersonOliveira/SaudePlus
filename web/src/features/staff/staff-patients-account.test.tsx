import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { json, mockApi, renderApp, seedSession } from '@/test/utils'
import { AccountPage } from './pages/AccountPage'
import { PatientsPage } from './pages/PatientsPage'

beforeEach(() => {
  localStorage.clear()
  seedSession()
})
afterEach(() => vi.restoreAllMocks())

describe('Buscar paciente', () => {
  it('busca vazia mostra o erro no campo e não chama a API', async () => {
    const m = mockApi({})
    renderApp(<PatientsPage />)
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(await screen.findByText('Digite o nome ou o e-mail do paciente para buscar.')).toBeInTheDocument()
    expect(screen.getByLabelText('Nome ou e-mail do paciente')).toHaveAttribute('aria-invalid', 'true')
    expect(m.calls).toHaveLength(0)
  })

  it('conta inativa/pendente é sinalizada e não abre histórico', async () => {
    mockApi({
      'GET /staff/patients?q=maria': [
        { id: 'p1', full_name: 'Maria Lima', email: 'maria@x.com', phone: '(87) 3333-4444', birth_date: '1980-05-02', account_status: 'ativo' },
        { id: 'p2', full_name: "Maria d'Ávila", email: 'm2@x.com', account_status: 'inativo' },
        { id: 'p3', full_name: 'Maria Nova', email: 'm3@x.com', account_status: 'pendente' },
      ],
    })
    renderApp(<PatientsPage />)
    await userEvent.type(screen.getByLabelText('Nome ou e-mail do paciente'), 'maria')
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }))

    expect(await screen.findByText('Conta inativa')).toBeInTheDocument()
    expect(screen.getByText('Conta pendente de ativação')).toBeInTheDocument()
    // nome com apóstrofo: o legado quebrava o onclick; aqui é só texto
    expect(screen.getByText("Maria d'Ávila")).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Ver histórico/ })).toHaveLength(1)
  })

  it('sem resultado mostra a mensagem; erro da API aparece como alerta', async () => {
    mockApi({
      'GET /staff/patients?q=nada': [],
      'GET /staff/patients?q=erro': () => json(500, { error: 'x' }),
    })
    renderApp(<PatientsPage />)
    const input = screen.getByLabelText('Nome ou e-mail do paciente')
    await userEvent.type(input, 'nada')
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(await screen.findByText('Nenhum paciente encontrado.')).toBeInTheDocument()

    await userEvent.clear(input)
    await userEvent.type(input, 'erro')
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao buscar pacientes')
  })

  it('Ver histórico carrega consultas e exames do paciente', async () => {
    const m = mockApi({
      'GET /staff/patients/p1/history': {
        user: { full_name: 'Maria Lima', birth_date: '1980-05-02', gender: 'feminino', blood_type: 'O+', mobile: '(87) 98888-7777' },
        appointments: [{ id: 'a1', scheduled_at: '2026-10-01 09:00:00', status: 'concluido', specialty: 'Clínico Geral', doctor: 'Dr. Paulo', location: 'UBS' }],
        exams: [],
      },
      'GET /staff/patients?q=maria': [{ id: 'p1', full_name: 'Maria Lima', email: 'maria@x.com', account_status: 'ativo' }],
    })
    renderApp(<PatientsPage />)
    await userEvent.type(screen.getByLabelText('Nome ou e-mail do paciente'), 'maria')
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Ver histórico de Maria Lima' }))

    expect(await screen.findByText('1 consultas · 0 exames')).toBeInTheDocument()
    expect(screen.getByText(/Tipo sanguíneo: O\+/)).toBeInTheDocument()
    expect(screen.getByText('Sem registros.')).toBeInTheDocument() // exames vazios
    expect(m.last('GET', '/staff/patients/p1/history')).toBeDefined()
  })
})

const me = {
  user: {
    full_name: 'Ana Souza', social_name: '', birth_date: '1990-03-10', gender: 'feminino', job_role: 'tecnico_enfermagem',
    cpf: null, rg: null, cns: null, mobile: '(87) 98888-7777', phone: '', cep: '', street: '', city: 'Lagoa de Itaenga', state: 'PE',
  },
}

const accountApi = () =>
  mockApi({
    'GET /auth/me/export': { privacy_version: 'v1-2026-10-09', profile: { consent_at: '2026-10-01 10:00:00' } },
    'GET /auth/me': me,
    'GET /public/dpo': { configured: true, name: 'Dra. Rita', email: 'dpo@lagoa.pe.gov.br' },
    'PUT /auth/me': { ok: true },
  })

describe('Minha conta', () => {
  it('carrega o perfil, o cargo formatado, a completude, o consentimento e o DPO', async () => {
    accountApi()
    renderApp(<AccountPage />)
    expect(await screen.findByDisplayValue('Ana Souza')).toBeInTheDocument()
    expect(screen.getByLabelText('Cargo / Função')).toHaveValue('Técnico(a) de Enfermagem')
    expect(screen.getByLabelText('Cargo / Função')).toBeDisabled()
    // 4 de 11 campos rastreados (birth_date, gender, city, state)
    expect(screen.getByText('36%')).toBeInTheDocument()
    expect(await screen.findByText('v1-2026-10-09')).toBeInTheDocument()
    expect(await screen.findByText('Dra. Rita — dpo@lagoa.pe.gov.br')).toBeInTheDocument()
  })

  it('CPF inválido bloqueia o envio e mostra o erro no campo', async () => {
    const m = accountApi()
    renderApp(<AccountPage />)
    await screen.findByDisplayValue('Ana Souza')
    await userEvent.type(screen.getByLabelText('CPF'), '11111111111')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }))
    expect(await screen.findByText('CPF inválido. Confira os números digitados.')).toBeInTheDocument()
    expect(m.last('PUT', '/auth/me')).toBeUndefined()
  })

  it('salvar envia PUT parcial: CPF/RG/CNS em branco são omitidos; campo apagado vai como ""', async () => {
    const m = accountApi()
    renderApp(<AccountPage />)
    const nome = await screen.findByDisplayValue('Ana Souza')
    await userEvent.clear(nome)
    await userEvent.type(nome, 'Ana Souza Lima')
    await userEvent.clear(screen.getByLabelText('Cidade'))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }))

    await waitFor(() => expect(m.last('PUT', '/auth/me')).toBeDefined())
    const body = m.last('PUT', '/auth/me')!.body as Record<string, unknown>
    expect(body.full_name).toBe('Ana Souza Lima')
    expect(body.city).toBe('') // apagado = limpar
    expect(body).not.toHaveProperty('cpf')
    expect(body).not.toHaveProperty('rg')
    expect(body).not.toHaveProperty('cns')
    expect(await screen.findByText('Perfil atualizado')).toBeInTheDocument()
  })

  it('CPF válido é enviado com a máscara', async () => {
    const m = accountApi()
    renderApp(<AccountPage />)
    await screen.findByDisplayValue('Ana Souza')
    await userEvent.type(screen.getByLabelText('CPF'), '52998224725')
    expect(screen.getByLabelText('CPF')).toHaveValue('529.982.247-25')
    await userEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }))
    await waitFor(() => expect(m.last('PUT', '/auth/me')?.body).toMatchObject({ cpf: '529.982.247-25' }))
  })

  it('excluir conta exige a senha, envia no corpo do DELETE e encerra a sessão', async () => {
    const m2 = mockApi({
      'GET /auth/me/export': { privacy_version: 'v1' },
      'GET /auth/me': me,
      'GET /public/dpo': { configured: false },
      'DELETE /auth/me': { ok: true },
      'POST /auth/logout': {},
    })
    renderApp(
      <Routes>
        <Route path="/" element={<AccountPage />} />
        <Route path="/home" element={<p>landing</p>} />
      </Routes>,
      { route: '/', path: '/*' },
    )
    await screen.findByDisplayValue('Ana Souza')
    await userEvent.click(screen.getByRole('button', { name: 'Excluir minha conta…' }))
    const dialog = await screen.findByRole('alertdialog')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir conta' }))
    expect(await within(dialog).findByText('Informe sua senha.')).toBeInTheDocument()
    expect(m2.last('DELETE', '/auth/me')).toBeUndefined()

    await userEvent.type(within(dialog).getByLabelText('Senha'), 'minha-senha-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir conta' }))
    await waitFor(() => expect(m2.last('DELETE', '/auth/me')?.body).toEqual({ password: 'minha-senha-1' }))
    await waitFor(() => expect(localStorage.getItem('saude_token')).toBeNull())
  })

  it('senha errada mantém o diálogo aberto com a mensagem do servidor', async () => {
    mockApi({
      'GET /auth/me/export': { privacy_version: 'v1' },
      'GET /auth/me': me,
      'GET /public/dpo': { configured: false },
      'DELETE /auth/me': () => json(401, { error: 'Senha incorreta.' }),
    })
    renderApp(<AccountPage />)
    await screen.findByDisplayValue('Ana Souza')
    await userEvent.click(screen.getByRole('button', { name: 'Excluir minha conta…' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.type(within(dialog).getByLabelText('Senha'), 'errada')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir conta' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Senha incorreta.')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
