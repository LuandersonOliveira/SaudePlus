import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** Marcador de uma aba que ainda está sendo migrada. */
export function ComingSoon({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground">Esta seção está sendo migrada e chega na próxima etapa.</CardContent>
    </Card>
  )
}
