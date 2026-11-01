import { MoreHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState, ListSkeleton, QueryError } from '@/components/QueryState'
import { OptionSelect } from '@/components/OptionSelect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { fmtDate } from '@/lib/validators'
import { DeleteUserDialog } from './components/DeleteUserDialog'
import { UserFormDialog } from './components/UserFormDialog'
import { UserHistoryDialog } from './components/UserHistoryDialog'
import { UserViewDialog } from './components/UserViewDialog'
import { canManage, ROLE_LABEL, summaryText } from './logic'
import { useAdminUsers } from './queries'
import { ROLES, STATUSES, type AccountStatus, type AdminUserRow, type UserFilters, type UserRole } from './types'

const STATUS_TONE: Record<string, string> = {
  ativo: 'bg-success-soft text-success',
  inativo: 'bg-danger-soft text-destructive',
  pendente: 'bg-warning-soft text-warning-ink',
}
const ROLE_OPTIONS: [string, string][] = ROLES.map((r) => [r, ROLE_LABEL[r]])
const STATUS_OPTIONS: [string, string][] = [['pendente', 'Aguardando ativação'], ['ativo', 'Ativos'], ['inativo', 'Inativos']]

const asRole = (v: string | null): UserFilters['role'] => ((ROLES as readonly string[]).includes(v ?? '') ? (v as UserRole) : '')
const asStatus = (v: string | null): UserFilters['status'] => ((STATUSES as readonly string[]).includes(v ?? '') ? (v as AccountStatus) : '')

function UserRow({ u, onView, onEdit, onHistory, onDelete, manageable }: {
  u: AdminUserRow
  manageable: boolean
  onView: () => void
  onEdit: () => void
  onHistory: () => void
  onDelete: () => void
}) {
  const name = u.full_name || '(Sem nome)'
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="font-bold">
          {name} <Badge variant="secondary">{ROLE_LABEL[u.role] ?? u.role}</Badge>{' '}
          <Badge variant="outline" className={cn('border-transparent', STATUS_TONE[u.account_status])}>
            {u.account_status}
          </Badge>
        </p>
        <p className="break-words text-sm text-muted-foreground">
          {[u.email, u.mobile, u.job_role].filter(Boolean).join(' · ')}
          {u.last_login_at ? ` · Último acesso: ${fmtDate(u.last_login_at)}` : ' · Nunca acessou'}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" aria-label={`Ações de ${name}`}>
            Ações <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onView}>Visualizar</DropdownMenuItem>
          {manageable && <DropdownMenuItem onSelect={onEdit}>Editar</DropdownMenuItem>}
          <DropdownMenuItem onSelect={onHistory}>Histórico</DropdownMenuItem>
          {manageable && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                Excluir
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}

/** Cadastros › Pessoas: busca com filtros na URL, lista que acumula e ações respeitando a hierarquia. */
export function PessoasPage() {
  const { session } = useAuth()
  const [params, setParams] = useSearchParams()
  const filters: UserFilters = { q: params.get('q') ?? '', role: asRole(params.get('role')), status: asStatus(params.get('status')) }
  // Os campos só viram filtro ao clicar em "Buscar" (como no legado); a URL guarda o filtro aplicado.
  const [q, setQ] = useState(filters.q)
  const [role, setRole] = useState<string>(filters.role)
  const [status, setStatus] = useState<string>(filters.status)

  const [viewId, setViewId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [del, setDel] = useState<{ id: string; name: string } | null>(null)
  const [hist, setHist] = useState<{ id: string; name: string } | null>(null)

  const list = useAdminUsers(filters)
  const rows = list.data?.pages.flatMap((p) => p.rows) ?? []
  const total = list.data?.pages.at(-1)?.total ?? 0
  const actor = session?.user ?? {}

  function apply(e: React.FormEvent) {
    e.preventDefault()
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    if (role) p.set('role', role)
    if (status) p.set('status', status)
    setParams(p, { replace: true })
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-extrabold">Gestão de usuários</CardTitle>
          <CardDescription>Localize contas, revise pendências e abra o perfil ou o histórico de atendimento.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div>
            <Button
              onClick={() => {
                setEditId(null)
                setFormOpen(true)
              }}
            >
              Novo usuário
            </Button>
          </div>

          <form onSubmit={apply} aria-label="Buscar usuários" className="flex flex-wrap items-end gap-3">
            <div className="grid min-w-52 flex-1 gap-1.5">
              <Label htmlFor="user-q" className="sr-only">
                Nome, e-mail ou telefone
              </Label>
              <Input id="user-q" placeholder="Nome, e-mail ou telefone…" autoComplete="off" spellCheck={false} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div className="grid w-44 gap-1.5">
              <Label htmlFor="user-role" className="sr-only">
                Filtrar por papel
              </Label>
              <OptionSelect id="user-role" aria-label="Filtrar por papel" value={role} onChange={setRole} options={ROLE_OPTIONS} emptyLabel="Todos os papéis" />
            </div>
            <div className="grid w-48 gap-1.5">
              <Label htmlFor="user-status" className="sr-only">
                Filtrar por status
              </Label>
              <OptionSelect id="user-status" aria-label="Filtrar por status" value={status} onChange={setStatus} options={STATUS_OPTIONS} emptyLabel="Todos os status" />
            </div>
            <Button type="submit">Buscar</Button>
          </form>

          <p role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
            {list.isPending ? 'Buscando usuários…' : list.isError ? '' : summaryText(total)}
          </p>

          <div aria-busy={list.isFetching}>
            {list.isPending ? (
              <ListSkeleton />
            ) : list.isError ? (
              <QueryError message={errorMessage(list.error, 'Não foi possível buscar os usuários.')} onRetry={() => void list.refetch()} />
            ) : rows.length === 0 ? (
              <EmptyState>Nenhum usuário encontrado com esses filtros.</EmptyState>
            ) : (
              <>
                <ul>
                  {rows.map((u) => (
                    <UserRow
                      key={u.id}
                      u={u}
                      manageable={canManage(actor, u)}
                      onView={() => setViewId(u.id)}
                      onEdit={() => {
                        setEditId(u.id)
                        setFormOpen(true)
                      }}
                      onHistory={() => setHist({ id: u.id, name: u.full_name || '' })}
                      onDelete={() => setDel({ id: u.id, name: u.full_name || u.email || '' })}
                    />
                  ))}
                </ul>
                {list.hasNextPage ? (
                  <div className="pt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={list.isFetchingNextPage}
                      aria-label={`Carregar mais ${total - rows.length} registro(s) de usuários`}
                      onClick={() => void list.fetchNextPage()}
                    >
                      {list.isFetchingNextPage ? 'Carregando…' : `Carregar mais (${rows.length} de ${total})`}
                    </Button>
                  </div>
                ) : (
                  <p className="pt-3 text-sm text-muted-foreground">Fim da lista — {total} registro(s).</p>
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <UserViewDialog id={viewId} onClose={() => setViewId(null)} />
      <UserFormDialog open={formOpen} editId={editId} onClose={() => setFormOpen(false)} />
      <DeleteUserDialog target={del} onClose={() => setDel(null)} />
      <UserHistoryDialog target={hist} onClose={() => setHist(null)} />
    </>
  )
}

