import { describe, expect, it } from 'vitest'
import { maskCep, maskCns, maskCpf, maskPhone, maskProfileValues, maskRg } from './masks'
import { passwordStrength } from './password'
import { ageFromDate, profileSchema, signupSchema } from './validators'

describe('máscaras', () => {
  it('maskCpf formata progressivamente e limita a 11 dígitos', () => {
    expect(maskCpf('52998224725')).toBe('529.982.247-25')
    expect(maskCpf('5299')).toBe('529.9')
    expect(maskCpf('529982247259999')).toBe('529.982.247-25')
  })
  it('maskPhone celular e fixo', () => {
    expect(maskPhone('87988887777', true)).toBe('(87) 98888-7777')
    expect(maskPhone('8733334444')).toBe('(87) 3333-4444')
  })
})

describe('máscaras de documento e endereço', () => {
  it('maskCns agrupa 3-4-4-4 e é progressivo', () => {
    expect(maskCns('898001160660001')).toBe('898 0011 6066 0001')
    expect(maskCns('8980')).toBe('898 0')
    expect(maskCns('89800116066000199')).toBe('898 0011 6066 0001')
  })
  it('maskRg aceita X no dígito verificador', () => {
    expect(maskRg('12345678x')).toBe('12.345.678-x')
    expect(maskRg('1234')).toBe('12.34')
  })
  it('maskCep', () => {
    expect(maskCep('50000000')).toBe('50000-000')
    expect(maskCep('5000')).toBe('5000')
  })
})

describe('maskProfileValues', () => {
  it('formata o que o servidor devolve cru e é idempotente', () => {
    const raw = { cpf: '52998224725', cns: '898001160660001', rg: '12345678x', cep: '50000000', mobile: '87988887777', phone: '8733334444', city: 'Recife', name: '' }
    const once = maskProfileValues(raw)
    expect(once).toMatchObject({
      cpf: '529.982.247-25', cns: '898 0011 6066 0001', rg: '12.345.678-x', cep: '50000-000',
      mobile: '(87) 98888-7777', phone: '(87) 3333-4444', city: 'Recife',
    })
    expect(maskProfileValues(once)).toEqual(once)
  })
  it('campos vazios continuam vazios (não vira "()")', () => {
    expect(maskProfileValues({ cpf: '', phone: '', mobile: '' })).toEqual({ cpf: '', phone: '', mobile: '' })
  })
})

describe('profileSchema', () => {
  const base = {
    full_name: 'Ana', social_name: '', birth_date: '', gender: '', cpf: '', rg: '', cns: '',
    mobile: '(87) 98888-7777', phone: '', cep: '', address_number: '', street: '', neighborhood: '', city: '', state: '',
  }
  const msgs = (v: object) => {
    const r = profileSchema.safeParse(v)
    return r.success ? [] : r.error.issues.map((i) => i.message)
  }
  it('aceita perfil mínimo (documentos e CEP vazios)', () => expect(msgs(base)).toEqual([]))
  it('valida CPF, CNS e CEP só quando preenchidos', () => {
    expect(msgs({ ...base, cpf: '111.111.111-11' })).toContain('CPF inválido. Confira os números digitados.')
    expect(msgs({ ...base, cns: '123' })).toContain('Cartão SUS inválido. Confira os 15 números do cartão.')
    expect(msgs({ ...base, cep: '5000' })).toContain('O CEP precisa ter 8 dígitos.')
    expect(msgs({ ...base, cpf: '529.982.247-25', cep: '50000-000' })).toEqual([])
  })
  it('exige nome e celular', () => {
    expect(msgs({ ...base, full_name: ' ', mobile: '' })).toEqual([
      'Informe seu nome completo.',
      'Informe seu celular com DDD.',
    ])
  })
})

describe('passwordStrength', () => {
  it('vazio não tem nível', () => expect(passwordStrength('').level).toBeNull())
  it('classifica fraca, média e forte', () => {
    expect(passwordStrength('abc').level).toBe('weak')
    expect(passwordStrength('abcdef12').level).toBe('medium')
    expect(passwordStrength('Abcdef12345!').level).toBe('strong')
  })
})

describe('ageFromDate', () => {
  const now = new Date('2026-06-15T12:00:00')
  it('desconta o ano se o aniversário ainda não ocorreu', () => {
    expect(ageFromDate('2008-06-16', now)).toBe(17)
    expect(ageFromDate('2008-06-15', now)).toBe(18)
  })
  it('data vazia ou inválida vira null', () => {
    expect(ageFromDate('', now)).toBeNull()
    expect(ageFromDate('xx', now)).toBeNull()
  })
})

describe('signupSchema', () => {
  const base = {
    full_name: 'Maria Silva', birth_date: '1990-01-01', cpf: '529.982.247-25',
    mobile: '(87) 98888-7777', guardian_name: '', email: 'm@x.com', password: 'secreta1', confirm: 'secreta1',
  }
  const issues = (v: object) => {
    const r = signupSchema.safeParse(v)
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)
  }

  it('aceita um cadastro adulto válido', () => expect(issues(base)).toEqual([]))
  it('rejeita CPF inválido e senhas diferentes', () => {
    const out = issues({ ...base, cpf: '111.111.111-11', confirm: 'outra' })
    expect(out.join('|')).toContain('cpf: CPF inválido')
    expect(out.join('|')).toContain('confirm: As senhas não coincidem.')
  })
  it('exige responsável para menor de 18 anos', () => {
    const ano = new Date().getFullYear() - 10
    expect(issues({ ...base, birth_date: `${ano}-01-01` }).join('|')).toContain('guardian_name')
    expect(issues({ ...base, birth_date: `${ano}-01-01`, guardian_name: 'Ana' })).toEqual([])
  })
  it('rejeita data de nascimento futura', () => {
    const ano = new Date().getFullYear() + 1
    expect(issues({ ...base, birth_date: `${ano}-01-01` }).join('|')).toContain('Data de nascimento inválida')
  })
})
