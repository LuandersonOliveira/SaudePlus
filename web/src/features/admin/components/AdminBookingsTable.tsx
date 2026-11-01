import { MoreHorizontal } from 'lucide-react'
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
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { StatusBadge } from '@/features/staff/components/StatusBadge'
import { maxLocalForInput, nowLocalForInput, RESCHEDULE_REASON_LABEL, toApiDateTime } from '@/features/staff/logic'
import { errorMessage } from '@/lib/api'
import { fmtDate } from '@/lib/validators'
import { fmtShortDateTime } from '../logic'
import { useAdminUpdateBooking } from '../queries'
import type { AdminBooking, AdminBookingKind } from '../types'

interface Target {
  kind: AdminBookingKind
  row: AdminBooking
}

const noun = (kind: AdminBookingKind) => (kind === 'exams' ? 'exame' : 'consulta')
/** Só pendente e confirmado aceitam ação (concluído, cancelado e "para remarcar" não). */
export const canAct = (status: string) => status === 'pendente' || status === 'confirmado'

function CancelDialog({ target, onClose }: { target: Target | null; onClose: () => void }) {
  const update = useAdminUpdateBooking()
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!target) return
    setError(null)
    try {
      await update.mutateAsync({ kind: target.kind, id: target.row.id, body: { status: 'cancelado' } })
      toast.success('Atualizado')
      onClose()
    } catch (e) {
      setError(errorMessage(e, 'Erro ao cancelar'))
    }
  }

  const row = target?.row
  return (
    <AlertDialog open={!!target} onOpenChange={(o) => !o && !update.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancelar {target ? (target.kind === 'exams' ? 'o exame' : 'a consulta') : ''}?</AlertDialogTitle>
          <AlertDialogDescription>
            {row?.user_name || 'O atendimento'}
            {row ? ` em ${fmtDate(row.scheduled_at)}` : ''} passa a constar como cancelado. O paciente vê a mudança e precisa
            remarcar — não dá para desfazer por aqui.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={update.isPending}>Voltar</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={update.isPending}>
            {update.isPending ? 'Cancelando…' : `Cancelar ${target?.kind === 'exams' ? 'o exame' : 'o atendimento'}`}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function RescheduleForm({ target, onClose }: { target: Target; onClose: () => void }) {
  const update = useAdminUpdateBooking()
  const [when, setWhen] = useState('')
  const [reason, setReason] = useState('solicitado_pelo_paciente')
  const [error, setError] = useState<string | null>(null)
  const min = nowLocalForInput()
  const max = maxLocalForInput()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!when) return setError('Selecione uma data e hora válidas')
    if (when < min) return setError('A nova data não pode estar no passado.')
    if (when > max) return setError('A nova data deve estar dentro de 1 ano.')
    try {
      // O servidor exige o motivo da remarcação (400 "Informe o motivo da remarcação."), também para o admin.
      await update.mutateAsync({
        kind: target.kind,
        id: target.row.id,
        body: { scheduled_at: toApiDateTime(when), reschedule_reason: reason },
      })
      toast.success('Reagendado com sucesso')
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Erro ao reagendar'))
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="adm-resched">Data/hora</Label>
        <Input id="adm-resched" type="datetime-local" min={min} max={max} value={when} onChange={(e) => setWhen(e.target.value)} />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="adm-resched-reason">Motivo da remarcação</Label>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger id="adm-resched-reason" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(RESCHEDULE_REASON_LABEL).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && (
        <p role="alert" className="rounded-sm bg-danger-soft p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={update.isPending}>
          {update.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function RescheduleDialog({ target, onClose }: { target: Target | null; onClose: () => void }) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reagendar atendimento</DialogTitle>
          <DialogDescription>
            {target ? `${target.row.user_name || 'Paciente'} — selecione a nova data e horário.` : ''}
          </DialogDescription>
        </DialogHeader>
        {target && <RescheduleForm key={target.row.id} target={target} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

interface Props {
  kind: AdminBookingKind
  rows: AdminBooking[]
  caption: string
}

/** Tabela de agendamentos com as ações do admin (confirmar, cancelar, reagendar). */
export function AdminBookingsTable({ kind, rows, caption }: Props) {
  const update = useAdminUpdateBooking()
  const [cancel, setCancel] = useState<Target | null>(null)
  const [resched, setResched] = useState<Target | null>(null)
  const isAppt = kind === 'appointments'

  async function confirm(row: AdminBooking) {
    try {
      await update.mutateAsync({ kind, id: row.id, body: { status: 'confirmado' } })
      toast.success('Atualizado')
    } catch (e) {
      toast.error(errorMessage(e, 'Erro'))
    }
  }

  return (
    <>
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Paciente</TableHead>
            <TableHead>Data/hora</TableHead>
            <TableHead className="hidden sm:table-cell">{isAppt ? 'Especialidade' : 'Tipo de exame'}</TableHead>
            {isAppt && <TableHead className="hidden md:table-cell">Médico</TableHead>}
            <TableHead className="hidden md:table-cell">Local</TableHead>
            <TableHead className="hidden sm:table-cell">Status</TableHead>
            <TableHead>Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const who = r.user_name || 'Paciente'
            const label = `${noun(kind)} de ${who} em ${fmtDate(r.scheduled_at)}`
            return (
              <TableRow key={r.id}>
                <TableCell>
                  {who}
                  {/* No celular as colunas Serviço e Status somem; passam para baixo do nome para o menu de ações caber. */}
                  <span className="block text-xs text-muted-foreground sm:hidden">{(isAppt ? r.specialty : r.exam_type) || '—'}</span>
                  <span className="mt-1 block sm:hidden">
                    <StatusBadge status={r.status} />
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className="sm:hidden">{fmtShortDateTime(r.scheduled_at)}</span>
                  <span className="hidden sm:inline">{fmtDate(r.scheduled_at)}</span>
                </TableCell>
                <TableCell className="hidden sm:table-cell">{(isAppt ? r.specialty : r.exam_type) || '—'}</TableCell>
                {isAppt && <TableCell className="hidden md:table-cell">{r.doctor || '—'}</TableCell>}
                <TableCell className="hidden md:table-cell">{r.location || '—'}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell>
                  {canAct(r.status) ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="sm" variant="outline" aria-label={`Ações para ${label}`}>
                          <span className="hidden sm:inline">Ações</span> <MoreHorizontal aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => void confirm(r)}>Confirmar</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setResched({ kind, row: r })}>Reagendar</DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => setCancel({ kind, row: r })}>
                          Cancelar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
      <CancelDialog target={cancel} onClose={() => setCancel(null)} />
      <RescheduleDialog target={resched} onClose={() => setResched(null)} />
    </>
  )
}

/** Lista que revela mais linhas aos poucos ("Carregar mais"), sem nova ida ao servidor. */
export function RevealList({
  kind,
  rows,
  isPending,
  error,
  onRetry,
  empty,
  caption,
  step = 20,
}: {
  kind: AdminBookingKind
  rows: AdminBooking[] | undefined
  isPending: boolean
  error?: unknown
  onRetry?: () => void
  empty: string
  caption: string
  step?: number
}) {
  const [shown, setShown] = useState(step)
  if (isPending) return <ListSkeleton />
  if (error || !rows) return <QueryError message={errorMessage(error, 'Não foi possível carregar os dados')} onRetry={onRetry} />
  if (!rows.length) return <EmptyState>{empty}</EmptyState>

  const slice = rows.slice(0, shown)
  const left = rows.length - slice.length
  return (
    <>
      <AdminBookingsTable kind={kind} rows={slice} caption={caption} />
      {left > 0 ? (
        <div className="pt-3">
          <Button
            variant="outline"
            size="sm"
            aria-label={`Carregar mais ${Math.min(left, step)} ${kind === 'exams' ? 'exames' : 'consultas'}`}
            onClick={() => setShown((s) => s + step)}
          >
            Carregar mais ({slice.length} de {rows.length})
          </Button>
        </div>
      ) : (
        <p className="pt-3 text-sm text-muted-foreground">{rows.length} registro(s) carregado(s).</p>
      )}
    </>
  )
}
