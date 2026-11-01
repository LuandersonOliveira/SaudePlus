import { MoreHorizontal } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { errorMessage } from '@/lib/api'
import { useUpdateBooking } from '../queries'
import type { BookingKindPath, BookingStatus } from '../types'
import type { ActionTarget } from './BookingActionDialog'

interface Props {
  kind: BookingKindPath
  id: string
  who: string
  status: BookingStatus
  onAction: (t: ActionTarget) => void
  /** Mostra "Histórico" (usado na agenda operacional). */
  onHistory?: () => void
  /** `buttons`: botões diretos (listas largas). `menu`: um menu "Ações" (tabelas estreitas). */
  layout?: 'buttons' | 'menu'
}

/** Ações permitidas por status. Concluído e cancelado são estados finais. */
export function allowedActions(status: BookingStatus) {
  return {
    confirm: status === 'pendente',
    complete: status === 'pendente' || status === 'confirmado',
    cancel: status === 'pendente' || status === 'confirmado' || status === 'para_remarcar',
    reschedule: status === 'pendente' || status === 'confirmado' || status === 'para_remarcar',
  }
}

export function BookingActions({ kind, id, who, status, onAction, onHistory, layout = 'buttons' }: Props) {
  const update = useUpdateBooking()
  const can = allowedActions(status)
  const open = (mode: ActionTarget['mode']) => onAction({ mode, kind, id, who })

  async function confirm() {
    try {
      await update.mutateAsync({ kind, id, body: { status: 'confirmado' } })
      toast.success('Atendimento confirmado')
    } catch (e) {
      toast.error(errorMessage(e, 'Não foi possível confirmar'))
    }
  }

  if (layout === 'menu') {
    const hasMutations = can.confirm || can.complete || can.reschedule || can.cancel
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" aria-label={`Ações de ${who}`}>
            <span className="hidden sm:inline">Ações</span> <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {can.confirm && <DropdownMenuItem onSelect={confirm}>Confirmar</DropdownMenuItem>}
          {can.complete && <DropdownMenuItem onSelect={() => open('complete')}>Registrar</DropdownMenuItem>}
          {can.reschedule && <DropdownMenuItem onSelect={() => open('reschedule')}>Remarcar</DropdownMenuItem>}
          {can.cancel && (
            <DropdownMenuItem variant="destructive" onSelect={() => open('cancel')}>
              Cancelar
            </DropdownMenuItem>
          )}
          {hasMutations && onHistory && <DropdownMenuSeparator />}
          {onHistory && <DropdownMenuItem onSelect={onHistory}>Histórico</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {can.confirm && (
        <Button size="sm" variant="outline" disabled={update.isPending} onClick={confirm} aria-label={`Confirmar atendimento de ${who}`}>
          Confirmar
        </Button>
      )}
      {can.complete && (
        <Button size="sm" variant="outline" onClick={() => open('complete')} aria-label={`Registrar atendimento de ${who}`}>
          Registrar
        </Button>
      )}
      {can.reschedule && (
        <Button size="sm" variant="outline" onClick={() => open('reschedule')} aria-label={`Remarcar atendimento de ${who}`}>
          Remarcar
        </Button>
      )}
      {can.cancel && (
        <Button
          size="sm"
          variant="outline"
          className="border-destructive/40 text-destructive hover:text-destructive"
          onClick={() => open('cancel')}
          aria-label={`Cancelar atendimento de ${who}`}
        >
          Cancelar
        </Button>
      )}
      {onHistory && (
        <Button size="sm" variant="ghost" onClick={onHistory} aria-label={`Ver histórico de ${who}`}>
          Histórico
        </Button>
      )}
    </div>
  )
}
