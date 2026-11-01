import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { errorMessage } from '@/lib/api'
import { fmtDate } from '@/lib/validators'
import { StatusBadge } from '../components/StatusBadge'
import { fmtSimpleDate } from '../logic'
import { usePatientHistory, usePatientSearch } from '../queries'
import type { Booking, Patient } from '../types'

/** Tabela de consultas ou exames de um paciente (também usada no histórico do painel admin). */
export function HistoryTable({ rows, service }: { rows: Booking[]; service: 'specialty' | 'exam_type' }) {
  if (!rows.length) return <p className="py-4 text-sm text-muted-foreground">Sem registros.</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Data/hora</TableHead>
          <TableHead>{service === 'specialty' ? 'Especialidade' : 'Exame'}</TableHead>
          {service === 'specialty' && <TableHead>Médico</TableHead>}
          <TableHead>Local</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id}>
            <TableCell className="whitespace-nowrap">{fmtDate(r.scheduled_at)}</TableCell>
            <TableCell>{r[service] ?? '—'}</TableCell>
            {service === 'specialty' && <TableCell>{r.doctor ?? '—'}</TableCell>}
            <TableCell>{r.location ?? '—'}</TableCell>
            <TableCell>
              <StatusBadge status={r.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

function History({ id }: { id: string }) {
  const q = usePatientHistory(id)
  if (q.isPending) return <Skeleton className="h-40" aria-hidden="true" />
  if (q.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(q.error, 'Erro ao carregar histórico')}</p>
  const { user: u, appointments, exams } = q.data
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <CardTitle className="text-xl font-extrabold">{u.full_name}</CardTitle>
          <span className="text-sm text-muted-foreground">
            {appointments.length} consultas · {exams.length} exames
          </span>
        </div>
        {u.birth_date && (
          <p className="text-sm text-muted-foreground">
            Nasc: {fmtSimpleDate(u.birth_date)} · {u.gender || '—'} · Tipo sanguíneo: {u.blood_type || '—'}
          </p>
        )}
        {u.mobile && <p className="text-sm text-muted-foreground">Celular: {u.mobile}</p>}
      </CardHeader>
      <CardContent className="grid gap-4">
        <div>
          <h3 className="mb-1 font-bold">Consultas</h3>
          <HistoryTable rows={appointments} service="specialty" />
        </div>
        <div>
          <h3 className="mb-1 font-bold">Exames</h3>
          <HistoryTable rows={exams} service="exam_type" />
        </div>
      </CardContent>
    </Card>
  )
}

function PatientItem({ p, onView }: { p: Patient; onView: () => void }) {
  const status = p.account_status || 'ativo'
  if (status === 'inativo' || status === 'pendente') {
    return (
      <li className="rounded-md border-l-4 border-warning bg-warning-soft p-4">
        <p className="font-bold">
          {p.full_name || 'Paciente cadastrado'}{' '}
          <Badge className="ml-1 border-transparent bg-warning text-white">
            Conta {status === 'inativo' ? 'inativa' : 'pendente de ativação'}
          </Badge>
        </p>
        <p className="text-sm text-warning-ink">
          Este paciente possui um cadastro existente, mas a conta está atualmente <strong>{status}</strong>. Entre em
          contato com a administração para reativação.
        </p>
      </li>
    )
  }
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4">
      <div>
        <p className="font-bold">{p.full_name}</p>
        <p className="text-sm text-muted-foreground">
          {[p.email, p.phone, p.birth_date ? `Nasc: ${fmtSimpleDate(p.birth_date)}` : null].filter(Boolean).join(' · ')}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={onView} aria-label={`Ver histórico de ${p.full_name}`}>
        Ver histórico
      </Button>
    </li>
  )
}

export function PatientsPage() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const search = usePatientSearch(query)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const q = input.trim()
    if (!q) return setFieldError('Digite o nome ou o e-mail do paciente para buscar.')
    setFieldError(null)
    setSelected(null)
    setQuery(q)
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-extrabold">Buscar paciente</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form onSubmit={submit} noValidate aria-label="Buscar paciente" className="flex flex-wrap items-start gap-3">
            <div className="grid min-w-[260px] flex-1 gap-2">
              <Label htmlFor="patient-q" className="sr-only">
                Nome ou e-mail do paciente
              </Label>
              <Input
                id="patient-q"
                placeholder="Nome ou e-mail do paciente"
                value={input}
                aria-invalid={!!fieldError}
                aria-describedby={fieldError ? 'patient-q-error' : undefined}
                onChange={(e) => setInput(e.target.value)}
              />
              {fieldError && (
                <p id="patient-q-error" className="text-sm text-destructive">
                  {fieldError}
                </p>
              )}
            </div>
            <Button type="submit">Buscar</Button>
          </form>

          {query && search.isFetching && <Skeleton className="h-20" aria-hidden="true" />}
          {query && search.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(search.error, 'Erro ao buscar pacientes')}
            </p>
          )}
          {query && search.data && !search.isFetching &&
            (search.data.length ? (
              <ul className="grid gap-3">
                {search.data.map((p) => (
                  <PatientItem key={p.id} p={p} onView={() => setSelected(p.id)} />
                ))}
              </ul>
            ) : (
              <p className="py-4 text-center text-sm text-muted-foreground">Nenhum paciente encontrado.</p>
            ))}
        </CardContent>
      </Card>
      {selected && <History id={selected} />}
    </>
  )
}
