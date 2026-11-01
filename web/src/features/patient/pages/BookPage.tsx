import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BookingForm } from '../booking/BookingForm'
import { WaitlistCard } from '../booking/WaitlistCard'
import { useMyBookings } from '../queries'
import type { MyKind } from '../types'
import type { BookingIntent } from './MyBookingsPage'

function isIntent(v: unknown): v is BookingIntent {
  const s = v as Partial<BookingIntent> | null
  return !!s && (s.mode === 'edit' || s.mode === 'rebook') && (s.kind === 'appointments' || s.kind === 'exams') && typeof s.id === 'string'
}

/** Aba "Agendar": Consulta ou Exame, mais a lista de espera. Editar/refazer chegam pelo estado da rota. */
export function BookPage() {
  const location = useLocation()
  const navigate = useNavigate()
  // Lida uma vez: depois que o formulário consome a intenção, o estado da rota é limpo.
  const [intent] = useState<BookingIntent | null>(() => (isIntent(location.state) ? location.state : null))
  const [tab, setTab] = useState<MyKind>(intent?.kind ?? 'appointments')

  const appts = useMyBookings('appointments')
  const exams = useMyBookings('exams')
  const bookings = { appointments: appts, exams }

  const clearIntent = () => navigate(location.pathname, { replace: true, state: null })

  function recordFor(kind: MyKind) {
    if (!intent || intent.kind !== kind) return null
    const q = bookings[kind]
    if (q.isPending) return undefined // ainda carregando
    return q.data?.find((r) => r.id === intent.id) ?? null
  }

  return (
    <>
      <Tabs value={tab} onValueChange={(v) => setTab(v as MyKind)}>
        <TabsList aria-label="Tipo de agendamento">
          <TabsTrigger value="appointments">Consulta</TabsTrigger>
          <TabsTrigger value="exams">Exame</TabsTrigger>
        </TabsList>
        {/* forceMount: o rascunho de uma aba não se perde ao trocar para a outra. */}
        {(['appointments', 'exams'] as const).map((kind) => (
          // `hidden` explícito: com forceMount o Radix não o aplica, e a aba inativa continuaria na árvore de acessibilidade.
          <TabsContent key={kind} value={kind} forceMount hidden={tab !== kind} className="mt-4 data-[state=inactive]:hidden">
            <BookingForm
              kind={kind}
              intent={intent && intent.kind === kind ? { mode: intent.mode, id: intent.id } : null}
              record={recordFor(kind)}
              onIntentDone={clearIntent}
            />
          </TabsContent>
        ))}
      </Tabs>
      <WaitlistCard />
    </>
  )
}
