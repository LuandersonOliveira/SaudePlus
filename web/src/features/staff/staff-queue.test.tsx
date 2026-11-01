import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { json, mockApi, renderApp, seedSession } from '@/test/utils'
import { addDays, localDateStr } from './logic'
import StaffRoutes from './StaffRoutes'

const today = localDateStr()
const tomorrow = addDays(today, 1)

const appointments = [
  { id: 'a1', scheduled_at: `${today} 09:00:00`, status: 'pendente', specialty: 'Clínico Geral', doctor: 'Dr. Paulo', location: 'UBS Centro', user_name: 'Maria Lima' },
  { id: 'a2', scheduled_at: `${today} 10:00:00`, status: 'confirmado', specialty: 'Pediatria', user_name: 'Pedro Alves' },
  { id: 'a3', scheduled_at: `${tomorrow} 09:00:00`, status: 'pendente', specialty: 'Clínico Geral', user_name: 'Lia Costa' },
]
const exams = [{ id: 'e1', scheduled_at: `${today} 08:00:00`, status: 'pendente', exam_type: 'Hemograma', location: 'Lab', user_name: 'João Reis' }]

function renderStaff(route = '/atendente') {
  return renderApp(<StaffRoutes />, { route, path: '/atendente/*' })
}

const baseApi = {
  'GET /staff/appointments': appointments,
  'GET /staff/exams': exams,
}

beforeEach(() => {
  localStorage.clear()
  seedSession()
})
afterEach(() => vi.restoreAllMocks())

