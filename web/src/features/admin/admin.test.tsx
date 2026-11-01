import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, localDateStr } from '@/features/staff/logic'
import * as api from '@/lib/api'
import { json, mockApi, renderApp, seedSession } from '@/test/utils'
import AdminRoutes from './AdminRoutes'

const today = localDateStr()

const stats = { users: { total: 10, pending: 3, inactive: 1 }, units: { total: 12, active: 10 }, diseases: { total: 5, active: 4 } }
const booking = (id: string, at: string, status = 'pendente') => ({ id, scheduled_at: `${at} 09:00:00`, status, user_name: 'Maria' })
const audit = (n: number, over: object = {}) =>
  Array.from({ length: n }, (_, i) => ({ id: `a${i}`, action: 'admin_update', entity_type: 'appointment', details: `detalhe ${i}`, created_at: `${today} 10:00:00`, actor_name: 'Ana Admin', ...over }))

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname + l.search}</p>
}

function renderAdmin(level: string | null, route = '/admin') {
  seedSession({ id: 'a1', role: 'admin', admin_level: level, full_name: 'Ana Admin', email: 'ana@saude.app' })
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
  'GET /admin/stats': stats,
  'GET /admin/appointments': { data: [booking('1', today), booking('2', today, 'confirmado'), booking('3', addDays(today, 1))], total: 3 },
  'GET /admin/exams': { data: [booking('4', today)], total: 1 },
  'GET /admin/audit-log?limit=5': audit(2),
  'GET /admin/audit-log': { data: audit(2), total: 2 },
  'GET /admin/audit-log/verify': { ok: true, checked: 42, head: 'abcdef0123456789ffff' },
}

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

const nav = () => within(screen.getByRole('navigation', { name: 'Navegação administrativa' }))

describe('menu por nível administrativo', () => {
  it.each([
    ['superadmin', ['Início', 'Atendimentos', 'Cadastros', 'Auditoria', 'Minha conta']],
    ['gestor', ['Início', 'Atendimentos', 'Cadastros', 'Auditoria', 'Minha conta']],
    ['atendimento', ['Início', 'Atendimentos', 'Minha conta']],
    ['alertas', ['Início', 'Cadastros', 'Minha conta']],
    [null, ['Início', 'Minha conta']], // sem nível: fail-closed
  ])('%s vê só o que pode', async (level, labels) => {
    mockApi(baseApi)
    renderAdmin(level)
    await screen.findByText('Painel administrativo')
    expect(nav().getAllByRole('link').map((l) => l.textContent?.replace(/\d+$/, ''))).toEqual(labels)
  })

  it('mostra o nível no selo do usuário', async () => {
    mockApi(baseApi)
    renderAdmin('gestor')
    expect(await screen.findByText('gestor')).toBeInTheDocument()
  })
})

describe('seções proibidas voltam ao Início', () => {
  it('atendimento tentando /admin/auditoria', async () => {
    mockApi(baseApi)
    renderAdmin('atendimento', '/admin/auditoria')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/admin$/))
  })
  it('alertas tentando Atendimentos e Pessoas', async () => {
    mockApi(baseApi)
    renderAdmin('alertas', '/admin/atendimentos')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/admin$/))
  })
  it('alertas em /admin/cadastros cai direto em Doenças (única sub-aba permitida)', async () => {
    mockApi(baseApi)
    renderAdmin('alertas', '/admin/cadastros')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/admin/cadastros/doencas'))
    expect(screen.getByRole('tab', { name: 'Doenças e alertas' })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Pessoas' })).not.toBeInTheDocument()
  })
  it('alertas acessando /admin/cadastros/pessoas é levado à primeira sub-aba permitida', async () => {
    mockApi(baseApi)
    renderAdmin('alertas', '/admin/cadastros/pessoas')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/admin\/cadastros\/doencas$/))
    expect(screen.queryByRole('tab', { name: 'Pessoas' })).not.toBeInTheDocument()
  })
  it('gestor vê as três sub-abas e a de Pessoas abre por padrão', async () => {
    mockApi(baseApi)
    renderAdmin('gestor', '/admin/cadastros')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/admin/cadastros/pessoas'))
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Pessoas', 'Rede de saúde', 'Doenças e alertas'])
  })
})

