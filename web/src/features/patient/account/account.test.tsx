import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { json, mockApi, renderApp, seedSession } from '@/test/utils'
import PatientRoutes from '../PatientRoutes'
import { patientCompleteness } from './logic'

const baseUser = {
  full_name: 'Maria Lima', social_name: '', birth_date: '1985-04-02', gender: 'feminino', mother_name: 'Ana Lima', father_name: '',
  cpf: null, rg: null, cns: null, mobile: '(87) 98888-7777', phone: '', blood_type: '', priority: '', race: '',
  cep: '', street: '', address_number: '', neighborhood: '', city: 'Lagoa de Itaenga', state: 'PE', zone: '', reference_point: '',
  totp_enabled: 0,
}

function setup(user: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const state = { me: { ...baseUser, ...user } }
  const m = mockApi({
    'GET /auth/me/export': { privacy_version: 'v1-2026-10-09', profile: { consent_at: '2026-10-01 10:00:00' } },
    'GET /auth/me': () => ({ user: state.me }),
    'GET /public/dpo': { configured: true, name: 'Dra. Rita', email: 'dpo@lagoa.pe.gov.br' },
    'PUT /auth/me': { ok: true },
    ...extra,
  })
  renderApp(
    <Routes>
      <Route path="/dashboard/*" element={<PatientRoutes />} />
      <Route path="/" element={<p>landing</p>} />
    </Routes>,
    { route: '/dashboard/conta', path: '/*' },
  )
  return { m, state }
}

const profile = () => screen.getByRole('form', { name: 'Meu perfil' })
const putBody = (m: ReturnType<typeof mockApi>) => m.last('PUT', '/auth/me')?.body as Record<string, unknown>

beforeEach(() => {
  localStorage.clear()
  seedSession({ id: 'p1', role: 'paciente', full_name: 'Maria Lima', email: 'maria@x.com' })
})
afterEach(() => vi.restoreAllMocks())

describe('patientCompleteness', () => {
  it('conta os 12 campos opcionais rastreados', () => {
    expect(patientCompleteness({})).toBe(0)
    expect(patientCompleteness({ gender: 'feminino', mother_name: 'Ana', cns: '1', zone: 'urbana' })).toBe(Math.round((4 / 12) * 100))
    expect(patientCompleteness({ social_name: '  ', rg: null })).toBe(0)
  })
})

