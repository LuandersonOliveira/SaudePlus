import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, ListSkeleton, QueryError } from '@/components/QueryState'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { fmtDate } from '@/lib/validators'
import { useLeaveWaitlist, useWaitlist } from './queries'
import type { WaitlistEntry } from './types'

const STATE_LABEL: Record<string, string> = {
  aguardando: 'Aguardando vaga',
  convertido: 'Vaga convertida em agendamento',
}

function LeaveDialog({ entry, onClose }: { entry: WaitlistEntry | null; onClose: () => void }) {
  const leave = useLeaveWaitlist()
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!entry) return
    setError(null)
    try {
      await leave.mutateAsync(entry.id)
      toast.success('Você saiu da lista de espera.')
      onClose()
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível sair da lista de espera.'))
    }
  }

  return (
    <AlertDialog open={!!entry} onOpenChange={(o) => !o && !leave.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sair da lista de espera?</AlertDialogTitle>
          <AlertDialogDescription>
            Você deixa de esperar uma vaga para {entry?.service_name}. Pode entrar de novo quando quiser.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={leave.isPending}>Voltar</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={leave.isPending}>
            {leave.isPending ? 'Saindo…' : 'Sair da lista'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Se um horário abrir para um serviço em que a pessoa espera, o servidor agenda e avisa por e-mail. */
export function WaitlistCard() {
  const q = useWaitlist()
  const [target, setTarget] = useState<WaitlistEntry | null>(null)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">Lista de espera</CardTitle>
        <CardDescription>
          Se um horário abrir para um serviço em que você está esperando, o Saúde+ agenda automaticamente e avisa por
          e-mail.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {q.isPending ? (
          <ListSkeleton rows={2} />
        ) : q.isError ? (
          <QueryError message={errorMessage(q.error, 'Não foi possível carregar a lista de espera.')} onRetry={() => void q.refetch()} />
        ) : q.data.length ? (
          <ul>
            {q.data.map((r) => {
              const waiting = r.status === 'aguardando'
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-b-0">
                  <div>
                    <p className="font-bold">
                      <Badge variant="secondary" className="mr-2">
                        {r.kind === 'exame' ? 'Exame' : 'Consulta'}
                      </Badge>
                      {r.service_name}
                    </p>
                    <Badge
                      variant="outline"
                      className={cn('mt-1 border-transparent', waiting ? 'bg-warning-soft text-warning-ink' : 'bg-muted text-muted-foreground')}
                    >
                      {STATE_LABEL[r.status] ?? 'Cancelada'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{fmtDate(r.created_at)}</span>
                    {waiting && (
                      <Button size="sm" variant="outline" aria-label={`Sair da lista de espera: ${r.service_name}`} onClick={() => setTarget(r)}>
                        Sair da lista
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <EmptyState>Nenhum serviço na lista de espera.</EmptyState>
        )}
      </CardContent>
      <LeaveDialog entry={target} onClose={() => setTarget(null)} />
    </Card>
  )
}
