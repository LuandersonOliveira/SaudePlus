import { describe, expect, it } from 'vitest'
import { fmtDate, isValidCNS, isValidCPF } from './validators'

describe('isValidCPF', () => {
  it('aceita CPF válido, com ou sem máscara', () => {
    expect(isValidCPF('529.982.247-25')).toBe(true)
    expect(isValidCPF('52998224725')).toBe(true)
  })
  it('rejeita DV errado, sequência repetida e tamanho incorreto', () => {
    expect(isValidCPF('529.982.247-24')).toBe(false)
    expect(isValidCPF('11111111111')).toBe(false)
    expect(isValidCPF('123')).toBe(false)
    expect(isValidCPF(null)).toBe(false)
  })
})

describe('isValidCNS', () => {
  it('aceita CNS definitivo (iniciado em 7/8/9) com DV correto', () => {
    expect(isValidCNS('898001160660001')).toBe(true)
  })
  it('rejeita prefixo inválido e tamanho incorreto', () => {
    expect(isValidCNS('398001160660001')).toBe(false)
    expect(isValidCNS('8980011606600')).toBe(false)
  })
})

describe('fmtDate', () => {
  it('retorna travessão para valor ausente ou inválido', () => {
    expect(fmtDate(null)).toBe('—')
    expect(fmtDate('lixo')).toBe('—')
  })
})
