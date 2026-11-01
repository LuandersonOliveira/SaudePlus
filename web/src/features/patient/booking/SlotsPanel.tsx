import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { fmtDayLabel, sameSlot, slotEntries } from './logic'
import type { Selection, SlotUnit } from './types'

interface Props {
  units: SlotUnit[]
  totalVagas: number
  selection: Selection | null
  /** Dia aberto por unidade (id → data). */
  openDays: Record<string, string>
  onToggleDay: (unitId: string, date: string) => void
  onPick: (unitId: string, date: string, hora: string, professionalId: string | null) => void
}

/** Cartões por unidade: dias com vaga e, no dia aberto, os pares horário × profissional. */
export function SlotsPanel({ units, totalVagas, selection, openDays, onToggleDay, onPick }: Props) {
  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted-foreground">
        {totalVagas} horário(s) livre(s) em {units.length} unidade(s).
      </p>
      {units.map((u) => {
        const openDate = openDays[u.id] || u.dias[0]?.date
        const day = u.dias.find((d) => d.date === openDate) ?? u.dias[0]
        const meta = [u.type, u.neighborhood].filter(Boolean).join(' · ')
        return (
          <section key={u.id} aria-label={u.name} className="rounded-md border p-4">
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div>
                <h3 className="font-bold">{u.name}</h3>
                {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
              </div>
              <span className="rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-accent-foreground">
                {u.totalVagas} vaga(s)
              </span>
            </div>

            <div className="mb-3 flex flex-wrap gap-2">
              {u.dias.map((d) => (
                <Button
                  key={d.date}
                  type="button"
                  size="sm"
                  variant={d.date === day.date ? 'default' : 'outline'}
                  aria-pressed={d.date === day.date}
                  onClick={() => onToggleDay(u.id, d.date)}
                >
                  {fmtDayLabel(d.date)}
                </Button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {slotEntries(day).map((t) => {
                const selected = sameSlot(selection, u.id, day.date, t.hora, t.professional_id)
                return (
                  <Button
                    key={`${t.hora}-${t.professional_id ?? 'x'}`}
                    type="button"
                    variant="outline"
                    aria-pressed={selected}
                    className={cn(
                      'h-auto flex-col gap-0 py-1.5',
                      selected && 'border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground',
                    )}
                    onClick={() => onPick(u.id, day.date, t.hora, t.professional_id)}
                  >
                    <span className="font-bold">{t.hora}</span>
                    {t.professional_name && <small className="text-xs font-normal opacity-80">{t.professional_name}</small>}
                  </Button>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function SlotsSkeleton() {
  return (
    <div className="grid gap-2" role="status" aria-label="Buscando vagas livres">
      <Skeleton className="h-6 w-56" />
      <Skeleton className="h-28" />
    </div>
  )
}
