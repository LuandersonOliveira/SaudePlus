import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi, renderApp, seedSession } from '@/test/utils'
import { addDays, localDateStr } from './logic'
import { AgendaPage } from './pages/AgendaPage'

const today = localDateStr()

const item = (over: object) => ({
  kind: 'consulta',
  id: 'x',
  scheduled_at: `${today} 09:00:00`,
  duration_minutes: 30,
  status: 'pendente',
  outcome: null,
  reschedule_reason: null,
  service_name: 'Clínico Geral',
  user_id: 'p1',
  user_name: 'Maria Lima',
  user_priority: 'idoso',
  professional_name: 'Dr. Paulo',
  unit_name: 'UBS Centro',
  ...over,
})

const dayReply = {
  items: [
    item({ id: 'c1' }),
    item({ id: 'c2', scheduled_at: `${today} 10:00:00`, status: 'para_remarcar', user_name: 'Pedro Alves', user_priority: null }),
    item({ id: 'e1', kind: 'exame', scheduled_at: `${today} 11:00:00`, service_name: 'Hemograma', user_name: 'João Reis', status: 'confirmado' }),
  ],
  summary: { total: 3, pendente: 1, confirmado: 1, para_remarcar: 1, concluido: 0, cancelado: 0, consultas: 2, exames: 1 },
}

const api = () =>
  mockApi({
    'GET /staff/agenda/month': { days: [{ date: today, total: 3 }] },
    'GET /staff/agenda?': dayReply,
    'GET /health-units': [{ id: 'u1', name: 'UBS Centro' }, { id: 'u2', name: 'UBS Norte' }],
    'GET /staff/agenda/reports': {
      total: 40, totals: { confirmados: 10, concluidos: 20, cancelados: 5, para_remarcar: 3, faltas: 2 },
      occupancy_rate: 0.75, absence_rate: null,
    },
    'GET /staff/booking-events': [{ event_type: 'criado', created_at: `${today} 08:00:00`, reason: null }, { event_type: 'remarcado', created_at: `${today} 08:30:00`, reason: 'solicitado_pelo_paciente' }],
  })

beforeEach(() => {
  localStorage.clear()
  seedSession()
})
afterEach(() => vi.restoreAllMocks())

