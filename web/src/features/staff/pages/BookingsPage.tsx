import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { errorMessage } from '@/lib/api'
import { BookingsTable } from '../components/BookingsTable'
import { useBookings } from '../queries'
import type { BookingKindPath } from '../types'

function Section({ kind, title, empty }: { kind: BookingKindPath; title: string; empty: string }) {
  const q = useBookings(kind)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <BookingsTable
          rows={q.data?.map((r) => ({ ...r, kind }))}
          isLoading={q.isPending}
          error={q.error ? errorMessage(q.error, 'Erro ao carregar dados') : null}
          empty={empty}
        />
      </CardContent>
    </Card>
  )
}

export function BookingsPage() {
  return (
    <>
      <Section kind="appointments" title="Consultas recentes" empty="Sem consultas." />
      <Section kind="exams" title="Exames recentes" empty="Sem exames." />
    </>
  )
}
