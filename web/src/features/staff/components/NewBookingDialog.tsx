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
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { maxLocalForInput, nowLocalForInput, toApiDateTime } from '../logic'
import {
  useCatalogProfessionals,
  useCreateBooking,
  useHealthUnits,
  useOffers,
  usePatientSearch,
} from '../queries'
import type { Patient } from '../types'

const NO_PROFESSIONAL = 'none'

function Form({ onCreated, onClose }: { onCreated: (date: string) => void; onClose: () => void }) {
  const create = useCreateBooking()
  const units = useHealthUnits()

  const [kind, setKind] = useState<'consulta' | 'exame'>('consulta')
  const [patientQ, setPatientQ] = useState('')
  const [patient, setPatient] = useState<Patient | null>(null)
  const [unitId, setUnitId] = useState('')
  const [service, setService] = useState('')
  const [professionalId, setProfessionalId] = useState(NO_PROFESSIONAL)
  const [when, setWhen] = useState('')
  const [location, setLocation] = useState('UBS')
  const [error, setError] = useState<string | null>(null)

  const patients = usePatientSearch(useDebouncedValue(patientQ.trim()))
  const offers = useOffers(unitId, kind)
  const professionals = useCatalogProfessionals(unitId, kind, service)
  const hasProfessionals = (professionals.data?.length ?? 0) > 0
  const min = nowLocalForInput()
  const max = maxLocalForInput()

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!patient) return setError('Selecione o paciente.')
    if (!unitId) return setError('Selecione a unidade.')
    if (!service) return setError(kind === 'consulta' ? 'Selecione a especialidade.' : 'Selecione o tipo de exame.')
    // O servidor recusa (409) agendar sem profissional quando o serviço tem profissionais na unidade.
    if (hasProfessionals && professionalId === NO_PROFESSIONAL) return setError('Selecione o profissional.')
    if (!when) return setError('Informe a data e a hora.')
    if (when < min) return setError('A data não pode estar no passado.')
    if (when > max) return setError('A data deve estar dentro de 1 ano.')

    try {
      await create.mutateAsync({
        kind,
        user_id: patient.id,
        unit_id: unitId,
        professional_id: professionalId === NO_PROFESSIONAL ? null : professionalId,
        scheduled_at: toApiDateTime(when),
        location: location.trim() || 'UBS',
        service,
      })
      toast.success('Agendamento criado')
      onCreated(when.slice(0, 10))
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível criar o agendamento.'))
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="nb-kind">Tipo</Label>
        <Select
          value={kind}
          onValueChange={(v) => {
            setKind(v as 'consulta' | 'exame')
            setService('')
            setProfessionalId(NO_PROFESSIONAL)
          }}
        >
          <SelectTrigger id="nb-kind" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="consulta">Consulta</SelectItem>
            <SelectItem value="exame">Exame</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="nb-patient">Paciente *</Label>
        {patient ? (
          <div className="flex items-center justify-between gap-3 rounded-sm border bg-accent p-3 text-sm">
            <span>
              <strong>{patient.full_name}</strong> <span className="text-muted-foreground">{patient.email}</span>
            </span>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPatient(null)}>
              Trocar
            </Button>
          </div>
        ) : (
          <>
            <Input id="nb-patient" placeholder="Nome ou e-mail" value={patientQ} onChange={(e) => setPatientQ(e.target.value)} />
            {patients.data && patientQ.trim() && (
              <ul className="grid max-h-40 gap-1 overflow-auto">
                {patients.data.filter((p) => (p.account_status || 'ativo') === 'ativo').length === 0 && (
                  <li className="text-sm text-muted-foreground">Nenhum paciente ativo encontrado.</li>
                )}
                {patients.data
                  .filter((p) => (p.account_status || 'ativo') === 'ativo')
                  .map((p) => (
                    <li key={p.id}>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                        onClick={() => setPatient(p)}
                      >
                        {p.full_name} <span className="text-muted-foreground">· {p.email}</span>
                      </Button>
                    </li>
                  ))}
              </ul>
            )}
          </>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="nb-unit">Unidade *</Label>
        <Select
          value={unitId}
          onValueChange={(v) => {
            setUnitId(v)
            setService('')
            setProfessionalId(NO_PROFESSIONAL)
          }}
        >
          <SelectTrigger id="nb-unit" className="w-full">
            <SelectValue placeholder="Selecione a unidade" />
          </SelectTrigger>
          <SelectContent>
            {(units.data ?? []).map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.name || u.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="nb-service">{kind === 'consulta' ? 'Especialidade *' : 'Tipo de exame *'}</Label>
        <Select
          value={service}
          onValueChange={(v) => {
            setService(v)
            setProfessionalId(NO_PROFESSIONAL)
          }}
          disabled={!unitId}
        >
          <SelectTrigger id="nb-service" className="w-full">
            <SelectValue placeholder={unitId ? 'Selecione' : 'Escolha a unidade primeiro'} />
          </SelectTrigger>
          <SelectContent>
            {(offers.data ?? []).map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {unitId && offers.data?.length === 0 && (
          <p className="text-xs text-muted-foreground">Esta unidade não oferece este tipo de atendimento.</p>
        )}
      </div>

      <div className="grid gap-2">
        <Label htmlFor="nb-prof">
          Profissional{' '}
          {hasProfessionals ? '*' : <span className="font-normal text-muted-foreground">(opcional)</span>}
        </Label>
        <Select
          value={hasProfessionals && professionalId === NO_PROFESSIONAL ? '' : professionalId}
          onValueChange={setProfessionalId}
          disabled={!service}
        >
          <SelectTrigger id="nb-prof" className="w-full">
            <SelectValue placeholder={hasProfessionals ? 'Selecione o profissional' : undefined} />
          </SelectTrigger>
          <SelectContent>
            {!hasProfessionals && <SelectItem value={NO_PROFESSIONAL}>Sem profissional definido</SelectItem>}
            {(professionals.data ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
                {p.job_title ? ` — ${p.job_title}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="nb-when">Data e hora *</Label>
          <Input id="nb-when" type="datetime-local" min={min} max={max} value={when} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="nb-loc">Local</Label>
          <Input id="nb-loc" value={location} maxLength={100} onChange={(e) => setLocation(e.target.value)} />
        </div>
      </div>

      {error && (
        <p role="alert" className={cn('rounded-sm bg-danger-soft p-3 text-sm text-destructive')}>
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={create.isPending}>
          {create.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </DialogFooter>
    </form>
  )
}

export function NewBookingDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  /** Recebe o dia (YYYY-MM-DD) do agendamento criado, para a agenda navegar até ele. */
  onCreated: (date: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo agendamento</DialogTitle>
          <DialogDescription>Agende uma consulta ou exame para um paciente.</DialogDescription>
        </DialogHeader>
        {open && <Form onCreated={onCreated} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}
