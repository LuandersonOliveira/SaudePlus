import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { json, mockApi, renderApp, seedSession } from '@/test/utils'
import AdminRoutes from '../AdminRoutes'
import { filterOffers, filterUnits, validateUnit, unitBody } from './logic'

const unit = (id: string, name: string, over: object = {}) => ({ id, name, type: 'ubs', neighborhood: 'Centro', active: 1, ...over })
const offer = (id: string, name: string, over: object = {}) => ({ id, kind: 'consulta', name, active: 1, ...over })

function renderPage(level = 'gestor') {
  seedSession({ id: 'g1', role: 'admin', admin_level: level, full_name: 'Gil Gestor', email: 'gil@saude.app' })
  return renderApp(
    <Routes>
      <Route path="/admin/*" element={<AdminRoutes />} />
    </Routes>,
    { route: '/admin/cadastros/rede', path: '/*' },
  )
}

const baseUnits = [unit('u1', 'UBS Centro'), unit('u2', 'Hospital Geral', { type: 'hospital', neighborhood: 'Moinho', active: 0 })]

function api(over: Record<string, unknown> = {}) {
  const state = { units: baseUnits, offers: [offer('o1', 'Cardiologia'), offer('o2', 'Hemograma', { kind: 'exame' })] }
  return {
    state,
    api: {
      'GET /health-units/manage': () => state.units,
      'GET /health-units/u1/offers': () => state.offers,
      'GET /health-units/u2/offers': () => [],
      'GET /admin/stats': { users: {}, units: {}, diseases: {} },
      'POST /health-units/u1/offers': { id: 'novo' },
      'POST /health-units': { id: 'nova' },
      'PATCH /health-units/': { ok: true },
      'DELETE /health-units/u1/offers/': new Response(null, { status: 204 }),
      ...over,
    },
  }
}

const row = (name: string) => screen.getByText(name, { selector: 'p, p *' }).closest('li') as HTMLElement

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('logic', () => {
  it('filtra unidades por nome, tipo e bairro, ignorando acento', () => {
    const list = baseUnits as never
    expect(filterUnits(list, 'hospital')).toHaveLength(1)
    expect(filterUnits(list, 'MOINHO')).toHaveLength(1)
    expect(filterUnits(list, '')).toHaveLength(2)
    expect(filterOffers([offer('1', 'Ortopedia')] as never, 'ortop')).toHaveLength(1)
  })
  it('valida e monta o corpo com textos aparados', () => {
    expect(validateUnit({ name: '  ', type: 'ubs', neighborhood: '' }).name).toBeTruthy()
    expect(unitBody({ name: ' UBS ', type: 'caps', neighborhood: ' Sul ' })).toEqual({ name: 'UBS', type: 'caps', neighborhood: 'Sul' })
  })
})

