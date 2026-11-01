import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** `accessLine` descreve quem acessa o quê (muda entre paciente e equipe). */
export function PrivacyCard({ accessLine }: { accessLine: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">Privacidade</CardTitle>
        <CardDescription>
          Coletamos o mínimo necessário para o atendimento público. A base legal é o dever legal do SUS (art. 11, II,{' '}
          <em>f</em> da LGPD), não o consentimento — por isso não há caixa de aceite genérico.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <ul className="grid list-disc gap-1.5 pl-5 text-sm text-muted-foreground">
          <li>Dados de saúde são sensíveis e ficam restritos à equipe que presta o atendimento.</li>
          <li>CPF, RG e CNS são gravados criptografados no banco.</li>
          <li>{accessLine}</li>
          <li>Você pode corrigir, exportar ou apagar seus dados a qualquer momento.</li>
        </ul>
        <Button asChild variant="outline" size="sm" className="w-fit">
          <Link to="/privacy">Ler a Política de Privacidade</Link>
        </Button>
      </CardContent>
    </Card>
  )
}
