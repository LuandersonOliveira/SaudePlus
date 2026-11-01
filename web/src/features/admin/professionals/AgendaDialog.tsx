import { useState } from 'react'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { OptionSelect } from '@/components/OptionSelect'
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
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { errorMessage } from '@/lib/api'
import { useAdminUnits } from '../network/queries'
import {
  EMPTY_BLOCK,
  EMPTY_OFFER,
  EMPTY_SCHEDULE,
  WEEKDAYS,
  blockBody,
  findProfessional,
  fmtBlockDate,
  hhmm,
  scheduleBody,
  validateBlock,
  validateOffer,
  validateSchedule,
  type BlockErrors,
  type BlockFormValues,
  type OfferFormValues,
  type Professional,
  type ProfessionalsData,
  type ScheduleErrors,
  type ScheduleFormValues,
} from './logic'
import { useAddBlock, useAddProfessionalOffer, useAddSchedule, useProfessionals, useRemoveItem, type RemovableKind } from './queries'

/** Quem abre o painel: um profissional direto ou o atendente (resolvido pela conta ligada a ele). */
export interface AgendaTarget {
  professionalId?: string | null
  userId?: string | null
  /** Nome para o título enquanto a lista carrega. */
  name: string
}

function useUnitOptions(): [string, string][] {
  const units = useAdminUnits()
  return (units.data ?? []).filter((u) => Number(u.active) === 1).map((u) => [u.id, u.name])
}

interface Removal {
  kind: RemovableKind
  id: string
  title: string
  message: string
  confirm: string
  done: string
}