describe('endereço inexistente', () => {
  it('dentro de /admin volta ao Início (não deixa página em branco)', async () => {
    mockApi(baseApi)
    renderAdmin('gestor', '/admin/inexistente-xyz')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/admin$/))
    expect(await screen.findByText('Precisa da sua atenção')).toBeInTheDocument()
  })
})

describe('Visão geral', () => {
  it('gestor: quatro números, pendentes de hoje somando consultas e exames', async () => {
    mockApi(baseApi)
    renderAdmin('gestor')
    const card = async (label: string) => (await screen.findByText(label)).closest('[data-slot=card]') as HTMLElement
    // hoje: consulta pendente (1) + exame pendente (1) = 2 (o confirmado e o de amanhã não contam)
    await waitFor(async () => expect(await card('Hoje (pendentes)')).toHaveTextContent('2'))
    expect(await card('Aguardando ativação')).toHaveTextContent('3')
    expect(await card('Alertas ativos')).toHaveTextContent('4')
    expect(await card('Unidades ativas')).toHaveTextContent('10')
  })

  it('pendências com ação: contas, agenda e unidades inativas (sem botão)', async () => {
    mockApi(baseApi)
    renderAdmin('gestor')
    expect(await screen.findByText('3 conta(s) aguardando ativação')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver contas' })).toHaveAttribute('href', '/admin/cadastros/pessoas?status=pendente')
    expect(await screen.findByText('2 atendimento(s) pendente(s) hoje')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver agenda' })).toHaveAttribute('href', '/admin/atendimentos')
    const unidades = screen.getByText('2 unidade(s) inativa(s)').closest('li')!
    expect(within(unidades).queryByRole('link')).not.toBeInTheDocument()
  })

  it('sem pendências mostra a mensagem', async () => {
    mockApi({
      ...baseApi,
      'GET /admin/stats': { users: { total: 1, pending: 0, inactive: 0 }, units: { total: 3, active: 3 }, diseases: { total: 0, active: 0 } },
      'GET /admin/appointments': { data: [], total: 0 },
      'GET /admin/exams': { data: [], total: 0 },
    })
    renderAdmin('gestor')
    expect(await screen.findByText('Nenhuma pendência no momento.')).toBeInTheDocument()
  })

  it('atendimento só vê o número de hoje, sem contas/alertas/unidades, atividade ou CSV', async () => {
    mockApi(baseApi)
    renderAdmin('atendimento')
    expect(await screen.findByText('Hoje (pendentes)')).toBeInTheDocument()
    for (const hidden of ['Aguardando ativação', 'Alertas ativos', 'Unidades ativas', 'Atividade recente']) {
      expect(screen.queryByText(hidden)).not.toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: 'Baixar resumo CSV' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ver contas aguardando ativação' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver atendimentos de hoje' })).toBeInTheDocument()
  })

  it('alertas não consulta agendamentos nem auditoria (o servidor responderia 403)', async () => {
    const m = mockApi(baseApi)
    renderAdmin('alertas')
    await screen.findByText('Alertas ativos')
    expect(m.calls.some((c) => c.path.startsWith('/admin/appointments') || c.path.startsWith('/admin/exams'))).toBe(false)
    expect(m.calls.some((c) => c.path.startsWith('/admin/audit-log'))).toBe(false)
  })

  it('atividade recente mostra ator, ação e trata ator removido / sem nome', async () => {
    mockApi({
      ...baseApi,
      'GET /admin/audit-log?limit=5': [
        { id: 1, action: 'delete_user', entity_type: 'user', details: 'x', created_at: `${today} 09:00:00`, actor_missing: 1 },
        { id: 2, action: 'login', entity_type: 'auth', details: null, created_at: `${today} 09:01:00`, actor_name: '', actor_email: 'sem.nome@x.com' },
        { id: 3, action: 'job', entity_type: 'system', details: '', created_at: `${today} 09:02:00` },
      ],
    })
    renderAdmin('gestor')
    expect(await screen.findByText('Usuário removido')).toBeInTheDocument()
    expect(screen.getByText('sem.nome@x.com')).toBeInTheDocument()
    expect(screen.getByText('Sistema')).toBeInTheDocument()
  })

  it('uma fonte que falha vira "—" e só aquela seção mostra erro', async () => {
    mockApi({ ...baseApi, 'GET /admin/appointments': () => json(500, { error: 'x' }) })
    renderAdmin('gestor')
    const card = (await screen.findByText('Hoje (pendentes)')).closest('[data-slot=card]') as HTMLElement
    await waitFor(() => expect(card).toHaveTextContent('—'))
    expect(screen.getByText('Aguardando ativação').closest('[data-slot=card]')).toHaveTextContent('3')
  })

  it('falha em /admin/stats mostra o erro com "Tentar de novo"', async () => {
    mockApi({ ...baseApi, 'GET /admin/stats': () => json(500, { error: 'x' }) })
    renderAdmin('gestor')
    expect(await screen.findByText('Não foi possível carregar os dados')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })

  it('baixar CSV: GET autenticado e download do arquivo', async () => {
    const m = mockApi({ ...baseApi, 'GET /admin/export/summary.csv': new Response('Indicador;Total', { status: 200 }) })
    const save = vi.spyOn(api, 'saveBlob').mockImplementation(() => {})
    renderAdmin('gestor')
    await userEvent.click(await screen.findByRole('button', { name: 'Baixar resumo CSV' }))
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.any(Blob), 'saude-plus-resumo-administrativo.csv'))
    expect(m.calls.some((c) => c.path === '/admin/export/summary.csv')).toBe(true)
  })

  it('erro ao baixar o CSV mostra a mensagem do servidor', async () => {
    mockApi({ ...baseApi, 'GET /admin/export/summary.csv': () => json(403, { error: 'Sem permissão para relatórios.' }) })
    renderAdmin('gestor')
    await userEvent.click(await screen.findByRole('button', { name: 'Baixar resumo CSV' }))
    expect(await screen.findByText('Sem permissão para relatórios.')).toBeInTheDocument()
  })
})

