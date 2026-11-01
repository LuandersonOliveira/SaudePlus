import { EmptyState, ListSkeleton, QueryError } from '@/components/QueryState'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { localDateStr } from '@/features/staff/logic'
import { AgendaPage } from '@/features/staff/pages/AgendaPage'
import { errorMessage } from '@/lib/api'
import { AdminBookingsTable, RevealList } from '../components/AdminBookingsTable'
import { BOOKINGS_MAX_PAGES, BOOKINGS_PER_PAGE, isToday } from '../logic'
import { useAdminBookings } from '../queries'

function TodayAgenda() {
  const appts = useAdminBookings('appointments', true)
  const exams = useAdminBookings('exams', true)
  const today = localDateStr()
  const todayAppts = appts.data?.rows.filter((r) => isToday(r, today)) ?? []
  const todayExams = exams.data?.rows.filter((r) => isToday(r, today)) ?? []
  const truncated = !!(appts.data?.truncated || exams.data?.truncated)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">Agenda de hoje</CardTitle>
        <CardDescription>Consultas e exames marcados para hoje — confirme, cancele ou reagende.</CardDescription>
      </CardHeader>
      {/* minmax(0,1fr): sem isto o item do grid cresce até a largura da tabela e a página inteira rola na horizontal. */}
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-4 px-2 sm:px-6">
        {appts.isPending || exams.isPending ? (
          <ListSkeleton />
        ) : appts.isError || exams.isError ? (
          <QueryError
            message={errorMessage(appts.error ?? exams.error, 'Não foi possível carregar os dados')}
            onRetry={() => {
              void appts.refetch()
              void exams.refetch()
            }}
          />
        ) : todayAppts.length || todayExams.length ? (
          <>
            {todayAppts.length > 0 && (
              <div>
                <h3 className="mb-1 font-bold">Consultas de hoje</h3>
                <AdminBookingsTable kind="appointments" rows={todayAppts} caption="Consultas marcadas para hoje" />
              </div>
            )}
            {todayExams.length > 0 && (
              <div>
                <h3 className="mb-1 font-bold">Exames de hoje</h3>
                <AdminBookingsTable kind="exams" rows={todayExams} caption="Exames marcados para hoje" />
              </div>
            )}
          </>
        ) : (
          <EmptyState>Nada agendado para hoje.</EmptyState>
        )}

        {/* Honestidade numérica: se o teto de páginas estourou, diz — em vez de mostrar "0 pendentes" sem avisar. */}
        {truncated && (
          <p role="alert" className="rounded-sm bg-warning-soft p-3 text-sm text-warning-ink">
            Há mais de {BOOKINGS_PER_PAGE * BOOKINGS_MAX_PAGES} registros futuros no total. Este resumo pode estar incompleto —
            use a agenda operacional abaixo para ver a lista inteira.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function Recent({ kind, title, empty }: { kind: 'appointments' | 'exams'; title: string; empty: string }) {
  const q = useAdminBookings(kind, true)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-2 sm:px-6">
        <RevealList
          kind={kind}
          rows={q.data?.rows}
          isPending={q.isPending}
          error={q.error}
          onRetry={() => void q.refetch()}
          empty={empty}
          caption={title}
        />
      </CardContent>
    </Card>
  )
}

/** Atendimentos: agenda de hoje, recentes e a agenda operacional (a mesma do atendente). */
export function AtendimentosPage() {
  return (
    <>
      <TodayAgenda />
      <Recent kind="appointments" title="Consultas recentes" empty="Sem consultas." />
      <AgendaPage />
      <Recent kind="exams" title="Exames recentes" empty="Sem exames." />
    </>
  )
}
