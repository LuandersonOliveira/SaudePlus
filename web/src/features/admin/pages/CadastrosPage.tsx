import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/lib/auth'
import { allowedSubTabs, type SubTab } from '../capabilities'

const LABEL: Record<SubTab, string> = { pessoas: 'Pessoas', rede: 'Rede de saúde', doencas: 'Doenças e alertas' }

/** Cadastros: sub-abas (só as que o nível enxerga) como rotas, para a URL guardar o lugar. */
export function CadastrosPage() {
  const { session } = useAuth()
  const tabs = allowedSubTabs(session?.user.admin_level)
  const { pathname } = useLocation()
  const current = tabs.find((t) => pathname.startsWith(`/admin/cadastros/${t}`))

  // /admin/cadastros sozinho abre a primeira sub-aba permitida.
  if (!current) return <Navigate to={`/admin/cadastros/${tabs[0] ?? ''}`} replace />

  return (
    <>
      <Tabs value={current}>
        <TabsList aria-label="Cadastros">
          {tabs.map((t) => (
            <TabsTrigger key={t} value={t} asChild>
              <NavLink to={`/admin/cadastros/${t}`}>{LABEL[t]}</NavLink>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <Outlet />
    </>
  )
}
