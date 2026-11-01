import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { json, mockApi, renderApp, seedSession } from '@/test/utils'
import { addDays, localDateStr } from '@/features/staff/logic'
import PatientRoutes from './PatientRoutes'

const today = localDateStr()
const future = (n: number) => `${addDays(today, n)} 09:00:00`

const appointments = [
  { id: 'a1', scheduled_at: future(3), status: 'pendente', specialty: 'Clínico Geral', doctor: 'Dr. Paulo', location: 'UBS Centro' },
  { id: 'a2', scheduled_at: future(5), status: 'cancelado', specialty: 'Pediatria', location: 'UBS Norte' },
  { id: 'a3', scheduled_at: `${addDays(today, -2)} 09:00:00`, status: 'pendente', specialty: 'Cardiologia', location: 'UBS Centro' },
]
const exams = [{ id: 'e1', scheduled_at: future(1), status: 'confirmado', exam_type: 'Hemograma', location: 'Laboratório' }]
const diseases = [
  { id: 1, name: 'Dengue', alert_level: 'alto', description: 'Casos em alta', region: 'Lagoa de Itaenga' },
  { id: 2, name: 'Gripe', alert_level: 'baixo', description: null, region: null },
]
const reminders = [
  { id: 1, title: 'Consulta amanhã', message: 'Leve seu cartão SUS', read: 0 },
  { id: 2, title: 'Exame confirmado', message: '', read: 1 },
]

const baseApi = {
  'GET /me/appointments': appointments,
  'GET /me/exams': exams,
  'GET /diseases': diseases,
  'GET /me/reminders': reminders,
}

function Probe() {
  const l = useLocation()
  return <pre data-testid="state">{JSON.stringify(l.state)}</pre>
}

function renderPatient(route = '/dashboard') {
  return renderApp(
    <Routes>
      <Route path="/dashboard/*" element={<PatientRoutes />} />
      <Route path="/dashboard/agendar" element={<Probe />} />
    </Routes>,
    { route, path: '/*' },
  )
}

beforeEach(() => {
  localStorage.clear()
  seedSession({ id: 'p1', role: 'paciente', full_name: 'Maria Lima', email: 'maria@x.com' })
})
afterEach(() => vi.restoreAllMocks())

describe('Início', () => {
  it('mostra números, próximos eventos ordenados (sem passados nem cancelados) e lembretes', async () => {
    mockApi(baseApi)
    renderPatient()
    expect(await screen.findByText('Meu painel')).toBeInTheDocument()

    const stats = await screen.findByText('Alertas ativos')
    expect(stats.closest('[data-slot=card]')).toHaveTextContent('2')
    expect(screen.getByText('Consultas').closest('[data-slot=card]')).toHaveTextContent('3')
    // 1 lembrete não lido
    expect(screen.getByText('Lembretes', { selector: 'p' }).closest('[data-slot=card]')).toHaveTextContent('1')

    const upcoming = (await screen.findByText('Próximos eventos')).closest('[data-slot=card]') as HTMLElement
    const titles = within(upcoming).getAllByRole('listitem').map((li) => li.textContent ?? '')
    expect(titles).toHaveLength(2) // exame (amanhã) e consulta (em 3 dias)
    expect(titles[0]).toContain('Hemograma')
    expect(titles[1]).toContain('Clínico Geral')
    expect(upcoming).not.toHaveTextContent('Cardiologia') // passado
    expect(upcoming).not.toHaveTextContent('Pediatria') // cancelado

    expect(screen.getByText('Consulta amanhã')).toBeInTheDocument()
    expect(screen.getByText('Novo')).toBeInTheDocument()
    expect(screen.getByText('Lido')).toBeInTheDocument()
  })

  it('sem agendamentos mostra o convite ao primeiro agendamento', async () => {
    mockApi({ ...baseApi, 'GET /me/appointments': [], 'GET /me/exams': [] })
    renderPatient()
    expect(await screen.findByText('Bem-vindo(a) ao Saúde+')).toBeInTheDocument()
    expect(screen.getByText('Nenhum evento futuro agendado.', { exact: false })).toBeInTheDocument()
  })

  it('uma fonte que falha vira "—" e só aquela seção mostra erro (sem 0 mentiroso)', async () => {
    mockApi({ ...baseApi, 'GET /me/reminders': () => json(500, { error: 'x' }) })
    renderPatient()
    await screen.findByText('Alertas ativos')
    expect(screen.getByText('Lembretes', { selector: 'p' }).closest('[data-slot=card]')).toHaveTextContent('—')
    expect(await screen.findByText('Erro ao carregar os lembretes.')).toBeInTheDocument()
    expect(screen.getByText('Hemograma')).toBeInTheDocument() // o resto segue funcionando
  })
})

