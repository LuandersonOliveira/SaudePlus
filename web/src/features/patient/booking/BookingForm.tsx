import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useHealthUnits } from '@/features/staff/queries'
import { maxLocalForInput, nowLocalForInput } from '@/features/staff/logic'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { MyBooking, MyKind } from '../types'
import {
  buildPayload,
  COPY,
  draftKey,
  EMPTY_FORM,
  findSlot,
  fmtDayLabel,
  isManual,
  isReady,
  OTHER,
  parseDraft,
  pickSlot,
  reviewLines,
  serializeDraft,
  stateFromRecord,
} from './logic'
import { useJoinWaitlist, useSaveMyBooking, useServices, useSlots } from './queries'
import { ReviewDialog, type ReviewData } from './ReviewDialog'
import { SlotsPanel, SlotsSkeleton } from './SlotsPanel'
import type { BookingFormState } from './types'

export interface FormIntent {
  mode: 'edit' | 'rebook'
  id: string
}

interface Props {
  kind: MyKind
  /** Editar ou refazer um agendamento existente. */
  intent: FormIntent | null
  /** Registro correspondente à intenção (`undefined` enquanto a lista carrega). */
  record: MyBooking | null | undefined
  /** Chamado ao terminar/cancelar uma edição, para a página limpar a intenção. */
  onIntentDone: () => void
}

interface Preselect {
  unit_id: string
  scheduled_at: string
  professional_id: string | null
  /** Edição avisa se a vaga original sumiu; rascunho restaura em silêncio. */
  warnIfMissing: boolean
}

