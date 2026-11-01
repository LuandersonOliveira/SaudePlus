import { CalendarDays, FolderTree, Home, ScrollText, UserRound } from 'lucide-react'
import { AppShell, type ShellNavItem } from '@/components/AppShell'
import { useAuth } from '@/lib/auth'
import { can, canSeeCadastros } from './capabilities'

export function AdminLayout() {
  const { session } = useAuth()
  const level = session?.user.admin_level

  // O menu mostra só o que o nível permite.
  const nav: ShellNavItem[] = [
    { to: '/admin', label: 'Início', icon: Home, end: true },
    ...(can(level, 'appointments') ? [{ to: '/admin/atendimentos', label: 'Atendimentos', icon: CalendarDays }] : []),
    ...(canSeeCadastros(level) ? [{ to: '/admin/cadastros', label: 'Cadastros', icon: FolderTree }] : []),
    ...(can(level, 'audit') ? [{ to: '/admin/auditoria', label: 'Auditoria', icon: ScrollText }] : []),
    { to: '/admin/conta', label: 'Minha conta', icon: UserRound },
  ]

  return (
    <AppShell
      navLabel="Navegação administrativa"
      nav={nav}
      roleLabel={level || 'sem nível'}
      heading="Painel administrativo"
      subheading="Monitore atendimentos, usuários e alertas de saúde."
    />
  )
}
