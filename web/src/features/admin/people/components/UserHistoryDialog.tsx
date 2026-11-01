import { QueryError } from '@/components/QueryState'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { HistoryTable } from '@/features/staff/pages/PatientsPage'
import { errorMessage } from '@/lib/api'
import { useUserHistory } from '../queries'

function Body({ id }: { id: string }) {
  const q = useUserHistory(id)
  if (q.isPending) return <Skeleton className="h-40" aria-hidden="true" />
  if (q.isError) return <QueryError message={errorMessage(q.error, 'Erro ao carregar histórico')} onRetry={() => void q.refetch()} />
  const appts = q.data.appointments ?? []
  const exams = q.data.exams ?? []
  return (
    <div className="grid min-w-0 gap-4">
      <p className="text-sm text-muted-foreground">
        {appts.length} consultas · {exams.length} exames
      </p>
      <div className="min-w-0">
        <h3 className="mb-1 font-bold">Consultas</h3>
        <HistoryTable rows={appts} service="specialty" />
      </div>
      <div className="min-w-0">
        <h3 className="mb-1 font-bold">Exames</h3>
        <HistoryTable rows={exams} service="exam_type" />
      </div>
    </div>
  )
}

export function UserHistoryDialog({ target, onClose }: { target: { id: string; name: string } | null; onClose: () => void }) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Histórico de {target?.name || 'Usuário'}</DialogTitle>
          <DialogDescription>Consultas e exames do usuário.</DialogDescription>
        </DialogHeader>
        {target && <Body id={target.id} />}
      </DialogContent>
    </Dialog>
  )
}
