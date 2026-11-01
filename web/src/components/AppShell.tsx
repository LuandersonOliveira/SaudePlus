import { LogOut, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { Brand } from '@/components/Brand'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'

export interface ShellNavItem {
  to: string
  label: string
  icon: LucideIcon
  end?: boolean
  /** Conteúdo à direita do rótulo (ex.: contagem). */
  badge?: ReactNode
}

interface Props {
  navLabel: string
  nav: ShellNavItem[]
  /** Selo do papel ("Atendente", "Paciente"). */
  roleLabel: string
  /** Texto abaixo do nome no rodapé do menu (ex.: cargo). */
  userSubtitle?: string
  heading: string
  subheading: string
}

/** Casca das áreas autenticadas: menu lateral (topo no celular), usuário e "Sair". */
export function AppShell({ navLabel, nav, roleLabel, userSubtitle, heading, subheading }: Props) {
  const { session, logout } = useAuth()
  const user = session?.user
  const name = user?.full_name || user?.name || user?.email || ''

  return (
    <div className="min-h-screen md:grid md:grid-cols-[250px_1fr]">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[10000] focus:rounded-xs focus:border focus:bg-card focus:px-4 focus:py-2.5 focus:font-semibold focus:shadow-lg"
      >
        Pular para o conteúdo
      </a>

      <aside className="flex flex-col gap-4 border-b bg-card p-4 md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <Brand />
        <nav aria-label={navLabel} className="flex gap-1 overflow-x-auto md:flex-col">
          {nav.map(({ to, label, icon: Icon, end, badge }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex min-h-11 items-center gap-2.5 whitespace-nowrap rounded-sm px-3 text-sm font-semibold text-foreground no-underline transition-colors hover:bg-accent',
                  isActive && 'bg-accent text-accent-foreground',
                )
              }
            >
              <Icon className="size-4 flex-none" aria-hidden="true" />
              {label}
              {badge}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto hidden gap-2 border-t pt-4 md:grid">
          <Badge className="w-fit border-transparent bg-accent text-accent-foreground">{roleLabel}</Badge>
          <p className="text-sm font-bold leading-tight">{name}</p>
          {userSubtitle && <p className="text-xs text-muted-foreground">{userSubtitle}</p>}
          <p className="break-all text-xs text-muted-foreground">{user?.email}</p>
          <Button variant="outline" size="sm" onClick={logout}>
            <LogOut aria-hidden="true" /> Sair
          </Button>
        </div>
      </aside>

      <div className="min-w-0">
        {/* minmax(0,1fr): sem isto a coluna do grid cresce com a tabela e a página inteira rola na horizontal. */}
        <main id="conteudo" className="mx-auto grid max-w-[1080px] grid-cols-[minmax(0,1fr)] gap-4 px-5 pb-16 pt-8">
          <header>
            <h1 className="text-[clamp(1.7rem,3vw,2.3rem)] font-extrabold leading-tight tracking-tight">{heading}</h1>
            <p className="text-muted-foreground">{subheading}</p>
          </header>
          <Outlet />
          <Button variant="outline" size="sm" className="w-fit md:hidden" onClick={logout}>
            <LogOut aria-hidden="true" /> Sair
          </Button>
        </main>
      </div>
    </div>
  )
}
