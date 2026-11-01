import { describe, expect, it } from 'vitest'
import { buildUserBody, canChangeAdminCredentials, canManage, EMPTY_USER_FORM, linkableProfessionals, rankOf, summaryText, toUserForm } from './logic'
import type { AdminUserDetail } from './types'

const actor = (level: string, id = 'me') => ({ id, role: 'admin', admin_level: level })
const target = (role: string, level: string | null = null, id = 'x') => ({ id, role, admin_level: level })

describe('hierarquia (espelha o servidor)', () => {
  it('rank: nível ausente ou desconhecido vale 0, nunca gestor', () => {
    expect(rankOf('superadmin')).toBe(4)
    expect(rankOf(undefined)).toBe(0)
    expect(rankOf('root')).toBe(0)
  })
  it('ninguém gerencia a própria conta', () => {
    expect(canManage(actor('superadmin', 'a'), target('paciente', null, 'a'))).toBe(false)
  })
  it('admin só gerencia admin de nível estritamente menor', () => {
    expect(canManage(actor('superadmin'), target('admin', 'gestor'))).toBe(true)
    expect(canManage(actor('gestor'), target('admin', 'atendimento'))).toBe(true)
    expect(canManage(actor('gestor'), target('admin', 'gestor'))).toBe(false) // igual
    expect(canManage(actor('gestor'), target('admin', 'superadmin'))).toBe(false) // maior
    expect(canManage(actor('gestor'), target('admin', null))).toBe(true) // alvo sem nível = rank 0
  })
  it('pacientes e atendentes qualquer admin gerencia; quem não é admin nunca gerencia admin', () => {
    expect(canManage(actor('alertas'), target('paciente'))).toBe(true)
    expect(canManage({ id: 'z', role: 'atendente' }, target('admin', 'alertas'))).toBe(false)
  })
  it('só o superadmin troca e-mail/senha de administradores', () => {
    expect(canChangeAdminCredentials('superadmin')).toBe(true)
    expect(canChangeAdminCredentials('gestor')).toBe(false)
    expect(canChangeAdminCredentials(null)).toBe(false)
  })
})

describe('summaryText / linkableProfessionals', () => {
  it('singular e plural', () => {
    expect(summaryText(1)).toBe('1 usuário encontrado.')
    expect(summaryText(0)).toBe('0 usuários encontrados.')
    expect(summaryText(7)).toBe('7 usuários encontrados.')
  })
  it('lista só ativos que estão livres ou são o da própria conta', () => {
    const list = [
      { id: 'a', name: 'A', active: 1, user_id: null },
      { id: 'b', name: 'B', active: 1, user_id: 'outro' },
      { id: 'c', name: 'C', active: 0, user_id: null },
      { id: 'd', name: 'D', active: 1, user_id: 'me' },
    ]
    expect(linkableProfessionals(list, 'd').map((p) => p.id)).toEqual(['a', 'd'])
    expect(linkableProfessionals(list).map((p) => p.id)).toEqual(['a'])
  })
})

const original: AdminUserDetail = {
  id: 'u1', full_name: 'Maria Lima', email: 'maria@x.com', role: 'paciente', account_status: 'ativo', mobile: '8799', job_role: null,
}

describe('buildUserBody — criar', () => {
  const novo = { ...EMPTY_USER_FORM, full_name: ' Ana ', email: ' ana@x.com ', password: 'secreta1', mobile: '' }
  it('exige senha de 6+ caracteres', () => {
    expect(buildUserBody({ ...novo, password: '123' }, {})).toEqual({ ok: false, error: 'Senha deve ter pelo menos 6 caracteres.', field: 'password' })
  })
  it('envia nome/e-mail aparados, papel, status e telefones vazios como null', () => {
    const r = buildUserBody(novo, { actorLevel: 'gestor' })
    expect(r.ok && r.body).toEqual({
      full_name: 'Ana', email: 'ana@x.com', mobile: null, phone: null, job_role: null, password: 'secreta1', role: 'paciente', account_status: 'ativo',
    })
  })
  it('admin_level só com a capability "admins"; profissional só para atendente', () => {
    const adm = { ...novo, role: 'admin' as const, admin_level: 'alertas' as const }
    expect((buildUserBody(adm, { actorLevel: 'gestor' }) as { body: object }).body).not.toHaveProperty('admin_level')
    expect((buildUserBody(adm, { actorLevel: 'superadmin' }) as { body: object }).body).toMatchObject({ admin_level: 'alertas' })
    const at = { ...novo, role: 'atendente' as const, professional_id: 'p9' }
    expect((buildUserBody(at, {}) as { body: object }).body).toMatchObject({ professional_id: 'p9' })
    expect((buildUserBody(novo, {}) as { body: object }).body).not.toHaveProperty('professional_id')
  })
  it('atendente sem profissional escolhido manda null (o servidor cria um automaticamente)', () => {
    const r = buildUserBody({ ...novo, role: 'atendente' }, {})
    expect(r.ok && r.body).toMatchObject({ professional_id: null })
  })
})

describe('buildUserBody — editar', () => {
  const form = toUserForm(original)
  it('toUserForm preenche o formulário e zera senha e motivo', () => {
    expect(form).toMatchObject({ full_name: 'Maria Lima', email: 'maria@x.com', role: 'paciente', password: '', reason: '' })
  })
  it('e-mail igual (mesmo com outra caixa/espaços) NÃO é reenviado; senha vazia também não', () => {
    const r = buildUserBody({ ...form, email: '  MARIA@X.COM ', mobile: '8700' }, { original })
    expect(r.ok && r.body).toEqual({ full_name: 'Maria Lima', mobile: '8700', phone: null, job_role: null })
  })
  it('e-mail diferente é enviado', () => {
    const r = buildUserBody({ ...form, email: 'nova@x.com' }, { original })
    expect(r.ok && r.body).toMatchObject({ email: 'nova@x.com' })
  })
  it('mudar o status exige motivo e o envia como reason e status_notes', () => {
    expect(buildUserBody({ ...form, account_status: 'inativo' }, { original })).toEqual({
      ok: false, error: 'Informe o motivo da alteração de status.', field: 'reason',
    })
    const r = buildUserBody({ ...form, account_status: 'inativo', reason: ' duplicado ' }, { original })
    expect(r.ok && r.body).toMatchObject({ account_status: 'inativo', reason: 'duplicado', status_notes: 'duplicado' })
  })
  it('sem mudar o status, o motivo é ignorado e o status não vai', () => {
    const r = buildUserBody({ ...form, reason: 'qualquer' }, { original })
    expect(r.ok && r.body).not.toHaveProperty('account_status')
    expect(r.ok && r.body).not.toHaveProperty('reason')
  })
  it('papel só vai se mudou; senha nova precisa de 6+ caracteres', () => {
    expect((buildUserBody({ ...form, role: 'atendente' }, { original }) as { body: object }).body).toMatchObject({ role: 'atendente' })
    expect((buildUserBody(form, { original }) as { body: object }).body).not.toHaveProperty('role')
    expect(buildUserBody({ ...form, password: '12' }, { original })).toMatchObject({ ok: false, field: 'password' })
    expect((buildUserBody({ ...form, password: 'nova-senha' }, { original }) as { body: object }).body).toMatchObject({ password: 'nova-senha' })
  })
})
