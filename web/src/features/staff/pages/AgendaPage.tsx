import { ptBR } from 'react-day-picker/locale'
import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar, CalendarDayButton } from '@/components/ui/calendar'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useDebouncedValue } from '@/hooks/useDebouncedValue'
import { errorMessage } from '@/lib/api'
import { BookingActionDialog, type ActionTarget } from '../components/BookingActionDialog'
import { BookingActions } from '../components/BookingActions'
import { HistoryDialog, type HistoryTarget } from '../components/HistoryDialog'
import { NewBookingDialog } from '../components/NewBookingDialog'
import { ReportDialog } from '../components/ReportDialog'
import { StatusBadge } from '../components/StatusBadge'
import { hhmm, kindToPath, localDateStr, monthStr } from '../logic'
import { useAgendaDay, useAgendaMonth, useHealthUnits } from '../queries'
import type { AgendaFilters } from '../types'

const ALL = 'all'

const toDate = (s: string) => new Date(`${s}T00:00:00`)

export function AgendaPage() {
  const [date, setDate] = useState(localDateStr())
  const [month, setMonth] = useState(monthStr(date))
  const [tab, setTab] = useState<'dia' | 'remarcar'>('dia')
  const [tipo, setTipo] = useState<AgendaFilters['tipo']>('all')
  const [status, setStatus] = useState<AgendaFilters['status']>('')
  const [unitId, setUnitId] = useState('')
  const [profInput, setProfInput] = useState('')
  const professionalId = useDebouncedValue(profInput.trim())

  const [action, setAction] = useState<ActionTarget | null>(null)
  const [history, setHistory] = useState<HistoryTarget | null>(null)
  const [newOpen, setNewOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)

  const filters: AgendaFilters = useMemo(
    () => ({ tipo, status, unitId, professionalId }),
    [tipo, status, unitId, professionalId],
  )
  const units = useHealthUnits()
  const day = useAgendaDay(date, filters)
  const monthQ = useAgendaMonth(month, filters)

  const totals = useMemo(() => new Map((monthQ.data ?? []).map((d) => [d.date, d.total])), [monthQ.data])
  const items = (day.data?.items ?? []).filter((i) => tab === 'dia' || i.status === 'para_remarcar')
  const s = day.data?.summary

  function goTo(d: string) {
    setDate(d)
    setMonth(monthStr(d))
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-xl font-extrabold">Agenda operacional</CardTitle>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setReportOpen(true)}>
              Relatório
            </Button>
            <Button size="sm" onClick={() => setNewOpen(true)}>
              Novo agendamento
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="grid gap-2">
              <Label htmlFor="ag-date">Data</Label>
              <Input id="ag-date" type="date" value={date} onChange={(e) => e.target.value && goTo(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ag-tipo">Tipo</Label>
              <Select value={tipo} onValueChange={(v) => setTipo(v as AgendaFilters['tipo'])}>
                <SelectTrigger id="ag-tipo" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="consulta">Consultas</SelectItem>
                  <SelectItem value="exame">Exames</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ag-status">Status</Label>
              <Select value={status || ALL} onValueChange={(v) => setStatus(v === ALL ? '' : (v as AgendaFilters['status']))}>
                <SelectTrigger id="ag-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todos os status</SelectItem>
                  <SelectItem value="pendente">Pendente</SelectItem>
                  <SelectItem value="confirmado">Confirmado</SelectItem>
                  <SelectItem value="para_remarcar">Para remarcar</SelectItem>
                  <SelectItem value="concluido">Concluído</SelectItem>
                  <SelectItem value="cancelado">Cancelado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ag-unit">Unidade</Label>
              <Select value={unitId || ALL} onValueChange={(v) => setUnitId(v === ALL ? '' : v)}>
                <SelectTrigger id="ag-unit" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Todas as unidades</SelectItem>
                  {(units.data ?? []).map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name || u.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ag-prof">Profissional (id)</Label>
              <Input
                id="ag-prof"
                placeholder="Em branco = todos"
                value={profInput}
                onChange={(e) => setProfInput(e.target.value)}
              />
            </div>
          </div>

          <div aria-live="polite" className="flex flex-wrap gap-2">
            <Badge variant="secondary">Total: {s?.total ?? 0}</Badge>
            <Badge variant="secondary">Pendentes: {s?.pendente ?? 0}</Badge>
            <Badge variant="secondary">Confirmados: {s?.confirmado ?? 0}</Badge>
            <Badge variant="secondary">Para remarcar: {s?.para_remarcar ?? 0}</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[auto_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-extrabold">Calendário</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Calendar
              mode="single"
              locale={ptBR}
              selected={toDate(date)}
              onSelect={(d) => d && goTo(localDateStr(d))}
              month={toDate(`${month}-01`)}
              onMonthChange={(d) => setMonth(monthStr(localDateStr(d)))}
              components={{
                DayButton: (p) => {
                  const n = totals.get(localDateStr(p.day.date))
                  return (
                    <CalendarDayButton {...p}>
                      {p.children}
                      {n ? <span aria-label={`${n} atendimentos`}>{n}</span> : null}
                    </CalendarDayButton>
                  )
                },
              }}
            />
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <CardTitle className="text-lg font-extrabold">
              Atendimentos de {date.split('-').reverse().join('/')}
            </CardTitle>
            <Tabs value={tab} onValueChange={(v) => setTab(v as 'dia' | 'remarcar')}>
              <TabsList>
                <TabsTrigger value="dia">Dia</TabsTrigger>
                <TabsTrigger value="remarcar">Para remarcar</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent className="px-2 sm:px-6">
            {day.isPending ? (
              <div className="grid gap-2" aria-hidden="true">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            ) : day.error ? (
              <p role="alert" className="text-sm text-destructive">
                {errorMessage(day.error, 'Erro ao carregar a agenda')}
              </p>
            ) : !items.length ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {tab === 'remarcar' ? 'Nenhum atendimento para remarcar neste dia.' : 'Nenhum atendimento neste dia.'}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Horário</TableHead>
                    <TableHead>Paciente</TableHead>
                    <TableHead className="hidden sm:table-cell">Serviço</TableHead>
                    <TableHead className="hidden sm:table-cell">Prioridade</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((i) => {
                    const who = i.user_name || 'paciente'
                    return (
                      <TableRow key={`${i.kind}-${i.id}`}>
                        <TableCell className="whitespace-nowrap">
                          {hhmm(i.scheduled_at)}
                          {i.duration_minutes ? <span className="hidden text-muted-foreground sm:inline"> ({i.duration_minutes} min)</span> : null}
                        </TableCell>
                        <TableCell>
                          {who}
                          {/* No celular as colunas Serviço e Prioridade somem; o serviço vem aqui. */}
                          <span className="block text-xs text-muted-foreground sm:hidden">{i.service_name || '—'}</span>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{i.service_name || '—'}</TableCell>
                        <TableCell className="hidden capitalize sm:table-cell">{i.user_priority || 'nenhuma'}</TableCell>
                        <TableCell>
                          <StatusBadge status={i.status} />
                        </TableCell>
                        <TableCell>
                          <BookingActions
                            kind={kindToPath(i.kind)}
                            id={i.id}
                            who={who}
                            status={i.status}
                            onAction={setAction}
                            layout="menu"
                            onHistory={() => setHistory({ kind: i.kind, id: i.id, who })}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <BookingActionDialog target={action} onClose={() => setAction(null)} />
      <HistoryDialog target={history} onClose={() => setHistory(null)} />
      <ReportDialog open={reportOpen} date={date} onClose={() => setReportOpen(false)} />
      <NewBookingDialog open={newOpen} onClose={() => setNewOpen(false)} onCreated={goTo} />
    </>
  )
}
