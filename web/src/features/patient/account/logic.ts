import type { MeUser } from '@/features/staff/types'

// Campos opcionais rastreados pela barra de progresso (mesmos do legado).
export const PROFILE_TRACKED = [
  'social_name', 'gender', 'mother_name', 'father_name', 'rg', 'cns', 'phone', 'blood_type', 'priority', 'race', 'cep', 'zone',
] as const

/** % dos campos opcionais do perfil que estão preenchidos. */
export function patientCompleteness(user?: MeUser | null): number {
  const filled = PROFILE_TRACKED.filter((k) => {
    const v = user?.[k]
    return v !== null && v !== undefined && String(v).trim() !== ''
  }).length
  return Math.round((filled / PROFILE_TRACKED.length) * 100)
}

type Option = [value: string, label: string]

export const GENDERS: Option[] = [
  ['masculino', 'Masculino'], ['feminino', 'Feminino'], ['outro', 'Outro'], ['prefiro_nao_informar', 'Prefiro não informar'],
]
export const BLOOD_TYPES: Option[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'].map((t) => [t, t])
export const PRIORITIES: Option[] = [
  ['nenhuma', 'Nenhuma'], ['idoso', 'Idoso(a) (60+)'], ['gestante', 'Gestante'], ['pcd', 'Pessoa com deficiência (PCD)'], ['lactante', 'Lactante'],
]
export const RACES: Option[] = [
  ['branca', 'Branca'], ['preta', 'Preta'], ['parda', 'Parda'], ['amarela', 'Amarela'], ['indigena', 'Indígena'], ['nao_informar', 'Prefiro não informar'],
]
export const ZONES: Option[] = [['urbana', 'Urbana'], ['rural', 'Rural']]

/** Preenche o formulário a partir do usuário; campos ausentes viram "". */
export function toPatientForm<T extends Record<string, string>>(user: MeUser, empty: T): T {
  return Object.fromEntries(
    (Object.keys(empty) as (keyof T)[]).map((k) => [k, String(user[k as string] ?? '')]),
  ) as T
}

/**
 * Corpo do PUT /auth/me. O servidor faz atualização PARCIAL: "" limpa o campo, `undefined` mantém.
 * CPF/RG/CNS são a exceção: o formulário não os recebe preenchidos, então vazio = "não mexa".
 */
export function buildProfileBody<T extends Record<string, string>>(v: T) {
  return {
    ...v,
    full_name: v.full_name?.trim(),
    cpf: v.cpf?.trim() || undefined,
    rg: v.rg?.trim() || undefined,
    cns: v.cns?.trim() || undefined,
  }
}
