import { Link } from 'react-router-dom'
import { EmptyState, ListSkeleton, QueryError } from '@/components/QueryState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useMe } from '@/features/staff/queries'
import { errorMessage } from '@/lib/api'
import { patientCompleteness } from '../account/logic'
import { BookingRow } from '../components/BookingRow'
import { toItems, upcomingEvents } from '../logic'
import { useDiseases, useMyBookings, useReminders } from '../queries'

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardHeader>
        <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
        <CardTitle className="text-3xl font-extrabold">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}

export function HomePage() {
  const appts = useMyBookings('appointments')
  const exams = useMyBookings('exams')
  const diseases = useDiseases()
  const reminders = useReminders()
  const me = useMe()

  // O marcador de uma fonte que falhou vira "—" em vez de um 0 mentiroso.
  const unread = reminders.data?.filter((r) => !r.read).length
  const bookingsReady = appts.isSuccess && exams.isSuccess
  const items = bookingsReady ? toItems(appts.data, exams.data) : []
  const upcoming = upcomingEvents(items)
  const allFailed = [appts, exams, diseases, reminders].every((q) => q.isError)

  const profilePct = me.isSuccess ? patientCompleteness(me.data) : 100

  return (
    <>
      {profilePct < 100 && (
        <Card className="border-primary bg-accent">
          <CardHeader>
            <CardTitle className="text-xl font-extrabold">Complete seu perfil ({profilePct}%)</CardTitle>
            <p>Faltam dados como CNS e endereço — eles melhoram seu atendimento.</p>
            <Button asChild size="sm" className="mt-2 w-fit">
              <Link to="/dashboard/conta">Completar agora</Link>
            </Button>
          </CardHeader>
        </Card>
      )}

      {bookingsReady && items.length === 0 && (
        <Card className="border-primary bg-accent">
          <CardHeader>
            <CardTitle className="text-xl font-extrabold">Bem-vindo(a) ao Saúde+</CardTitle>
            <p>
              Use a aba <strong>Agendar</strong> para fazer seu primeiro agendamento.
            </p>
          </CardHeader>
        </Card>
      )}

      {allFailed ? (
        <QueryError
          message={errorMessage(appts.error, 'Erro ao carregar os números do painel.')}
          onRetry={() => [appts, exams, diseases, reminders].forEach((q) => void q.refetch())}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-live="polite">
          <Stat label="Consultas" value={appts.data?.length ?? '—'} />
          <Stat label="Exames" value={exams.data?.length ?? '—'} />
          <Stat label="Alertas ativos" value={diseases.data?.length ?? '—'} />
          <Stat label="Lembretes" value={unread ?? '—'} />
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-extrabold">Próximos eventos</CardTitle>
        </CardHeader>
        <CardContent>
          {appts.isPending || exams.isPending ? (
            <ListSkeleton />
          ) : !bookingsReady ? (
            <QueryError
              message={errorMessage(appts.error ?? exams.error, 'Erro ao carregar os próximos eventos.')}
              onRetry={() => {
                void appts.refetch()
                void exams.refetch()
              }}
            />
          ) : upcoming.length ? (
            <ul>
              {upcoming.map((i) => (
                <BookingRow key={`${i.kind}-${i.id}`} item={i} />
              ))}
            </ul>
          ) : (
            <EmptyState>
              Nenhum evento futuro agendado. <Link to="/dashboard/agendar" className="text-secondary-foreground underline">Agendar agora</Link>.
            </EmptyState>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-extrabold">Lembretes</CardTitle>
        </CardHeader>
        <CardContent>
          {reminders.isPending ? (
            <ListSkeleton />
          ) : reminders.isError ? (
            <QueryError message={errorMessage(reminders.error, 'Erro ao carregar os lembretes.')} onRetry={() => void reminders.refetch()} />
          ) : reminders.data.length ? (
            <ul>
              {reminders.data.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0">
                  <div>
                    <p className="font-bold">{r.title}</p>
                    <p className="text-sm text-muted-foreground">{r.message || ''}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={r.read ? 'border-transparent bg-muted text-muted-foreground' : 'border-transparent bg-warning-soft text-warning-ink'}
                  >
                    {r.read ? 'Lido' : 'Novo'}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Nenhum lembrete no momento.</EmptyState>
          )}
        </CardContent>
      </Card>
    </>
  )
}
