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
import { Textarea } from '@/components/ui/textarea'
import { LEVEL_LABEL } from '@/features/patient/logic'
import { errorMessage } from '@/lib/api'
import { ALERT_LEVELS, diseaseBody, validateDisease, type AdminDisease, type AlertLevelValue, type DiseaseErrors, type DiseaseFormValues } from './logic'
import { useDeleteDisease, useUpdateDisease } from './queries'

export function LevelSelect({ id, value, onChange }: { id: string; value: AlertLevelValue; onChange: (v: AlertLevelValue) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as AlertLevelValue)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ALERT_LEVELS.map((l) => (
          <SelectItem key={l} value={l}>
            {LEVEL_LABEL[l]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function EditForm({ disease, onClose }: { disease: AdminDisease; onClose: () => void }) {
  const update = useUpdateDisease()
  const [v, setV] = useState<DiseaseFormValues>({
    name: disease.name || '',
    region: disease.region || '',
    alert_level: (disease.alert_level as AlertLevelValue) || 'baixo',
    description: disease.description || '',
  })
  const [errors, setErrors] = useState<DiseaseErrors>({})
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof DiseaseFormValues>(k: K, val: DiseaseFormValues[K]) => setV((s) => ({ ...s, [k]: val }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const errs = validateDisease(v, { requireRegion: false })
    setErrors(errs)
    if (Object.keys(errs).length) return
    try {
      await update.mutateAsync({ id: disease.id, body: diseaseBody(v) })
      toast.success('Alerta atualizado')
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Erro ao editar alerta'))
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Editar alerta" className="grid gap-4">
      <FormField label="Nome" error={errors.name}>
        {(a) => <Input {...a} value={v.name} onChange={(e) => set('name', e.target.value)} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Região">
          {(a) => <Input {...a} value={v.region} onChange={(e) => set('region', e.target.value)} />}
        </FormField>
        <FormField label="Nível">{(a) => <LevelSelect id={a.id} value={v.alert_level} onChange={(l) => set('alert_level', l)} />}</FormField>
      </div>
      <FormField label="Descrição">
        {(a) => <Textarea {...a} value={v.description} onChange={(e) => set('description', e.target.value)} />}
      </FormField>
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

export function EditDiseaseDialog({ disease, onClose }: { disease: AdminDisease | null; onClose: () => void }) {
  return (
    <Dialog open={!!disease} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Editar alerta</DialogTitle>
          <DialogDescription>Altere os dados do alerta epidemiológico.</DialogDescription>
        </DialogHeader>
        {disease && <EditForm key={disease.id} disease={disease} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}

/** Desativar tira o alerta da tela dos pacientes (o cadastro continua guardado): pede confirmação. */
export function DeactivateDiseaseDialog({ disease, onClose }: { disease: AdminDisease | null; onClose: () => void }) {
  const update = useUpdateDisease()
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!disease) return
    setError(null)
    try {
      await update.mutateAsync({ id: disease.id, body: { active: 0 } })
      toast.success('Alerta desativado')
      onClose()
    } catch (e) {
      setError(errorMessage(e, 'Erro ao atualizar alerta'))
    }
  }

  return (
    <AlertDialog open={!!disease} onOpenChange={(o) => !o && !update.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desativar o alerta?</AlertDialogTitle>
          <AlertDialogDescription>
            "{disease?.name}" deixa de aparecer para os pacientes da região. O cadastro continua guardado e dá para reativar depois.
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
            {update.isPending ? 'Desativando…' : 'Desativar alerta'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function DeleteDiseaseDialog({ disease, onClose }: { disease: AdminDisease | null; onClose: () => void }) {
  const del = useDeleteDisease()
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!disease) return
    setError(null)
    try {
      await del.mutateAsync(disease.id)
      toast.success('Alerta excluído')
      onClose()
    } catch (e) {
      setError(errorMessage(e, 'Erro ao excluir alerta'))
    }
  }

  return (
    <AlertDialog open={!!disease} onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir alerta?</AlertDialogTitle>
          <AlertDialogDescription>
            O alerta "{disease?.name}" deixará de aparecer para os usuários. Essa ação não pode ser desfeita.
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
            {del.isPending ? 'Excluindo…' : 'Excluir alerta'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
