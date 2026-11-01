import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api'
import { addDays } from '../logic'
import { useAgendaReport } from '../queries'

const pct = (v: number | null | undefined) => (v === null || v === undefined ? 'n/d' : `${Math.round(v * 100)}%`)

function Body({ from, to }: { from: string; to: string }) {
  const q = useAgendaReport(from, to, true)
  if (q.isPending) return <Skeleton className="h-40" aria-hidden="true" />
  if (q.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(q.error, 'Erro ao carregar relatório')}</p>
  const r = q.data
  const rows: [string, string | number][] = [
    ['Total', r.total ?? 0],
    ['Confirmados', r.totals?.confirmados ?? 0],
    ['Concluídos', r.totals?.concluidos ?? 0],
    ['Cancelados', r.totals?.cancelados ?? 0],
    ['Para remarcar', r.totals?.para_remarcar ?? 0],
    ['Faltas', r.totals?.faltas ?? 0],
    ['Ocupação', pct(r.occupancy_rate)],
    ['Absenteísmo', pct(r.absence_rate)],
  ]
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between border-b py-1.5">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-bold">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Resumo dos 30 dias até `date`. */
export function ReportDialog({ open, date, onClose }: { open: boolean; date: string; onClose: () => void }) {
  const from = addDays(date, -30)
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Relatório da agenda</DialogTitle>
          <DialogDescription>
            De {from.split('-').reverse().join('/')} a {date.split('-').reverse().join('/')}
          </DialogDescription>
        </DialogHeader>
        {open && <Body from={from} to={date} />}
      </DialogContent>
    </Dialog>
  )
}
