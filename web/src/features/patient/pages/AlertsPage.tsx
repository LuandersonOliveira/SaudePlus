import { Bar, BarChart, Cell, XAxis, YAxis } from 'recharts'
import { EmptyState, ListSkeleton, QueryError } from '@/components/QueryState'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { countByLevel, LEVEL_LABEL, levelTone } from '../logic'
import { useDiseases } from '../queries'

const TONE_CLASS = {
  danger: 'bg-danger-soft text-destructive',
  warning: 'bg-warning-soft text-warning-ink',
  success: 'bg-success-soft text-success',
} as const

const LEVEL_COLOR = { alto: 'var(--destructive)', medio: 'var(--warning)', baixo: 'var(--success)' } as const

const chartConfig = { total: { label: 'Alertas' } } satisfies ChartConfig

export function AlertsPage() {
  const q = useDiseases()
  const data = q.data ? countByLevel(q.data) : []

  return (
    <>
      {q.data && q.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl font-extrabold">Alertas por nível</CardTitle>
            <CardDescription>
              {data.map((d) => `${d.label}: ${d.total}`).join(' · ')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={chartConfig} className="h-40 w-full" role="img" aria-label="Quantidade de alertas por nível">
              <BarChart accessibilityLayer data={data} layout="vertical" margin={{ left: 8, right: 16 }}>
                <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} width={56} />
                <XAxis type="number" allowDecimals={false} hide />
                <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                <Bar dataKey="total" radius={6} barSize={22}>
                  {data.map((d) => (
                    <Cell key={d.level} fill={LEVEL_COLOR[d.level]} />
                  ))}
                </Bar>
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-xl font-extrabold">Doenças em alerta na sua região</CardTitle>
        </CardHeader>
        <CardContent>
          {q.isPending ? (
            <ListSkeleton />
          ) : q.isError ? (
            <QueryError message={errorMessage(q.error, 'Erro ao carregar os alertas da sua região.')} onRetry={() => void q.refetch()} />
          ) : q.data.length ? (
            <ul>
              {q.data.map((d, i) => (
                <li key={d.id ?? `${d.name}-${i}`} className="border-b py-3 last:border-b-0">
                  <p className="font-bold">
                    {d.name}{' '}
                    <Badge variant="outline" className={cn('ml-1 border-transparent', TONE_CLASS[levelTone(d.alert_level)])}>
                      {LEVEL_LABEL[d.alert_level] ?? d.alert_level}
                    </Badge>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[d.description, d.region].filter(Boolean).join(' · ')}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState>Sem alertas ativos.</EmptyState>
          )}
        </CardContent>
      </Card>
    </>
  )
}