export function BookingForm({ kind, intent, record, onIntentDone }: Props) {
  const copy = COPY[kind]
  const { session } = useAuth()
  const userId = session?.user.id

  const services = useServices(kind)
  const units = useHealthUnits()
  const save = useSaveMyBooking()
  const join = useJoinWaitlist()

  const [form, setForm] = useState<BookingFormState>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [slotNote, setSlotNote] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [review, setReview] = useState<ReviewData | null>(null)
  const [initDone, setInitDone] = useState(false)
  const preselect = useRef<Preselect | null>(null)
  const initRef = useRef(false)

  const manual = isManual(form)
  const guided = form.servico && !manual ? form.servico : ''
  const slots = useSlots(kind, guided, editingId, !!guided)
  const min = nowLocalForInput()
  const max = maxLocalForInput()
  const patch = (p: Partial<BookingFormState>) => setForm((f) => ({ ...f, ...p }))

  /* ---- Inicialização única: editar/refazer ou restaurar rascunho (precisa do catálogo e das unidades) ---- */
  const ready = services.isFetched && units.isFetched && (!intent || record !== undefined)
  useEffect(() => {
    // useRef (não o estado): impede a segunda execução do efeito (StrictMode) de repetir toasts e restauração.
    if (initRef.current || !ready) return
    initRef.current = true
    setInitDone(true)
    const catalog = services.data ?? []
    const unitList = units.data ?? []

    if (intent && record) {
      const name = (kind === 'appointments' ? record.specialty : record.exam_type) || ''
      const known = catalog.some((s) => s.name === name)
      const rebook = intent.mode === 'rebook'
      setForm(stateFromRecord(kind, record, { rebook, serviceKnown: known, units: unitList }))
      if (!rebook) setEditingId(record.id)
      if (rebook) toast.success('Escolha uma nova data e horário para concluir o agendamento.')
      if (known && !rebook && record.unit_id) {
        preselect.current = { unit_id: record.unit_id, scheduled_at: record.scheduled_at, professional_id: record.professional_id ?? null, warnIfMissing: true }
      }
      return
    }

    const draft = parseDraft(localStorage.getItem(draftKey(userId, kind)))
    if (draft && (draft.servico === OTHER || catalog.some((s) => s.name === draft.servico))) {
      const sel = draft.selecao
      setForm({ ...draft, selecao: null })
      if (sel && draft.servico !== OTHER) {
        preselect.current = { unit_id: sel.unit_id, scheduled_at: sel.scheduled_at, professional_id: sel.professional_id, warnIfMissing: false }
      }
      toast.success('Rascunho recuperado — confira e confirme.')
    }
  }, [ready, initDone, intent, record, kind, services.data, units.data, userId])

  /* ---- Pré-seleciona a vaga (edição ou rascunho) quando as vagas chegam ---- */
  useEffect(() => {
    const p = preselect.current
    if (!p || !slots.isSuccess) return
    preselect.current = null
    const found = findSlot(slots.data.unidades, p.unit_id, p.scheduled_at, p.professional_id)
    if (found) patch({ selecao: found, diaAberto: { [found.unit_id]: found.date } })
    else if (p.warnIfMissing) setSlotNote('A vaga original não está mais livre — escolha outro horário.')
  }, [slots.isSuccess, slots.data])

  /* ---- Rascunho: só para agendamentos novos; salva 500 ms depois da última alteração ---- */
  const debounced = useDebouncedValue(form, 500)
  useEffect(() => {
    if (!initDone || editingId) return
    try {
      const raw = serializeDraft(debounced)
      if (raw) localStorage.setItem(draftKey(userId, kind), raw)
      // Só apaga quando o formulário atual também está vazio: logo após restaurar, `debounced`
      // ainda é o valor antigo (vazio) e apagaria o rascunho recém-lido.
      else if (serializeDraft(form) === null) localStorage.removeItem(draftKey(userId, kind))
    } catch {
      /* storage cheio/bloqueado: ignora */
    }
    // `form` fica fora das dependências de propósito: a gravação segue o valor com debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, initDone, editingId, userId, kind])

  function clearAll() {
    setForm(EMPTY_FORM)
    setSlotNote('')
    setFormError(null)
    setEditingId(null)
    try {
      localStorage.removeItem(draftKey(userId, kind))
    } catch {
      /* ignora */
    }
  }

  function cancelEdit() {
    clearAll()
    onIntentDone()
  }

  function onServicePick(value: string) {
    // Troca de serviço zera vaga e caminho manual, mas preserva as observações.
    preselect.current = null
    setForm({ ...EMPTY_FORM, servico: value, notes: form.notes })
    setSlotNote('')
    setFormError(null)
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)
    const built = buildPayload(kind, form, units.data ?? [])
    if (!built.ok) return setFormError(built.error)
    const { payload, doctor } = built.value
    const editing = !!editingId
    setReview({
      editing,
      lines: reviewLines(kind, payload, doctor),
      submit: async () => {
        await save.mutateAsync({ kind, editingId, payload })
        toast.success(editing ? copy.successEdit : copy.successCreate)
        clearAll()
        if (editing) onIntentDone()
      },
    })
  }

  const slotsError = slots.isError ? `Não foi possível buscar as vagas. ${errorMessage(slots.error, '')}`.trim() : ''
  const noSlots = slots.isSuccess && slots.data.unidades.length === 0
  const sel = form.selecao

  return (
    <Card>
      <CardHeader>
        {editingId && (
          <p className="rounded-sm bg-warning-soft p-3 text-sm font-semibold text-warning-ink">Você está editando este agendamento.</p>
        )}
        <CardTitle className="text-xl font-extrabold">{editingId ? copy.editTitle : copy.newTitle}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} noValidate aria-label={copy.newTitle} className="grid gap-4">
          {/* 1) serviço */}
          <div className="grid gap-2">
            <Label htmlFor={`svc-${kind}`}>{copy.serviceLabel}</Label>
            <Select value={form.servico} onValueChange={onServicePick} disabled={services.isPending}>
              <SelectTrigger id={`svc-${kind}`} className="w-full">
                <SelectValue placeholder={services.isPending ? 'Carregando serviços...' : 'Selecione...'} />
              </SelectTrigger>
              <SelectContent>
                {(services.data ?? []).map((s) => (
                  <SelectItem key={s.name} value={s.name}>
                    {s.name}
                    {s.unidades > 1 ? ` (${s.unidades} unidades)` : ''}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER}>{copy.otherLabel}</SelectItem>
              </SelectContent>
            </Select>
            {manual && (
              <Input
                aria-label={kind === 'appointments' ? 'Digite a especialidade' : 'Digite o tipo de exame'}
                placeholder={kind === 'appointments' ? 'Digite a especialidade' : 'Digite o tipo de exame'}
                value={form.manualService}
                maxLength={100}
                onChange={(e) => patch({ manualService: e.target.value })}
              />
            )}
            {services.isError && (
              <p role="alert" className="text-sm text-destructive">
                Não foi possível carregar os serviços. {errorMessage(services.error, '')}
              </p>
            )}
            {services.isSuccess && services.data.length === 0 && <p className="text-xs text-muted-foreground">{copy.emptyServices}</p>}
            {slotNote && <p className="text-xs text-muted-foreground">{slotNote}</p>}
          </div>

          {/* 2) vagas (guiado) ou data/unidade (manual) */}
          {!form.servico && <p className="text-sm text-muted-foreground">Escolha um serviço para ver as vagas livres.</p>}

          {guided && (
            <div aria-live="polite">
              {slots.isFetching ? (
                <SlotsSkeleton />
              ) : slotsError ? (
                <p className="rounded-md border p-4 text-sm text-muted-foreground">{slotsError}</p>
              ) : noSlots ? (
                <div className="rounded-md border p-4 text-sm text-muted-foreground">
                  <p>{slots.data.reason || 'Nenhuma vaga livre para este serviço nos próximos dias.'}</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    disabled={join.isPending}
                    onClick={async () => {
                      try {
                        await join.mutateAsync({ kind, service: form.servico })
                        toast.success('Você entrou na lista de espera. Avisaremos quando abrir vaga.')
                      } catch (e) {
                        toast.error(errorMessage(e, 'Não foi possível entrar na lista de espera.'))
                      }
                    }}
                  >
                    Entrar na lista de espera
                  </Button>
                </div>
              ) : slots.isSuccess ? (
                <SlotsPanel
                  units={slots.data.unidades}
                  totalVagas={slots.data.totalVagas}
                  selection={sel}
                  openDays={form.diaAberto}
                  onToggleDay={(unitId, date) => patch({ diaAberto: { ...form.diaAberto, [unitId]: date } })}
                  onPick={(unitId, date, hora, profId) => {
                    const picked = pickSlot(slots.data.unidades, unitId, date, hora, profId)
                    if (picked) {
                      patch({ selecao: picked, diaAberto: { ...form.diaAberto, [unitId]: date } })
                      setSlotNote('')
                      setFormError(null)
                    }
                  }}
                />
              ) : null}
            </div>
          )}

          {manual && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor={`mu-${kind}`}>Unidade *</Label>
                <Select value={form.manualUnitId} onValueChange={(v) => patch({ manualUnitId: v })}>
                  <SelectTrigger id={`mu-${kind}`} className="w-full">
                    <SelectValue placeholder="Selecione..." />
                  </SelectTrigger>
                  <SelectContent>
                    {(units.data ?? []).map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name}
                        {u.neighborhood ? ` – ${u.neighborhood}` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor={`mw-${kind}`}>Data/hora *</Label>
                <Input id={`mw-${kind}`} type="datetime-local" min={min} max={max} value={form.manualWhen} onChange={(e) => patch({ manualWhen: e.target.value })} />
              </div>
              <p className="text-sm text-muted-foreground sm:col-span-2">Sem vaga na grade? A unidade aloca o atendimento e confirma depois.</p>
            </div>
          )}

          {/* 3) resumo da vaga escolhida */}
          {sel && !manual && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-primary bg-accent p-3" aria-label="Vaga escolhida">
              <div>
                <strong>
                  {fmtDayLabel(sel.date)} às {sel.hora}
                </strong>
                <p className="text-sm text-muted-foreground">
                  {sel.unit_name}
                  {sel.professional_name ? ` · ${sel.professional_name}` : ''}
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => patch({ selecao: null })}>
                Trocar
              </Button>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor={`notes-${kind}`}>Observações</Label>
            <Textarea id={`notes-${kind}`} value={form.notes} onChange={(e) => patch({ notes: e.target.value })} />
          </div>

          {formError && (
            <p role="alert" className="rounded-sm bg-danger-soft p-3 text-sm text-destructive">
              {formError}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!isReady(form)}>
              {editingId ? 'Salvar alterações' : 'Agendar'}
            </Button>
            {editingId ? (
              <Button type="button" variant="outline" size="sm" onClick={cancelEdit}>
                Cancelar edição
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={clearAll}>
                Cancelar
              </Button>
            )}
          </div>
        </form>
        <ReviewDialog data={review} onClose={() => setReview(null)} />
      </CardContent>
    </Card>
  )
}
