import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { json, mockApi, renderApp, seedSession } from '@/test/utils'
import AdminRoutes from '../AdminRoutes'

const disease = (id: string, name: string, over: object = {}) => ({
  id, name, region: 'Centro', alert_level: 'alto', description: 'Casos em alta', active: 1, ...over,
})

function Where() {
  const l = useLocation()
  return <p data-testid="where">{l.pathname}</p>
}

function renderPage(level = 'alertas') {
  seedSession({ id: 'a1', role: 'admin', admin_level: level, full_name: 'Ana Alertas', email: 'ana@saude.app' })
  return renderApp(
    <>
      <Routes>
        <Route path="/admin/*" element={<AdminRoutes />} />
      </Routes>
      <Where />
    </>,
    { route: '/admin/cadastros/doencas', path: '/*' },
  )
}

const units = [
  { id: 'u1', name: 'UBS A', neighborhood: 'Moinho' },
  { id: 'u2', name: 'UBS B', neighborhood: 'Centro' },
  { id: 'u3', name: 'UBS C', neighborhood: 'Moinho' },
  { id: 'u4', name: 'UBS D', neighborhood: null },
]

const stateful = (initial: ReturnType<typeof disease>[]) => {
  const state = { list: initial }
  return {
    state,
    api: {
      'GET /admin/diseases': () => state.list,
      'GET /health-units': units,
      'GET /admin/stats': { users: {}, units: {}, diseases: {} },
      'POST /admin/diseases': () => { state.list = [disease('novo', 'Zika', { region: 'Centro', alert_level: 'baixo', description: null }), ...state.list]; return { id: 'novo' } },
      'PATCH /admin/diseases/': { ok: true },
      'DELETE /admin/diseases/': new Response(null, { status: 204 }),
    },
  }
}

const baseList = [
  disease('d1', 'Dengue', { region: 'Vila Boa Esperança', description: 'Casos em alta' }),
  disease('d2', 'Gripe', { alert_level: 'baixo', region: 'Centro', description: 'Influenza sazonal' }),
  disease('d3', 'Sarampo', { alert_level: 'medio', active: 0, region: null, description: null }),
]

