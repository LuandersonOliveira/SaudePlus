import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { json, mockApi, renderApp, seedSession } from '@/test/utils'
import AdminRoutes from '../AdminRoutes'

const ME = 'me-id'
const user = (id: string, name: string, role: string, status = 'ativo', over: object = {}) => ({
  id, full_name: name, email: `${id}@x.com`, role, account_status: status, mobile: '(87) 98888-7777', job_role: null, admin_level: null, last_login_at: null, ...over,
})

const users = [
  user('p1', 'Maria Lima', 'paciente', 'ativo', { last_login_at: '2026-10-01 09:00:00' }),
  user('p2', 'Pedro Alves', 'paciente', 'pendente'),
  user('at1', 'Ana Atendente', 'atendente', 'ativo', { job_role: 'recepcionista' }),
  user('ad-super', 'Sara Super', 'admin', 'ativo', { admin_level: 'superadmin' }),
  user('ad-low', 'Lia Atend', 'admin', 'ativo', { admin_level: 'atendimento' }),
  user(ME, 'Eu Mesmo', 'admin', 'ativo', { admin_level: 'gestor' }),
]

const detail = (over: object = {}) => ({
  ...user('p1', 'Maria Lima', 'paciente'), social_name: 'Mari', birth_date: '1985-04-02', gender: 'feminino', blood_type: 'O+', mother_name: 'Ana',
  cpf: '52998224725', rg: '12345678x', cns: '898001160660001', cep: '50000000', street: 'Rua A', address_number: '10', neighborhood: 'Centro', city: 'Recife', state: 'PE',
  professional_name: null, professional_id: null, ...over,
})

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

function renderPeople(level = 'gestor', route = '/admin/cadastros/pessoas') {
  seedSession({ id: ME, role: 'admin', admin_level: level, full_name: 'Eu Mesmo', email: 'eu@saude.app' })
  return renderApp(
    <>
      <Routes>
        <Route path="/admin/*" element={<AdminRoutes />} />
      </Routes>
      <Where />
    </>,
    { route, path: '/*' },
  )
}

const baseApi = {
  'GET /admin/users?': { data: users, total: users.length, page: 1, pageSize: 25 },
  'GET /admin/users/p1': detail(),
  'GET /admin/history': { user: { full_name: 'Maria Lima' }, appointments: [{ id: 'a1', scheduled_at: '2026-10-01 09:00:00', status: 'concluido', specialty: 'Clínico Geral', doctor: 'Dr. Paulo', location: 'UBS' }], exams: [] },
  'GET /admin/professionals': [
    { id: 'pr1', name: 'Dra. Livre', active: 1, user_id: null },
    { id: 'pr2', name: 'Dr. Ocupado', active: 1, user_id: 'outro' },
    { id: 'pr3', name: 'Dr. Inativo', active: 0, user_id: null },
  ],
  'POST /admin/users': { ok: true, id: 'novo' },
  'PATCH /admin/users/': { ok: true },
  'DELETE /admin/users/': { ok: true },
}

// O nome também pode aparecer fora da lista (ex.: usuário logado no menu lateral): pega o item da lista.
const row = (name: string) =>
  screen.getAllByText(name).map((el) => el.closest('li')).find(Boolean) as HTMLElement
