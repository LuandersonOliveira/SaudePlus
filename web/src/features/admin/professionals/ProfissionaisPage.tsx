import { useState } from 'react'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { AgendaDialog, type AgendaTarget } from './AgendaDialog'
import {
  EMPTY_PROFESSIONAL,
  countsFor,
  filterProfessionals,
  isActive,
  professionalBody,
  validateProfessional,
  type Professional,
  type ProfessionalFormValues,
} from './logic'
import { useCreateProfessional, useProfessionals, useUpdateProfessional } from './queries'

const ON = 'border-transparent bg-success-soft text-success'
const OFF = 'border-transparent bg-danger-soft text-destructive'

function Fields({ v, set, errors }: { v: ProfessionalFormValues; set: <K extends keyof ProfessionalFormValues>(k: K, x: string) => void; errors: { name?: string } }) {
  return (
    <>
      <FormField label="Nome" error={errors.name}>
        {(a) => <Input {...a} value={v.name} onChange={(e) => set('name', e.target.value)} />}
      </FormField>
      <FormField label="Cargo">
        {(a) => <Input {...a} placeholder="Ex.: Médico, Psicólogo" value={v.job_title} onChange={(e) => set('job_title', e.target.value)} />}
      </FormField>
      <FormField label="Registro profissional">
        {(a) => <Input {...a} placeholder="CRM, CRP…" value={v.registry} onChange={(e) => set('registry', e.target.value)} />}
      </FormField>
    </>
  )
}