const row = (name: string) => screen.getByText(name, { selector: 'p, p *' }).closest('li') as HTMLElement

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('lista', () => {
  it('mostra nível, situação, descrição e região de cada alerta', async () => {
    mockApi(stateful(baseList).api)
    renderPage()
    expect(await screen.findByText('Dengue')).toBeInTheDocument()
    const dengue = row('Dengue')
    expect(within(dengue).getByText('Alto')).toBeInTheDocument()
    expect(within(dengue).getByText('Ativo')).toBeInTheDocument()
    expect(dengue).toHaveTextContent('Casos em alta · Vila Boa Esperança')
    expect(within(row('Gripe')).getByText('Baixo')).toBeInTheDocument()
    const sarampo = row('Sarampo')
    expect(within(sarampo).getByText('Médio')).toBeInTheDocument()
    expect(within(sarampo).getByText('Inativo')).toBeInTheDocument()
    expect(within(sarampo).getByRole('button', { name: 'Ativar alerta Sarampo' })).toBeInTheDocument()
    expect(within(dengue).getByRole('button', { name: 'Desativar alerta Dengue' })).toBeInTheDocument()
  })

  it('sem registros e falha de API', async () => {
    mockApi(stateful([]).api)
    renderPage()
    expect(await screen.findByText('Sem registros.')).toBeInTheDocument()
  })

  it('erro ao carregar mostra "Tentar de novo"', async () => {
    mockApi({ ...stateful([]).api, 'GET /admin/diseases': () => json(500, { error: 'x' }) })
    renderPage()
    expect(await screen.findByText('Não foi possível carregar os alertas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })
})

describe('filtro', () => {
  it('filtra no cliente por nome, região e descrição, ignorando acento, sem nova chamada à API', async () => {
    const m = mockApi(stateful(baseList).api)
    renderPage()
    await screen.findByText('Dengue')
    const antes = m.calls.length
    await userEvent.type(screen.getByLabelText('Filtrar alertas pelo nome ou região'), 'esperanca')
    expect(screen.getByText('Dengue')).toBeInTheDocument()
    expect(screen.queryByText('Gripe')).not.toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Filtrar alertas pelo nome ou região'))
    await userEvent.type(screen.getByLabelText('Filtrar alertas pelo nome ou região'), 'INFLUENZA')
    expect(screen.getByText('Gripe')).toBeInTheDocument()
    expect(screen.queryByText('Dengue')).not.toBeInTheDocument()
    expect(m.calls.length).toBe(antes)
  })

  it('sem casamento mostra a mensagem com o termo', async () => {
    mockApi(stateful(baseList).api)
    renderPage()
    await screen.findByText('Dengue')
    await userEvent.type(screen.getByLabelText('Filtrar alertas pelo nome ou região'), 'xyz')
    expect(screen.getByText('Nenhum alerta casa com "xyz".')).toBeInTheDocument()
  })
})

describe('cadastro', () => {
  it('regiões = bairros distintos das unidades, em ordem', async () => {
    mockApi(stateful(baseList).api)
    renderPage()
    await screen.findByText('Dengue')
    const form = screen.getByRole('form', { name: 'Cadastrar alerta de doença' })
    await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Região (Bairro)' })).toBeEnabled())
    await userEvent.click(within(form).getByRole('combobox', { name: 'Região (Bairro)' }))
    expect((await screen.findAllByRole('option')).map((o) => o.textContent)).toEqual(['Centro', 'Moinho'])
  })

  it('valida nome e região antes de enviar', async () => {
    const s = stateful(baseList)
    const m = mockApi(s.api)
    renderPage()
    await screen.findByText('Dengue')
    await userEvent.click(within(screen.getByRole('form', { name: 'Cadastrar alerta de doença' })).getByRole('button', { name: 'Adicionar' }))
    expect(await screen.findByText('Informe o nome da doença.')).toBeInTheDocument()
    expect(screen.getByText('Selecione a região/bairro.')).toBeInTheDocument()
    expect(m.last('POST', '/admin/diseases')).toBeUndefined()
  })

  it('cadastra: POST com textos aparados, volta ao estado inicial e a lista é recarregada', async () => {
    const s = stateful(baseList)
    const m = mockApi(s.api)
    renderPage()
    await screen.findByText('Dengue')
    const form = screen.getByRole('form', { name: 'Cadastrar alerta de doença' })
    await userEvent.type(within(form).getByLabelText('Nome'), '  Zika ')
    await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Região (Bairro)' })).toBeEnabled())
    await userEvent.click(within(form).getByRole('combobox', { name: 'Região (Bairro)' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Centro' }))
    await userEvent.click(within(form).getByRole('combobox', { name: 'Nível' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Médio' }))
    await userEvent.type(within(form).getByLabelText('Descrição'), '  transmitida por mosquito ')
    await userEvent.click(within(form).getByRole('button', { name: 'Adicionar' }))

    await waitFor(() => expect(m.last('POST', '/admin/diseases')?.body).toEqual({ name: 'Zika', region: 'Centro', alert_level: 'medio', description: 'transmitida por mosquito' }))
    expect(await screen.findByText('Doença cadastrada')).toBeInTheDocument()
    expect(await screen.findByText('Zika')).toBeInTheDocument() // lista recarregada
    expect(within(form).getByLabelText('Nome')).toHaveValue('')
    expect(within(form).getByRole('combobox', { name: 'Nível' })).toHaveTextContent('Baixo')
    expect(within(form).getByRole('combobox', { name: 'Região (Bairro)' })).toHaveTextContent('Selecione a região/bairro…')
  })

  it('erro do servidor aparece no campo nome', async () => {
    mockApi({ ...stateful(baseList).api, 'POST /admin/diseases': () => json(400, { error: 'Nome é obrigatório.' }) })
    renderPage()
    await screen.findByText('Dengue')
    const form = screen.getByRole('form', { name: 'Cadastrar alerta de doença' })
    await userEvent.type(within(form).getByLabelText('Nome'), 'Zika')
    await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Região (Bairro)' })).toBeEnabled())
    await userEvent.click(within(form).getByRole('combobox', { name: 'Região (Bairro)' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Moinho' }))
    await userEvent.click(within(form).getByRole('button', { name: 'Adicionar' }))
    expect(await within(form).findByText('Nome é obrigatório.')).toBeInTheDocument()
  })

  it('sem bairros cadastrados a região fica desabilitada com a explicação; falha de unidades também', async () => {
    mockApi({ ...stateful([]).api, 'GET /health-units': [{ id: 'u', name: 'X', neighborhood: null }] })
    renderPage()
    const form = await screen.findByRole('form', { name: 'Cadastrar alerta de doença' })
    await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Região (Bairro)' })).toHaveTextContent('Nenhum bairro encontrado'))
    expect(within(form).getByRole('combobox', { name: 'Região (Bairro)' })).toBeDisabled()
  })

  it('erro ao carregar as unidades avisa na própria região', async () => {
    mockApi({ ...stateful([]).api, 'GET /health-units': () => json(500, { error: 'x' }) })
    renderPage()
    const form = await screen.findByRole('form', { name: 'Cadastrar alerta de doença' })
    await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Região (Bairro)' })).toHaveTextContent('Erro ao carregar regiões'))
  })
})

describe('editar', () => {
  async function open(name = 'Dengue', over: Record<string, unknown> = {}) {
    const m = mockApi({ ...stateful(baseList).api, ...over })
    renderPage()
    await screen.findByText(name)
    await userEvent.click(within(row(name)).getByRole('button', { name: `Editar alerta ${name}` }))
    return { m, dlg: await screen.findByRole('dialog') }
  }

  it('abre preenchido e envia o PATCH com os textos aparados', async () => {
    const { m, dlg } = await open()
    expect(within(dlg).getByLabelText('Nome')).toHaveValue('Dengue')
    expect(within(dlg).getByLabelText('Região')).toHaveValue('Vila Boa Esperança')
    expect(within(dlg).getByRole('combobox', { name: 'Nível' })).toHaveTextContent('Alto')
    await userEvent.clear(within(dlg).getByLabelText('Descrição'))
    await userEvent.type(within(dlg).getByLabelText('Descrição'), '  nova descrição ')
    await userEvent.click(within(dlg).getByRole('combobox', { name: 'Nível' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Baixo' }))
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(m.last('PATCH', '/admin/diseases/d1')?.body).toEqual({ name: 'Dengue', region: 'Vila Boa Esperança', alert_level: 'baixo', description: 'nova descrição' }))
    expect(await screen.findByText('Alerta atualizado')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('nome vazio é recusado sem chamar a API; região pode ficar vazia', async () => {
    const { m, dlg } = await open('Sarampo')
    await userEvent.clear(within(dlg).getByLabelText('Nome'))
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvar alterações' }))
    expect(await within(dlg).findByText('Informe o nome da doença.')).toBeInTheDocument()
    expect(m.last('PATCH', '/admin/diseases/')).toBeUndefined()
    await userEvent.type(within(dlg).getByLabelText('Nome'), 'Sarampo')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvar alterações' })) // região "" é aceita
    await waitFor(() => expect(m.last('PATCH', '/admin/diseases/d3')?.body).toMatchObject({ region: '' }))
  })

  it('erro do servidor aparece no diálogo, que continua aberto', async () => {
    const { dlg } = await open('Dengue', { 'PATCH /admin/diseases/d1': () => json(400, { error: 'Nível inválido.' }) })
    await userEvent.click(within(dlg).getByRole('button', { name: 'Salvar alterações' }))
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Nível inválido.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})

describe('ativar e desativar', () => {
  it('desativar pede confirmação (some para os pacientes) e envia active: 0', async () => {
    const m = mockApi(stateful(baseList).api)
    renderPage()
    await screen.findByText('Dengue')
    await userEvent.click(within(row('Dengue')).getByRole('button', { name: 'Desativar alerta Dengue' }))
    const dlg = await screen.findByRole('alertdialog')
    expect(dlg).toHaveTextContent('deixa de aparecer para os pacientes da região')
    expect(m.last('PATCH', '/admin/diseases/')).toBeUndefined()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Desativar alerta' }))
    await waitFor(() => expect(m.last('PATCH', '/admin/diseases/d1')?.body).toEqual({ active: 0 }))
    expect(await screen.findByText('Alerta desativado')).toBeInTheDocument()
  })

  it('ativar é direto, sem confirmação, e envia active: 1', async () => {
    const m = mockApi(stateful(baseList).api)
    renderPage()
    await screen.findByText('Sarampo')
    await userEvent.click(within(row('Sarampo')).getByRole('button', { name: 'Ativar alerta Sarampo' }))
    await waitFor(() => expect(m.last('PATCH', '/admin/diseases/d3')?.body).toEqual({ active: 1 }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(await screen.findByText('Alerta ativado')).toBeInTheDocument()
  })

  it('"Voltar" na confirmação não desativa', async () => {
    const m = mockApi(stateful(baseList).api)
    renderPage()
    await screen.findByText('Dengue')
    await userEvent.click(within(row('Dengue')).getByRole('button', { name: 'Desativar alerta Dengue' }))
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Voltar' }))
    expect(m.last('PATCH', '/admin/diseases/')).toBeUndefined()
  })
})

describe('excluir', () => {
  it('pede confirmação e chama DELETE (resposta 204)', async () => {
    const m = mockApi(stateful(baseList).api)
    renderPage()
    await screen.findByText('Gripe')
    await userEvent.click(within(row('Gripe')).getByRole('button', { name: 'Excluir alerta Gripe' }))
    const dlg = await screen.findByRole('alertdialog')
    expect(dlg).toHaveTextContent('Essa ação não pode ser desfeita')
    expect(m.last('DELETE', '/admin/diseases/')).toBeUndefined()
    await userEvent.click(within(dlg).getByRole('button', { name: 'Excluir alerta' }))
    await waitFor(() => expect(m.last('DELETE', '/admin/diseases/d2')).toBeDefined())
    expect(await screen.findByText('Alerta excluído')).toBeInTheDocument()
  })

  it('erro ao excluir mantém o diálogo aberto', async () => {
    mockApi({ ...stateful(baseList).api, 'DELETE /admin/diseases/d2': () => json(500, { error: 'x' }) })
    renderPage()
    await screen.findByText('Gripe')
    await userEvent.click(within(row('Gripe')).getByRole('button', { name: 'Excluir alerta Gripe' }))
    const dlg = await screen.findByRole('alertdialog')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Excluir alerta' }))
    expect(await within(dlg).findByRole('alert')).toHaveTextContent('Erro ao excluir alerta')
  })
})

describe('acesso', () => {
  it('o nível "atendimento" não chega a Doenças; "gestor" chega', async () => {
    mockApi(stateful(baseList).api)
    renderPage('atendimento')
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/admin$/))
  })
  it('gestor vê a página', async () => {
    mockApi(stateful(baseList).api)
    renderPage('gestor')
    expect(await screen.findByText('Dengue')).toBeInTheDocument()
  })
})
