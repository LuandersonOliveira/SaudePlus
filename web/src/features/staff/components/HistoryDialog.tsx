import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api'
import { fmtDate } from '@/lib/validators'
import { useBookingEvents } from '../queries'

export interface HistoryTarget {
  kind: 'consulta' | 'exame'
  id: string
  who: string
}

function Events({ target }: { target: HistoryTarget }) {
  const q = useBookingEvents(target.kind, target.id)
  if (q.isPending) return <Skeleton className="h-24" aria-hidden="true" />
  if (q.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(q.error, 'Erro ao carregar histórico')}</p>
  if (!q.data?.length) return <p className="text-sm text-muted-foreground">Sem histórico.</p>
  return (
    <ol className="grid gap-2">
      {q.data.map((e, i) => (
        <li key={i} className="rounded-sm border p-3 text-sm">
          <span className="font-semibold">{e.event_type}</span>
          <span className="text-muted-foreground"> — {fmtDate(e.created_at)}</span>
          {e.reason && <p className="text-muted-foreground">Motivo: {e.reason}</p>}
        </li>
      ))}
    </ol>
  )
}

export function HistoryDialog({ target, onClose }: { target: HistoryTarget | null; onClose: () => void }) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Histórico do atendimento</DialogTitle>
          <DialogDescription>{target?.who}</DialogDescription>
        </DialogHeader>
        {target && <Events target={target} />}
      </DialogContent>
    </Dialog>
  )
}
