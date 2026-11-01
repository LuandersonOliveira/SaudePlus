import { CalendarDays, ClipboardList, ListChecks, Search, UserRound } from 'lucide-react'
import { AppShell, type ShellNavItem } from '@/components/AppShell'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/lib/auth'
import { buildTodayQueue, formatJobRole } from './logic'
import { useBookings } from './queries'

function QueueBadge() {
  const a = useBookings('appointments')
  const e = useBookings('exams')
  const n = buildTodayQueue(a.data ?? [], e.data ?? []).length
  if (!n) return null
  return (
    <Badge className="ml-auto border-transparent bg-warning-soft text-warning-ink" aria-label={`${n} pendentes hoje`}>
      {n}
    </Badge>
  )
}

export function StaffLayout() {
  const { session } = useAuth()
  const user = session?.user
  const name = user?.full_name || user?.name || user?.email || ''
  const jobRole = formatJobRole(user?.job_role)

  const nav: ShellNavItem[] = [
    { to: '/atendente', label: 'Fila do dia', icon: ListChecks, end: true, badge: <QueueBadge /> },
    { to: '/atendente/agenda', label: 'Agenda', icon: CalendarDays },
    { to: '/atendente/agendamentos', label: 'Agendamentos', icon: ClipboardList },
    { to: '/atendente/pacientes', label: 'Buscar paciente', icon: Search },
    { to: '/atendente/conta', label: 'Minha conta', icon: UserRound },
  ]

  return (
    <AppShell
      navLabel="Navegação do atendimento"
      nav={nav}
      roleLabel="Atendente"
      userSubtitle={jobRole}
      heading={`Olá, ${name.split(' ')[0]}!`}
      subheading={`${jobRole ? `${jobRole} · ` : ''}Painel de atendimento`}
    />
  )
}
