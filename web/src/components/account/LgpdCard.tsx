import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useMeExport } from '@/features/staff/queries'
import { errorMessage } from '@/lib/api'
import { fmtDate } from '@/lib/validators'
import { DeleteAccountDialog } from './DeleteAccountDialog'

/** "Meus dados (LGPD)": consentimento registrado, exportação em JSON e exclusão da conta. */
export function LgpdCard() {
  const exp = useMeExport()
  const [deleteOpen, setDeleteOpen] = useState(false)

  async function download() {
    try {
      const data = exp.data ?? (await exp.refetch()).data
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'meus-dados-saude-mais.json'
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Dados baixados')
    } catch (e) {
      toast.error(errorMessage(e, 'Erro ao baixar dados'))
    }
  }

  const p = exp.data?.profile
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">Meus dados (LGPD)</CardTitle>
        <CardDescription>Baixe tudo que o sistema guarda sobre você ou peça a exclusão da conta.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="text-sm" role="status" aria-live="polite">
          {exp.isPending ? (
            <Skeleton className="h-10" aria-hidden="true" />
          ) : exp.error ? (
            <p className="text-muted-foreground">{errorMessage(exp.error, 'Não foi possível ler os registros de consentimento.')}</p>
          ) : (
            <>
              <p>
                Política de privacidade na versão <strong>{exp.data.privacy_version || p?.privacy_version || '—'}</strong>
              </p>
              <p>
                Consentimento registrado em: <strong>{p?.consent_at ? fmtDate(p.consent_at) : 'não registrado'}</strong>
              </p>
            </>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={download}>
            Baixar meus dados (JSON)
          </Button>
          <Button variant="outline" size="sm" className="border-destructive/40 text-destructive hover:text-destructive" onClick={() => setDeleteOpen(true)}>
            Excluir minha conta…
          </Button>
        </div>
        <DeleteAccountDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} />
      </CardContent>
    </Card>
  )
}
