import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, localDateStr } from '@/features/staff/logic'
import { json, mockApi, renderApp, seedSession } from '@/test/utils'
import PatientRoutes from '../PatientRoutes'
import { draftKey } from './logic'

const today = localDateStr()
const day = addDays(today, 3)

const slotsReply = {
  unidades: [
    {
      id: 'u1', name: 'UBS Centro', type: 'UBS', neighborhood: 'Centro', totalVagas: 3,
      dias: [
        {
          date: day,
          slots: [
            { hora: '09:00', professionals: [{ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Beto' }] },
            { hora: '09:30', professional_id: 'p1', professional_name: 'Ana' },
          ],
        },
      ],
    },
  ],
  totalVagas: 3,
}

const existing = {
  id: 'a1', scheduled_at: `${day} 09:00:00`, status: 'pendente', specialty: 'Pediatria',
  location: 'UBS Centro', unit_id: 'u1', professional_id: 'p1', notes: 'trazer cartão',
}

const api = (over: Record<string, unknown> = {}) =>
  mockApi({
    'GET /catalog/services?tipo=consulta': [{ name: 'Pediatria', unidades: 2 }, { name: 'Cardiologia', unidades: 1 }],
    'GET /catalog/services?tipo=exame': [{ name: 'Hemograma', unidades: 1 }],
    'GET /catalog/slots': slotsReply,
    'GET /health-units': [{ id: 'u1', name: 'UBS Centro', neighborhood: 'Centro' }, { id: 'u2', name: 'UBS Norte' }],
    'GET /me/waitlist': [],
    'GET /me/appointments': [existing],
    'GET /me/exams': [],
    'POST /me/appointments': { id: 'novo' },
    'PUT /me/appointments/a1': { ok: true },
    ...over,
  })

function renderBook(state?: unknown) {
  return renderApp(
    <Routes>
      <Route path="/dashboard/*" element={<PatientRoutes />} />
    </Routes>,
    { route: { pathname: '/dashboard/agendar', state }, path: '/*' },
  )
}

async function chooseService(name: RegExp | string, label = 'Especialidade *') {
  await userEvent.click(await screen.findByRole('combobox', { name: label }))
  await userEvent.click(await screen.findByRole('option', { name }))
}

const consultaForm = () => screen.getByRole('form', { name: 'Agendar consulta' })

beforeEach(() => {
  localStorage.clear()
  seedSession({ id: 'p1', role: 'paciente', full_name: 'Maria Lima', email: 'maria@x.com' })
})
afterEach(() => vi.restoreAllMocks())

describe('Agendar — caminho guiado', () => {
  it('serviço → vagas → vaga com profissional → revisão → POST com o corpo do legado', async () => {
    const m = api()
    renderBook()
    expect(screen.getByRole('button', { name: 'Agendar' })).toBeDisabled()
    await chooseService(/Pediatria/)

    expect(await screen.findByText('3 horário(s) livre(s) em 1 unidade(s).')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /09:00\s*Ana/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /09:00\s*Beto/ }))

    // resumo da vaga + submit liberado
    const resumo = screen.getByLabelText('Vaga escolhida')
    expect(resumo).toHaveTextContent('UBS Centro · Beto')
    await userEvent.type(within(consultaForm()).getByLabelText('Observações'), 'primeira consulta')
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Confirmar agendamento', { selector: 'h2' })).toBeInTheDocument()
    expect(dialog).toHaveTextContent('Beto')
    expect(dialog).toHaveTextContent('primeira consulta')
    expect(m.last('POST', '/me/appointments')).toBeUndefined() // só envia depois de confirmar

    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar agendamento' }))
    await waitFor(() =>
      expect(m.last('POST', '/me/appointments')?.body).toEqual({
        specialty: 'Pediatria', doctor: 'Beto', location: 'UBS Centro', scheduled_at: `${day} 09:00:00`,
        notes: 'primeira consulta', unit_id: 'u1', professional_id: 'p2',
      }),
    )
    expect(await screen.findByText('Consulta agendada')).toBeInTheDocument()
    // formulário volta ao início e o rascunho é descartado
    await waitFor(() => expect(screen.getByRole('button', { name: 'Agendar' })).toBeDisabled())
    expect(screen.queryByLabelText('Vaga escolhida')).not.toBeInTheDocument()
    expect(localStorage.getItem(draftKey('p1', 'appointments'))).toBeNull()
  })

  it('trocar a vaga escolhida limpa o resumo e bloqueia o envio', async () => {
    api()
    renderBook()
    await chooseService(/Pediatria/)
    await userEvent.click(await screen.findByRole('button', { name: /09:30/ }))
    await userEvent.click(within(screen.getByLabelText('Vaga escolhida')).getByRole('button', { name: 'Trocar' }))
    expect(screen.queryByLabelText('Vaga escolhida')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agendar' })).toBeDisabled()
  })

  it('exame usa exam_type e o endpoint de exames', async () => {
    const m = api({ 'POST /me/exams': { id: 'e' } })
    renderBook()
    await userEvent.click(screen.getByRole('tab', { name: 'Exame' }))
    await chooseService('Hemograma', 'Tipo de exame *')
    await userEvent.click(await screen.findByRole('button', { name: /09:30/ }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Agendar' }).find((b) => !(b as HTMLButtonElement).disabled)!)
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar agendamento' }))
    await waitFor(() => expect(m.last('POST', '/me/exams')?.body).toMatchObject({ exam_type: 'Hemograma', professional_id: 'p1', unit_id: 'u1' }))
    expect(m.last('POST', '/me/exams')?.body).not.toHaveProperty('specialty')
  })

  it('erro do servidor na confirmação mantém a revisão aberta com a mensagem', async () => {
    api({ 'POST /me/appointments': () => json(409, { error: 'Esse horário acabou de ser ocupado.' }) })
    renderBook()
    await chooseService(/Pediatria/)
    await userEvent.click(await screen.findByRole('button', { name: /09:30/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Confirmar agendamento' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Esse horário acabou de ser ocupado.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('o estado de uma aba não se perde ao alternar entre Consulta e Exame', async () => {
    api()
    renderBook()
    await chooseService(/Pediatria/)
    await userEvent.click(screen.getByRole('tab', { name: 'Exame' }))
    await userEvent.click(screen.getByRole('tab', { name: 'Consulta' }))
    expect(screen.getByRole('combobox', { name: 'Especialidade *' })).toHaveTextContent('Pediatria')
  })
})

describe('Agendar — sem vagas e caminho manual', () => {
  it('sem vagas mostra o motivo do servidor e permite entrar na lista de espera', async () => {
    const m = api({
      'GET /catalog/slots': { unidades: [], totalVagas: 0, reason: 'Sem horários nos próximos 30 dias.' },
      'POST /me/waitlist': { id: 'w1' },
    })
    renderBook()
    await chooseService(/Pediatria/)
    expect(await screen.findByText('Sem horários nos próximos 30 dias.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Entrar na lista de espera' }))
    await waitFor(() => expect(m.last('POST', '/me/waitlist')?.body).toEqual({ kind: 'consulta', service_name: 'Pediatria' }))
    expect(await screen.findByText('Você entrou na lista de espera. Avisaremos quando abrir vaga.')).toBeInTheDocument()
  })

  it('"Outra (especificar)": serviço digitado + unidade + data/hora, sem profissional', async () => {
    const m = api()
    renderBook()
    await chooseService('Outra (especificar)')
    expect(screen.queryByText(/horário\(s\) livre\(s\)/)).not.toBeInTheDocument() // sem painel de vagas
    const submit = screen.getByRole('button', { name: 'Agendar' })
    expect(submit).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Digite a especialidade'), 'Fisioterapia')
    await userEvent.click(within(consultaForm()).getByRole('combobox', { name: 'Unidade *' }))
    await userEvent.click(await screen.findByRole('option', { name: /UBS Norte/ }))
    fireEvent.change(within(consultaForm()).getByLabelText('Data/hora *'), { target: { value: `${day}T14:30` } })
    expect(submit).toBeEnabled()

    await userEvent.click(submit)
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar agendamento' }))
    await waitFor(() =>
      expect(m.last('POST', '/me/appointments')?.body).toEqual({
        specialty: 'Fisioterapia', doctor: null, location: 'UBS Norte', scheduled_at: `${day} 14:30:00`,
        notes: '', unit_id: 'u2', professional_id: null,
      }),
    )
  })
})

describe('Agendar — editar e refazer', () => {
  it('editar: carrega o registro, pré-seleciona a vaga atual, pede revisão e envia PUT', async () => {
    const m = api()
    renderBook({ mode: 'edit', kind: 'appointments', id: 'a1' })

    expect(await screen.findByText('Editar consulta')).toBeInTheDocument()
    expect(screen.getByText('Você está editando este agendamento.')).toBeInTheDocument()
    const resumo = await screen.findByLabelText('Vaga escolhida')
    expect(resumo).toHaveTextContent('09:00')
    expect(resumo).toHaveTextContent('UBS Centro · Ana')
    expect(within(consultaForm()).getByLabelText('Observações')).toHaveValue('trazer cartão')
    // a vaga do próprio agendamento é liberada na busca (exclude_id)
    expect(m.calls.some((c) => c.path.startsWith('/catalog/slots') && c.path.includes('exclude_id=a1'))).toBe(true)

    await userEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Salvar alterações?', { selector: 'h2' })).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(m.last('PUT', '/me/appointments/a1')?.body).toMatchObject({ specialty: 'Pediatria', professional_id: 'p1', unit_id: 'u1', notes: 'trazer cartão' }))
    expect(m.last('POST', '/me/appointments')).toBeUndefined()
    expect(await screen.findByText('Consulta atualizada')).toBeInTheDocument()
  })

  it('editar: se a vaga original sumiu, avisa e não pré-seleciona nada', async () => {
    api({ 'GET /me/appointments': [{ ...existing, scheduled_at: `${day} 11:00:00` }] })
    renderBook({ mode: 'edit', kind: 'appointments', id: 'a1' })
    expect(await screen.findByText('A vaga original não está mais livre — escolha outro horário.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Vaga escolhida')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeDisabled()
  })

  it('editar: serviço fora do catálogo cai no caminho manual com unidade e data atuais', async () => {
    api({ 'GET /me/appointments': [{ ...existing, specialty: 'Acupuntura' }] })
    renderBook({ mode: 'edit', kind: 'appointments', id: 'a1' })
    expect(await screen.findByLabelText('Digite a especialidade')).toHaveValue('Acupuntura')
    expect(within(consultaForm()).getByLabelText('Data/hora *')).toHaveValue(`${day}T09:00`)
    expect(screen.getByRole('button', { name: 'Salvar alterações' })).toBeEnabled()
  })

  it('"Cancelar edição" volta ao formulário de novo agendamento', async () => {
    api()
    renderBook({ mode: 'edit', kind: 'appointments', id: 'a1' })
    await screen.findByText('Editar consulta')
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar edição' }))
    expect(await screen.findByText('Agendar consulta', { selector: '[data-slot=card-title]' })).toBeInTheDocument()
    expect(screen.queryByText('Você está editando este agendamento.')).not.toBeInTheDocument()
  })

  it('refazer: serviço preenchido, observações vazias, aviso e POST (não PUT)', async () => {
    const m = api({ 'GET /me/appointments': [{ ...existing, status: 'cancelado' }] })
    renderBook({ mode: 'rebook', kind: 'appointments', id: 'a1' })
    expect(await screen.findByText('Escolha uma nova data e horário para concluir o agendamento.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Especialidade *' })).toHaveTextContent('Pediatria'))
    expect(within(consultaForm()).getByLabelText('Observações')).toHaveValue('')
    expect(screen.queryByText('Você está editando este agendamento.')).not.toBeInTheDocument()

    await userEvent.click(await screen.findByRole('button', { name: /09:30/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Agendar' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Confirmar agendamento' }))
    await waitFor(() => expect(m.last('POST', '/me/appointments')).toBeDefined())
    expect(m.last('PUT', '/me/appointments')).toBeUndefined()
  })

  it('intenção apontando para um agendamento inexistente é ignorada sem travar o formulário', async () => {
    api()
    renderBook({ mode: 'edit', kind: 'appointments', id: 'nao-existe' })
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Especialidade *' })).toBeEnabled())
    expect(screen.queryByText('Editar consulta')).not.toBeInTheDocument()
    expect(screen.getByText('Agendar consulta', { selector: '[data-slot=card-title]' })).toBeInTheDocument()
  })
})

describe('Agendar — rascunho', () => {
  const draft = (over: object = {}) =>
    JSON.stringify({
      v: 2, servico: 'Pediatria', manual: false, manualService: '', manualUnitId: '', manualWhen: '', notes: 'trazer cartão',
      selecao: { unit_id: 'u1', unit_name: 'UBS Centro', professional_id: 'p1', professional_name: 'Ana', date: day, hora: '09:00', scheduled_at: `${day} 09:00:00` },
      ...over,
    })

  it('restaura serviço, observações e a vaga (se ainda livre) e avisa', async () => {
    api()
    localStorage.setItem(draftKey('p1', 'appointments'), draft())
    renderBook()
    expect(await screen.findByText('Rascunho recuperado — confira e confirme.')).toBeInTheDocument()
    expect(within(consultaForm()).getByLabelText('Observações')).toHaveValue('trazer cartão')
    expect(await screen.findByLabelText('Vaga escolhida')).toHaveTextContent('UBS Centro · Ana')
    expect(screen.getByRole('button', { name: 'Agendar' })).toBeEnabled()
  })

  it('vaga do rascunho que já não existe é descartada em silêncio; o resto é mantido', async () => {
    api()
    localStorage.setItem(draftKey('p1', 'appointments'), draft({ selecao: { unit_id: 'u1', unit_name: 'UBS Centro', professional_id: 'p1', professional_name: 'Ana', date: day, hora: '16:00', scheduled_at: `${day} 16:00:00` } }))
    renderBook()
    await screen.findByText('3 horário(s) livre(s) em 1 unidade(s).')
    expect(screen.queryByLabelText('Vaga escolhida')).not.toBeInTheDocument()
    expect(screen.queryByText(/não está mais livre/)).not.toBeInTheDocument()
    expect(within(consultaForm()).getByLabelText('Observações')).toHaveValue('trazer cartão')
  })

  it('rascunho de serviço que saiu do catálogo é ignorado', async () => {
    api()
    localStorage.setItem(draftKey('p1', 'appointments'), draft({ servico: 'Serviço Extinto' }))
    renderBook()
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Especialidade *' })).toBeEnabled())
    expect(screen.queryByText('Rascunho recuperado — confira e confirme.')).not.toBeInTheDocument()
    expect(within(consultaForm()).getByLabelText('Observações')).toHaveValue('')
  })

  it('grava o rascunho ao digitar e "Cancelar" o descarta', async () => {
    api()
    renderBook()
    await waitFor(() => expect(within(consultaForm()).getByLabelText('Observações')).toBeEnabled())
    await userEvent.type(within(consultaForm()).getByLabelText('Observações'), 'rascunho novo')
    await waitFor(() => expect(JSON.parse(localStorage.getItem(draftKey('p1', 'appointments')) ?? 'null')).toMatchObject({ v: 2, notes: 'rascunho novo' }), { timeout: 3000 })

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(localStorage.getItem(draftKey('p1', 'appointments'))).toBeNull()
    expect(within(consultaForm()).getByLabelText('Observações')).toHaveValue('')
  })

  it('edição nunca grava rascunho', async () => {
    api()
    renderBook({ mode: 'edit', kind: 'appointments', id: 'a1' })
    await screen.findByText('Editar consulta')
    await userEvent.type(within(consultaForm()).getByLabelText('Observações'), ' extra')
    await new Promise((r) => setTimeout(r, 700))
    expect(localStorage.getItem(draftKey('p1', 'appointments'))).toBeNull()
  })
})

describe('Lista de espera', () => {
  const entries = [
    { id: 'w1', kind: 'consulta', service_name: 'Cardiologia', status: 'aguardando', created_at: '2026-10-20 08:00:00' },
    { id: 'w2', kind: 'exame', service_name: 'Hemograma', status: 'convertido', created_at: '2026-10-10 08:00:00' },
    { id: 'w3', kind: 'consulta', service_name: 'Pediatria', status: 'cancelado', created_at: '2026-10-05 08:00:00' },
  ]

  it('mostra o estado de cada entrada; só "aguardando" pode sair', async () => {
    api({ 'GET /me/waitlist': entries })
    renderBook()
    expect(await screen.findByText('Aguardando vaga')).toBeInTheDocument()
    expect(screen.getByText('Vaga convertida em agendamento')).toBeInTheDocument()
    expect(screen.getByText('Cancelada')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Sair da lista de espera:/ })).toHaveLength(1)
  })

  it('sair pede confirmação (sem window.confirm) e chama DELETE', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const m = api({ 'GET /me/waitlist': entries, 'DELETE /me/waitlist/w1': { ok: true } })
    renderBook()
    await userEvent.click(await screen.findByRole('button', { name: 'Sair da lista de espera: Cardiologia' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(m.last('DELETE', '/me/waitlist')).toBeUndefined()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Sair da lista' }))
    await waitFor(() => expect(m.last('DELETE', '/me/waitlist/w1')).toBeDefined())
    expect(await screen.findByText('Você saiu da lista de espera.')).toBeInTheDocument()
    expect(confirmSpy).not.toHaveBeenCalled()
  })

  it('lista vazia mostra a mensagem', async () => {
    api()
    renderBook()
    expect(await screen.findByText('Nenhum serviço na lista de espera.')).toBeInTheDocument()
  })
})
