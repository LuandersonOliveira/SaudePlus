import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { DPO_UNAVAILABLE, describeDpo, usePublicDpo } from '@/lib/publicStats'

export function DpoCard() {
  const dpo = usePublicDpo()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">Encarregado (DPO)</CardTitle>
        <CardDescription>Canal oficial para qualquer assunto sobre seus dados pessoais (LGPD, art. 41).</CardDescription>
      </CardHeader>
      <CardContent role="status" aria-live="polite">
        {dpo.isPending ? (
          <Skeleton className="h-5 w-64" aria-hidden="true" />
        ) : (
          <p className="font-semibold">{dpo.isError ? DPO_UNAVAILABLE : describeDpo(dpo.data)}</p>
        )}
      </CardContent>
    </Card>
  )
}
