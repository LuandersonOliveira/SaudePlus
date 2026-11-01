import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState, ListSkeleton, QueryError } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { errorMessage } from '@/lib/api'
import { BookingRow } from '../components/BookingRow'
import { CancelDialog } from '../components/CancelDialog'
import { canEditOrCancel, canRebook, sortRecentFirst, toItems } from '../logic'
import { useMyBookings } from '../queries'
import type { BookingItem, MyBooking, MyKind } from '../types'

/** Estado enviado à aba "Agendar" para editar ou refazer um agendamento. */
export interface BookingIntent {
  mode: 'edit' | 'rebook'
  kind: MyKind
  id: string
}

function Actions({ item, onCancel }: { item: BookingItem; onCancel: (i: BookingItem) => void }) {
  const navigate = useNavigate()
  const go = (mode: BookingIntent['mode']) =>
    navigate('/dashboard/agendar', { state: { mode, kind: item.kind, id: item.id } satisfies BookingIntent })
  const name = `${item.typeLabel === 'Consulta' ? 'a consulta' : 'o exame'} de ${item.title}`

  return (
    <>
      {canEditOrCancel(item.status) && (
        <>
          <Button size="sm" variant="outline" aria-label={`Editar ${name}`} onClick={() => go('edit')}>
            Editar
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-destructive/40 text-destructive hover:text-destructive"
            aria-label={`Cancelar ${name}`}
            onClick={() => onCancel(item)}
          >
            Cancelar
          </Button>
        </>
      )}
      {canRebook(item.status) && (
        <Button size="sm" variant="outline" aria-label={`Tentar agendar novamente: ${item.title}`} onClick={() => go('rebook')}>
          Tentar agendar novamente
        </Button>
      )}
    </>
  )
}

function Section({
  title,
  description,
  query,
  rows,
  showType,
  empty,
  onCancel,
}: {
  title: string
  description?: string
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown }
  rows: BookingItem[]
  showType: boolean
  empty: string
  onCancel: (i: BookingItem) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <ListSkeleton />
        ) : query.isError ? (
          <QueryError message={errorMessage(query.error, 'Erro ao carregar seus agendamentos.')} onRetry={() => void query.refetch()} />
        ) : rows.length ? (
          <ul>
            {rows.map((i) => (
              <BookingRow key={`${i.kind}-${i.id}`} item={i} showType={showType} actions={<Actions item={i} onCancel={onCancel} />} />
            ))}
          </ul>
        ) : (
          <EmptyState>{empty}</EmptyState>
        )}
      </CardContent>
    </Card>
  )
}

export function MyBookingsPage() {
  const appts = useMyBookings('appointments')
  const exams = useMyBookings('exams')
  const [target, setTarget] = useState<BookingItem | null>(null)

  const both = { isPending: appts.isPending || exams.isPending, isError: appts.isError || exams.isError, error: appts.error ?? exams.error, refetch: () => { void appts.refetch(); void exams.refetch() } }
  const all = sortRecentFirst(toItems(appts.data ?? [], exams.data ?? []))
  const onlyKind = (rows: MyBooking[] | undefined, kind: MyKind) => toItems(kind === 'appointments' ? (rows ?? []) : [], kind === 'exams' ? (rows ?? []) : [])

  return (
    <>
      <Section
        title="Todos os meus agendamentos"
        description="Consultas e exames — ativos, confirmados e cancelados."
        query={both}
        rows={all}
        showType
        empty="Nenhum agendamento encontrado."
        onCancel={setTarget}
      />
      <Section title="Minhas consultas" query={appts} rows={onlyKind(appts.data, 'appointments')} showType={false} empty="Nenhum registro." onCancel={setTarget} />
      <Section title="Meus exames" query={exams} rows={onlyKind(exams.data, 'exams')} showType={false} empty="Nenhum registro." onCancel={setTarget} />
      <CancelDialog item={target} onClose={() => setTarget(null)} />
    </>
  )
}
