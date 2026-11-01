import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, localDateStr } from '@/features/staff/logic'
import { json, mockApi, renderApp, seedSession } from '@/test/utils'
import AdminRoutes from './AdminRoutes'

const today = localDateStr()
const row = (id: string, day: string, status: string, over: object = {}) => ({
  id, scheduled_at: `${day} 09:00:00`, status, user_name: 'Maria Lima', specialty: 'Pediatria', doctor: 'Dr. Paulo', location: 'UBS Centro', ...over,
})

const appts = [
  row('a1', today, 'pendente'),
  row('a2', today, 'confirmado', { user_name: 'Pedro Alves', specialty: 'Cardiologia' }),
  row('a3', addDays(today, 2), 'pendente', { user_name: 'Lia Costa' }),
  row('a4', addDays(today, 1), 'cancelado', { user_name: 'Eva Dias' }),
]
const exams = [
  row('e1', today, 'pendente', { user_name: 'João Reis', exam_type: 'Hemograma', specialty: undefined, doctor: undefined }),
  row('e2', today, 'concluido', { user_name: 'Rui Neto', exam_type: 'Raio-X', specialty: undefined, doctor: undefined }),
]

const baseApi = {
  'GET /admin/stats': { users: { total: 1, pending: 0, inactive: 0 }, units: { total: 1, active: 1 }, diseases: { total: 0, active: 0 } },
  'GET /admin/appointments': { data: appts, total: appts.length },
  'GET /admin/exams': { data: exams, total: exams.length },
  'GET /admin/audit-log': [],
  'GET /staff/agenda/month': { days: [] },
  'GET /staff/agenda?': { items: [], summary: { total: 0 } },
  'GET /health-units': [],
  'PATCH /admin/': { ok: true },
}

function renderPage(level = 'gestor') {
  seedSession({ id: 'a1', role: 'admin', admin_level: level, full_name: 'Ana Admin', email: 'ana@saude.app' })
  return renderApp(
    <Routes>
      <Route path="/admin/*" element={<AdminRoutes />} />
    </Routes>,
    { route: '/admin/atendimentos', path: '/*' },
  )
}

// O título também aparece na <caption> (sr-only) da tabela, dentro do mesmo cartão: qualquer ocorrência serve.
const card = (title: string) => screen.getAllByText(title)[0].closest('[data-slot=card]') as HTMLElement
const menuFor = (scope: HTMLElement, who: string, kind = 'consulta') =>
  within(scope).getByRole('button', { name: new RegExp(`Ações para ${kind} de ${who}`) })

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('Agenda de hoje', () => {
  it('só os de hoje, separados em consultas e exames', async () => {
    mockApi(baseApi)
    renderPage()
    const hoje = await waitFor(() => {
      const c = card('Agenda de hoje')
      expect(within(c).getByText('Maria Lima')).toBeInTheDocument()
      return c
    })
    expect(within(hoje).getByText('Consultas de hoje')).toBeInTheDocument()
    expect(within(hoje).getByText('Exames de hoje')).toBeInTheDocument()
    expect(within(hoje).getByText('Pedro Alves')).toBeInTheDocument()
    expect(within(hoje).getByText('João Reis')).toBeInTheDocument()
    expect(within(hoje).queryByText('Lia Costa')).not.toBeInTheDocument() // depois de amanhã
    expect(within(hoje).queryByText('Eva Dias')).not.toBeInTheDocument() // amanhã
  })

  it('sem nada hoje mostra a mensagem', async () => {
    mockApi({ ...baseApi, 'GET /admin/appointments': { data: [appts[2]], total: 1 }, 'GET /admin/exams': { data: [], total: 0 } })
    renderPage()
    expect(await screen.findByText('Nada agendado para hoje.')).toBeInTheDocument()
  })

  it('erro ao carregar mostra a falha com "Tentar de novo"', async () => {
    mockApi({ ...baseApi, 'GET /admin/appointments': () => json(500, { error: 'x' }) })
    renderPage()
    expect(await within(await waitFor(() => card('Agenda de hoje'))).findByText('Não foi possível carregar os dados')).toBeInTheDocument()
  })

  it('teto de páginas estourado avisa que o resumo pode estar incompleto', async () => {
    // sempre devolve datas futuras e um total enorme: 5 páginas e ainda sobra
    mockApi({ ...baseApi, 'GET /admin/appointments': () => ({ data: [row('x', addDays(today, 3), 'pendente')], total: 9999 }) })
    renderPage()
    expect(await screen.findByText(/Há mais de 500 registros futuros no total/)).toBeInTheDocument()
  })
})