function OffersTab({ prof, data, onRemove }: { prof: Professional; data: ProfessionalsData; onRemove: (r: Removal) => void }) {
  const units = useUnitOptions()
  const add = useAddProfessionalOffer()
  const [v, setV] = useState<OfferFormValues>(EMPTY_OFFER)
  const [errors, setErrors] = useState<{ unit_id?: string; name?: string }>({})
  const set = <K extends keyof OfferFormValues>(k: K, val: OfferFormValues[K]) => setV((s) => ({ ...s, [k]: val }))
  const offers = data.offers.filter((o) => o.professional_id === prof.id)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validateOffer(v)
    setErrors(errs)
    if (Object.keys(errs).length) return
    try {
      await add.mutateAsync({ id: prof.id, body: { unit_id: v.unit_id, kind: v.kind, name: v.name.trim(), ...(v.reason.trim() ? { reason: v.reason.trim() } : {}) } })
      setV({ ...EMPTY_OFFER, unit_id: v.unit_id, kind: v.kind })
      setErrors({})
      toast.success('Vínculo criado')
    } catch (err) {
      setErrors({ name: errorMessage(err, 'Não foi possível criar o vínculo.') })
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">O profissional só aparece para o serviço vinculado naquela unidade.</p>
      <form onSubmit={submit} noValidate aria-label="Vincular profissional a unidade e serviço" className="grid items-start gap-4 sm:grid-cols-2">
        <FormField label="Unidade" error={errors.unit_id}>
          {(a) => <OptionSelect {...a} value={v.unit_id} onChange={(x) => set('unit_id', x)} options={units} emptyLabel="Selecione a unidade…" />}
        </FormField>
        <FormField label="Tipo">
          {(a) => (
            <OptionSelectKind id={a.id} value={v.kind} onChange={(k) => set('kind', k)} />
          )}
        </FormField>
        <FormField label="Especialidade / exame" error={errors.name}>
          {(a) => <Input {...a} placeholder="Ex.: Cardiologia" value={v.name} onChange={(e) => set('name', e.target.value)} />}
        </FormField>
        <FormField label="Motivo (opcional)">
          {(a) => <Input {...a} placeholder="Ex.: contratação nova" value={v.reason} onChange={(e) => set('reason', e.target.value)} />}
        </FormField>
        <div>
          <Button type="submit" variant="outline" disabled={add.isPending}>
            {add.isPending ? 'Vinculando…' : 'Vincular'}
          </Button>
        </div>
      </form>
      {offers.length === 0 ? (
        <EmptyState>Nenhum vínculo cadastrado.</EmptyState>
      ) : (
        <ul>
          {offers.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-b-0">
              <div className="min-w-0">
                <p className="font-bold">
                  {o.name} <Badge variant="outline">{o.kind === 'exame' ? 'Exame' : 'Consulta'}</Badge>
                </p>
                <p className="text-sm text-muted-foreground">{o.unit_name}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/40 text-destructive hover:text-destructive"
                aria-label={`Remover vínculo com ${o.name} em ${o.unit_name}`}
                onClick={() =>
                  onRemove({
                    kind: 'offers',
                    id: o.id,
                    title: 'Remover o vínculo?',
                    message: `${o.name} deixa de aparecer para este profissional em ${o.unit_name}. Os horários já publicados continuam, mas sem serviço vinculado.`,
                    confirm: 'Remover vínculo',
                    done: 'Vínculo removido',
                  })
                }
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function OptionSelectKind({ id, value, onChange }: { id: string; value: 'consulta' | 'exame'; onChange: (v: 'consulta' | 'exame') => void }) {
  return (
    <OptionSelect
      id={id}
      value={value}
      onChange={(k) => onChange(k === 'exame' ? 'exame' : 'consulta')}
      options={[['consulta', 'Consulta'], ['exame', 'Exame']]}
      emptyLabel="Consulta"
    />
  )
}

function SchedulesTab({ prof, data, onRemove }: { prof: Professional; data: ProfessionalsData; onRemove: (r: Removal) => void }) {
  const units = useUnitOptions()
  const add = useAddSchedule()
  const [v, setV] = useState<ScheduleFormValues>(EMPTY_SCHEDULE)
  const [errors, setErrors] = useState<ScheduleErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const set = <K extends keyof ScheduleFormValues>(k: K, val: ScheduleFormValues[K]) => setV((s) => ({ ...s, [k]: val }))
  const schedules = data.schedules.filter((s) => s.professional_id === prof.id)

  const toggleDay = (d: number, on: boolean) =>
    set('weekdays', on ? [...v.weekdays, d].sort((a, b) => a - b) : v.weekdays.filter((x) => x !== d))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const errs = validateSchedule(v)
    setErrors(errs)
    if (Object.keys(errs).length) return
    // Um POST por dia. Se um falhar (ex.: horário repetido), para e diz qual — os anteriores já foram gravados.
    const done: number[] = []
    try {
      for (const d of v.weekdays) {
        await add.mutateAsync({ id: prof.id, body: scheduleBody(v, d) })
        done.push(d)
      }
      setV({ ...EMPTY_SCHEDULE, unit_id: v.unit_id })
      setErrors({})
      toast.success(done.length === 1 ? 'Horário adicionado' : 'Horários adicionados')
    } catch (err) {
      const failed = v.weekdays.find((d) => !done.includes(d))
      setV((s) => ({ ...s, weekdays: s.weekdays.filter((d) => !done.includes(d)) }))
      setFormError(`${failed !== undefined ? `${WEEKDAYS[failed]}: ` : ''}${errorMessage(err, 'Não foi possível adicionar o horário.')}${done.length ? ` (já adicionados: ${done.map((d) => WEEKDAYS[d]).join(', ')})` : ''}`)
    }
  }

  return (
    <div className="grid gap-4">
      <form onSubmit={submit} noValidate aria-label="Adicionar horário de atendimento" className="grid items-start gap-4 sm:grid-cols-2">
        <FormField label="Unidade" error={errors.unit_id} className="sm:col-span-2">
          {(a) => <OptionSelect {...a} value={v.unit_id} onChange={(x) => set('unit_id', x)} options={units} emptyLabel="Selecione a unidade…" />}
        </FormField>
        <fieldset className="grid gap-2 sm:col-span-2" aria-describedby={errors.weekdays ? 'weekdays-error' : undefined}>
          <legend className="mb-2 text-sm font-medium">Dias da semana</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {WEEKDAYS.map((d, i) => (
              <div key={d} className="flex items-center gap-2">
                <Checkbox id={`wd-${i}`} checked={v.weekdays.includes(i)} onCheckedChange={(c) => toggleDay(i, c === true)} />
                <Label htmlFor={`wd-${i}`} className="font-normal">
                  {d}
                </Label>
              </div>
            ))}
          </div>
          {errors.weekdays && (
            <p id="weekdays-error" className="text-sm text-destructive">
              {errors.weekdays}
            </p>
          )}
        </fieldset>
        <FormField label="Início" error={errors.start_time}>
          {(a) => <Input {...a} type="time" value={v.start_time} onChange={(e) => set('start_time', e.target.value)} />}
        </FormField>
        <FormField label="Fim" error={errors.end_time}>
          {(a) => <Input {...a} type="time" value={v.end_time} onChange={(e) => set('end_time', e.target.value)} />}
        </FormField>
        <FormField label="Duração (min)" error={errors.slot_minutes}>
          {(a) => <Input {...a} type="number" min={5} max={240} value={v.slot_minutes} onChange={(e) => set('slot_minutes', e.target.value)} />}
        </FormField>
        <FormField label="Motivo (opcional)">
          {(a) => <Input {...a} value={v.reason} onChange={(e) => set('reason', e.target.value)} />}
        </FormField>
        {formError && (
          <p role="alert" className="rounded-sm bg-danger-soft p-3 text-sm text-destructive sm:col-span-2">
            {formError}
          </p>
        )}
        <div>
          <Button type="submit" variant="outline" disabled={add.isPending}>
            {add.isPending ? 'Adicionando…' : 'Adicionar horário'}
          </Button>
        </div>
      </form>
      {schedules.length === 0 ? (
        <EmptyState>Nenhum horário cadastrado — o profissional não aparece na agenda.</EmptyState>
      ) : (
        <ul>
          {schedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-b-0">
              <div className="min-w-0">
                <p className="font-bold">
                  {WEEKDAYS[Number(s.weekday)] ?? s.weekday} <Badge variant="outline">{hhmm(s.start_time)}–{hhmm(s.end_time)}</Badge>{' '}
                  <Badge variant="outline">{Number(s.slot_minutes)} min</Badge>
                </p>
                <p className="text-sm text-muted-foreground">{s.unit_name}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/40 text-destructive hover:text-destructive"
                aria-label={`Remover horário de ${WEEKDAYS[Number(s.weekday)] ?? 'atendimento'} em ${s.unit_name}`}
                onClick={() =>
                  onRemove({
                    kind: 'schedules',
                    id: s.id,
                    title: 'Remover este horário?',
                    message: `${WEEKDAYS[Number(s.weekday)] ?? 'O dia escolhido'} em ${s.unit_name} deixa de ser uma janela de atendimento deste profissional.`,
                    confirm: 'Remover horário',
                    done: 'Horário removido',
                  })
                }
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function BlocksTab({ prof, data, onRemove }: { prof: Professional; data: ProfessionalsData; onRemove: (r: Removal) => void }) {
  const units = useUnitOptions()
  const add = useAddBlock()
  const [v, setV] = useState<BlockFormValues>(EMPTY_BLOCK)
  const [errors, setErrors] = useState<BlockErrors>({})
  const set = <K extends keyof BlockFormValues>(k: K, val: BlockFormValues[K]) => setV((s) => ({ ...s, [k]: val }))
  const blocks = data.blocks.filter((b) => b.professional_id === prof.id)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validateBlock(v)
    setErrors(errs)
    if (Object.keys(errs).length) return
    try {
      await add.mutateAsync({ id: prof.id, body: blockBody(v) })
      setV({ ...EMPTY_BLOCK, unit_id: v.unit_id })
      setErrors({})
      toast.success('Agenda bloqueada no período')
    } catch (err) {
      setErrors({ ends_at: errorMessage(err, 'Não foi possível bloquear a agenda.') })
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">Bloqueios (férias, folgas, intervalos) impedem agendamentos no período informado.</p>
      <form onSubmit={submit} noValidate aria-label="Bloquear agenda do profissional" className="grid items-start gap-4 sm:grid-cols-2">
        <FormField label="Unidade" error={errors.unit_id} className="sm:col-span-2">
          {(a) => <OptionSelect {...a} value={v.unit_id} onChange={(x) => set('unit_id', x)} options={units} emptyLabel="Selecione a unidade…" />}
        </FormField>
        <FormField label="Início" error={errors.starts_at}>
          {(a) => <Input {...a} type="datetime-local" value={v.starts_at} onChange={(e) => set('starts_at', e.target.value)} />}
        </FormField>
        <FormField label="Fim" error={errors.ends_at}>
          {(a) => <Input {...a} type="datetime-local" value={v.ends_at} onChange={(e) => set('ends_at', e.target.value)} />}
        </FormField>
        <FormField label="Motivo" error={errors.reason} className="sm:col-span-2">
          {(a) => <Input {...a} placeholder="Ex.: férias" value={v.reason} onChange={(e) => set('reason', e.target.value)} />}
        </FormField>
        <div>
          <Button type="submit" variant="outline" disabled={add.isPending}>
            {add.isPending ? 'Bloqueando…' : 'Bloquear agenda'}
          </Button>
        </div>
      </form>
      {blocks.length === 0 ? (
        <EmptyState>Nenhum bloqueio futuro.</EmptyState>
      ) : (
        <ul>
          {blocks.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-b-0">
              <div className="min-w-0">
                <p className="font-bold">
                  {fmtBlockDate(b.starts_at)} → {fmtBlockDate(b.ends_at)}
                </p>
                <p className="break-words text-sm text-muted-foreground">{[b.unit_name, b.reason].filter(Boolean).join(' · ')}</p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="border-destructive/40 text-destructive hover:text-destructive"
                aria-label={`Remover bloqueio de ${fmtBlockDate(b.starts_at)}`}
                onClick={() =>
                  onRemove({
                    kind: 'blocks',
                    id: b.id,
                    title: 'Remover este bloqueio?',
                    message: `A agenda volta a ficar aberta em ${fmtBlockDate(b.starts_at)} a ${fmtBlockDate(b.ends_at)}. As vagas desse período podem ser oferecidas de novo.`,
                    confirm: 'Remover bloqueio',
                    done: 'Bloqueio removido',
                  })
                }
              >
                Remover
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RemoveDialog({ profId, removal, onClose }: { profId: string; removal: Removal | null; onClose: () => void }) {
  const remove = useRemoveItem()
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!removal) return
    setError(null)
    try {
      await remove.mutateAsync({ id: profId, kind: removal.kind, itemId: removal.id })
      toast.success(removal.done)
      onClose()
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível remover.'))
    }
  }

  return (
    <AlertDialog open={!!removal} onOpenChange={(o) => !o && !remove.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{removal?.title}</AlertDialogTitle>
          <AlertDialogDescription>{removal?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Voltar</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={remove.isPending}>
            {remove.isPending ? 'Removendo…' : removal?.confirm}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function Body({ target }: { target: AgendaTarget }) {
  const q = useProfessionals()
  const [removal, setRemoval] = useState<Removal | null>(null)
  if (q.isPending) return <ListSkeleton />
  if (q.isError) return <QueryError message={errorMessage(q.error, 'Erro ao carregar profissionais')} onRetry={() => void q.refetch()} />
  const prof = findProfessional(q.data, target)
  if (!prof) {
    return <EmptyState>Não há profissional vinculado a este usuário. Edite o usuário e defina o profissional.</EmptyState>
  }
  return (
    <>
      <Tabs defaultValue="vinculos">
        <TabsList aria-label={`Vínculos e agenda de ${prof.name}`}>
          <TabsTrigger value="vinculos">Vínculos</TabsTrigger>
          <TabsTrigger value="horarios">Horários</TabsTrigger>
          <TabsTrigger value="bloqueios">Bloqueios</TabsTrigger>
        </TabsList>
        <TabsContent value="vinculos" className="pt-4">
          <OffersTab prof={prof} data={q.data} onRemove={setRemoval} />
        </TabsContent>
        <TabsContent value="horarios" className="pt-4">
          <SchedulesTab prof={prof} data={q.data} onRemove={setRemoval} />
        </TabsContent>
        <TabsContent value="bloqueios" className="pt-4">
          <BlocksTab prof={prof} data={q.data} onRemove={setRemoval} />
        </TabsContent>
      </Tabs>
      <RemoveDialog profId={prof.id} removal={removal} onClose={() => setRemoval(null)} />
    </>
  )
}

/** Vínculos, horários de atendimento e bloqueios de um profissional (usado em Profissionais e em Pessoas). */
export function AgendaDialog({ target, onClose }: { target: AgendaTarget | null; onClose: () => void }) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{target?.name} — vínculos e agenda</DialogTitle>
          <DialogDescription>Onde, quando e para quais serviços o profissional atende.</DialogDescription>
        </DialogHeader>
        {target && <Body key={`${target.professionalId ?? ''}${target.userId ?? ''}`} target={target} />}
      </DialogContent>
    </Dialog>
  )
}
