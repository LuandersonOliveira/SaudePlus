import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { json, mockApi, renderApp, seedSession } from '@/test/utils'
import AdminRoutes from '../AdminRoutes'
import {
  countsFor,
  filterProfessionals,
  findProfessional,
  fmtBlockDate,
  normalizeData,
  scheduleBody,
  validateBlock,
  validateOffer,
  validateSchedule,
  type ProfessionalsData,
} from './logic'

const prof = (id: string, name: string, over: object = {}) => ({ id, name, job_title: 'Médico', registry: 'CRM 1', active: 1, user_id: null, ...over })

const data = (): ProfessionalsData =>
  ({
    professionals: [prof('p1', 'Dra. Ana', { user_id: 'u9' }), prof('p2', 'Dr. Beto', { active: 0, job_title: null, registry: null })],
    offers: [{ id: 'o1', professional_id: 'p1', unit_id: 'un1', kind: 'consulta', name: 'Cardiologia', unit_name: 'UBS Centro' }],
    schedules: [{ id: 's1', professional_id: 'p1', unit_id: 'un1', weekday: 1, start_time: '08:00:00', end_time: '12:00:00', slot_minutes: 30, unit_name: 'UBS Centro' }],
    blocks: [{ id: 'b1', professional_id: 'p1', unit_id: 'un1', starts_at: '2026-12-01 08:00:00', ends_at: '2026-12-05 18:00:00', reason: 'Férias', unit_name: 'UBS Centro' }],
  }) as ProfessionalsData

const units = [
  { id: 'un1', name: 'UBS Centro', type: 'ubs', neighborhood: 'Centro', active: 1 },
  { id: 'un2', name: 'UBS Sul', type: 'ubs', neighborhood: 'Sul', active: 1 },
]

function renderPage(level = 'gestor') {
  seedSession({ id: 'g1', role: 'admin', admin_level: level, full_name: 'Gil Gestor', email: 'gil@saude.app' })
  return renderApp(
    <Routes>
      <Route path="/admin/*" element={<AdminRoutes />} />
    </Routes>,
    { route: '/admin/cadastros/profissionais', path: '/*' },
  )
}

const apiTable = (over: Record<string, unknown> = {}) => ({
  'GET /admin/professionals': () => data(),
  'GET /health-units/manage': units,
  'GET /admin/stats': { users: {}, units: {}, diseases: {} },
  'POST /admin/professionals/p1/': { id: 'novo' },
  'POST /admin/professionals': { id: 'p3' },
  'PATCH /admin/professionals/': { ok: true, moved: 0 },
  'DELETE /admin/professionals/p1/': new Response(null, { status: 204 }),
  ...over,
})

const row = (name: string) => screen.getByText(name, { selector: 'p, p *' }).closest('li') as HTMLElement

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('logic', () => {
  it('normaliza os dois formatos da API e acha o profissional pela conta do atendente', () => {
    expect(normalizeData([prof('p1', 'A')]).professionals).toHaveLength(1)
    expect(normalizeData(null).offers).toEqual([])
    const d = data()
    expect(findProfessional(d, { userId: 'u9' })?.id).toBe('p1')
    expect(findProfessional(d, { professionalId: 'p2' })?.id).toBe('p2')
    expect(findProfessional(d, { userId: 'nada' })).toBeNull()
    expect(countsFor(d, 'p1')).toEqual({ offers: 1, schedules: 1, blocks: 1 })
    expect(filterProfessionals(d.professionals, 'BETO')).toHaveLength(1)
  })
  it('valida vínculo, horário e bloqueio', () => {
    expect(validateOffer({ unit_id: '', kind: 'consulta', name: ' ', reason: '' })).toEqual({ unit_id: expect.any(String), name: expect.any(String) })
    const base = { unit_id: 'un1', weekdays: [1], start_time: '08:00', end_time: '12:00', slot_minutes: '30', reason: '' }
    expect(validateSchedule(base)).toEqual({})
    expect(validateSchedule({ ...base, weekdays: [] }).weekdays).toBeTruthy()
    expect(validateSchedule({ ...base, end_time: '08:00' }).end_time).toMatch(/depois do inicial/)
    expect(validateSchedule({ ...base, slot_minutes: '2' }).slot_minutes).toBeTruthy()
    expect(validateBlock({ unit_id: 'un1', starts_at: '2026-12-02T08:00', ends_at: '2026-12-01T08:00', reason: 'x' }).ends_at).toMatch(/depois do início/)
    expect(validateBlock({ unit_id: 'un1', starts_at: '2026-12-01T08:00', ends_at: '2026-12-02T08:00', reason: ' ' }).reason).toBeTruthy()
  })
  it('monta o corpo do horário e formata datas sem fuso', () => {
    expect(scheduleBody({ unit_id: 'un1', weekdays: [1], start_time: '08:00', end_time: '12:00', slot_minutes: '45', reason: ' folga ' }, 3)).toEqual({
      unit_id: 'un1', weekday: 3, start_time: '08:00', end_time: '12:00', slot_minutes: 45, reason: 'folga',
    })
    expect(fmtBlockDate('2026-12-01 08:00:00')).toBe('01/12/2026 08:00')
  })
})