describe('Agenda operacional', () => {
  it('carrega o dia de hoje com resumo e colunas na ordem Prioridade → Status', async () => {
    const m = api()
    renderApp(<AgendaPage />)
    expect(await screen.findByText('Pedro Alves')).toBeInTheDocument()

    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['Horário', 'Paciente', 'Serviço', 'Prioridade', 'Status', 'Ações'])

    // a prioridade aparece na coluna de prioridade (o legado trocava com o status)
    const row = screen.getByText('Maria Lima').closest('tr')!
    const cells = within(row).getAllByRole('cell')
    expect(cells[3]).toHaveTextContent('idoso')
    expect(cells[4]).toHaveTextContent('Pendente')
    expect(cells[0]).toHaveTextContent('09:00 (30 min)')

    expect(screen.getByText('Total: 3')).toBeInTheDocument()
    expect(screen.getByText('Para remarcar: 1')).toBeInTheDocument()
    expect(m.calls.find((c) => c.path.startsWith('/staff/agenda?'))?.path).toContain(`date=${today}`)
  })

  it('aba "Para remarcar" filtra só esse status', async () => {
    api()
    renderApp(<AgendaPage />)
    await screen.findByText('Maria Lima')
    await userEvent.click(screen.getByRole('tab', { name: 'Para remarcar' }))
    expect(screen.getByText('Pedro Alves')).toBeInTheDocument()
    expect(screen.queryByText('Maria Lima')).not.toBeInTheDocument()
    expect(screen.queryByText('João Reis')).not.toBeInTheDocument()
  })

  it('o menu de ações respeita o status: "para remarcar" só remarca/cancela; pendente tem tudo', async () => {
    api()
    renderApp(<AgendaPage />)
    await screen.findByText('Pedro Alves')

    await userEvent.click(screen.getByRole('button', { name: 'Ações de Pedro Alves' }))
    let items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
    expect(items).toEqual(['Remarcar', 'Cancelar', 'Histórico'])
    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByRole('button', { name: 'Ações de Maria Lima' }))
    items = (await screen.findAllByRole('menuitem')).map((i) => i.textContent)
    expect(items).toEqual(['Confirmar', 'Registrar', 'Remarcar', 'Cancelar', 'Histórico'])
  })

  it('agrupa a ação no recurso certo: exame vai para /staff/exams', async () => {
    const m = api()
    renderApp(<AgendaPage />)
    await screen.findByText('João Reis')
    await userEvent.click(screen.getByRole('button', { name: 'Ações de João Reis' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Registrar' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(m.calls.some((c) => c.method === 'PATCH' && c.path === '/staff/exams/e1')).toBe(true))
  })

  it('histórico lista os eventos do atendimento (e não usa alert())', async () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})
    const m = api()
    renderApp(<AgendaPage />)
    await screen.findByText('Maria Lima')
    await userEvent.click(screen.getByRole('button', { name: 'Ações de Maria Lima' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Histórico' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('remarcado')).toBeInTheDocument()
    expect(within(dialog).getByText(/Motivo: solicitado_pelo_paciente/)).toBeInTheDocument()
    expect(m.calls.find((c) => c.path.startsWith('/staff/booking-events'))?.path).toBe('/staff/booking-events?kind=consulta&booking_id=c1')
    expect(alertSpy).not.toHaveBeenCalled()
  })

  it('relatório mostra totais e "n/d" quando a taxa não existe', async () => {
    api()
    renderApp(<AgendaPage />)
    await screen.findByText('Maria Lima')
    await userEvent.click(screen.getByRole('button', { name: 'Relatório' }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText('Ocupação')).toBeInTheDocument()
    expect(within(dialog).getByText('75%')).toBeInTheDocument()
    expect(within(dialog).getByText('n/d')).toBeInTheDocument()
    expect(within(dialog).getByText('Faltas').nextSibling).toHaveTextContent('2')
  })

  it('trocar a unidade refaz a consulta com unit_id', async () => {
    const m = api()
    renderApp(<AgendaPage />)
    await screen.findByText('Maria Lima')
    await userEvent.click(screen.getByRole('combobox', { name: 'Unidade' }))
    await userEvent.click(await screen.findByRole('option', { name: 'UBS Norte' }))
    await waitFor(() => expect(m.calls.some((c) => c.path.startsWith('/staff/agenda?') && c.path.includes('unit_id=u2'))).toBe(true))
  })
})

describe('Novo agendamento', () => {
  it('monta o POST com unidade → serviço → profissional escolhidos em listas', async () => {
    const m = mockApi({
      'GET /staff/agenda/month': { days: [] },
      'GET /staff/agenda?': { items: [], summary: { total: 0 } },
      'GET /health-units': [{ id: 'u1', name: 'UBS Centro' }],
      'GET /staff/patients': [
        { id: 'p1', full_name: 'Maria Lima', email: 'maria@x.com', account_status: 'ativo' },
        { id: 'p2', full_name: 'Maria Inativa', email: 'in@x.com', account_status: 'inativo' },
      ],
      'GET /catalog/offers': ['Clínico Geral', 'Pediatria'],
      'GET /catalog/professionals': [{ id: 'pr1', name: 'Dr. Paulo', job_title: 'Médico' }],
      'POST /staff/appointments': { id: 'novo' },
    })
    renderApp(<AgendaPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Novo agendamento' }))
    const dialog = await screen.findByRole('dialog')

    // paciente: a conta inativa não pode receber agendamento
    await userEvent.type(within(dialog).getByLabelText('Paciente *'), 'Maria')
    expect(await within(dialog).findByRole('button', { name: /Maria Lima/ })).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Maria Inativa/ })).not.toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: /Maria Lima/ }))

    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Unidade *' }))
    await userEvent.click(await screen.findByRole('option', { name: 'UBS Centro' }))
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Especialidade *' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Pediatria' }))
    await userEvent.click(within(dialog).getByRole('combobox', { name: /Profissional/ }))
    await userEvent.click(await screen.findByRole('option', { name: /Dr\. Paulo/ }))

    const quando = addDays(today, 2)
    fireEvent.change(within(dialog).getByLabelText('Data e hora *'), { target: { value: `${quando}T09:15` } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))

    await waitFor(() =>
      expect(m.last('POST', '/staff/appointments')?.body).toEqual({
        user_id: 'p1',
        unit_id: 'u1',
        professional_id: 'pr1',
        scheduled_at: `${quando} 09:15:00`,
        location: 'UBS',
        specialty: 'Pediatria',
      }),
    )
    // a agenda navega para o dia criado
    await waitFor(() => expect(screen.getByLabelText('Data')).toHaveValue(quando))
  })

  it('exige o profissional quando o serviço tem profissionais (o servidor recusa sem ele)', async () => {
    const m = mockApi({
      'GET /staff/agenda/month': { days: [] },
      'GET /staff/agenda?': { items: [], summary: { total: 0 } },
      'GET /health-units': [{ id: 'u1', name: 'UBS Centro' }],
      'GET /staff/patients': [{ id: 'p1', full_name: 'Maria Lima', email: 'maria@x.com', account_status: 'ativo' }],
      'GET /catalog/offers': ['Pediatria'],
      'GET /catalog/professionals': [{ id: 'pr1', name: 'Dr. Paulo' }],
    })
    renderApp(<AgendaPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Novo agendamento' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.type(within(dialog).getByLabelText('Paciente *'), 'Maria')
    await userEvent.click(await within(dialog).findByRole('button', { name: /Maria Lima/ }))
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Unidade *' }))
    await userEvent.click(await screen.findByRole('option', { name: 'UBS Centro' }))
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Especialidade *' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Pediatria' }))

    // com profissionais disponíveis não existe a opção "sem profissional"
    await userEvent.click(await within(dialog).findByRole('combobox', { name: /Profissional/ }))
    expect(screen.queryByRole('option', { name: 'Sem profissional definido' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Escape}')

    fireEvent.change(within(dialog).getByLabelText('Data e hora *'), { target: { value: `${addDays(today, 2)}T09:15` } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    expect(await within(dialog).findByText('Selecione o profissional.')).toBeInTheDocument()
    expect(m.last('POST', '/staff')).toBeUndefined()
  })

  it('valida os campos obrigatórios em ordem, sem chamar a API', async () => {
    const m = mockApi({
      'GET /staff/agenda/month': { days: [] },
      'GET /staff/agenda?': { items: [], summary: { total: 0 } },
      'GET /health-units': [],
    })
    renderApp(<AgendaPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Novo agendamento' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    expect(await within(dialog).findByText('Selecione o paciente.')).toBeInTheDocument()
    expect(m.last('POST', '/staff')).toBeUndefined()
  })
})
