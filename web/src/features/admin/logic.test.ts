import { describe, expect, it, vi } from 'vitest'
import { actorLabel, buildAttention, collectBookingsUntil, countTodayPending, DEFAULT_PAGE_SIZE, fmtShortDateTime, parsePageSize, unpage } from './logic'
import type { AdminBooking } from './types'

const b = (id: string, at: string, status: AdminBooking['status'] = 'pendente'): AdminBooking => ({ id, scheduled_at: `${at} 09:00:00`, status })

describe('actorLabel', () => {
  it('ator removido, nome, e-mail e sistema', () => {
    expect(actorLabel({ actor_missing: 1, actor_name: 'x' })).toBe('Usuário removido')
    expect(actorLabel({ actor_name: 'Ana', actor_email: 'a@x.com' })).toBe('Ana')
    expect(actorLabel({ actor_name: '', actor_email: 'a@x.com' })).toBe('a@x.com')
    expect(actorLabel({})).toBe('Sistema')
  })
})

describe('unpage', () => {
  it('aceita {data,total} e array puro', () => {
    expect(unpage({ data: [1, 2], total: 9 })).toEqual({ rows: [1, 2], total: 9 })
    expect(unpage([1, 2, 3])).toEqual({ rows: [1, 2, 3], total: 3 })
    expect(unpage(null)).toEqual({ rows: [], total: 0 })
    expect(unpage({ data: [1] } as never)).toEqual({ rows: [1], total: 1 })
  })
})

describe('collectBookingsUntil', () => {
  const today = '2026-11-05'
  const page = (rows: AdminBooking[], total: number) => ({ data: rows, total })

  it('para quando o mais antigo da página já é anterior a hoje (ordem DESC)', async () => {
    const fetchPage = vi.fn(async () => page([b('1', '2026-11-08'), b('2', '2026-11-05'), b('3', '2026-11-01')], 300))
    const r = await collectBookingsUntil(fetchPage, today)
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(r.rows).toHaveLength(3)
    expect(r.truncated).toBe(false)
  })

  it('busca a próxima página enquanto ainda há datas de hoje em diante', async () => {
    const fetchPage = vi.fn(async (p: number) =>
      p === 1 ? page([b('1', '2026-11-20'), b('2', '2026-11-10')], 3) : page([b('3', '2026-11-06')], 3),
    )
    const r = await collectBookingsUntil(fetchPage, today)
    expect(fetchPage).toHaveBeenCalledTimes(2)
    expect(r.rows.map((x) => x.id)).toEqual(['1', '2', '3'])
    expect(r.truncated).toBe(false) // chegou ao total
  })

  it('estourar o teto de 5 páginas marca como truncado (não mente "0 pendentes")', async () => {
    const fetchPage = vi.fn(async (p: number) => page([b(`p${p}`, '2026-12-01')], 999))
    const r = await collectBookingsUntil(fetchPage, today, { pageSize: 1 })
    expect(fetchPage).toHaveBeenCalledTimes(5)
    expect(r.truncated).toBe(true)
  })

  it('página vazia encerra; resposta em array puro também funciona', async () => {
    expect((await collectBookingsUntil(async () => page([], 0), today)).rows).toEqual([])
    const r = await collectBookingsUntil(async () => [b('1', '2026-11-09')], today)
    expect(r.rows).toHaveLength(1)
  })
})

describe('countTodayPending', () => {
  it('só pendentes de hoje, somando consultas e exames', () => {
    const today = '2026-11-05'
    const appts = [b('1', today), b('2', today, 'confirmado'), b('3', '2026-11-06')]
    const exams = [b('4', today), b('5', today, 'cancelado')]
    expect(countTodayPending(appts, exams, today)).toBe(2)
  })
})

describe('buildAttention', () => {
  const base = { canUsers: true, canAppointments: true, canUnits: true, pendingUsers: 2, todayPending: 3, inactiveUnits: 1 }
  it('mostra as três pendências com destino, e a de unidades sem botão', () => {
    const notes = buildAttention(base)
    expect(notes.map((n) => n.key)).toEqual(['users', 'today', 'units'])
    expect(notes[0].to).toBe('/admin/cadastros/pessoas?status=pendente')
    expect(notes[1].to).toBe('/admin/atendimentos')
    expect(notes[2].to).toBeUndefined()
  })
  it('respeita o nível: sem permissão, sem a pendência', () => {
    expect(buildAttention({ ...base, canUsers: false, canUnits: false }).map((n) => n.key)).toEqual(['today'])
    expect(buildAttention({ ...base, pendingUsers: 0, todayPending: 0, inactiveUnits: 0 })).toEqual([])
  })
})

describe('parsePageSize', () => {
  it('aceita só os tamanhos da lista', () => {
    expect(parsePageSize('100')).toBe(100)
    expect(parsePageSize('7')).toBe(DEFAULT_PAGE_SIZE)
    expect(parsePageSize(null)).toBe(DEFAULT_PAGE_SIZE)
    expect(parsePageSize('abc')).toBe(DEFAULT_PAGE_SIZE)
  })
})

describe('fmtShortDateTime', () => {
  it('formata dd/mm hh:mm e tolera valores ausentes ou inválidos', () => {
    expect(fmtShortDateTime('2026-11-03 08:05:00')).toBe('03/11 08:05')
    expect(fmtShortDateTime(null)).toBe('—')
    expect(fmtShortDateTime('lixo')).toBe('—')
  })
})