describe('Profissionais', () => {
  it('lista com situação, cargo, registro e contagens', async () => {
    mockApi(apiTable())
    renderPage()
    expect(await screen.findByRole('button', { name: 'Editar Dra. Ana' })).toBeInTheDocument()
    expect(row('Dra. Ana')).toHaveTextContent('Registro: CRM 1 · 1 vínculo(s) · 1 horário(s) · 1 bloqueio(s)')
    expect(within(row('Dra. Ana')).getByText('Ativo')).toBeInTheDocument()
    expect(within(row('Dr. Beto')).getByText('Inativo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ativar Dr. Beto' })).toBeInTheDocument()
  })

  it('erro de carregamento oferece nova tentativa', async () => {
    mockApi(apiTable({ 'GET /admin/professionals': () => json(500, { error: 'x' }) }))
    renderPage()
    expect(await screen.findByText('Erro ao carregar profissionais')).toBeInTheDocument()
  })

  it('cadastra exigindo o nome', async () => {
    const m = mockApi(apiTable())
    const user = userEvent.setup()
    renderPage()
    await screen.findByRole('button', { name: 'Editar Dra. Ana' })
    const form = screen.getByRole('form', { name: 'Cadastrar profissional' })
    await user.click(within(form).getByRole('button', { name: 'Adicionar' }))
    expect(await within(form).findByText('Informe o nome do profissional.')).toBeInTheDocument()
    await user.type(within(form).getByLabelText('Nome'), ' Dr. Caio ')
    await user.type(within(form).getByLabelText('Cargo'), 'Psicólogo')
    await user.click(within(form).getByRole('button', { name: 'Adicionar' }))
    await waitFor(() => expect(m.last('POST', '/admin/professionals')?.body).toEqual({ name: 'Dr. Caio', job_title: 'Psicólogo', registry: '' }))
  })

  it('edita em diálogo', async () => {
    const m = mockApi(apiTable())
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Editar Dra. Ana' }))
    const dlg = await screen.findByRole('dialog')
    const name = within(dlg).getByLabelText('Nome')
    await user.clear(name)
    await user.type(name, 'Dra. Ana Lima')
    await user.click(within(dlg).getByRole('button', { name: 'Salvar alterações' }))
    await waitFor(() => expect(m.last('PATCH', '/admin/professionals/p1')?.body).toMatchObject({ name: 'Dra. Ana Lima' }))
  })

  it('desativar avisa da fila de remarcação; ativar é direto', async () => {
    const m = mockApi(apiTable({ 'PATCH /admin/professionals/p1': { ok: true, moved: 3 } }))
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Desativar Dra. Ana' }))
    const dlg = await screen.findByRole('alertdialog')
    expect(dlg).toHaveTextContent(/fila de remarcação/)
    await user.click(within(dlg).getByRole('button', { name: 'Desativar profissional' }))
    await waitFor(() => expect(m.last('PATCH', '/admin/professionals/p1')?.body).toEqual({ active: 0 }))
    expect(await screen.findByText(/3 atendimento\(s\) foram para a fila de remarcação/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ativar Dr. Beto' }))
    await waitFor(() => expect(m.last('PATCH', '/admin/professionals/p2')?.body).toEqual({ active: 1 }))
  })
})

describe('Gerenciar (vínculos, horários, bloqueios)', () => {
  async function openAgenda() {
    const m = mockApi(apiTable())
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Gerenciar vínculos e agenda de Dra. Ana' }))
    const dlg = await screen.findByRole('dialog')
    return { m, user, dlg }
  }

  it('vínculos: lista, valida, cria e remove com confirmação', async () => {
    const { m, user, dlg } = await openAgenda()
    expect(await within(dlg).findByText('Cardiologia')).toBeInTheDocument()
    const form = within(dlg).getByRole('form', { name: 'Vincular profissional a unidade e serviço' })
    await user.click(within(form).getByRole('button', { name: 'Vincular' }))
    expect(await within(form).findByText('Selecione a unidade.')).toBeInTheDocument()
    await user.click(within(form).getByLabelText('Unidade'))
    await user.click(await screen.findByRole('option', { name: 'UBS Sul' }))
    await user.type(within(form).getByLabelText('Especialidade / exame'), 'Neurologia')
    await user.click(within(form).getByRole('button', { name: 'Vincular' }))
    await waitFor(() => expect(m.last('POST', '/admin/professionals/p1/offers')?.body).toEqual({ unit_id: 'un2', kind: 'consulta', name: 'Neurologia' }))

    await user.click(within(dlg).getByRole('button', { name: 'Remover vínculo com Cardiologia em UBS Centro' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remover vínculo' }))
    await waitFor(() => expect(m.last('DELETE', '/admin/professionals/p1/offers/o1')).toBeDefined())
  })

  it('horários: um POST por dia marcado', async () => {
    const { m, user, dlg } = await openAgenda()
    await user.click(within(dlg).getByRole('tab', { name: 'Horários' }))
    expect(await within(dlg).findByText('08:00–12:00')).toBeInTheDocument()
    const form = within(dlg).getByRole('form', { name: 'Adicionar horário de atendimento' })
    await user.click(within(form).getByRole('button', { name: 'Adicionar horário' }))
    expect(await within(form).findByText('Selecione ao menos um dia da semana.')).toBeInTheDocument()
    await user.click(within(form).getByLabelText('Unidade'))
    await user.click(await screen.findByRole('option', { name: 'UBS Centro' }))
    await user.click(within(form).getByLabelText('Terça'))
    await user.click(within(form).getByLabelText('Quinta'))
    await user.type(within(form).getByLabelText('Início'), '09:00')
    await user.type(within(form).getByLabelText('Fim'), '11:30')
    await user.click(within(form).getByRole('button', { name: 'Adicionar horário' }))
    await waitFor(() => {
      const posts = m.calls.filter((c) => c.method === 'POST' && c.path === '/admin/professionals/p1/schedules')
      expect(posts.map((p) => (p.body as { weekday: number }).weekday)).toEqual([2, 4])
      expect(posts[0].body).toMatchObject({ unit_id: 'un1', start_time: '09:00', end_time: '11:30', slot_minutes: 30 })
    })
    // o aviso da primeira tentativa vazia não pode sobrar depois do envio certo
    expect(within(form).queryByText('Selecione ao menos um dia da semana.')).not.toBeInTheDocument()
    expect(within(form).queryByText('Informe o início.')).not.toBeInTheDocument()
  })

  it('horário repetido (409) aparece com o dia e não perde os outros', async () => {
    const m = mockApi(
      apiTable({
        'POST /admin/professionals/p1/schedules': ({ body }: { body: { weekday: number } }) =>
          body.weekday === 4 ? json(409, { error: 'Este horário já está cadastrado para o profissional.' }) : { id: 'ok' },
      }),
    )
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Gerenciar vínculos e agenda de Dra. Ana' }))
    const dlg = await screen.findByRole('dialog')
    await user.click(within(dlg).getByRole('tab', { name: 'Horários' }))
    const form = await within(dlg).findByRole('form', { name: 'Adicionar horário de atendimento' })
    await user.click(within(form).getByLabelText('Unidade'))
    await user.click(await screen.findByRole('option', { name: 'UBS Centro' }))
    await user.click(within(form).getByLabelText('Terça'))
    await user.click(within(form).getByLabelText('Quinta'))
    await user.type(within(form).getByLabelText('Início'), '09:00')
    await user.type(within(form).getByLabelText('Fim'), '11:30')
    await user.click(within(form).getByRole('button', { name: 'Adicionar horário' }))
    const alert = await within(form).findByRole('alert')
    expect(alert).toHaveTextContent('Quinta: Este horário já está cadastrado para o profissional.')
    expect(alert).toHaveTextContent('já adicionados: Terça')
    expect(m.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/schedules'))).toHaveLength(2)
  })

  it('bloqueios: motivo obrigatório, cria e remove', async () => {
    const { m, user, dlg } = await openAgenda()
    await user.click(within(dlg).getByRole('tab', { name: 'Bloqueios' }))
    expect(await within(dlg).findByText('01/12/2026 08:00 → 05/12/2026 18:00')).toBeInTheDocument()
    const form = within(dlg).getByRole('form', { name: 'Bloquear agenda do profissional' })
    await user.click(within(form).getByLabelText('Unidade'))
    await user.click(await screen.findByRole('option', { name: 'UBS Centro' }))
    await user.type(within(form).getByLabelText('Início'), '2026-12-10T08:00')
    await user.type(within(form).getByLabelText('Fim'), '2026-12-10T12:00')
    await user.click(within(form).getByRole('button', { name: 'Bloquear agenda' }))
    expect(await within(form).findByText(/Informe o motivo/)).toBeInTheDocument()
    await user.type(within(form).getByLabelText('Motivo'), 'Congresso')
    await user.click(within(form).getByRole('button', { name: 'Bloquear agenda' }))
    await waitFor(() =>
      expect(m.last('POST', '/admin/professionals/p1/blocks')?.body).toEqual({ unit_id: 'un1', starts_at: '2026-12-10T08:00', ends_at: '2026-12-10T12:00', reason: 'Congresso' }),
    )
    await user.click(within(dlg).getByRole('button', { name: 'Remover bloqueio de 01/12/2026 08:00' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Remover bloqueio' }))
    await waitFor(() => expect(m.last('DELETE', '/admin/professionals/p1/blocks/b1')).toBeDefined())
  })

  it('nível sem a capability units não enxerga a aba', async () => {
    mockApi(apiTable())
    renderPage('atendimento')
    await waitFor(() => expect(screen.queryByText('Cadastrar profissional')).not.toBeInTheDocument())
  })
})
