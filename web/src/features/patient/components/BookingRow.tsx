import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { StatusBadge } from '@/features/staff/components/StatusBadge'
import { fmtDate } from '@/lib/validators'
import { isOverdue } from '../logic'
import type { BookingItem } from '../types'

/** Linha de agendamento: tipo + título, local, status (e "atrasado") e data. `actions` à direita. */
export function BookingRow({ item, actions, showType = true }: { item: BookingItem; actions?: ReactNode; showType?: boolean }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="font-bold">
          {showType && (
            <Badge variant="secondary" className="mr-2">
              {item.typeLabel}
            </Badge>
          )}
          {item.title}
          {item.kind === 'appointments' && item.doctor ? (
            <span className="font-normal text-muted-foreground"> com {item.doctor}</span>
          ) : null}
        </p>
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          {item.location && <span>{item.location} ·</span>}
          <StatusBadge status={item.status} />
          {isOverdue(item.scheduled_at, item.status) && (
            <Badge variant="outline" className="border-transparent bg-warning-soft text-warning-ink">
              atrasado
            </Badge>
          )}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{fmtDate(item.scheduled_at)}</span>
        {actions}
      </div>
    </li>
  )
}