describe('Auditoria', () => {
  it('lista com ator, ação, detalhes e total', async () => {
    mockApi(baseApi)
    renderAdmin('gestor', '/admin/auditoria')
    expect(await screen.findByText('appointment · detalhe 0')).toBeInTheDocument()
    expect(screen.getByText('appointment · detalhe 1')).toBeInTheDocument()
    expect(screen.getAllByText('admin_update')).toHaveLength(2)
    expect(await screen.findByText('2 ação(ões) no total.')).toBeInTheDocument()
  })

  it('filtros vão para a API e para a URL; "Limpar" zera os dois', async () => {
    const m = mockApi(baseApi)
    renderAdmin('gestor', '/admin/auditoria')
    await screen.findByText('2 ação(ões) no total.')
    await userEvent.type(screen.getByLabelText('Tipo da entidade'), 'user')
    await userEvent.type(screen.getByLabelText('Ação'), 'delete_user')
    await userEvent.click(screen.getByRole('button', { name: 'Filtrar' }))

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/admin/auditoria?entityType=user&action=delete_user'))
    await waitFor(() => expect(m.calls.some((c) => c.path.includes('entityType=user') && c.path.includes('action=delete_user'))).toBe(true))

    await userEvent.click(screen.getByRole('button', { name: 'Limpar' }))
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/admin\/auditoria$/))
    expect(screen.getByLabelText('Tipo da entidade')).toHaveValue('')
  })

  it('recarregar com filtros na URL aplica os filtros (estado na URL)', async () => {
    const m = mockApi(baseApi)
    renderAdmin('gestor', '/admin/auditoria?entityType=disease&pageSize=100')
    await screen.findByText('2 ação(ões) no total.')
    expect(screen.getByLabelText('Tipo da entidade')).toHaveValue('disease')
    const call = m.calls.find((c) => c.path.startsWith('/admin/audit-log?page='))!
    expect(call.path).toContain('pageSize=100')
    expect(call.path).toContain('entityType=disease')
  })

  it('tamanho de página inválido na URL volta ao padrão (50)', async () => {
    const m = mockApi(baseApi)
    renderAdmin('gestor', '/admin/auditoria?pageSize=7')
    await screen.findByText('2 ação(ões) no total.')
    expect(m.calls.find((c) => c.path.startsWith('/admin/audit-log?page='))!.path).toContain('pageSize=50')
  })

  it('"Carregar mais" acumula as páginas em vez de substituir', async () => {
    const m = mockApi({
      ...baseApi,
      // página de 25 linhas de um total de 26: sobra 1 para o "Carregar mais"
      'GET /admin/audit-log?page=1': { data: audit(25, { actor_name: 'Primeira' }), total: 26 },
      'GET /admin/audit-log?page=2': { data: [{ id: 'z', action: 'x', entity_type: 'y', details: 'ultima', created_at: `${today} 11:00:00`, actor_name: 'Terceira' }], total: 26 },
    })
    renderAdmin('gestor', '/admin/auditoria?pageSize=25')
    await userEvent.click(await screen.findByRole('button', { name: 'Carregar mais 1 ações de auditoria' }))
    expect(await screen.findByText('Terceira')).toBeInTheDocument()
    expect(screen.getAllByText('Primeira')).toHaveLength(25) // as anteriores continuam na tela
    expect(m.calls.some((c) => c.path.includes('page=2'))).toBe(true)
    expect(await screen.findByText('26 ação(ões) no total.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Carregar mais/ })).not.toBeInTheDocument()
  })

  it('verificar integridade: cadeia íntegra mostra a contagem e a cabeça abreviada', async () => {
    mockApi(baseApi)
    renderAdmin('gestor', '/admin/auditoria')
    await userEvent.click(await screen.findByRole('button', { name: 'Verificar integridade' }))
    expect(await screen.findByText('ÍNTEGRA')).toBeInTheDocument()
    expect(screen.getByText(/42 linha\(s\) verificadas/)).toBeInTheDocument()
    expect(screen.getByText('abcdef0123456789…')).toBeInTheDocument()
  })

  it('verificar integridade: cadeia violada mostra a linha e o motivo', async () => {
    mockApi({ ...baseApi, 'GET /admin/audit-log/verify': { ok: false, checked: 10, firstBad: 'abc', reason: 'hash divergente' } })
    renderAdmin('gestor', '/admin/auditoria')
    await userEvent.click(await screen.findByRole('button', { name: 'Verificar integridade' }))
    expect(await screen.findByText('VIOLADA')).toBeInTheDocument()
    expect(screen.getByText(/hash divergente/)).toBeInTheDocument()
  })

  it('erro ao carregar mostra a mensagem e permite tentar de novo; lista vazia mostra o estado vazio', async () => {
    mockApi({ ...baseApi, 'GET /admin/audit-log': () => json(500, { error: 'x' }) })
    renderAdmin('gestor', '/admin/auditoria')
    expect(await screen.findByText('Não foi possível carregar a auditoria.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })

  it('sem registros mostra o estado vazio', async () => {
    mockApi({ ...baseApi, 'GET /admin/audit-log': { data: [], total: 0 } })
    renderAdmin('gestor', '/admin/auditoria')
    expect(await screen.findByText('Nenhuma ação registrada ainda.')).toBeInTheDocument()
  })
})

describe('Minha conta (admin)', () => {
  it('perfil sem cargo, LGPD, privacidade e DPO; sem MFA', async () => {
    mockApi({
      ...baseApi,
      'GET /auth/me/export': { privacy_version: 'v1', profile: {} },
      'GET /auth/me': { user: { full_name: 'Ana Admin', mobile: '(87) 98888-7777' } },
      'GET /public/dpo': { configured: false },
    })
    renderAdmin('gestor', '/admin/conta')
    expect(await screen.findByDisplayValue('Ana Admin')).toBeInTheDocument()
    expect(screen.queryByLabelText('Cargo / Função')).not.toBeInTheDocument()
    expect(screen.getByText('Meus dados (LGPD)')).toBeInTheDocument()
    expect(screen.queryByText(/Verificação em duas etapas/)).not.toBeInTheDocument()
  })

  it('o gênero usa "prefiro_nao_informar" (o legado enviava "nao_informar", que o servidor recusa)', async () => {
    const m = mockApi({
      ...baseApi,
      'GET /auth/me/export': { privacy_version: 'v1', profile: {} },
      'GET /auth/me': { user: { full_name: 'Ana Admin', mobile: '(87) 98888-7777' } },
      'GET /public/dpo': { configured: false },
      'PUT /auth/me': { ok: true },
    })
    renderAdmin('gestor', '/admin/conta')
    await screen.findByDisplayValue('Ana Admin')
    await userEvent.click(screen.getByRole('combobox', { name: 'Gênero' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Prefiro não informar' }))
    await userEvent.click(screen.getByRole('button', { name: 'Salvar perfil' }))
    await waitFor(() => expect(m.last('PUT', '/auth/me')?.body).toMatchObject({ gender: 'prefiro_nao_informar' }))
  })
})
