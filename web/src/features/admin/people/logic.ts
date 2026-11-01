import { can } from '../capabilities'
import type { AdminUserDetail, AdminUserRow, ProfessionalOption, UserFormValues } from './types'

/** Hierarquia de privilégio. ESPELHA LEVEL_RANK de server/src/routes/admin.users.routes.js. */
export const LEVEL_RANK: Record<string, number> = { superadmin: 4, gestor: 3, atendimento: 2, alertas: 1 }

/** Nível ausente ou desconhecido vale 0 (fail-closed), nunca "gestor". */
export const rankOf = (level?: string | null) => (level && LEVEL_RANK[level]) || 0

export const ROLE_LABEL: Record<string, string> = { paciente: 'Paciente', atendente: 'Atendente', admin: 'Administrador' }
export const STATUS_LABEL: Record<string, string> = { ativo: 'Ativo', pendente: 'Pendente (aguardando ativação)', inativo: 'Inativo' }
export const LEVEL_LABEL: Record<string, string> = { superadmin: 'Superadmin', gestor: 'Gestor', atendimento: 'Atendimento', alertas: 'Alertas' }

export interface Actor {
  id?: string | number
  role?: string
  admin_level?: string | null
}

/**
 * O ator pode alterar/excluir esta conta? Espelha o servidor: não a própria (use "Minha conta"), e um
 * administrador só mexe em outro de nível ESTRITAMENTE menor. O servidor continua sendo a autoridade (403).
 */
export function canManage(actor: Actor, target: Pick<AdminUserRow, 'id' | 'role' | 'admin_level'>): boolean {
  if (String(target.id) === String(actor.id)) return false
  if (target.role === 'admin') {
    if (actor.role !== 'admin') return false
    if (rankOf(actor.admin_level) <= rankOf(target.admin_level)) return false
  }
  return true
}

/** Trocar e-mail ou senha de um administrador exige a capability 'admins' (só o superadmin). */
export const canChangeAdminCredentials = (level?: string | null) => can(level, 'admins')

/** Resumo "N usuários encontrados." */
export const summaryText = (total: number) => (total === 1 ? '1 usuário encontrado.' : `${total} usuários encontrados.`)

/** Profissionais que podem ser vinculados: os ativos que estão livres ou já são o da própria conta. */
export function linkableProfessionals(list: ProfessionalOption[], currentId?: string | null): ProfessionalOption[] {
  return list.filter((p) => Number(p.active ?? 1) === 1 && (p.id === currentId || !p.user_id))
}

export const EMPTY_USER_FORM: UserFormValues = {
  full_name: '', email: '', mobile: '', phone: '', role: 'paciente', account_status: 'ativo', job_role: '',
  password: '', admin_level: 'gestor', professional_id: '', reason: '',
}

export function toUserForm(u: AdminUserDetail): UserFormValues {
  return {
    full_name: u.full_name ?? '',
    email: u.email ?? '',
    mobile: u.mobile ?? '',
    phone: u.phone ?? '',
    role: (u.role as UserFormValues['role']) || 'paciente',
    account_status: (u.account_status as UserFormValues['account_status']) || 'ativo',
    job_role: u.job_role ?? '',
    password: '',
    admin_level: (u.admin_level as UserFormValues['admin_level']) || 'gestor',
    professional_id: u.professional_id ?? '',
    reason: '',
  }
}

export type PayloadResult = { ok: true; body: Record<string, unknown> } | { ok: false; error: string; field?: keyof UserFormValues }

/**
 * Monta o corpo de POST (criar) ou PATCH (editar). Pontos que o servidor exige ou que não podem vazar:
 *  - criar: senha obrigatória (mín. 6);
 *  - editar: e-mail só vai se mudou (reenviá-lo é inofensivo, mas poupa a trava de credenciais de admin),
 *    senha só se preenchida, papel/status só se mudaram, e a MUDANÇA DE STATUS exige motivo;
 *  - `admin_level` só vai quando o ator tem 'admins' (gestor recebia 403 por causa do campo no payload).
 */
export function buildUserBody(
  values: UserFormValues,
  opts: { original?: AdminUserDetail; actorLevel?: string | null },
): PayloadResult {
  const { original, actorLevel } = opts
  const body: Record<string, unknown> = {
    full_name: values.full_name.trim(),
    mobile: values.mobile.trim() || null,
    phone: values.phone.trim() || null,
    job_role: values.job_role.trim() || null,
  }

  const email = values.email.trim()
  if (!original || email.toLowerCase() !== (original.email ?? '').trim().toLowerCase()) body.email = email

  if (!original) {
    if (values.password.length < 6) return { ok: false, error: 'Senha deve ter pelo menos 6 caracteres.', field: 'password' }
    body.password = values.password
    body.role = values.role
    body.account_status = values.account_status
  } else {
    if (values.password) {
      if (values.password.length < 6) return { ok: false, error: 'Senha deve ter pelo menos 6 caracteres.', field: 'password' }
      body.password = values.password
    }
    if (values.role !== original.role) body.role = values.role
    if (values.account_status !== original.account_status) {
      const reason = values.reason.trim()
      if (!reason) return { ok: false, error: 'Informe o motivo da alteração de status.', field: 'reason' }
      body.account_status = values.account_status
      body.reason = reason
      body.status_notes = reason
    }
  }

  if (values.role === 'admin' && can(actorLevel, 'admins')) body.admin_level = values.admin_level
  if (values.role === 'atendente') body.professional_id = values.professional_id || null
  return { ok: true, body }
}
