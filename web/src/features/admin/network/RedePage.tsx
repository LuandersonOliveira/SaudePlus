import { useState } from 'react'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { EmptyState, ListSkeleton, QueryError } from '@/components/QueryState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  EMPTY_UNIT,
  OFFER_KINDS,
  OFFER_KIND_LABEL,
  UNIT_TYPE_LABEL,
  filterOffers,
  filterUnits,
  isActive,
  unitBody,
  validateUnit,
  type AdminUnit,
  type OfferKind,
  type UnitErrors,
  type UnitFormValues,
  type UnitOffer,
} from './logic'
import { useAddOffer, useAdminUnits, useCreateUnit, useUnitOffers, useUpdateUnit } from './queries'
import { DeactivateUnitDialog, EditUnitDialog, RemoveOfferDialog, UnitTypeSelect } from './UnitDialogs'

const ON = 'border-transparent bg-success-soft text-success'
const OFF = 'border-transparent bg-danger-soft text-destructive'

function CreateUnitCard() {
  const create = useCreateUnit()
  const [v, setV] = useState<UnitFormValues>(EMPTY_UNIT)
  const [errors, setErrors] = useState<UnitErrors>({})
  const set = <K extends keyof UnitFormValues>(k: K, val: UnitFormValues[K]) => setV((s) => ({ ...s, [k]: val }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validateUnit(v)
    setErrors(errs)
    if (Object.keys(errs).length) return
    try {
      await create.mutateAsync(unitBody(v))
      setV(EMPTY_UNIT)
      toast.success('Unidade cadastrada')
    } catch (err) {
      setErrors({ name: errorMessage(err, 'Não foi possível cadastrar a unidade.') })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">Cadastrar unidade de saúde</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate aria-label="Cadastrar unidade de saúde" className="grid items-start gap-4 sm:grid-cols-2">
          <FormField label="Nome da unidade" error={errors.name}>
            {(a) => <Input {...a} value={v.name} onChange={(e) => set('name', e.target.value)} />}
          </FormField>
          <FormField label="Tipo">{(a) => <UnitTypeSelect id={a.id} value={v.type} onChange={(t) => set('type', t)} />}</FormField>
          <FormField label="Bairro ou região">
            {(a) => <Input {...a} value={v.neighborhood} onChange={(e) => set('neighborhood', e.target.value)} />}
          </FormField>
          <div className="self-end">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Adicionando…' : 'Adicionar unidade'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function UnitRow({ u, onEdit, onToggle }: { u: AdminUnit; onEdit: () => void; onToggle: () => void }) {
  const active = isActive(u)
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="font-bold">
          {u.name}{' '}
          <Badge variant="outline" className={cn(active ? ON : OFF)}>
            {active ? 'Ativa' : 'Inativa'}
          </Badge>
        </p>
        <p className="break-words text-sm text-muted-foreground">
          {[UNIT_TYPE_LABEL[u.type] ?? u.type, u.neighborhood].filter(Boolean).join(' · ')}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" aria-label={`Editar ${u.name}`} onClick={onEdit}>
          Editar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={active ? 'border-destructive/40 text-destructive hover:text-destructive' : undefined}
          aria-label={`${active ? 'Desativar' : 'Ativar'} ${u.name}`}
          onClick={onToggle}
        >
          {active ? 'Desativar' : 'Ativar'}
        </Button>
      </div>
    </li>
  )
}

function UnitsCard({ units }: { units: ReturnType<typeof useAdminUnits> }) {
  const update = useUpdateUnit()
  const [term, setTerm] = useState('')
  const [edit, setEdit] = useState<AdminUnit | null>(null)
  const [deactivate, setDeactivate] = useState<AdminUnit | null>(null)

  async function toggle(u: AdminUnit) {
    // Lê o estado da lista atual (não do botão): dois admins em telas antigas não se desfazem por engano.
    if (isActive(u)) return setDeactivate(u)
    try {
      await update.mutateAsync({ id: u.id, body: { active: 1 } })
      toast.success('Unidade ativada')
    } catch (e) {
      toast.error(errorMessage(e, 'Erro ao atualizar unidade'))
    }
  }

  const all = units.data ?? []
  const visible = filterUnits(all, term)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">Unidades cadastradas</CardTitle>
        <CardDescription>Unidades inativas não aparecem nos formulários de agendamento.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="unit-filter" className="sr-only">
            Filtrar unidades pelo nome, tipo ou bairro
          </Label>
          <Input id="unit-filter" placeholder="Filtrar por nome, tipo ou bairro…" autoComplete="off" spellCheck={false} value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        {units.isPending ? (
          <ListSkeleton />
        ) : units.isError ? (
          <QueryError message={errorMessage(units.error, 'Erro ao carregar unidades')} onRetry={() => void units.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState>Nenhuma unidade cadastrada.</EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState>Nenhuma unidade casa com "{term}".</EmptyState>
        ) : (
          <ul>
            {visible.map((u) => (
              <UnitRow key={u.id} u={u} onEdit={() => setEdit(u)} onToggle={() => void toggle(u)} />
            ))}
          </ul>
        )}
        <EditUnitDialog unit={edit} onClose={() => setEdit(null)} />
        <DeactivateUnitDialog unit={deactivate} onClose={() => setDeactivate(null)} />
      </CardContent>
    </Card>
  )
}

function OffersCard({ units }: { units: AdminUnit[] }) {
  const [picked, setPicked] = useState('')
  // Sem escolha (ou unidade que sumiu da lista): cai na primeira.
  const unitId = units.some((u) => u.id === picked) ? picked : (units[0]?.id ?? '')
  const offers = useUnitOffers(unitId)
  const add = useAddOffer()
  const [kind, setKind] = useState<OfferKind>('consulta')
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | undefined>()
  const [term, setTerm] = useState('')
  const [removing, setRemoving] = useState<UnitOffer | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setNameError(undefined)
    if (!unitId) return setNameError('Cadastre uma unidade antes de adicionar serviços.')
    if (!name.trim()) return setNameError('Informe a especialidade ou o exame.')
    try {
      await add.mutateAsync({ unitId, kind, name: name.trim() })
      setName('')
      toast.success('Serviço adicionado')
    } catch (err) {
      setNameError(errorMessage(err, 'Não foi possível adicionar o serviço.'))
    }
  }

  const all = offers.data ?? []
  const visible = filterOffers(all, term)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">Serviços oferecidos pela unidade</CardTitle>
        <CardDescription>
          Especialidades de consulta e tipos de exame que o paciente pode escolher em cada unidade. É a fonte da verdade do agendamento.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form onSubmit={submit} noValidate aria-label="Adicionar serviço ofertado por unidade" className="grid items-start gap-4 sm:grid-cols-2">
          <FormField label="Unidade">
            {(a) => (
              <Select value={unitId} onValueChange={setPicked} disabled={!units.length}>
                <SelectTrigger id={a.id} className="w-full">
                  <SelectValue placeholder="Nenhuma unidade cadastrada" />
                </SelectTrigger>
                <SelectContent>
                  {units.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Tipo">
            {(a) => (
              <Select value={kind} onValueChange={(k) => setKind(k as OfferKind)}>
                <SelectTrigger id={a.id} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OFFER_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k === 'consulta' ? 'Consulta (especialidade)' : 'Exame'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Especialidade ou exame" error={nameError}>
            {(a) => <Input {...a} placeholder="Ex.: Cardiologia / Hemograma…" value={name} onChange={(e) => setName(e.target.value)} />}
          </FormField>
          <div className="self-end">
            <Button type="submit" disabled={add.isPending}>
              {add.isPending ? 'Adicionando…' : 'Adicionar serviço'}
            </Button>
          </div>
        </form>

        <div className="grid gap-1.5">
          <Label htmlFor="offer-filter" className="sr-only">
            Filtrar serviços pelo nome
          </Label>
          <Input id="offer-filter" placeholder="Filtrar serviço pelo nome…" autoComplete="off" spellCheck={false} value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        {!unitId ? (
          <EmptyState>Cadastre uma unidade para adicionar serviços.</EmptyState>
        ) : offers.isPending ? (
          <ListSkeleton />
        ) : offers.isError ? (
          <QueryError message={errorMessage(offers.error, 'Erro ao carregar serviços')} onRetry={() => void offers.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState>Nenhum serviço cadastrado para esta unidade.</EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState>Nenhum serviço casa com "{term}".</EmptyState>
        ) : (
          <ul>
            {visible.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-b-0">
                <p className="min-w-0 break-words font-bold">
                  {o.name} <Badge variant="outline">{OFFER_KIND_LABEL[o.kind as OfferKind] ?? o.kind}</Badge>{' '}
                  <Badge variant="outline" className={cn(Number(o.active) ? ON : OFF)}>
                    {Number(o.active) ? 'Ativo' : 'Inativo'}
                  </Badge>
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-destructive/40 text-destructive hover:text-destructive"
                  aria-label={`Remover ${o.kind === 'exame' ? 'exame' : 'serviço'} ${o.name}`}
                  onClick={() => setRemoving(o)}
                >
                  Remover
                </Button>
              </li>
            ))}
          </ul>
        )}
        <RemoveOfferDialog unitId={unitId} offer={removing} onClose={() => setRemoving(null)} />
      </CardContent>
    </Card>
  )
}

/** Cadastros › Rede de saúde: unidades e os serviços que cada uma oferece (capability `units`). */
export function RedePage() {
  const units = useAdminUnits()
  return (
    <>
      <CreateUnitCard />
      <UnitsCard units={units} />
      <OffersCard units={units.data ?? []} />
    </>
  )
}
