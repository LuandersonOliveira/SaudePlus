import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { STATUS_LABEL, statusTone, type BadgeTone } from '../logic'
import type { BookingStatus } from '../types'

const TONE_CLASS: Record<BadgeTone, string> = {
  success: 'border-transparent bg-success-soft text-success',
  warning: 'border-transparent bg-warning-soft text-warning-ink',
  danger: 'border-transparent bg-danger-soft text-destructive',
  muted: 'border-transparent bg-muted text-muted-foreground',
  default: 'border-transparent bg-secondary text-secondary-foreground',
}

export function StatusBadge({ status }: { status: BookingStatus | string }) {
  return (
    <Badge variant="outline" className={cn('font-semibold', TONE_CLASS[statusTone(status)])}>
      {STATUS_LABEL[status as BookingStatus] ?? status}
    </Badge>
  )
}
