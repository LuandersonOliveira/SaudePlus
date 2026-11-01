// Máscaras puras (string -> string), equivalentes às de assets/ui.js.

export function maskCpf(value: string): string {
  return value
    .replace(/\D/g, '')
    .slice(0, 11)
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
}

/** Cartão SUS em grupos 3-4-4-4. (O legado contava posições já com os espaços e saía 3-4-5-3.) */
/**
 * Aplica as máscaras de exibição aos campos conhecidos de um perfil carregado da API.
 * O servidor devolve CPF/CNS/RG sem formatação; sem isto o campo aparece "52998224725" e só vira
 * "529.982.247-25" quando a pessoa digita. É idempotente (valores já formatados não mudam).
 */
export function maskProfileValues<T extends Record<string, string>>(values: T): T {
  const out: Record<string, string> = { ...values }
  const apply = (key: string, fn: (v: string) => string) => {
    if (typeof out[key] === 'string' && out[key]) out[key] = fn(out[key])
  }
  apply('cpf', maskCpf)
  apply('cns', maskCns)
  apply('rg', maskRg)
  apply('cep', maskCep)
  apply('mobile', (v) => maskPhone(v, true))
  apply('phone', (v) => maskPhone(v, false))
  return out as T
}

export function maskCns(value: string): string {
  const v = value.replace(/\D/g, '').slice(0, 15)
  return [v.slice(0, 3), v.slice(3, 7), v.slice(7, 11), v.slice(11, 15)].filter(Boolean).join(' ')
}

export function maskRg(value: string): string {
  const v = value.replace(/[^0-9Xx]/g, '').slice(0, 9)
  let out = v.slice(0, 2)
  if (v.length > 2) out += `.${v.slice(2, 5)}`
  if (v.length > 5) out += `.${v.slice(5, 8)}`
  if (v.length > 8) out += `-${v.slice(8)}`
  return out
}

export function maskCep(value: string): string {
  const v = value.replace(/\D/g, '').slice(0, 8)
  return v.length > 5 ? `${v.slice(0, 5)}-${v.slice(5)}` : v
}

export function maskPhone(value: string, mobile = false): string {
  const v = value.replace(/\D/g, '').slice(0, mobile ? 11 : 10)
  const ddd = v.replace(/^(\d{2})(\d)/, '($1) $2')
  return mobile ? ddd.replace(/(\d{5})(\d)/, '$1-$2') : ddd.replace(/(\d{4})(\d)/, '$1-$2')
}
