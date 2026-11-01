import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { errorMessage } from '@/lib/api'

export interface ReviewData {
  editing: boolean
  lines: [string, string][]
  submit: () => Promise<void>
}

function Body({ data, onClose }: { data: ReviewData; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    setBusy(true)
    setError(null)
    try {
      await data.submit()
      onClose()
    } catch (e) {
      setError(errorMessage(e, 'Erro ao salvar'))
      setBusy(false)
    }
  }

  return (
    <>
      <dl className="grid gap-1.5 text-sm">
        {data.lines.map(([k, v]) => (
          <div key={k} className="flex flex-wrap gap-x-2">
            <dt className="text-muted-foreground">{k}:</dt>
            <dd className="font-bold">{v}</dd>
          </div>
        ))}
      </dl>
      {error && (
        <p role="alert" className="rounded-sm bg-danger-soft p-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Voltar
        </Button>
        <Button type="button" onClick={confirm} disabled={busy}>
          {busy ? 'Enviando…' : data.editing ? 'Salvar alterações' : 'Confirmar agendamento'}
        </Button>
      </DialogFooter>
    </>
  )
}

/** Revisão antes de confirmar: o paciente vê "unidade · serviço · profissional · data/hora" e confirma. */
export function ReviewDialog({ data, onClose }: { data: ReviewData | null; onClose: () => void }) {
  return (
    <Dialog open={!!data} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{data?.editing ? 'Salvar alterações?' : 'Confirmar agendamento'}</DialogTitle>
          <DialogDescription>Confira os dados antes de confirmar.</DialogDescription>
        </DialogHeader>
        {data && <Body data={data} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  )
}
