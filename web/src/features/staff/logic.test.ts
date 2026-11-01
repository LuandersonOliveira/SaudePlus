import { describe, expect, it } from 'vitest'
import {
  addDays,
  addMonths,
  buildTodayQueue,
  fmtSimpleDate,
  formatJobRole,
  localDateStr,
  maxLocalForInput,
  nowLocalForInput,
  profileCompleteness,
  statusTone,
  toApiDateTime,
} from './logic'
import type { Booking } from './types'

const b = (over: Partial<Booking>): Booking => ({ id: 'x', scheduled_at: '2026-11-03 09:00:00', status: 'pendente', ...over })

describe('datas locais', () => {
  it('localDateStr usa o fuso local (não UTC)', () => {
    // 23:30 local de 3/nov: em UTC já seria dia 4 (UTC-3) — não pode virar o dia.
    expect(localDateStr(new Date(2026, 10, 3, 23, 30))).toBe('2026-11-03')
  })
  it('addDays e addMonths atravessam mês e ano', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(addMonths('2026-12', 1)).toBe('2027-01')
    expect(addMonths('2026-01', -1)).toBe('2025-12')
  })
  it('limites do datetime-local: agora até +1 ano', () => {
    const now = new Date(2026, 5, 15, 10, 45, 30)
    expect(nowLocalForInput(now)).toBe('2026-06-15T10:45')
    expect(maxLocalForInput(now)).toBe('2027-06-15T10:45')
  })
  it('toApiDateTime acrescenta segundos só quando faltam', () => {
    expect(toApiDateTime('2026-11-03T09:30')).toBe('2026-11-03 09:30:00')
    expect(toApiDateTime('2026-11-03 09:30:15')).toBe('2026-11-03 09:30:15')
  })
})

describe('buildTodayQueue', () => {
  it('só pendentes de hoje, consultas+exames, em ordem de horário', () => {
    const consultas = [
      b({ id: 'c1', scheduled_at: '2026-11-03 14:00:00' }),
      b({ id: 'c2', scheduled_at: '2026-11-03 08:00:00', status: 'confirmado' }),
      b({ id: 'c3', scheduled_at: '2026-11-04 08:00:00' }),
    ]
    const exames = [b({ id: 'e1', scheduled_at: '2026-11-03 07:30:00' })]
    const fila = buildTodayQueue(consultas, exames, '2026-11-03')
    expect(fila.map((r) => r.id)).toEqual(['e1', 'c1'])
    expect(fila.map((r) => r.kind)).toEqual(['exams', 'appointments'])
  })
})

describe('formatJobRole', () => {
  it('normaliza acento, caixa e variações conhecidas', () => {
    expect(formatJobRole('MEDICO')).toBe('Médico(a)')
    expect(formatJobRole('tecnico_enfermagem')).toBe('Técnico(a) de Enfermagem')
    expect(formatJobRole('Agente de Saúde')).toBe('Agente Comunitário de Saúde')
  })
  it('cargo livre vira Title Case; vazio vira ""', () => {
    expect(formatJobRole('fisioterapeuta do posto')).toBe('Fisioterapeuta Do Posto')
    expect(formatJobRole(null)).toBe('')
  })
})

describe('profileCompleteness', () => {
  it('conta campos opcionais preenchidos (11 rastreados)', () => {
    expect(profileCompleteness({})).toBe(0)
    expect(profileCompleteness({ social_name: 'Ana', city: ' ', state: 'PE' })).toBe(Math.round((2 / 11) * 100))
    expect(profileCompleteness(null)).toBe(0)
  })
})

describe('fmtSimpleDate', () => {
  it('data pura não sofre deslocamento de fuso (01/04 em vez de 02/04 era o defeito)', () => {
    expect(fmtSimpleDate('1985-04-02')).toBe('02/04/1985')
    expect(fmtSimpleDate('2000-01-01')).toBe('01/01/2000')
  })
  it('ISO completo, vazio e inválido', () => {
    expect(fmtSimpleDate('2026-11-03T15:00:00')).toBe('03/11/2026')
    expect(fmtSimpleDate(null)).toBe('—')
    expect(fmtSimpleDate('lixo')).toBe('—')
  })
})

describe('statusTone', () => {
  it('mapeia status para o tom do badge', () => {
    expect(statusTone('cancelado')).toBe('danger')
    expect(statusTone('pendente')).toBe('warning')
    expect(statusTone('concluido')).toBe('success')
  })
})
