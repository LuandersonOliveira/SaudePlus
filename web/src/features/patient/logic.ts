import type { AlertLevel, BookingItem, MyBooking, MyKind } from './types'

export function toItems(appointments: MyBooking[], exams: MyBooking[]): BookingItem[] {
  return [
    ...appointments.map((r): BookingItem => ({ ...r, kind: 'appointments', typeLabel: 'Consulta', title: r.specialty || '—' })),
    ...exams.map((r): BookingItem => ({ ...r, kind: 'exams', typeLabel: 'Exame', title: r.exam_type || '—' })),
  ]
}

/** Pendente cujo horário já passou. */
export function isOverdue(at: string, status: string, now = new Date()): boolean {
  return new Date(at.replace(' ', 'T')) < now && status === 'pendente'
}

/** Próximos 5 eventos: futuros e não cancelados, do mais próximo ao mais distante. */
export function upcomingEvents(items: BookingItem[], now = new Date()): BookingItem[] {
  return items
    .filter((x) => new Date(x.scheduled_at.replace(' ', 'T')) >= now && x.status !== 'cancelado')
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    .slice(0, 5)
}

/** Todos os agendamentos, do mais recente ao mais antigo. */
export function sortRecentFirst(items: BookingItem[]): BookingItem[] {
  return [...items].sort((a, b) => b.scheduled_at.localeCompare(a.scheduled_at))
}

export const canEditOrCancel = (status: string) => status === 'pendente' || status === 'confirmado'
export const canRebook = (status: string) => status === 'cancelado'

export const cancelPath = (kind: MyKind, id: string) => `/me/${encodeURIComponent(kind)}/${encodeURIComponent(id)}/cancel`

export const LEVEL_LABEL: Record<string, string> = { alto: 'Alto', medio: 'Médio', baixo: 'Baixo' }

export function levelTone(level: AlertLevel): 'danger' | 'warning' | 'success' {
  return level === 'alto' ? 'danger' : level === 'medio' ? 'warning' : 'success'
}

/** Contagem de alertas por nível, sempre na ordem alto → médio → baixo (para o gráfico). */
export function countByLevel(diseases: { alert_level: AlertLevel }[]) {
  return (['alto', 'medio', 'baixo'] as const).map((level) => ({
    level,
    label: LEVEL_LABEL[level],
    total: diseases.filter((d) => d.alert_level === level).length,
  }))
}
