import { useState } from 'react'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
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
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { errorMessage } from '@/lib/api'
import {
  UNIT_TYPES,
  UNIT_TYPE_LABEL,
  unitBody,
  validateUnit,
  type AdminUnit,
  type UnitErrors,
  type UnitFormValues,
  type UnitOffer,
  type UnitType,
} from './logic'
import { useDeleteOffer, useUpdateUnit } from './queries'

export function UnitTypeSelect({ id, value, onChange }: { id: string; value: UnitType; onChange: (v: UnitType) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as UnitType)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {UNIT_TYPES.map((t) => (
          <SelectItem key={t} value={t}>
            {UNIT_TYPE_LABEL[t]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function EditForm({ unit, onClose }: { unit: AdminUnit; onClose: () => void }) {
  const update = useUpdateUnit()
  const [v, setV] = useState<UnitFormValues>({
    name: unit.name || '',
    type: (UNIT_TYPES as readonly string[]).includes(unit.type) ? (unit.type as UnitType) : 'ubs',
    neighborhood: unit.neighborhood || '',
  })
  const [errors, setErrors] = useState<UnitErrors>({})
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof UnitFormValues>(k: K, val: UnitFormValues[K]) => setV((s) => ({ ...s, [k]: val }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const errs = validateUnit(v)
    setErrors(errs)
    if (Object.keys(errs).length) return
    try {
      await update.mutateAsync({ id: unit.id, body: unitBody(v) })
      toast.success('Unidade atualizada')
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível salvar a unidade.'))
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Editar unidade de saúde" className="grid gap-4">
      <FormField label="Nome da unidade" error={errors.name}>
        {(a) => <Input {...a} value={v.name} onChange={(e) => set('name', e.target.value)} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Tipo">{(a) => <UnitTypeSelect id={a.id} value={v.type} onChange={(t) => set('type', t)} />}</FormField>
        <FormField label="Bairro ou região">
          {(a) => <Input {...a} value={v.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} />}
        </FormField>
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
          {update.isPending ? 'Salvando…' : 'Salvar alterações'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function EditUnitDialog({ unit, onClose }: { unit: AdminUnit | null; onClose: () => void }) {
  return (
    <Dialog open={!!unit} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar unidade de saúde</DialogTitle>
          <DialogDescription>Altere nome, tipo ou bairro da unidade.</DialogDescription>
        </DialogHeader>
        {unit && <EditForm key={unit.id} unit={unit} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

/** Desativar tira a unidade dos formulários de agendamento; os atendimentos já marcados continuam. */
export function DeactivateUnitDialog({ unit, onClose }: { unit: AdminUnit | null; onClose: () => void }) {
  const update = useUpdateUnit()
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!unit) return
    setError(null)
    try {
      await update.mutateAsync({ id: unit.id, body: { active: 0 } })
      toast.success('Unidade desativada')
      onClose()
    } catch (e) {
      setError(errorMessage(e, 'Erro ao atualizar unidade'))
    }
  }

  return (
    <AlertDialog open={!!unit} onOpenChange={(o) => !o && !update.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desativar {unit?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            A unidade deixa de aparecer no agendamento para os pacientes até ser reativada. Os atendimentos já marcados continuam como estão.
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
            {update.isPending ? 'Desativando…' : 'Desativar unidade'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function RemoveOfferDialog({ unitId, offer, onClose }: { unitId: string; offer: UnitOffer | null; onClose: () => void }) {
  const del = useDeleteOffer()
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!offer) return
    setError(null)
    try {
      await del.mutateAsync({ unitId, offerId: offer.id })
      toast.success('Serviço removido')
      onClose()
    } catch (e) {
      setError(errorMessage(e, 'Erro ao remover serviço'))
    }
  }

  return (
    <AlertDialog open={!!offer} onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remover {offer?.kind === 'exame' ? 'o exame' : 'a especialidade'}?</AlertDialogTitle>
          <AlertDialogDescription>
            "{offer?.name}" deixa de aparecer para os pacientes desta unidade. Os agendamentos já marcados continuam válidos.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={del.isPending}>Voltar</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={del.isPending}>
            {del.isPending ? 'Removendo…' : 'Remover serviço'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
