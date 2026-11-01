import type { AdminBooking, AuditRow, Paged } from './types'

/** Quem praticou a ação. A API usa LEFT JOIN: ator removido vem com `actor_missing` e nome vazio. */
export function actorLabel(r: Pick<AuditRow, 'actor_missing' | 'actor_name' | 'actor_email'>): string {
  if (r.actor_missing) return 'Usuário removido'
  return r.actor_name || r.actor_email || 'Sistema'
}

/** A API devolve `{data,total}` no modo paginado e um array puro no legado. */
export function unpage<T>(res: Paged<T> | T[] | null | undefined): { rows: T[]; total: number } {
  if (Array.isArray(res)) return { rows: res, total: res.length }
  const rows = res?.data ?? []
  return { rows, total: Number(res?.total ?? rows.length) }
}

export interface CollectedBookings {
  rows: AdminBooking[]
  /** O teto de páginas estourou: os números podem estar incompletos (o painel avisa em vez de mentir). */
  truncated: boolean
}

export const BOOKINGS_PER_PAGE = 100
export const BOOKINGS_MAX_PAGES = 5

/**
 * Baixa agendamentos (ordem DESC por data) até passar de hoje: o painel só precisa do que é de hoje em
 * diante. O teto de 5 páginas (500 registros) mantém a chamada barata; ao estourar, `truncated`.
 */
export async function collectBookingsUntil(
  fetchPage: (page: number, pageSize: number) => Promise<Paged<AdminBooking> | AdminBooking[]>,
  today: string,
  { pageSize = BOOKINGS_PER_PAGE, maxPages = BOOKINGS_MAX_PAGES } = {},
): Promise<CollectedBookings> {
  const all: AdminBooking[] = []
  let truncated = false
  for (let page = 1; page <= maxPages; page++) {
    const res = await fetchPage(page, pageSize)
    const { rows, total } = unpage(res)
    if (!rows.length) break
    all.push(...rows)
    // DESC: se o mais antigo da página já é anterior a hoje, parou.
    if ((rows[rows.length - 1].scheduled_at || '').slice(0, 10) < today) break
    if (all.length >= total) break
    if (page === maxPages) truncated = true
  }
  return { rows: all, truncated }
}

export const isToday = (r: Pick<AdminBooking, 'scheduled_at'>, today: string) => (r.scheduled_at || '').slice(0, 10) === today

/** Pendentes de hoje, somando consultas e exames. */
export function countTodayPending(appointments: AdminBooking[], exams: AdminBooking[], today: string): number {
  return [...appointments, ...exams].filter((r) => isToday(r, today) && r.status === 'pendente').length
}

export interface AttentionNote {
  key: 'users' | 'today' | 'units'
  title: string
  text: string
  /** Rota do botão de ação (sem ação para unidades inativas). */
  to?: string
  cta?: string
}

/** Pendências do Início, filtradas pelo que o nível enxerga. */
export function buildAttention(input: {
  canUsers: boolean
  canAppointments: boolean
  canUnits: boolean
  pendingUsers: number
  todayPending: number
  inactiveUnits: number
}): AttentionNote[] {
  const notes: AttentionNote[] = []
  if (input.canUsers && input.pendingUsers > 0) {
    notes.push({
      key: 'users',
      title: `${input.pendingUsers} conta(s) aguardando ativação`,
      text: 'Atendentes não acessam o sistema até serem ativados.',
      to: '/admin/cadastros/pessoas?status=pendente',
      cta: 'Ver contas',
    })
  }
  if (input.canAppointments && input.todayPending > 0) {
    notes.push({
      key: 'today',
      title: `${input.todayPending} atendimento(s) pendente(s) hoje`,
      text: 'Confirme, cancele ou reagende na agenda do dia.',
      to: '/admin/atendimentos',
      cta: 'Ver agenda',
    })
  }
  if (input.canUnits && input.inactiveUnits > 0) {
    notes.push({
      key: 'units',
      title: `${input.inactiveUnits} unidade(s) inativa(s)`,
      text: 'Unidades inativas não aparecem no agendamento do paciente.',
    })
  }
  return notes
}

/** "03/11 08:00" — data curta para telas pequenas (a completa continua no desktop). */
export function fmtShortDateTime(iso?: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.replace(' ', 'T'))
  if (Number.isNaN(d.getTime())) return '—'
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export const PAGE_SIZES = [25, 50, 100, 200] as const
export const DEFAULT_PAGE_SIZE = 50

/** Lê o tamanho da página da URL; valores fora da lista voltam ao padrão. */
export function parsePageSize(v: string | null): number {
  const n = Number(v)
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE
}