describe('Meus agendamentos', () => {
  it('ações por status: pendente edita/cancela; cancelado refaz; atrasado é sinalizado', async () => {
    mockApi(baseApi)
    renderPatient('/dashboard/agendamentos')
    await screen.findAllByText('Clínico Geral')

    expect(screen.getAllByRole('button', { name: 'Editar a consulta de Clínico Geral' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Cancelar o exame de Hemograma' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Tentar agendar novamente: Pediatria' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Editar a consulta de Pediatria/ })).not.toBeInTheDocument()
    expect(screen.getAllByText('atrasado').length).toBeGreaterThan(0) // Cardiologia pendente no passado
  })

  it('cancelar pede confirmação e chama PATCH /me/<kind>/<id>/cancel', async () => {
    const m = mockApi({ ...baseApi, 'PATCH /me/appointments/a1/cancel': { ok: true } })
    renderPatient('/dashboard/agendamentos')
    const [btn] = await screen.findAllByRole('button', { name: 'Cancelar a consulta de Clínico Geral' })
    await userEvent.click(btn)

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Cancelar consulta?')
    expect(m.last('PATCH', '/me/')).toBeUndefined() // ainda não enviou

    await userEvent.click(within(dialog).getByRole('button', { name: 'Sim, cancelar' }))
    await waitFor(() => expect(m.last('PATCH', '/me/appointments/a1/cancel')?.body).toEqual({}))
    expect(await screen.findByText('Agendamento cancelado')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('erro ao cancelar mantém o diálogo aberto com a mensagem do servidor', async () => {
    mockApi({ ...baseApi, 'PATCH /me/exams/e1/cancel': () => json(409, { error: 'Já foi concluído.' }) })
    renderPatient('/dashboard/agendamentos')
    const [btn] = await screen.findAllByRole('button', { name: 'Cancelar o exame de Hemograma' })
    await userEvent.click(btn)
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sim, cancelar' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Já foi concluído.')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('Editar e "Tentar agendar novamente" levam à aba Agendar com a intenção no estado da rota', async () => {
    mockApi(baseApi)
    renderPatient('/dashboard/agendamentos')
    const [edit] = await screen.findAllByRole('button', { name: 'Editar a consulta de Clínico Geral' })
    await userEvent.click(edit)
    expect(JSON.parse((await screen.findByTestId('state')).textContent!)).toEqual({ mode: 'edit', kind: 'appointments', id: 'a1' })
  })

  it('refazer um cancelado envia mode=rebook', async () => {
    mockApi(baseApi)
    renderPatient('/dashboard/agendamentos')
    const [rebook] = await screen.findAllByRole('button', { name: 'Tentar agendar novamente: Pediatria' })
    await userEvent.click(rebook)
    expect(JSON.parse((await screen.findByTestId('state')).textContent!)).toEqual({ mode: 'rebook', kind: 'appointments', id: 'a2' })
  })
})

describe('Alertas', () => {
  it('lista as doenças com o nível e resume por nível no gráfico', async () => {
    mockApi(baseApi)
    renderPatient('/dashboard/alertas')
    expect(await screen.findByText('Dengue')).toBeInTheDocument()
    expect(screen.getByText('Alto')).toBeInTheDocument()
    expect(screen.getByText('Casos em alta · Lagoa de Itaenga')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Quantidade de alertas por nível' })).toBeInTheDocument()
    expect(screen.getByText('Alto: 1 · Médio: 0 · Baixo: 1')).toBeInTheDocument()
  })

  it('sem alertas: estado vazio e sem gráfico', async () => {
    mockApi({ ...baseApi, 'GET /diseases': [] })
    renderPatient('/dashboard/alertas')
    expect(await screen.findByText('Sem alertas ativos.')).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /por nível/ })).not.toBeInTheDocument()
  })

  it('falha da API mostra erro com "Tentar de novo"', async () => {
    mockApi({ ...baseApi, 'GET /diseases': () => json(500, { error: 'x' }) })
    renderPatient('/dashboard/alertas')
    expect(await screen.findByText('Erro ao carregar os alertas da sua região.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Tentar de novo' })).toBeInTheDocument()
  })
})
