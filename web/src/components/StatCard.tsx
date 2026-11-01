import { Card, CardHeader, CardTitle } from '@/components/ui/card'

/** Número de destaque com rótulo (não é um título de seção: não usa <h2>). */
export function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardHeader>
        <p className="text-xs font-semibold uppercase text-muted-foreground">{label}</p>
        <CardTitle className="text-3xl font-extrabold">{value}</CardTitle>
      </CardHeader>
    </Card>
  )
}
