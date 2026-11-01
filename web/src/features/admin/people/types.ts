// Contratos de /admin/users e /admin/history (ver server/src/routes/admin.users.routes.js).
import type { Booking } from '@/features/staff/types'

export const ROLES = ['paciente', 'atendente', 'admin'] as const
export type UserRole = (typeof ROLES)[number]

export const STATUSES = ['ativo', 'pendente', 'inativo'] as const
export type AccountStatus = (typeof STATUSES)[number]

export const ADMIN_LEVELS = ['superadmin', 'gestor', 'atendimento', 'alertas'] as const
export type AdminLevel = (typeof ADMIN_LEVELS)[number]

/** Linha de GET /admin/users (sem CPF/RG: esses só no detalhe). */
export interface AdminUserRow {
  id: string
  full_name: string | null
  email: string | null
  role: UserRole | (string & {})
  account_status: AccountStatus | (string & {})
  mobile?: string | null
  phone?: string | null
  job_role?: string | null
  admin_level?: string | null
  last_login_at?: string | null
}

export interface UserFilters {
  q: string
  role: '' | UserRole
  status: '' | AccountStatus
}

/** GET /admin/users/:id — perfil completo (a leitura de documentos é auditada pelo servidor). */
export interface AdminUserDetail extends AdminUserRow {
  social_name?: string | null
  birth_date?: string | null
  gender?: string | null
  blood_type?: string | null
  priority?: string | null
  race?: string | null
  guardian_name?: string | null
  mother_name?: string | null
  father_name?: string | null
  cpf?: string | null
  rg?: string | null
  cns?: string | null
  cep?: string | null
  street?: string | null
  address_number?: string | null
  neighborhood?: string | null
  city?: string | null
  state?: string | null
  professional_id?: string | null
  professional_name?: string | null
}

export interface UserHistory {
  user?: { full_name?: string | null }
  appointments?: Booking[]
  exams?: Booking[]
}

/** Profissional listável no vínculo com um atendente (GET /admin/professionals). */
export interface ProfessionalOption {
  id: string
  name: string
  active?: number | boolean
  user_id?: string | null
}

export interface UserFormValues {
  full_name: string
  email: string
  mobile: string
  phone: string
  role: UserRole
  account_status: AccountStatus
  job_role: string
  password: string
  admin_level: AdminLevel
  professional_id: string
  /** Motivo da mudança de status (obrigatório ao mudar o status de um usuário existente). */
  reason: string
}
