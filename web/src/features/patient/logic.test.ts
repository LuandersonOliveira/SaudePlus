import { describe, expect, it } from 'vitest'
import { canEditOrCancel, canRebook, cancelPath, countByLevel, isOverdue, levelTone, sortRecentFirst, toItems, upcomingEvents } from './logic'
import type { MyBooking } from './types'

const b = (over: Partial<MyBooking>): MyBooking => ({ id: 'x', scheduled_at: '2026-11-10 09:00:00', status: 'pendente', ...over })
const now = new Date('2026-11-05T12:00:00')

describe('toItems', () => {
  it('normaliza consulta e exame com tipo e título', () => {
    const items = toItems([b({ id: 'a', specialty: 'Pediatria' })], [b({ id: 'e', exam_type: 'Hemograma' })])
    expect(items.map((i) => [i.kind, i.typeLabel, i.title])).toEqual([
      ['appointments', 'Consulta', 'Pediatria'],
      ['exams', 'Exame', 'Hemograma'],
    ])
  })
  it('título ausente vira travessão', () => expect(toItems([b({})], [])[0].title).toBe('—'))
})

describe('isOverdue', () => {
  it('só pendente com horário passado', () => {
    expect(isOverdue('2026-11-01 09:00:00', 'pendente', now)).toBe(true)
    expect(isOverdue('2026-11-01 09:00:00', 'confirmado', now)).toBe(false)
    expect(isOverdue('2026-11-09 09:00:00', 'pendente', now)).toBe(false)
  })
})

describe('upcomingEvents', () => {
  it('ignora passados e cancelados, ordena e limita a 5', () => {
    const rows = [
      b({ id: 'passado', scheduled_at: '2026-11-01 09:00:00', specialty: 'A' }),
      b({ id: 'cancel', scheduled_at: '2026-11-08 09:00:00', status: 'cancelado', specialty: 'B' }),
      ...Array.from({ length: 6 }, (_, i) => b({ id: `f${i}`, scheduled_at: `2026-11-1${i} 09:00:00`, specialty: 'C' })),
    ]
    const out = upcomingEvents(toItems(rows, []), now)
    expect(out.map((i) => i.id)).toEqual(['f0', 'f1', 'f2', 'f3', 'f4'])
  })
})

describe('sortRecentFirst', () => {
  it('mais recente primeiro, sem mutar a entrada', () => {
    const items = toItems([b({ id: '1', scheduled_at: '2026-01-01 08:00:00' }), b({ id: '2', scheduled_at: '2026-03-01 08:00:00' })], [])
    expect(sortRecentFirst(items).map((i) => i.id)).toEqual(['2', '1'])
    expect(items.map((i) => i.id)).toEqual(['1', '2'])
  })
})

describe('regras de ação', () => {
  it('editar/cancelar só em pendente e confirmado; refazer só em cancelado', () => {
    expect(canEditOrCancel('pendente')).toBe(true)
    expect(canEditOrCancel('confirmado')).toBe(true)
    expect(canEditOrCancel('concluido')).toBe(false)
    expect(canEditOrCancel('para_remarcar')).toBe(false)
    expect(canRebook('cancelado')).toBe(true)
    expect(canRebook('pendente')).toBe(false)
  })
  it('cancelPath escapa o id', () => expect(cancelPath('exams', 'a/b')).toBe('/me/exams/a%2Fb/cancel'))
})

describe('alertas', () => {
  it('levelTone e countByLevel na ordem alto → médio → baixo', () => {
    expect(levelTone('alto')).toBe('danger')
    expect(levelTone('medio')).toBe('warning')
    expect(levelTone('baixo')).toBe('success')
    expect(countByLevel([{ alert_level: 'baixo' }, { alert_level: 'alto' }, { alert_level: 'alto' }]).map((x) => x.total)).toEqual([2, 0, 1])
  })
})