describe('Perfil', () => {
  it('carrega os dados, mostra o progresso e as seções de privacidade e DPO', async () => {
    setup()
    expect(await screen.findByDisplayValue('Maria Lima')).toBeInTheDocument()
    expect(within(profile()).getByLabelText(/Nome da mãe/)).toHaveValue('Ana Lima')
    expect(within(profile()).getByLabelText('Celular *')).toHaveValue('(87) 98888-7777')
    // gender + mother_name preenchidos = 2 de 12
    expect(screen.getByText('17%')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Progresso do preenchimento do perfil' })).toBeInTheDocument()
    expect(await screen.findByText('Dra. Rita — dpo@lagoa.pe.gov.br')).toBeInTheDocument()
    expect(screen.getByText(/Cada acesso da equipe a documentos pessoais/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ler a Política de Privacidade' })).toHaveAttribute('href', '/privacy')
  })

  it('menor de 18 anos mostra o responsável legal e o exige', async () => {
    const { m } = setup({ birth_date: `${new Date().getFullYear() - 10}-01-01` })
    await screen.findByDisplayValue('Maria Lima')
    const resp = within(profile()).getByLabelText('Responsável legal *')
    await userEvent.click(within(profile()).getByRole('button', { name: 'Salvar perfil' }))
    expect(await screen.findByText('Informe o nome do responsável legal para menores de 18 anos.')).toBeInTheDocument()
    expect(m.last('PUT', '/auth/me')).toBeUndefined()

    await userEvent.type(resp, 'João Lima')
    await userEvent.click(within(profile()).getByRole('button', { name: 'Salvar perfil' }))
    await waitFor(() => expect(putBody(m)).toMatchObject({ guardian_name: 'João Lima' }))
  })

  it('adulto não vê o campo de responsável', async () => {
    setup()
    await screen.findByDisplayValue('Maria Lima')
    expect(within(profile()).queryByLabelText('Responsável legal *')).not.toBeInTheDocument()
  })

  it('CPF, CNS e CEP inválidos bloqueiam o envio com a mensagem em cada campo', async () => {
    const { m } = setup()
    await screen.findByDisplayValue('Maria Lima')
    await userEvent.type(within(profile()).getByLabelText('CPF *'), '11111111111')
    await userEvent.type(within(profile()).getByLabelText('Cartão SUS (CNS)'), '123')
    await userEvent.type(within(profile()).getByLabelText('CEP'), '5000')
    await userEvent.click(within(profile()).getByRole('button', { name: 'Salvar perfil' }))
    expect(await screen.findByText('CPF inválido. Confira os números digitados.')).toBeInTheDocument()
    expect(screen.getByText('Cartão SUS inválido. Confira os 15 números do cartão.')).toBeInTheDocument()
    expect(screen.getByText('O CEP precisa ter 8 dígitos.')).toBeInTheDocument()
    expect(m.last('PUT', '/auth/me')).toBeUndefined()
  })

  it('salvar: PUT parcial — CPF/RG/CNS vazios omitidos, campo apagado vai "", máscaras aplicadas', async () => {
    const { m } = setup()
    await screen.findByDisplayValue('Maria Lima')
    await userEvent.clear(within(profile()).getByLabelText('Cidade'))
    await userEvent.type(within(profile()).getByLabelText('RG'), '12345678x')
    expect(within(profile()).getByLabelText('RG')).toHaveValue('12.345.678-x')
    await userEvent.click(within(profile()).getByRole('button', { name: 'Salvar perfil' }))

    await waitFor(() => expect(putBody(m)).toBeDefined())
    const body = putBody(m)
    expect(body.city).toBe('') // apagado = limpar
    expect(body.rg).toBe('12.345.678-x')
    expect(body).not.toHaveProperty('cpf')
    expect(body).not.toHaveProperty('cns')
    expect(body).toMatchObject({ full_name: 'Maria Lima', mother_name: 'Ana Lima', mobile: '(87) 98888-7777', state: 'PE' })
    expect(await screen.findByText('Perfil salvo')).toBeInTheDocument()
  })

  it('selects de saúde: escolher envia o valor; a opção vazia limpa o campo', async () => {
    const { m } = setup({ blood_type: 'A+' })
    await screen.findByDisplayValue('Maria Lima')
    await userEvent.click(within(profile()).getByRole('combobox', { name: 'Tipo sanguíneo' }))
    await userEvent.click(await screen.findByRole('option', { name: 'O+' }))
    await userEvent.click(within(profile()).getByRole('combobox', { name: 'Prioridade legal' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Gestante' }))
    await userEvent.click(within(profile()).getByRole('combobox', { name: 'Gênero' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Selecione...' }))
    await userEvent.click(within(profile()).getByRole('button', { name: 'Salvar perfil' }))
    await waitFor(() => expect(putBody(m)).toMatchObject({ blood_type: 'O+', priority: 'gestante', gender: '' }))
  })

  it('CEP preenche rua, bairro, cidade e UF pelo ViaCEP; CEP inexistente avisa', async () => {
    const { m } = setup({}, {
      'GET https://viacep.com.br/ws/50000000/json/': { logradouro: 'Rua das Flores', bairro: 'Centro', localidade: 'Recife', uf: 'pe' },
      'GET https://viacep.com.br/ws/99999999/json/': { erro: true },
    })
    await screen.findByDisplayValue('Maria Lima')
    const cep = within(profile()).getByLabelText('CEP')
    await userEvent.type(cep, '50000000')
    await userEvent.tab()
    await waitFor(() => expect(within(profile()).getByLabelText('Rua / Logradouro')).toHaveValue('Rua das Flores'))
    expect(within(profile()).getByLabelText('Bairro')).toHaveValue('Centro')
    expect(within(profile()).getByLabelText('Cidade')).toHaveValue('Recife')
    expect(within(profile()).getByLabelText('UF')).toHaveValue('PE')

    await userEvent.clear(cep)
    await userEvent.type(cep, '99999999')
    await userEvent.tab()
    expect(await screen.findByText('CEP não encontrado.')).toBeInTheDocument()
    expect(m.calls.filter((c) => c.path.startsWith('https://viacep')).length).toBe(2)
  })

  it('erro ao salvar mostra a mensagem do servidor', async () => {
    setup({}, { 'PUT /auth/me': () => json(400, { error: 'CPF já cadastrado.' }) })
    await screen.findByDisplayValue('Maria Lima')
    await userEvent.click(within(profile()).getByRole('button', { name: 'Salvar perfil' }))
    expect(await screen.findByText('CPF já cadastrado.')).toBeInTheDocument()
  })
})

describe('MFA', () => {
  it('ativar: senha → segredo → código de 6 dígitos → ativada (status e botão mudam)', async () => {
    const { m, state } = setup({}, {
      'POST /auth/mfa/setup': { secret: 'JBSWY3DPEHPK3PXP' },
      'POST /auth/mfa/enable': () => { state.me = { ...state.me, totp_enabled: 1 }; return { ok: true } },
    })
    expect(await screen.findByText('Desativada. Recomendado para atendentes e administradores.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Ativar verificação em 2 etapas' }))

    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gerar segredo' }))
    expect(await within(dialog).findByText('Informe sua senha.')).toBeInTheDocument()
    expect(m.last('POST', '/auth/mfa/setup')).toBeUndefined()

    await userEvent.type(within(dialog).getByLabelText('Senha'), 'minha-senha-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gerar segredo' }))
    await waitFor(() => expect(m.last('POST', '/auth/mfa/setup')?.body).toEqual({ password: 'minha-senha-1' }))
    expect(await screen.findByLabelText('Segredo do autenticador')).toHaveTextContent('JBSWY3DPEHPK3PXP')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await userEvent.type(screen.getByLabelText(/Digite o código de 6 dígitos/), '12')
    await userEvent.click(screen.getByRole('button', { name: 'Ativar' }))
    expect(await screen.findByText('Digite o código de 6 dígitos.')).toBeInTheDocument()
    expect(m.last('POST', '/auth/mfa/enable')).toBeUndefined()

    await userEvent.type(screen.getByLabelText(/Digite o código de 6 dígitos/), '3456')
    await userEvent.click(screen.getByRole('button', { name: 'Ativar' }))
    await waitFor(() => expect(m.last('POST', '/auth/mfa/enable')?.body).toEqual({ code: '123456' }))
    expect(await screen.findByText('Ativada. O login exige o código do app autenticador.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Desativar' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Segredo do autenticador')).not.toBeInTheDocument()
  })

  it('senha errada ao ativar mantém o diálogo aberto com a mensagem e não mostra segredo', async () => {
    setup({}, { 'POST /auth/mfa/setup': () => json(401, { error: 'Senha incorreta.' }) })
    await userEvent.click(await screen.findByRole('button', { name: 'Ativar verificação em 2 etapas' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Senha'), 'errada')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Gerar segredo' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Senha incorreta.')
    expect(screen.queryByLabelText('Segredo do autenticador')).not.toBeInTheDocument()
  })

  it('código errado mostra o erro do servidor e mantém o segredo para tentar de novo', async () => {
    setup({}, {
      'POST /auth/mfa/setup': { secret: 'ABC' },
      'POST /auth/mfa/enable': () => json(400, { error: 'Código inválido ou expirado.' }),
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Ativar verificação em 2 etapas' }))
    await userEvent.type(within(await screen.findByRole('dialog')).getByLabelText('Senha'), 'minha-senha-1')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Gerar segredo' }))
    await userEvent.type(await screen.findByLabelText(/Digite o código de 6 dígitos/), '123456')
    await userEvent.click(screen.getByRole('button', { name: 'Ativar' }))
    expect(await screen.findByText('Código inválido ou expirado.')).toBeInTheDocument()
    expect(screen.getByLabelText('Segredo do autenticador')).toBeInTheDocument()
  })

  it('desativar pede a senha e chama /auth/mfa/disable', async () => {
    const { m, state } = setup({ totp_enabled: 1 }, {
      'POST /auth/mfa/disable': () => { state.me = { ...state.me, totp_enabled: 0 }; return { ok: true } },
    })
    expect(await screen.findByText('Ativada. O login exige o código do app autenticador.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Desativar' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Senha'), 'minha-senha-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Desativar' }))
    await waitFor(() => expect(m.last('POST', '/auth/mfa/disable')?.body).toEqual({ password: 'minha-senha-1' }))
    expect(await screen.findByText('Desativada. Recomendado para atendentes e administradores.')).toBeInTheDocument()
  })
})

describe('LGPD', () => {
  it('mostra versão e data do consentimento e baixa os dados em JSON', async () => {
    const createUrl = vi.fn(() => 'blob:x')
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    setup()
    expect(await screen.findByText('v1-2026-10-09')).toBeInTheDocument()
    expect(screen.getByText(/Consentimento registrado em:/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Baixar meus dados (JSON)' }))
    expect(await screen.findByText('Dados baixados')).toBeInTheDocument()
    expect(createUrl).toHaveBeenCalledWith(expect.any(Blob))
    expect(click).toHaveBeenCalled()
  })

  it('excluir a conta envia a senha no corpo, encerra a sessão e volta à landing', async () => {
    const { m } = setup({}, { 'DELETE /auth/me': { ok: true }, 'POST /auth/logout': {} })
    await userEvent.click(await screen.findByRole('button', { name: 'Excluir minha conta…' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.type(within(dialog).getByLabelText('Senha'), 'minha-senha-1')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Excluir conta' }))
    await waitFor(() => expect(m.last('DELETE', '/auth/me')?.body).toEqual({ password: 'minha-senha-1' }))
    await waitFor(() => expect(localStorage.getItem('saude_token')).toBeNull())
  })
})

describe('Banner "Complete seu perfil" no Início', () => {
  const renderHome = (user: Record<string, unknown>) => {
    const m = mockApi({
      'GET /me/appointments': [], 'GET /me/exams': [], 'GET /diseases': [], 'GET /me/reminders': [],
      'GET /auth/me': { user },
    })
    renderApp(
      <Routes>
        <Route path="/dashboard/*" element={<PatientRoutes />} />
      </Routes>,
      { route: '/dashboard', path: '/*' },
    )
    return m
  }

  it('perfil incompleto mostra o percentual e leva a Minha conta', async () => {
    renderHome(baseUser)
    expect(await screen.findByText('Complete seu perfil (17%)')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Completar agora' })).toHaveAttribute('href', '/dashboard/conta')
  })

  it('perfil 100% completo não mostra o banner', async () => {
    const m = renderHome({
      social_name: 'x', gender: 'f', mother_name: 'x', father_name: 'x', rg: 'x', cns: 'x', phone: 'x', blood_type: 'x',
      priority: 'x', race: 'x', cep: 'x', zone: 'x',
    })
    await screen.findByText('Próximos eventos')
    // Espera o perfil chegar de verdade: sem isso a ausência do banner seria trivial (ele também some enquanto carrega).
    await waitFor(() => expect(m.calls.some((c) => c.path === '/auth/me')).toBe(true))
    await new Promise((r) => setTimeout(r, 150))
    expect(screen.queryByText(/Complete seu perfil/)).not.toBeInTheDocument()
  })
})
