import { describe, expect, it } from 'vitest'
import { diseaseBody, EMPTY_DISEASE, filterDiseases, isActive, norm, regionsFrom, validateDisease, type AdminDisease } from './logic'

const d = (over: Partial<AdminDisease>): AdminDisease => ({ id: 'x', name: 'Dengue', alert_level: 'alto', active: 1, region: 'Centro', description: 'Casos em alta', ...over })

describe('norm / filterDiseases', () => {
  it('ignora caixa e acento', () => expect(norm('  Gripê ÁVIÁRIA ')).toBe('  gripe aviaria '))
  const list = [d({ id: '1', name: 'Dengue', region: 'Vila Boa Esperança' }), d({ id: '2', name: 'Gripe', region: 'Centro', description: 'Influenza sazonal' }), d({ id: '3', name: 'Zika', region: null, description: null })]
  it('filtra por nome, região e descrição, sem depender de acento', () => {
    expect(filterDiseases(list, 'dengue').map((x) => x.id)).toEqual(['1'])
    expect(filterDiseases(list, 'esperanca').map((x) => x.id)).toEqual(['1'])
    expect(filterDiseases(list, 'INFLUENZA').map((x) => x.id)).toEqual(['2'])
  })
  it('termo vazio devolve tudo; sem casamento devolve vazio; campos nulos não quebram', () => {
    expect(filterDiseases(list, '   ')).toHaveLength(3)
    expect(filterDiseases(list, 'xyz')).toEqual([])
    expect(filterDiseases(list, 'zika').map((x) => x.id)).toEqual(['3'])
  })
})

describe('isActive', () => {
  it('aceita 1/0 e true/false', () => {
    expect(isActive({ active: 1 })).toBe(true)
    expect(isActive({ active: 0 })).toBe(false)
    expect(isActive({ active: true })).toBe(true)
    expect(isActive({ active: false })).toBe(false)
  })
})

describe('regionsFrom', () => {
  it('bairros distintos, sem vazios, em ordem alfabética', () => {
    expect(regionsFrom([{ neighborhood: 'Moinho' }, { neighborhood: 'Centro' }, { neighborhood: 'Moinho' }, { neighborhood: null }, {}, { neighborhood: 'Água Fria' }])).toEqual(['Água Fria', 'Centro', 'Moinho'])
    expect(regionsFrom([])).toEqual([])
  })
})

describe('validateDisease', () => {
  it('cadastro exige nome e região; edição só o nome', () => {
    expect(validateDisease(EMPTY_DISEASE, { requireRegion: true })).toEqual({ name: 'Informe o nome da doença.', region: 'Selecione a região/bairro.' })
    expect(validateDisease({ ...EMPTY_DISEASE, name: 'Dengue' }, { requireRegion: false })).toEqual({})
    expect(validateDisease({ ...EMPTY_DISEASE, name: '   ' }, { requireRegion: false })).toEqual({ name: 'Informe o nome da doença.' })
  })
})

describe('diseaseBody', () => {
  it('apara os textos e mantém o nível', () => {
    expect(diseaseBody({ name: ' Dengue ', region: ' Centro ', alert_level: 'medio', description: '  casos  ' })).toEqual({
      name: 'Dengue', region: 'Centro', alert_level: 'medio', description: 'casos',
    })
  })
})