describe('ações por status', () => {
  it('pendente e confirmado têm menu; concluído e cancelado ficam sem ação', async () => {
    mockApi(baseApi)
    renderPage()
    const hoje = await waitFor(() => {
      const c = card('Agenda de hoje')
      expect(within(c).getByText('Maria Lima')).toBeInTheDocument()
      return c
    })
    expect(menuFor(hoje, 'Maria Lima')).toBeInTheDocument()
    expect(menuFor(hoje, 'Pedro Alves')).toBeInTheDocument()
    expect(menuFor(hoje, 'João Reis', 'exame')).toBeInTheDocument()
    expect(within(hoje).queryByRole('button', { name: /Ações para exame de Rui Neto/ })).not.toBeInTheDocument()

    await userEvent.click(menuFor(hoje, 'Maria Lima'))
    expect((await screen.findAllByRole('menuitem')).map((i) => i.textContent)).toEqual(['Confirmar', 'Reagendar', 'Cancelar'])
  })
})

describe('Confirmar', () => {
  it('PATCH /admin/<tipo>/<id> só com o status (rota do admin, não a do atendente)', async () => {
    const m = mockApi(baseApi)
    renderPage()
    const hoje = await waitFor(() => {
      const c = card('Agenda de hoje')
      expect(within(c).getByText('João Reis')).toBeInTheDocument()
      return c
    })
    await userEvent.click(menuFor(hoje, 'João Reis', 'exame'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Confirmar' }))
    await waitFor(() => expect(m.last('PATCH', '/admin/exams/e1')?.body).toEqual({ status: 'confirmado' }))
    expect(m.calls.some((c) => c.path.startsWith('/staff') && c.method === 'PATCH')).toBe(false)
    expect(await screen.findByText('Atualizado')).toBeInTheDocument()
  })

  it('erro do servidor aparece como aviso', async () => {
    mockApi({ ...baseApi, 'PATCH /admin/appointments/a1': () => json(409, { error: 'Horário indisponível.' }) })
    renderPage()
    const hoje = await waitFor(() => {
      const c = card('Agenda de hoje')
      expect(within(c).getByText('Maria Lima')).toBeInTheDocument()
      return c
    })
    await userEvent.click(menuFor(hoje, 'Maria Lima'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Confirmar' }))
    expect(await screen.findByText('Horário indisponível.')).toBeInTheDocument()
  })
})

describe('Cancelar', () => {
  it('pede confirmação dizendo de quem é e quando, e só então envia', async () => {
    const m = mockApi(baseApi)
    renderPage()
    const hoje = await waitFor(() => {
      const c = card('Agenda de hoje')
      expect(within(c).getByText('Maria Lima')).toBeInTheDocument()
      return c
    })
    await userEvent.click(menuFor(hoje, 'Maria Lima'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancelar' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Cancelar a consulta?')
    expect(dialog).toHaveTextContent('Maria Lima')
    expect(dialog).toHaveTextContent('não dá para desfazer por aqui')
    expect(m.last('PATCH', '/admin/')).toBeUndefined()

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar o atendimento' }))
    await waitFor(() => expect(m.last('PATCH', '/admin/appointments/a1')?.body).toEqual({ status: 'cancelado' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('exame usa o texto "o exame"; "Voltar" não envia nada', async () => {
    const m = mockApi(baseApi)
    renderPage()
    const hoje = await waitFor(() => {
      const c = card('Agenda de hoje')
      expect(within(c).getByText('João Reis')).toBeInTheDocument()
      return c
    })
    await userEvent.click(menuFor(hoje, 'João Reis', 'exame'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancelar' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Cancelar o exame?')
    expect(within(dialog).getByRole('button', { name: 'Cancelar o exame' })).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Voltar' }))
    expect(m.last('PATCH', '/admin/')).toBeUndefined()
  })

  it('erro ao cancelar mantém o diálogo aberto com a mensagem', async () => {
    mockApi({ ...baseApi, 'PATCH /admin/appointments/a1': () => json(400, { error: 'Já foi concluída.' }) })
    renderPage()
    const hoje = await waitFor(() => {
      const c = card('Agenda de hoje')
      expect(within(c).getByText('Maria Lima')).toBeInTheDocument()
      return c
    })
    await userEvent.click(menuFor(hoje, 'Maria Lima'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Cancelar' }))
    const dialog = await screen.findByRole('alertdialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancelar o atendimento' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Já foi concluída.')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})

describe('Reagendar', () => {
  async function open() {
    const m = mockApi(baseApi)
    renderPage()
    const hoje = await waitFor(() => {
      const c = card('Agenda de hoje')
      expect(within(c).getByText('Maria Lima')).toBeInTheDocument()
      return c
    })
    await userEvent.click(menuFor(hoje, 'Maria Lima'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reagendar' }))
    return { m, dialog: await screen.findByRole('dialog') }
  }

  it('exige a data e recusa passado, sem enviar', async () => {
    const { m, dialog } = await open()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    expect(await within(dialog).findByText('Selecione uma data e hora válidas')).toBeInTheDocument()
    fireEvent.change(within(dialog).getByLabelText('Data/hora'), { target: { value: `${addDays(today, -1)}T10:00` } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    expect(await within(dialog).findByText('A nova data não pode estar no passado.')).toBeInTheDocument()
    expect(m.last('PATCH', '/admin/')).toBeUndefined()
  })

  it('envia a nova data COM o motivo (o servidor recusa sem ele, também para o admin) e fecha', async () => {
    const { m, dialog } = await open()
    const novo = addDays(today, 4)
    fireEvent.change(within(dialog).getByLabelText('Data/hora'), { target: { value: `${novo}T14:30` } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
      expect(m.last('PATCH', '/admin/appointments/a1')?.body).toEqual({
        scheduled_at: `${novo} 14:30:00`,
        reschedule_reason: 'solicitado_pelo_paciente',
      }),
    )
    expect(await screen.findByText('Reagendado com sucesso')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('Reagendar — motivo escolhido', () => {
  it('permite trocar o motivo da remarcação', async () => {
    const m = mockApi(baseApi)
    renderPage()
    const hoje = await waitFor(() => {
      const c = card('Agenda de hoje')
      expect(within(c).getByText('Maria Lima')).toBeInTheDocument()
      return c
    })
    await userEvent.click(menuFor(hoje, 'Maria Lima'))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reagendar' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Motivo da remarcação' }))
    await userEvent.click(await screen.findByRole('option', { name: 'Profissional inativado' }))
    fireEvent.change(within(dialog).getByLabelText('Data/hora'), { target: { value: `${addDays(today, 5)}T08:00` } })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar' }))
    await waitFor(() => expect(m.last('PATCH', '/admin/appointments/a1')?.body).toMatchObject({ reschedule_reason: 'profissional_inativado' }))
  })
})

describe('Consultas e exames recentes', () => {
  const many = Array.from({ length: 45 }, (_, i) => row(`m${i}`, addDays(today, 10 + i), 'pendente', { user_name: `Paciente ${i}` }))

  it('"Carregar mais" revela 20 por vez até acabar', async () => {
    mockApi({ ...baseApi, 'GET /admin/appointments': { data: many, total: 45 } })
    renderPage()
    const recent = await waitFor(() => {
      const c = card('Consultas recentes')
      expect(within(c).getByText('Paciente 0')).toBeInTheDocument()
      return c
    })
    expect(within(recent).getAllByRole('row')).toHaveLength(1 + 20)
    await userEvent.click(within(recent).getByRole('button', { name: 'Carregar mais 20 consultas' }))
    expect(within(recent).getAllByRole('row')).toHaveLength(1 + 40)
    await userEvent.click(within(recent).getByRole('button', { name: 'Carregar mais 5 consultas' }))
    expect(within(recent).getAllByRole('row')).toHaveLength(1 + 45)
    expect(within(recent).getByText('45 registro(s) carregado(s).')).toBeInTheDocument()
    expect(within(recent).queryByRole('button', { name: /Carregar mais/ })).not.toBeInTheDocument()
  })

  it('estados vazios', async () => {
    mockApi({ ...baseApi, 'GET /admin/appointments': { data: [], total: 0 }, 'GET /admin/exams': { data: [], total: 0 } })
    renderPage()
    expect(await screen.findByText('Sem consultas.')).toBeInTheDocument()
    expect(screen.getByText('Sem exames.')).toBeInTheDocument()
  })

  it('exames não têm colunas de médico; consultas têm', async () => {
    mockApi(baseApi)
    renderPage()
    const e = await waitFor(() => {
      const c = card('Exames recentes')
      // o serviço aparece na coluna (desktop) e sob o nome do paciente (celular)
      expect(within(c).getAllByText('Hemograma').length).toBeGreaterThan(0)
      return c
    })
    expect(within(e).queryByRole('columnheader', { name: 'Médico' })).not.toBeInTheDocument()
    expect(within(e).getByRole('columnheader', { name: 'Tipo de exame' })).toBeInTheDocument()
    expect(within(card('Consultas recentes')).getByRole('columnheader', { name: 'Médico' })).toBeInTheDocument()
  })
})

describe('Agenda operacional e acesso', () => {
  it('inclui a agenda operacional (mesma do atendente) com Novo agendamento e Relatório', async () => {
    mockApi(baseApi)
    renderPage()
    expect(await screen.findByText('Agenda operacional')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Novo agendamento' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Relatório' })).toBeInTheDocument()
  })

  it('o nível "atendimento" acessa a página', async () => {
    mockApi(baseApi)
    renderPage('atendimento')
    expect(await screen.findByText('Agenda de hoje')).toBeInTheDocument()
  })
})