describe('Rede de saúde', () => {
  it('lista unidades com tipo, bairro e situação', async () => {
    mockApi(api().api)
    renderPage()
    expect(await screen.findByRole('button', { name: 'Editar UBS Centro' })).toBeInTheDocument()
    expect(row('UBS Centro')).toHaveTextContent('UBS / PSF · Centro')
    expect(within(row('UBS Centro')).getByText('Ativa')).toBeInTheDocument()
    const h = row('Hospital Geral')
    expect(within(h).getByText('Inativa')).toBeInTheDocument()
    expect(within(h).getByRole('button', { name: 'Ativar Hospital Geral' })).toBeInTheDocument()
  })

  it('erro ao carregar mostra "Tentar de novo"', async () => {
    mockApi(api({ 'GET /health-units/manage': () => json(500, { error: 'x' }) }).api)
    renderPage()
    expect(await screen.findByText('Erro ao carregar unidades')).toBeInTheDocument()
  })

  it('cadastrar exige o nome e envia o corpo', async () => {
    const fetchMock = mockApi(api().api)
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: 'Editar UBS Centro' })
    const form = screen.getByRole('form', { name: 'Cadastrar unidade de saúde' })
    await user.click(within(form).getByRole('button', { name: 'Adicionar unidade' }))
    expect(await within(form).findByText('Informe o nome da unidade.')).toBeInTheDocument()
    await user.type(within(form).getByLabelText('Nome da unidade'), ' UBS Nova ')
    await user.type(within(form).getByLabelText('Bairro ou região'), 'Sul')
    await user.click(within(form).getByRole('button', { name: 'Adicionar unidade' }))
    await waitFor(() => expect(fetchMock.last('POST', '/health-units')?.body).toEqual({ name: 'UBS Nova', type: 'ubs', neighborhood: 'Sul' }))
  })

  it('desativar pede confirmação; ativar é direto', async () => {
    const fetchMock = mockApi(api().api)
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: 'Editar UBS Centro' })
    await user.click(screen.getByRole('button', { name: 'Desativar UBS Centro' }))
    const dlg = await screen.findByRole('alertdialog')
    await user.click(within(dlg).getByRole('button', { name: 'Desativar unidade' }))
    await waitFor(() => expect(fetchMock.last('PATCH', '/health-units/u1')?.body).toEqual({ active: 0 }))
    await user.click(screen.getByRole('button', { name: 'Ativar Hospital Geral' }))
    await waitFor(() => expect(fetchMock.last('PATCH', '/health-units/u2')?.body).toEqual({ active: 1 }))
  })

  it('edita a unidade em diálogo', async () => {
    const fetchMock = mockApi(api().api)
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: 'Editar UBS Centro' })
    await user.click(screen.getByRole('button', { name: 'Editar UBS Centro' }))
    const dlg = await screen.findByRole('dialog')
    const name = within(dlg).getByLabelText('Nome da unidade')
    await user.clear(name)
    await user.type(name, 'UBS Central')
    await user.click(within(dlg).getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(fetchMock.last('PATCH', '/health-units/u1')?.body).toMatchObject({ name: 'UBS Central', type: 'ubs' }))
  })

  it('serviços: lista, filtra, adiciona e remove com confirmação', async () => {
    const fetchMock = mockApi(api().api)
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('Cardiologia')).toBeInTheDocument()
    expect(screen.getByText('Hemograma')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Filtrar serviços pelo nome'), 'hemo')
    expect(screen.queryByText('Cardiologia')).not.toBeInTheDocument()
    await user.clear(screen.getByLabelText('Filtrar serviços pelo nome'))

    const form = screen.getByRole('form', { name: 'Adicionar serviço ofertado por unidade' })
    await user.click(within(form).getByRole('button', { name: 'Adicionar serviço' }))
    expect(await within(form).findByText('Informe a especialidade ou o exame.')).toBeInTheDocument()
    await user.type(within(form).getByLabelText('Especialidade ou exame'), 'Neurologia')
    await user.click(within(form).getByRole('button', { name: 'Adicionar serviço' }))
    await waitFor(() => expect(fetchMock.last('POST', '/health-units/u1/offers')?.body).toEqual({ kind: 'consulta', name: 'Neurologia' }))

    await user.click(screen.getByRole('button', { name: 'Remover serviço Cardiologia' }))
    const dlg = await screen.findByRole('alertdialog')
    await user.click(within(dlg).getByRole('button', { name: 'Remover serviço' }))
    await waitFor(() => expect(fetchMock.last('DELETE', '/health-units/u1/offers/o1')).toBeDefined())
  })

  it('duplicata (409) aparece no campo', async () => {
    mockApi(api({ 'POST /health-units/u1/offers': () => json(409, { error: 'Este serviço já está cadastrado nesta unidade.' }) }).api)
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Cardiologia')
    const form = screen.getByRole('form', { name: 'Adicionar serviço ofertado por unidade' })
    await user.type(within(form).getByLabelText('Especialidade ou exame'), 'Cardiologia')
    await user.click(within(form).getByRole('button', { name: 'Adicionar serviço' }))
    expect(await within(form).findByText('Este serviço já está cadastrado nesta unidade.')).toBeInTheDocument()
  })

  it('nível sem a capability units não enxerga a aba', async () => {
    mockApi(api().api)
    renderPage('atendimento')
    await waitFor(() => expect(screen.queryByText('Cadastrar unidade de saúde')).not.toBeInTheDocument())
  })
})