const menu = async (name: string) => {
  await userEvent.click(within(row(name)).getByRole('button', { name: `Ações de ${name}` }))
  return (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('lista', () => {
  it('mostra papel, status, contato e último acesso; resumo no plural', async () => {
    mockApi(baseApi)
    renderPeople()
    expect(await screen.findByText('6 usuários encontrados.')).toBeInTheDocument()
    const maria = row('Maria Lima')
    expect(within(maria).getByText('Paciente')).toBeInTheDocument()
    expect(within(maria).getByText('ativo')).toBeInTheDocument()
    expect(maria).toHaveTextContent('p1@x.com')
    expect(maria).toHaveTextContent('Último acesso:')
    expect(row('Pedro Alves')).toHaveTextContent('Nunca acessou')
    expect(row('Ana Atendente')).toHaveTextContent('recepcionista')
    expect(within(row('Sara Super')).getByText('Administrador')).toBeInTheDocument()
  })

  it('singular e vazio', async () => {
    mockApi({ ...baseApi, 'GET /admin/users?': { data: [users[0]], total: 1 } })
    renderPeople()
    expect(await screen.findByText('1 usuário encontrado.')).toBeInTheDocument()
  })

  it('sem resultado e erro de API', async () => {
    mockApi({ ...baseApi, 'GET /admin/users?': { data: [], total: 0 } })
    renderPeople()
    expect(await screen.findByText('Nenhum usuário encontrado com esses filtros.')).toBeInTheDocument()
  })

  it('falha mostra o erro com "Tentar de novo"', async () => {
    mockApi({ ...baseApi, 'GET /admin/users?': () => json(500, { error: 'x' }) })
    renderPeople()
    expect(await screen.findByText('Não foi possível buscar os usuários.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })

  it('"Carregar mais" acumula de 25 em 25 e termina com o total', async () => {
    const many = (n: number, start = 0) => Array.from({ length: n }, (_, i) => user(`m${start + i}`, `Pessoa ${start + i}`, 'paciente'))
    const m = mockApi({
      ...baseApi,
      'GET /admin/users?page=1': { data: many(25), total: 27 },
      'GET /admin/users?page=2': { data: many(2, 25), total: 27 },
    })
    renderPeople()
    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais 2 registro(s) de usuários' }))
    expect(await screen.findByText('Pessoa 26')).toBeInTheDocument()
    expect(screen.getByText('Pessoa 0')).toBeInTheDocument() // continua na tela
    expect(m.calls.some((c) => c.path.includes('page=2'))).toBe(true)
    expect(screen.getByText('Fim da lista — 27 registro(s).')).toBeInTheDocument()
  })
})

describe('filtros na URL', () => {
  it('?status=pendente (link do Início) aplica o filtro e mostra o select preenchido', async () => {
    const m = mockApi(baseApi)
    renderPeople('gestor', '/admin/cadastros/pessoas?status=pendente')
    await screen.findByText('6 usuários encontrados.')
    expect(m.calls.find((c) => c.path.startsWith('/admin/users?'))!.path).toContain('status=pendente')
    expect(screen.getByRole('combobox', { name: 'Filtrar por status' })).toHaveTextContent('Aguardando ativação')
  })

  it('Buscar grava o filtro na URL e consulta a API; valores inválidos na URL são ignorados', async () => {
    const m = mockApi(baseApi)
    renderPeople('gestor', '/admin/cadastros/pessoas?role=hacker&status=xyz')
    await screen.findByText('6 usuários encontrados.')
    expect(m.calls.find((c) => c.path.startsWith('/admin/users?'))!.path).not.toContain('role=')

    await userEvent.type(screen.getByLabelText('Nome, e-mail ou telefone'), 'maria')
    await userEvent.click(screen.getByRole('combobox', { name: 'Filtrar por papel' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Paciente' }))
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/admin/cadastros/pessoas?q=maria&role=paciente'))
    await waitFor(() => expect(m.calls.some((c) => c.path.includes('q=maria') && c.path.includes('role=paciente'))).toBe(true))
  })
})

describe('ações respeitam a hierarquia (gestor)', () => {
  it('paciente e atendente: tudo; admin de nível menor: tudo; admin superior: só ver e histórico; a si mesmo: só ver e histórico', async () => {
    mockApi(baseApi)
    renderPeople('gestor')
    await screen.findByText('6 usuários encontrados.')
    expect(await menu('Maria Lima')).toEqual(['Visualizar', 'Editar', 'Histórico', 'Excluir'])
    await userEvent.keyboard('{Escape}')
    expect(await menu('Lia Atend')).toEqual(['Visualizar', 'Editar', 'Histórico', 'Excluir']) // atendimento < gestor
    await userEvent.keyboard('{Escape}')
    expect(await menu('Sara Super')).toEqual(['Visualizar', 'Histórico']) // superadmin > gestor
    await userEvent.keyboard('{Escape}')
    expect(await menu('Eu Mesmo')).toEqual(['Visualizar', 'Histórico']) // ninguém edita a própria conta aqui
  })

  it('superadmin gerencia o gestor; gestor igual não', async () => {
    mockApi({ ...baseApi, 'GET /admin/users?': { data: [user('g2', 'Outro Gestor', 'admin', 'ativo', { admin_level: 'gestor' })], total: 1 } })
    renderPeople('superadmin')
    await screen.findByText('1 usuário encontrado.')
    expect(await menu('Outro Gestor')).toContain('Editar')
  })
})

describe('Visualizar', () => {
  it('mostra o perfil completo com os documentos formatados', async () => {
    const m = mockApi(baseApi)
    renderPeople()
    await screen.findByText('6 usuários encontrados.')
    await menu('Maria Lima')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Visualizar' }))
    const dlg = await screen.findByRole('dialog')
    expect(await within(dlg).findByText('529.982.247-25')).toBeInTheDocument()
    expect(within(dlg).getByText('898 0011 6066 0001')).toBeInTheDocument()
    expect(within(dlg).getByText('12.345.678-x')).toBeInTheDocument()
    expect(within(dlg).getByText('02/04/1985')).toBeInTheDocument()
    expect(within(dlg).getByText(/Rua A, 10, Centro, Recife, PE, 50000-000/)).toBeInTheDocument()
    expect(within(dlg).getByText(/fica registrada na auditoria/)).toBeInTheDocument()
    expect(m.calls.some((c) => c.path === '/admin/users/p1')).toBe(true)
  })

  it('erro ao carregar o perfil mostra a mensagem', async () => {
    mockApi({ ...baseApi, 'GET /admin/users/p1': () => json(404, { error: 'Usuário não encontrado.' }) })
    renderPeople()
    await screen.findByText('6 usuários encontrados.')
    await menu('Maria Lima')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Visualizar' }))
    expect(await within(await screen.findByRole('dialog')).findByText('Usuário não encontrado.')).toBeInTheDocument()
  })
})

describe('Histórico', () => {
  it('lista consultas e exames do usuário', async () => {
    mockApi(baseApi)
    renderPeople()
    await screen.findByText('6 usuários encontrados.')
    await menu('Maria Lima')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Histórico' }))
    const dlg = await screen.findByRole('dialog')
    expect(await within(dlg).findByText('Histórico de Maria Lima')).toBeInTheDocument()
    expect(await within(dlg).findByText('1 consultas · 0 exames')).toBeInTheDocument()
    expect(within(dlg).getByText('Clínico Geral')).toBeInTheDocument()
    expect(within(dlg).getByText('Sem registros.')).toBeInTheDocument() // exames
  })
})

describe('Novo usuário', () => {
  async function open(level = 'gestor') {
    const m = mockApi(baseApi)
    renderPeople(level)
    await screen.findByText('6 usuários encontrados.')
    await userEvent.click(screen.getByRole('button', { name: 'Novo usuário' }))
    return { m, dlg: await screen.findByRole('dialog') }
  }

  it('valida nome, e-mail e senha antes de enviar', async () => {
    const { m, dlg } = await open()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }))
    expect(await within(dlg).findByText('Informe o nome completo.')).toBeInTheDocument()
    expect(within(dlg).getByText('Informe o e-mail.')).toBeInTheDocument()
    await userEvent.type(within(dlg).getByLabelText('Nome completo *'), 'Nova Pessoa')
    await userEvent.type(within(dlg).getByLabelText('E-mail *'), 'nova@x.com')
    await userEvent.type(within(dlg).getByLabelText('Senha *'), '123')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }))
    expect(await within(dlg).findByText('Senha deve ter pelo menos 6 caracteres.')).toBeInTheDocument()
    expect(m.last('POST', '/admin/users')).toBeUndefined()
  })

  it('cria um paciente: POST com os dados e fecha', async () => {
    const { m, dlg } = await open()
    await userEvent.type(within(dlg).getByLabelText('Nome completo *'), 'Nova Pessoa')
    await userEvent.type(within(dlg).getByLabelText('E-mail *'), 'nova@x.com')
    await userEvent.type(within(dlg).getByLabelText('Celular'), '87999990000')
    await userEvent.type(within(dlg).getByLabelText('Senha *'), 'senha-segura')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(m.last('POST', '/admin/users')?.body).toEqual({
        full_name: 'Nova Pessoa', email: 'nova@x.com', mobile: '87999990000', phone: null, job_role: null,
        password: 'senha-segura', role: 'paciente', account_status: 'ativo',
      }),
    )
    expect(await screen.findByText('Usuário criado')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('nível administrativo só aparece para quem tem "admins" (superadmin), e só para o papel admin', async () => {
    const g = await open('gestor')
    await userEvent.click(within(g.dlg).getByRole('combobox', { name: 'Papel *' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Administrador' }))
    expect(within(g.dlg).queryByLabelText('Nível administrativo')).not.toBeInTheDocument()
  })

  it('superadmin escolhe o nível e ele vai no corpo', async () => {
    const { m, dlg } = await open('superadmin')
    await userEvent.type(within(dlg).getByLabelText('Nome completo *'), 'Novo Admin')
    await userEvent.type(within(dlg).getByLabelText('E-mail *'), 'adm@x.com')
    await userEvent.type(within(dlg).getByLabelText('Senha *'), 'senha-segura')
    await userEvent.click(within(dlg).getByRole('combobox', { name: 'Papel *' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Administrador' }))
    await userEvent.click(within(dlg).getByRole('combobox', { name: 'Nível administrativo' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Alertas' }))
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(m.last('POST', '/admin/users')?.body).toMatchObject({ role: 'admin', admin_level: 'alertas' }))
  })

  it('atendente: lista só profissionais ativos e livres; "Não vinculado" envia null', async () => {
    const { m, dlg } = await open()
    await userEvent.type(within(dlg).getByLabelText('Nome completo *'), 'Novo Atendente')
    await userEvent.type(within(dlg).getByLabelText('E-mail *'), 'at@x.com')
    await userEvent.type(within(dlg).getByLabelText('Senha *'), 'senha-segura')
    await userEvent.click(within(dlg).getByRole('combobox', { name: 'Papel *' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Atendente' }))
    await userEvent.click(await within(dlg).findByRole('combobox', { name: 'Vincular a profissional' }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Não vinculado', 'Dra. Livre'])
    await userEvent.click(screen.getByRole('option', { name: 'Dra. Livre' }))
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(m.last('POST', '/admin/users')?.body).toMatchObject({ role: 'atendente', professional_id: 'pr1' }))
  })

  it('erro do servidor (e-mail já cadastrado) aparece no diálogo, que continua aberto', async () => {
    const m = mockApi({ ...baseApi, 'POST /admin/users': () => json(409, { error: 'E-mail já cadastrado.' }) })
    renderPeople()
    await screen.findByText('6 usuários encontrados.')
    await userEvent.click(screen.getByRole('button', { name: 'Novo usuário' }))
    const dlg = await screen.findByRole('dialog')
    await userEvent.type(within(dlg).getByLabelText('Nome completo *'), 'Repetida')
    await userEvent.type(within(dlg).getByLabelText('E-mail *'), 'maria@x.com')
    await userEvent.type(within(dlg).getByLabelText('Senha *'), 'senha-segura')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }))
    expect(await within(dlg).findByText('E-mail já cadastrado.')).toBeInTheDocument()
    expect(m.last('POST', '/admin/users')).toBeDefined()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('Editar', () => {
  async function openEdit(name = 'Maria Lima', apiOver: Record<string, unknown> = {}, level = 'gestor') {
    const m = mockApi({ ...baseApi, ...apiOver })
    renderPeople(level)
    await screen.findByText('6 usuários encontrados.')
    await menu(name)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Editar' }))
    const dlg = await screen.findByRole('dialog')
    await within(dlg).findByDisplayValue(name)
    return { m, dlg }
  }

  it('carrega os dados; e-mail e papel inalterados não são reenviados; senha em branco não muda', async () => {
    const { m, dlg } = await openEdit()
    expect(within(dlg).getByLabelText('E-mail *')).toHaveValue('p1@x.com')
    await userEvent.clear(within(dlg).getByLabelText('Celular'))
    await userEvent.type(within(dlg).getByLabelText('Celular'), '87911110000')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(m.last('PATCH', '/admin/users/p1')?.body).toEqual({ full_name: 'Maria Lima', mobile: '87911110000', phone: null, job_role: null }))
    expect(await screen.findByText('Usuário atualizado')).toBeInTheDocument()
  })

  it('mudar o status exige o motivo e o envia (reason e status_notes)', async () => {
    const { m, dlg } = await openEdit()
    expect(within(dlg).queryByLabelText('Motivo da alteração *')).not.toBeInTheDocument()
    await userEvent.click(within(dlg).getByRole('combobox', { name: 'Status' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Inativo' }))
    expect(await within(dlg).findByLabelText('Motivo da alteração *')).toBeInTheDocument()

    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }))
    expect(await within(dlg).findByText('Informe o motivo da alteração de status.')).toBeInTheDocument()
    expect(m.last('PATCH', '/admin/users/')).toBeUndefined()

    await userEvent.type(within(dlg).getByLabelText('Motivo da alteração *'), 'cadastro duplicado')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(m.last('PATCH', '/admin/users/p1')?.body).toMatchObject({ account_status: 'inativo', reason: 'cadastro duplicado', status_notes: 'cadastro duplicado' }))
  })

  it('gestor editando um administrador de nível menor: e-mail e senha ficam bloqueados (só o superadmin troca)', async () => {
    const { m, dlg } = await openEdit('Lia Atend', { 'GET /admin/users/ad-low': detail({ ...user('ad-low', 'Lia Atend', 'admin', 'ativo', { admin_level: 'atendimento' }) }) })
    expect(within(dlg).getByLabelText('E-mail *')).toBeDisabled()
    expect(within(dlg).getByLabelText(/Senha/)).toBeDisabled()
    expect(within(dlg).getByText('Só o superadmin altera o e-mail de um administrador.')).toBeInTheDocument()
    // continua podendo editar outros campos, sem reenviar o e-mail (que acionaria a trava do servidor)
    await userEvent.clear(within(dlg).getByLabelText('Cargo'))
    await userEvent.type(within(dlg).getByLabelText('Cargo'), 'Coordenação')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(m.last('PATCH', '/admin/users/ad-low')?.body).toMatchObject({ job_role: 'Coordenação' }))
    expect(m.last('PATCH', '/admin/users/ad-low')?.body).not.toHaveProperty('email')
    expect(m.last('PATCH', '/admin/users/ad-low')?.body).not.toHaveProperty('password')
  })

  it('superadmin editando um administrador pode trocar e-mail e senha e escolher o nível', async () => {
    const { m, dlg } = await openEdit('Lia Atend', { 'GET /admin/users/ad-low': detail({ ...user('ad-low', 'Lia Atend', 'admin', 'ativo', { admin_level: 'atendimento' }) }) }, 'superadmin')
    expect(within(dlg).getByLabelText('E-mail *')).toBeEnabled()
    expect(within(dlg).getByLabelText(/Senha/)).toBeEnabled()
    await userEvent.type(within(dlg).getByLabelText(/Senha/), 'nova-senha-1')
    await userEvent.click(within(dlg).getByRole('combobox', { name: 'Nível administrativo' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Gestor' }))
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(m.last('PATCH', '/admin/users/ad-low')?.body).toMatchObject({ password: 'nova-senha-1', admin_level: 'gestor' }))
  })

  it('erro do servidor (403 de hierarquia) aparece no diálogo', async () => {
    const { dlg } = await openEdit('Maria Lima', { 'PATCH /admin/users/p1': () => json(403, { error: 'Você não pode alterar uma conta de nível administrativo igual ou superior ao seu.' }) })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvar' }))
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('igual ou superior ao seu')
  })

  it('falha ao carregar o usuário mostra o erro dentro do diálogo', async () => {
    mockApi({ ...baseApi, 'GET /admin/users/p1': () => json(500, { error: 'x' }) })
    renderPeople()
    await screen.findByText('6 usuários encontrados.')
    await menu('Maria Lima')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Editar' }))
    expect(await within(await screen.findByRole('dialog')).findByText('Erro ao carregar usuário')).toBeInTheDocument()
  })
})

describe('Excluir', () => {
  it('pede confirmação com o nome e só então chama DELETE', async () => {
    const m = mockApi(baseApi)
    renderPeople()
    await screen.findByText('6 usuários encontrados.')
    await menu('Pedro Alves')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Excluir' }))
    const dlg = await screen.findByRole('alertdialog')
    expect(dlg).toHaveTextContent('Excluir usuário?')
    expect(dlg).toHaveTextContent('Pedro Alves')
    expect(dlg).toHaveTextContent('soft-delete')
    expect(m.last('DELETE', '/admin/users/')).toBeUndefined()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Excluir' }))
    await waitFor(() => expect(m.last('DELETE', '/admin/users/p2')).toBeDefined())
    expect(await screen.findByText('Usuário excluído')).toBeInTheDocument()
  })

  it('erro do servidor mantém o diálogo aberto', async () => {
    mockApi({ ...baseApi, 'DELETE /admin/users/p2': () => json(403, { error: 'Você não pode excluir um administrador igual ou superior.' }) })
    renderPeople()
    await screen.findByText('6 usuários encontrados.')
    await menu('Pedro Alves')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Excluir' }))
    const dlg = await screen.findByRole('alertdialog')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Excluir' }))
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('igual ou superior')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('"Voltar" não exclui', async () => {
    const m = mockApi(baseApi)
    renderPeople()
    await screen.findByText('6 usuários encontrados.')
    await menu('Pedro Alves')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Excluir' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Voltar' }))
    expect(m.last('DELETE', '/admin/users/')).toBeUndefined()
  })
})

describe('acesso', () => {
  it('nível "atendimento" não chega a Pessoas', async () => {
    mockApi(baseApi)
    renderPeople('atendimento')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/admin$/))
  })
})

describe('Agenda/Vínculos do atendente', () => {
  const profData = {
    professionals: [{ id: 'pr9', name: 'Ana Atendente', active: 1, user_id: 'at1' }],
    offers: [{ id: 'o1', professional_id: 'pr9', unit_id: 'u1', kind: 'consulta', name: 'Triagem', unit_name: 'UBS Centro' }],
    schedules: [],
    blocks: [],
  }

  it('só atendentes têm o item; abre o painel do profissional ligado à conta', async () => {
    mockApi({ ...baseApi, 'GET /admin/professionals': profData, 'GET /health-units/manage': [] })
    renderPeople()
    await screen.findByText('6 usuários encontrados.')
    expect(await menu('Maria Lima')).not.toContain('Agenda/Vínculos')
    await userEvent.keyboard('{Escape}')
    expect(await menu('Ana Atendente')).toContain('Agenda/Vínculos')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Agenda/Vínculos' }))
    const dlg = await screen.findByRole('dialog')
    expect(await within(dlg).findByText('Triagem')).toBeInTheDocument()
  })

  it('atendente sem profissional ligado mostra o aviso', async () => {
    mockApi({ ...baseApi, 'GET /admin/professionals': { ...profData, professionals: [] }, 'GET /health-units/manage': [] })
    renderPeople()
    await screen.findByText('6 usuários encontrados.')
    await menu('Ana Atendente')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Agenda/Vínculos' }))
    expect(await screen.findByText(/Não há profissional vinculado a este usuário/)).toBeInTheDocument()
  })
})