import { useState } from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { fmtDate } from '@/lib/validators'
import type { Booking, BookingKindPath } from '../types'
import { BookingActionDialog, type ActionTarget } from './BookingActionDialog'
import { BookingActions } from './BookingActions'
import { StatusBadge } from './StatusBadge'

export type BookingRowData = Booking & { kind: BookingKindPath }

interface Props {
  rows: BookingRowData[] | undefined
  isLoading: boolean
  error?: string | null
  empty: string
}

function serviceOf(r: BookingRowData) {
  return r.kind === 'appointments' ? r.specialty || '—' : r.exam_type || '—'
}

export function BookingsTable({ rows, isLoading, error, empty }: Props) {
  const [target, setTarget] = useState<ActionTarget | null>(null)

  if (isLoading) {
    return (
      <div className="grid gap-2" aria-hidden="true">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    )
  }
  if (error) return <p role="alert" className="text-sm text-destructive">{error}</p>
  if (!rows?.length) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Atendimento</TableHead>
            <TableHead>Paciente</TableHead>
            <TableHead>Data/hora</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const who = r.user_name || 'paciente'
            return (
              <TableRow key={`${r.kind}-${r.id}`}>
                <TableCell>
                  <div className="font-semibold">
                    <span className="mr-1.5 text-xs font-bold uppercase text-muted-foreground">
                      {r.kind === 'appointments' ? 'Consulta' : 'Exame'}
                    </span>
                    {serviceOf(r)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {[r.kind === 'appointments' && r.doctor ? `com ${r.doctor}` : null, r.location || r.reason]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </TableCell>
                <TableCell>{r.user_name || '—'}</TableCell>
                <TableCell className="whitespace-nowrap">{fmtDate(r.scheduled_at)}</TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell>
                  <BookingActions kind={r.kind} id={r.id} who={who} status={r.status} onAction={setTarget} />
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <BookingActionDialog target={target} onClose={() => setTarget(null)} />
    </>
  )
}