function CreateCard() {
  const create = useCreateProfessional()
  const [v, setV] = useState<ProfessionalFormValues>(EMPTY_PROFESSIONAL)
  const [errors, setErrors] = useState<{ name?: string }>({})
  const set = (k: keyof ProfessionalFormValues, x: string) => setV((s) => ({ ...s, [k]: x }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validateProfessional(v)
    setErrors(errs)
    if (Object.keys(errs).length) return
    try {
      await create.mutateAsync(professionalBody(v))
      setV(EMPTY_PROFESSIONAL)
      toast.success('Profissional cadastrado')
    } catch (err) {
      setErrors({ name: errorMessage(err, 'Não foi possível salvar o profissional.') })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">Cadastrar profissional</CardTitle>
        <CardDescription>Profissional ativo só aparece no agendamento depois de vinculado a uma unidade e a um serviço.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate aria-label="Cadastrar profissional" className="grid items-start gap-4 sm:grid-cols-2">
          <Fields v={v} set={set} errors={errors} />
          <div className="self-end">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Adicionando…' : 'Adicionar'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function EditForm({ prof, onClose }: { prof: Professional; onClose: () => void }) {
  const update = useUpdateProfessional()
  const [v, setV] = useState<ProfessionalFormValues>({ name: prof.name || '', job_title: prof.job_title || '', registry: prof.registry || '' })
  const [errors, setErrors] = useState<{ name?: string }>({})
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof ProfessionalFormValues, x: string) => setV((s) => ({ ...s, [k]: x }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const errs = validateProfessional(v)
    setErrors(errs)
    if (Object.keys(errs).length) return
    try {
      await update.mutateAsync({ id: prof.id, body: professionalBody(v) })
      toast.success('Profissional atualizado')
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível salvar o profissional.'))
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label="Editar profissional" className="grid gap-4">
      <Fields v={v} set={set} errors={errors} />
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

/**
 * Desativar tira o profissional do agendamento E manda os atendimentos futuros dele para a fila de
 * remarcação (o servidor avisa os pacientes por e-mail) — o legado não dizia isso na confirmação.
 */
function DeactivateDialog({ prof, onClose }: { prof: Professional | null; onClose: () => void }) {
  const update = useUpdateProfessional()
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!prof) return
    setError(null)
    try {
      const r = await update.mutateAsync({ id: prof.id, body: { active: 0 } })
      toast.success(r?.moved ? `Profissional desativado — ${r.moved} atendimento(s) foram para a fila de remarcação` : 'Profissional desativado')
      onClose()
    } catch (e) {
      setError(errorMessage(e, 'Erro ao atualizar profissional'))
    }
  }

  return (
    <AlertDialog open={!!prof} onOpenChange={(o) => !o && !update.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Desativar {prof?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            O profissional deixa de aparecer no agendamento até ser reativado. Os atendimentos pendentes ou confirmados dele que ainda não
            aconteceram vão para a fila de remarcação e os pacientes são avisados por e-mail. Horários e vínculos continuam guardados.
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
            {update.isPending ? 'Desativando…' : 'Desativar profissional'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function ListCard() {
  const q = useProfessionals()
  const update = useUpdateProfessional()
  const [term, setTerm] = useState('')
  const [edit, setEdit] = useState<Professional | null>(null)
  const [deactivate, setDeactivate] = useState<Professional | null>(null)
  const [agenda, setAgenda] = useState<AgendaTarget | null>(null)

  async function toggle(p: Professional) {
    if (isActive(p)) return setDeactivate(p)
    try {
      await update.mutateAsync({ id: p.id, body: { active: 1 } })
      toast.success('Profissional ativado')
    } catch (e) {
      toast.error(errorMessage(e, 'Erro ao atualizar profissional'))
    }
  }

  const data = q.data
  const all = data?.professionals ?? []
  const visible = filterProfessionals(all, term)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">Profissionais cadastrados</CardTitle>
        <CardDescription>Em "Gerenciar" ficam vínculos com unidades e serviços, horários de atendimento e bloqueios de agenda.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="prof-filter" className="sr-only">
            Filtrar profissionais pelo nome ou cargo
          </Label>
          <Input id="prof-filter" placeholder="Filtrar por nome ou cargo…" autoComplete="off" spellCheck={false} value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        {q.isPending ? (
          <ListSkeleton />
        ) : q.isError || !data ? (
          <QueryError message={errorMessage(q.error, 'Erro ao carregar profissionais')} onRetry={() => void q.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState>Nenhum profissional cadastrado.</EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState>Nenhum profissional casa com "{term}".</EmptyState>
        ) : (
          <ul>
            {visible.map((p) => {
              const active = isActive(p)
              const c = countsFor(data, p.id)
              return (
                <li key={p.id} className="flex flex-wrap items-start justify-between gap-3 border-b py-3 last:border-b-0">
                  <div className="min-w-0">
                    <p className="font-bold">
                      {p.name}{' '}
                      <Badge variant="outline" className={cn(active ? ON : OFF)}>
                        {active ? 'Ativo' : 'Inativo'}
                      </Badge>{' '}
                      {p.job_title && <Badge variant="secondary">{p.job_title}</Badge>}
                    </p>
                    <p className="break-words text-sm text-muted-foreground">
                      {p.registry ? `Registro: ${p.registry} · ` : ''}
                      {c.offers} vínculo(s) · {c.schedules} horário(s) · {c.blocks} bloqueio(s)
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" aria-label={`Gerenciar vínculos e agenda de ${p.name}`} onClick={() => setAgenda({ professionalId: p.id, name: p.name })}>
                      Gerenciar
                    </Button>
                    <Button size="sm" variant="outline" aria-label={`Editar ${p.name}`} onClick={() => setEdit(p)}>
                      Editar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className={active ? 'border-destructive/40 text-destructive hover:text-destructive' : undefined}
                      aria-label={`${active ? 'Desativar' : 'Ativar'} ${p.name}`}
                      onClick={() => void toggle(p)}
                    >
                      {active ? 'Desativar' : 'Ativar'}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}

        <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Editar profissional</DialogTitle>
              <DialogDescription>Altere nome, cargo ou registro profissional.</DialogDescription>
            </DialogHeader>
            {edit && <EditForm key={edit.id} prof={edit} onClose={() => setEdit(null)} />}
          </DialogContent>
        </Dialog>
        <DeactivateDialog prof={deactivate} onClose={() => setDeactivate(null)} />
        <AgendaDialog target={agenda} onClose={() => setAgenda(null)} />
      </CardContent>
    </Card>
  )
}

/** Cadastros › Profissionais: cadastro, ativação e a agenda de cada um (capability `units`). */
export function ProfissionaisPage() {
  return (
    <>
      <CreateCard />
      <ListCard />
    </>
  )
}