describe('Fila do dia', () => {
  it('mostra só pendentes de hoje, em ordem de horário, com saudação e contagem', async () => {
    mockApi(baseApi)
    renderStaff()

    expect(await screen.findByText('Olá, Ana!')).toBeInTheDocument()
    expect(screen.getByText(/Recepcionista · Painel de atendimento/)).toBeInTheDocument()

    const rows = await screen.findAllByRole('row')
    // cabeçalho + 2 pendentes de hoje: o exame das 08:00 vem antes da consulta das 09:00
    expect(rows).toHaveLength(3)
    expect(within(rows[1]).getByText('Hemograma')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Clínico Geral')).toBeInTheDocument()
    expect(screen.queryByText('Lia Costa')).not.toBeInTheDocument() // amanhã
    expect(screen.queryByText('Pedro Alves')).not.toBeInTheDocument() // já confirmado

    expect(await screen.findByLabelText('2 pendentes hoje')).toBeInTheDocument()
  })

  it('mostra estado vazio quando não há pendentes hoje', async () => {
    mockApi({ 'GET /staff/appointments': [], 'GET /staff/exams': [] })
    renderStaff()
    expect(await screen.findByText('Nenhum pendente para hoje.')).toBeInTheDocument()
  })

  it('mostra o erro da API em vez de ficar preso no carregamento', async () => {
    mockApi({
      'GET /staff/appointments': () => json(500, { error: 'x' }),
      'GET /staff/exams': () => json(500, { error: 'x' }),
    })
    renderStaff()
    expect(await screen.findByRole('alert')).toHaveTextContent('Erro ao carregar dados')
  })

  it('Confirmar envia PATCH só com o status', async () => {
    const api = mockApi({ ...baseApi, 'PATCH /staff/exams/e1': { ok: true } })
    renderStaff()
    await userEvent.click(await screen.findByRole('button', { name: 'Confirmar atendimento de João Reis' }))
    await waitFor(() => expect(api.last('PATCH', '/staff/exams/e1')?.body).toEqual({ status: 'confirmado' }))
    expect(await screen.findByText('Atendimento confirmado')).toBeInTheDocument()
  })
})

describe('Remarcar', () => {
  async function abrir() {
    const api = mockApi({ ...baseApi, 'PATCH /staff/appointments/a1': { ok: true } })
    renderStaff()
    await userEvent.click(await screen.findByRole('button', { name: 'Remarcar atendimento de Maria Lima' }))
    return { api, dialog: await screen.findByRole('dialog') }
  }

  it('exige a nova data antes de enviar', async () => {
    const { api, dialog } = await abrir()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    expect(await within(dialog).findByText('Selecione uma data e hora válidas.')).toBeInTheDocument()
    expect(api.last('PATCH', '/staff')).toBeUndefined()
  })

  it('recusa data no passado', async () => {
    const { api, dialog } = await abrir()
    fireEvent.change(within(dialog).getByLabelText('Nova data e hora *'), { target: { value: `${addDays(today, -1)}T10:00` } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    expect(await within(dialog).findByText('A nova data não pode estar no passado.')).toBeInTheDocument()
    expect(api.last('PATCH', '/staff')).toBeUndefined()
  })

  it('envia scheduled_at no formato da API e o motivo (que o servidor exige)', async () => {
    const { api, dialog } = await abrir()
    const novo = addDays(today, 3)
    fireEvent.change(within(dialog).getByLabelText('Nova data e hora *'), { target: { value: `${novo}T14:30` } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(api.last('PATCH', '/staff/appointments/a1')?.body).toEqual({
        scheduled_at: `${novo} 14:30:00`,
        reschedule_reason: 'solicitado_pelo_paciente',
      }),
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('mostra a mensagem do servidor quando o horário está ocupado', async () => {
    const { dialog } = await abrir()
    vi.mocked(globalThis.fetch).mockImplementationOnce(async () => json(409, { error: 'Horário indisponível.' }))
    fireEvent.change(within(dialog).getByLabelText('Nova data e hora *'), { target: { value: `${addDays(today, 3)}T14:30` } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Horário indisponível.')
    expect(screen.getByRole('dialog')).toBeInTheDocument() // continua aberto para tentar de novo
  })
})

describe('Cancelar e registrar', () => {
  it('cancelar exige o motivo e envia status, desfecho e motivo', async () => {
    const api = mockApi({ ...baseApi, 'PATCH /staff/appointments/a1': { ok: true } })
    renderStaff()
    await userEvent.click(await screen.findByRole('button', { name: 'Cancelar atendimento de Maria Lima' }))
    const dialog = await screen.findByRole('dialog')

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar atendimento' }))
    expect(await within(dialog).findByText('Informe o motivo do cancelamento.')).toBeInTheDocument()
    expect(api.last('PATCH', '/staff')).toBeUndefined()

    await userEvent.type(within(dialog).getByLabelText('Descreva o motivo *'), 'Paciente avisou que não pode vir')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar atendimento' }))
    await waitFor(() =>
      expect(api.last('PATCH', '/staff/appointments/a1')?.body).toEqual({
        status: 'cancelado',
        outcome: 'recusou',
        reschedule_reason: 'Paciente avisou que não pode vir',
      }),
    )
  })

  it('registrar envia concluído com o desfecho padrão "compareceu"', async () => {
    const api = mockApi({ ...baseApi, 'PATCH /staff/appointments/a1': { ok: true } })
    renderStaff()
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar atendimento de Maria Lima' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(api.last('PATCH', '/staff/appointments/a1')?.body).toEqual({ status: 'concluido', outcome: 'compareceu' }),
    )
  })

  it('permite escolher outro desfecho', async () => {
    const api = mockApi({ ...baseApi, 'PATCH /staff/appointments/a1': { ok: true } })
    renderStaff()
    await userEvent.click(await screen.findByRole('button', { name: 'Registrar atendimento de Maria Lima' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Desfecho' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Faltou' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(api.last('PATCH', '/staff/appointments/a1')?.body).toMatchObject({ outcome: 'faltou' }))
  })
})

describe('Agendamentos', () => {
  it('lista consultas e exames; concluídos e cancelados não têm ações', async () => {
    mockApi({
      'GET /staff/appointments': [
        ...appointments,
        { id: 'a9', scheduled_at: `${today} 11:00:00`, status: 'concluido', specialty: 'Cardiologia', user_name: 'Rui Neto' },
        { id: 'a8', scheduled_at: `${today} 12:00:00`, status: 'cancelado', specialty: 'Dermato', user_name: 'Eva Dias' },
      ],
      'GET /staff/exams': exams,
    })
    renderStaff('/atendente/agendamentos')
    expect(await screen.findByText('Consultas recentes')).toBeInTheDocument()
    expect(await screen.findByText('Rui Neto')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /atendimento de Rui Neto/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /atendimento de Eva Dias/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirmar atendimento de Maria Lima' })).toBeInTheDocument()
    // pedido confirmado não oferece "Confirmar" de novo
    expect(screen.queryByRole('button', { name: 'Confirmar atendimento de Pedro Alves' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Registrar atendimento de Pedro Alves' })).toBeInTheDocument()
  })
})
