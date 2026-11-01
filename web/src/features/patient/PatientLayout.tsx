import { Bell, CalendarPlus, ClipboardList, Home, UserRound } from 'lucide-react'
import { AppShell, type ShellNavItem } from '@/components/AppShell'

const NAV: ShellNavItem[] = [
  { to: '/dashboard', label: 'Início', icon: Home, end: true },
  { to: '/dashboard/agendar', label: 'Agendar', icon: CalendarPlus },
  { to: '/dashboard/agendamentos', label: 'Meus agendamentos', icon: ClipboardList },
  { to: '/dashboard/alertas', label: 'Alertas', icon: Bell },
  { to: '/dashboard/conta', label: 'Minha conta', icon: UserRound },
]

export function PatientLayout() {
  return (
    <AppShell
      navLabel="Navegação do painel"
      nav={NAV}
      roleLabel="Paciente"
      heading="Meu painel"
      subheading="Acompanhe seus agendamentos, exames e alertas de saúde."
    />
  )
}
