import { z } from 'zod'

// Mesmas regras de server/src/utils/validators.js (fonte única no front).
const digitsOnly = (v: unknown) => String(v ?? '').replace(/\D/g, '')

export function isValidCPF(value: unknown): boolean {
  const cpf = digitsOnly(value)
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false
  const calc = (len: number) => {
    let sum = 0
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i)
    const d = (sum * 10) % 11
    return d === 10 ? 0 : d
  }
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10])
}

// CNS: regra oficial DEF-CNS (15 dígitos iniciando em 1/2/7/8/9 + DV).
export function isValidCNS(value: unknown): boolean {
  const cns = digitsOnly(value)
  if (!/^[12789]\d{14}$/.test(cns)) return false
  let sum = 0
  for (let i = 0; i < 15; i++) sum += Number(cns[i]) * (15 - i)
  if (sum % 11 === 0) return true
  return (cns[0] === '1' || cns[0] === '2') && (sum + 2) % 11 === 0
}

export const cpfSchema = z.string().refine(isValidCPF, 'CPF inválido')
export const cnsSchema = z.string().refine(isValidCNS, 'CNS inválido')

export const loginSchema = z.object({
  email: z.string().min(1, 'Informe o e-mail').email('E-mail inválido'),
  password: z.string().min(1, 'Informe a senha'),
})
export type LoginInput = z.infer<typeof loginSchema>

export function ageFromDate(birth: string, now = new Date()): number | null {
  if (!birth) return null
  const b = new Date(`${birth}T00:00:00`)
  if (Number.isNaN(b.getTime())) return null
  let age = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--
  return age
}

const emailField = z
  .string()
  .trim()
  .min(1, 'Informe o e-mail.')
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Informe um e-mail válido.')

/** Campos da etapa 1 do cadastro (validados antes de avançar). */
export const SIGNUP_STEP1_FIELDS = ['full_name', 'birth_date', 'cpf', 'mobile', 'guardian_name'] as const

// Cadastro mínimo (P4): o resto vai para "Meu perfil" depois do 1º login.
export const signupSchema = z
  .object({
    full_name: z.string().trim().min(1, 'Informe seu nome completo.'),
    birth_date: z.string().min(1, 'Informe sua data de nascimento.'),
    cpf: z.string().trim().min(1, 'Informe seu CPF.'),
    mobile: z.string().trim().min(1, 'Informe seu celular com DDD.'),
    guardian_name: z.string().trim().max(150).optional(),
    email: emailField,
    password: z.string().min(6, 'A senha precisa ter ao menos 6 caracteres.'),
    confirm: z.string(),
  })
  .superRefine((v, ctx) => {
    const age = ageFromDate(v.birth_date)
    if (v.birth_date && (age === null || age < 0 || age > 130)) {
      ctx.addIssue({ code: 'custom', path: ['birth_date'], message: 'Data de nascimento inválida.' })
    }
    if (v.cpf && !isValidCPF(v.cpf)) {
      ctx.addIssue({ code: 'custom', path: ['cpf'], message: 'CPF inválido. Confira os números digitados.' })
    }
    if (age !== null && age >= 0 && age < 18 && !v.guardian_name?.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['guardian_name'],
        message: 'Informe o nome do responsável legal para menores de 18 anos.',
      })
    }
    if (v.password !== v.confirm) {
      ctx.addIssue({ code: 'custom', path: ['confirm'], message: 'As senhas não coincidem.' })
    }
  })
export type SignupInput = z.infer<typeof signupSchema>

/** Perfil do atendente (Minha conta). Documentos e CEP só são validados se preenchidos. */
export const profileSchema = z.object({
  full_name: z.string().trim().min(1, 'Informe seu nome completo.'),
  social_name: z.string().trim().max(150),
  birth_date: z.string(),
  gender: z.string(),
  cpf: z.string().refine((v) => !v.trim() || isValidCPF(v), 'CPF inválido. Confira os números digitados.'),
  rg: z.string(),
  cns: z.string().refine((v) => !v.trim() || isValidCNS(v), 'Cartão SUS inválido. Confira os 15 números do cartão.'),
  mobile: z.string().trim().min(1, 'Informe seu celular com DDD.'),
  phone: z.string(),
  cep: z.string().refine((v) => !v.trim() || v.replace(/\D/g, '').length === 8, 'O CEP precisa ter 8 dígitos.'),
  address_number: z.string(),
  street: z.string(),
  neighborhood: z.string(),
  city: z.string(),
  state: z.string().max(2),
})
export type ProfileInput = z.infer<typeof profileSchema>

/** Perfil do paciente (Minha conta). CPF, CNS e CEP só são validados se preenchidos; responsável é exigido de menores. */
export const patientProfileSchema = z
  .object({
    full_name: z.string().trim().min(1, 'Informe seu nome completo.'),
    social_name: z.string().trim().max(150),
    birth_date: z.string().min(1, 'Informe sua data de nascimento.'),
    gender: z.string(),
    mother_name: z.string(),
    father_name: z.string(),
    guardian_name: z.string().trim().max(150),
    cpf: z.string().refine((v) => !v.trim() || isValidCPF(v), 'CPF inválido. Confira os números digitados.'),
    rg: z.string(),
    cns: z.string().refine((v) => !v.trim() || isValidCNS(v), 'Cartão SUS inválido. Confira os 15 números do cartão.'),
    mobile: z.string().trim().min(1, 'Informe seu celular com DDD.'),
    phone: z.string(),
    blood_type: z.string(),
    priority: z.string(),
    race: z.string(),
    cep: z.string().refine((v) => !v.trim() || v.replace(/\D/g, '').length === 8, 'O CEP precisa ter 8 dígitos.'),
    address_number: z.string(),
    street: z.string(),
    neighborhood: z.string(),
    city: z.string(),
    state: z.string().max(2),
    zone: z.string(),
    reference_point: z.string(),
  })
  .superRefine((v, ctx) => {
    const age = ageFromDate(v.birth_date)
    if (age !== null && age >= 0 && age < 18 && !v.guardian_name) {
      ctx.addIssue({ code: 'custom', path: ['guardian_name'], message: 'Informe o nome do responsável legal para menores de 18 anos.' })
    }
  })
export type PatientProfileInput = z.infer<typeof patientProfileSchema>

export const forgotSchema = z.object({ email: emailField })
export type ForgotInput = z.infer<typeof forgotSchema>

export const resetSchema = z
  .object({
    password: z.string().min(6, 'A senha precisa ter ao menos 6 caracteres.'),
    password2: z.string(),
  })
  .refine((v) => v.password === v.password2, { path: ['password2'], message: 'As senhas não conferem.' })
export type ResetInput = z.infer<typeof resetSchema>

export const mfaSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Digite o código de 6 dígitos.'),
})
export type MfaInput = z.infer<typeof mfaSchema>

export function fmtDate(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
