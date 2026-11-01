export type PasswordLevel = 'weak' | 'medium' | 'strong'

export interface PasswordStrength {
  level: PasswordLevel | null
  label: string
  /** Largura da barra, 0–100. */
  percent: number
}

/** Indicador de senha fraca/média/forte (mesmas faixas do auth.html legado). */
export function passwordStrength(value: string): PasswordStrength {
  if (!value) return { level: null, label: '', percent: 0 }
  let score = 0
  if (value.length >= 8) score++
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++
  if (/\d/.test(value)) score++
  if (/[^A-Za-z0-9]/.test(value)) score++

  if (score >= 3 && value.length >= 10) return { level: 'strong', label: 'Senha forte', percent: 100 }
  if (score >= 2) return { level: 'medium', label: 'Senha média — misture letras e números', percent: 60 }
  return { level: 'weak', label: 'Senha fraca — misture letras e números', percent: 25 }
}
