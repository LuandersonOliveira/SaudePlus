import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage } from '@/lib/api'
import {
  maxLocalForInput,
  nowLocalForInput,
  OUTCOME_LABEL,
  RESCHEDULE_REASON_LABEL,
  toApiDateTime,
} from '../logic'
import { useUpdateBooking } from '../queries'
import type { BookingKindPath } from '../types'

export type ActionMode = 'cancel' | 'complete' | 'reschedule'

export interface ActionTarget {
  mode: ActionMode
  kind: BookingKindPath
  id: string
  /** Nome do paciente, para o título e o leitor de tela. */
  who: string
}

// Desfechos que fazem sentido em cada fluxo (o servidor aceita os 6 valores).
const COMPLETE_OUTCOMES = ['compareceu', 'faltou', 'recusou', 'desistiu'] as const
const CANCEL_OUTCOMES = ['recusou', 'desistiu', 'erro_agendamento', 'profissional_indisponivel'] as const

const TITLE: Record<ActionMode, string> = {
  cancel: 'Cancelar atendimento',
  complete: 'Registrar atendimento',
  reschedule: 'Remarcar atendimento',
}

function OutcomeSelect({ id, value, onChange, options }: { id: string; value: string; onChange: (v: string) => void; options: readonly string[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {OUTCOME_LABEL[o] ?? o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function ActionForm({ target, onClose }: { target: ActionTarget; onClose: () => void }) {
  const update = useUpdateBooking()
  const [outcome, setOutcome] = useState<string>(target.mode === 'cancel' ? 'recusou' : 'compareceu')
  const [reason, setReason] = useState('')
  const [reschedReason, setReschedReason] = useState('solicitado_pelo_paciente')
  const [when, setWhen] = useState('')
  const [error, setError] = useState<string | null>(null)

  const min = nowLocalForInput()
  const max = maxLocalForInput()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    let body
    let okMsg: string
    if (target.mode === 'cancel') {
      if (reason.trim().length < 3) return setError('Informe o motivo do cancelamento.')
      body = { status: 'cancelado', outcome, reschedule_reason: reason.trim().slice(0, 255) }
      okMsg = 'Atendimento cancelado'
    } else if (target.mode === 'complete') {
      body = { status: 'concluido', outcome }
      okMsg = 'Atendimento registrado'
    } else {
      if (!when) return setError('Selecione uma data e hora válidas.')
      if (when < min) return setError('A nova data não pode estar no passado.')
      if (when > max) return setError('A nova data deve estar dentro de 1 ano.')
      body = { scheduled_at: toApiDateTime(when), reschedule_reason: reschedReason }
      okMsg = 'Remarcado com sucesso'
    }

    try {
      await update.mutateAsync({ kind: target.kind, id: target.id, body })
      toast.success(okMsg)
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível salvar. Tente novamente.'))
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      {target.mode === 'complete' && (
        <div className="grid gap-2">
          <Label htmlFor="act-outcome">Desfecho</Label>
          <OutcomeSelect id="act-outcome" value={outcome} onChange={setOutcome} options={COMPLETE_OUTCOMES} />
        </div>
      )}

      {target.mode === 'cancel' && (
        <>
          <div className="grid gap-2">
            <Label htmlFor="act-outcome">Motivo do cancelamento (categoria)</Label>
            <OutcomeSelect id="act-outcome" value={outcome} onChange={setOutcome} options={CANCEL_OUTCOMES} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="act-reason">Descreva o motivo *</Label>
            <Textarea id="act-reason" value={reason} maxLength={255} onChange={(e) => setReason(e.target.value)} />
          </div>
        </>
      )}

      {target.mode === 'reschedule' && (
        <>
          <div className="grid gap-2">
            <Label htmlFor="act-when">Nova data e hora *</Label>
            <Input id="act-when" type="datetime-local" min={min} max={max} value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="act-resched">Motivo da remarcação</Label>
            <Select value={reschedReason} onValueChange={setReschedReason}>
              <SelectTrigger id="act-resched" className="w-full">
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
        </>
      )}

      {error && (
        <p role="alert" className="rounded-sm bg-danger-soft p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Voltar
        </Button>
        <Button
          type="submit"
          variant={target.mode === 'cancel' ? 'destructive' : 'default'}
          disabled={update.isPending}
        >
          {update.isPending ? 'Salvando…' : target.mode === 'cancel' ? 'Cancelar atendimento' : 'Salvar'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function BookingActionDialog({ target, onClose }: { target: ActionTarget | null; onClose: () => void }) {
  return (
    <Dialog open={!!target} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {target && (
          <>
            <DialogHeader>
              <DialogTitle>{TITLE[target.mode]}</DialogTitle>
              <DialogDescription>{target.who}</DialogDescription>
            </DialogHeader>
            {/* key: o estado do formulário recomeça a cada ação aberta */}
            <ActionForm key={`${target.mode}:${target.id}`} target={target} onClose={onClose} />
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
