import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { errorMessage } from '@/lib/api'
import { BookingsTable } from '../components/BookingsTable'
import { buildTodayQueue } from '../logic'
import { useBookings } from '../queries'

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

export function QueuePage() {
  const appts = useBookings('appointments')
  const exams = useBookings('exams')
  const loading = appts.isPending || exams.isPending
  const err = appts.error || exams.error
  const queue = buildTodayQueue(appts.data ?? [], exams.data ?? [])

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Pendentes hoje" value={loading ? '—' : queue.length} />
        <Stat label="Consultas" value={appts.data?.length ?? '—'} />
        <Stat label="Exames" value={exams.data?.length ?? '—'} />
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-extrabold">Pendentes para hoje</CardTitle>
        </CardHeader>
        <CardContent>
          <BookingsTable
            rows={queue}
            isLoading={loading}
            error={err ? errorMessage(err, 'Erro ao carregar dados') : null}
            empty="Nenhum pendente para hoje."
          />
        </CardContent>
      </Card>
    </>
  )
}
