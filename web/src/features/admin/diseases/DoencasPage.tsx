import { useState } from 'react'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { EmptyState, ListSkeleton, QueryError } from '@/components/QueryState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { LEVEL_LABEL, levelTone } from '@/features/patient/logic'
import { useHealthUnits } from '@/features/staff/queries'
import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { DeactivateDiseaseDialog, DeleteDiseaseDialog, EditDiseaseDialog, LevelSelect } from './DiseaseDialogs'
import {
  diseaseBody,
  EMPTY_DISEASE,
  filterDiseases,
  isActive,
  regionsFrom,
  validateDisease,
  type AdminDisease,
  type DiseaseErrors,
  type DiseaseFormValues,
} from './logic'
import { useAdminDiseases, useCreateDisease, useUpdateDisease } from './queries'

const TONE = {
  danger: 'bg-danger-soft text-destructive',
  warning: 'bg-warning-soft text-warning-ink',
  success: 'bg-success-soft text-success',
} as const

function CreateCard() {
  const units = useHealthUnits()
  const create = useCreateDisease()
  const [v, setV] = useState<DiseaseFormValues>(EMPTY_DISEASE)
  const [errors, setErrors] = useState<DiseaseErrors>({})
  const set = <K extends keyof DiseaseFormValues>(k: K, val: DiseaseFormValues[K]) => setV((s) => ({ ...s, [k]: val }))
  const regions = regionsFrom(units.data ?? [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validateDisease(v, { requireRegion: true })
    setErrors(errs)
    if (Object.keys(errs).length) return
    try {
      await create.mutateAsync(diseaseBody(v))
      setV(EMPTY_DISEASE) // as regiões vêm da API (não do formulário): continuam disponíveis
      toast.success('Doença cadastrada')
    } catch (err) {
      setErrors({ name: errorMessage(err, 'Não foi possível cadastrar o alerta.') })
    }
  }

  const regionPlaceholder = units.isPending
    ? 'Carregando regiões…'
    : units.isError
      ? 'Erro ao carregar regiões'
      : regions.length
        ? 'Selecione a região/bairro…'
        : 'Nenhum bairro encontrado'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">Cadastrar doença / alerta</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} noValidate aria-label="Cadastrar alerta de doença" className="grid items-start gap-4 sm:grid-cols-2">
          <FormField label="Nome" error={errors.name}>
            {(a) => <Input {...a} value={v.name} onChange={(e) => set('name', e.target.value)} />}
          </FormField>
          <FormField label="Região (Bairro)" error={errors.region}>
            {(a) => (
              <Select value={v.region} onValueChange={(r) => set('region', r)} disabled={!regions.length}>
                <SelectTrigger {...a} className="w-full">
                  <SelectValue placeholder={regionPlaceholder} />
                </SelectTrigger>
                <SelectContent>
                  {regions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </FormField>
          <FormField label="Nível">{(a) => <LevelSelect id={a.id} value={v.alert_level} onChange={(l) => set('alert_level', l)} />}</FormField>
          <FormField label="Descrição" className="sm:col-span-2">
            {(a) => <Textarea {...a} value={v.description} onChange={(e) => set('description', e.target.value)} />}
          </FormField>
          {/* Botão depois da descrição: a ordem visual é a mesma do teclado e ninguém envia sem ver o campo. */}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Adicionando…' : 'Adicionar'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

function DiseaseRow({ d, onEdit, onToggle, onDelete }: { d: AdminDisease; onEdit: () => void; onToggle: () => void; onDelete: () => void }) {
  const active = isActive(d)
  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="font-bold">
          {d.name}{' '}
          <Badge variant="outline" className={cn('border-transparent', TONE[levelTone(d.alert_level)])}>
            {LEVEL_LABEL[d.alert_level] ?? d.alert_level}
          </Badge>{' '}
          <Badge variant="outline" className={cn('border-transparent', active ? TONE.success : TONE.danger)}>
            {active ? 'Ativo' : 'Inativo'}
          </Badge>
        </p>
        <p className="break-words text-sm text-muted-foreground">{[d.description, d.region].filter(Boolean).join(' · ')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" aria-label={`Editar alerta ${d.name}`} onClick={onEdit}>
          Editar
        </Button>
        <Button
          size="sm"
          variant="outline"
          className={active ? 'border-destructive/40 text-destructive hover:text-destructive' : undefined}
          aria-label={`${active ? 'Desativar' : 'Ativar'} alerta ${d.name}`}
          onClick={onToggle}
        >
          {active ? 'Desativar' : 'Ativar'}
        </Button>
        <Button size="sm" variant="outline" className="border-destructive/40 text-destructive hover:text-destructive" aria-label={`Excluir alerta ${d.name}`} onClick={onDelete}>
          Excluir
        </Button>
      </div>
    </li>
  )
}

function ListCard() {
  const q = useAdminDiseases()
  const update = useUpdateDisease()
  const [term, setTerm] = useState('')
  const [edit, setEdit] = useState<AdminDisease | null>(null)
  const [deactivate, setDeactivate] = useState<AdminDisease | null>(null)
  const [del, setDel] = useState<AdminDisease | null>(null)

  async function toggle(d: AdminDisease) {
    // Desativar pede confirmação; ativar é direto.
    if (isActive(d)) return setDeactivate(d)
    try {
      await update.mutateAsync({ id: d.id, body: { active: 1 } })
      toast.success('Alerta ativado')
    } catch (e) {
      toast.error(errorMessage(e, 'Erro ao atualizar alerta'))
    }
  }

  const all = q.data ?? []
  const visible = filterDiseases(all, term)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">Doenças cadastradas</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="disease-filter" className="sr-only">
            Filtrar alertas pelo nome ou região
          </Label>
          <Input id="disease-filter" placeholder="Filtrar por nome ou região…" autoComplete="off" spellCheck={false} value={term} onChange={(e) => setTerm(e.target.value)} />
        </div>
        {q.isPending ? (
          <ListSkeleton />
        ) : q.isError ? (
          <QueryError message={errorMessage(q.error, 'Não foi possível carregar os alertas')} onRetry={() => void q.refetch()} />
        ) : all.length === 0 ? (
          <EmptyState>Sem registros.</EmptyState>
        ) : visible.length === 0 ? (
          <EmptyState>Nenhum alerta casa com "{term}".</EmptyState>
        ) : (
          <ul>
            {visible.map((d) => (
              <DiseaseRow key={d.id} d={d} onEdit={() => setEdit(d)} onToggle={() => void toggle(d)} onDelete={() => setDel(d)} />
            ))}
          </ul>
        )}
        <EditDiseaseDialog disease={edit} onClose={() => setEdit(null)} />
        <DeactivateDiseaseDialog disease={deactivate} onClose={() => setDeactivate(null)} />
        <DeleteDiseaseDialog disease={del} onClose={() => setDel(null)} />
      </CardContent>
    </Card>
  )
}

/** Cadastros › Doenças e alertas (nível "alertas" é o dono desta área). */
export function DoencasPage() {
  return (
    <>
      <CreateCard />
      <ListCard />
    </>
  )
}
