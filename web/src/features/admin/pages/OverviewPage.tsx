import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { EmptyState, ListSkeleton, QueryError } from '@/components/QueryState'
import { StatCard } from '@/components/StatCard'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { errorMessage, getBlob, saveBlob } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { fmtDate } from '@/lib/validators'
import { can } from '../capabilities'
import { actorLabel, buildAttention, countTodayPending } from '../logic'
import { localDateStr } from '@/features/staff/logic'
import { useAdminBookings, useAdminStats, useRecentActivity } from '../queries'

export function OverviewPage() {
  const { session } = useAuth()
  const level = session?.user.admin_level
  const canAppointments = can(level, 'appointments')
  const canUsers = can(level, 'users')
  const canDiseases = can(level, 'diseases')
  const canUnits = can(level, 'units')
  const canAudit = can(level, 'audit')
  const canReports = can(level, 'reports')

  const stats = useAdminStats()
  const appts = useAdminBookings('appointments', canAppointments)
  const exams = useAdminBookings('exams', canAppointments)
  const activity = useRecentActivity(canAudit)
  const [csvBusy, setCsvBusy] = useState(false)

  // Um marcador de fonte que falhou vira "—" em vez de um 0 enganoso.
  const todayPending =
    appts.data && exams.data ? countTodayPending(appts.data.rows, exams.data.rows, localDateStr()) : undefined
  const s = stats.data
  const notes = s
    ? buildAttention({
        canUsers,
        canAppointments,
        canUnits,
        pendingUsers: Number(s.users.pending || 0),
        todayPending: todayPending ?? 0,
        inactiveUnits: Number(s.units.total || 0) - Number(s.units.active || 0),
      })
    : []

  async function downloadCsv() {
    setCsvBusy(true)
    try {
      saveBlob(await getBlob('/admin/export/summary.csv'), 'saude-plus-resumo-administrativo.csv')
    } catch (e) {
      toast.error(errorMessage(e, 'Erro ao baixar relatório'))
    } finally {
      setCsvBusy(false)
    }
  }

  return (
    <>
      {stats.isError ? (
        <QueryError message={errorMessage(stats.error, 'Não foi possível carregar os dados')} onRetry={() => void stats.refetch()} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-live="polite">
          {canAppointments && <StatCard label="Hoje (pendentes)" value={todayPending ?? '—'} />}
          {canUsers && <StatCard label="Aguardando ativação" value={s ? Number(s.users.pending || 0) : '—'} />}
          {canDiseases && <StatCard label="Alertas ativos" value={s ? Number(s.diseases.active || 0) : '—'} />}
          {canUnits && <StatCard label="Unidades ativas" value={s ? Number(s.units.active || 0) : '—'} />}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-extrabold">Precisa da sua atenção</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {stats.isPending ? (
            <ListSkeleton />
          ) : stats.isError ? null : notes.length ? (
            <ul>
              {notes.map((n) => (
                <li key={n.key} className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-b-0">
                  <div>
                    <p className="font-bold">{n.title}</p>
                    <p className="text-sm text-muted-foreground">{n.text}</p>
                  </div>
                  {n.to && (
                    <Button asChild size="sm">
                      <Link to={n.to}>{n.cta}</Link>
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Nenhuma pendência no momento.</EmptyState>
          )}

          <div className="flex flex-wrap gap-2">
            {canAppointments && (
              <Button asChild size="sm">
                <Link to="/admin/atendimentos">Ver atendimentos de hoje</Link>
              </Button>
            )}
            {canUsers && (
              <Button asChild size="sm" variant="outline">
                <Link to="/admin/cadastros/pessoas?status=pendente">Ver contas aguardando ativação</Link>
              </Button>
            )}
            {canReports && (
              <Button size="sm" variant="outline" onClick={downloadCsv} disabled={csvBusy}>
                {csvBusy ? 'Gerando…' : 'Baixar resumo CSV'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {canAudit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-extrabold">Atividade recente</CardTitle>
          </CardHeader>
          <CardContent>
            {activity.isPending ? (
              <ListSkeleton />
            ) : activity.isError ? (
              <QueryError message="Não foi possível carregar a atividade." onRetry={() => void activity.refetch()} />
            ) : activity.data.length ? (
              <ul>
                {activity.data.map((r, i) => (
                  <li key={r.id ?? i} className="flex flex-wrap items-start justify-between gap-3 border-b py-3 last:border-b-0">
                    <div className="min-w-0">
                      <p className="font-bold">
                        {actorLabel(r)} <Badge variant="secondary">{r.action}</Badge>
                      </p>
                      <p className="break-words text-sm text-muted-foreground">
                        {r.entity_type} · {r.details || ''}
                      </p>
                    </div>
                    <span className="text-sm text-muted-foreground">{fmtDate(r.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState>Nenhuma ação registrada ainda.</EmptyState>
            )}
          </CardContent>
        </Card>
      )}
    </>
  )
}
