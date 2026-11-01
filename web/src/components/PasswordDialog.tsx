import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { errorMessage } from '@/lib/api'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  description: string
  confirmLabel: string
  /** Se a promessa rejeitar, a mensagem aparece no diálogo (que continua aberto para tentar de novo). */
  onSubmit: (password: string) => Promise<void>
}

function Form({ onClose, confirmLabel, onSubmit }: Pick<Props, 'onClose' | 'confirmLabel' | 'onSubmit'>) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!password) return setError('Informe sua senha.')
    setBusy(true)
    setError(null)
    try {
      await onSubmit(password)
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível concluir. Tente novamente.'))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="pw-dialog">Senha</Label>
        <Input
          id="pw-dialog"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          aria-invalid={!!error}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
          Voltar
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? 'Aguarde…' : confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}

/** Pede a senha do titular antes de uma ação sensível (substitui o prompt() nativo, proibido pelo DESIGN.md). */
export function PasswordDialog({ open, onClose, title, description, confirmLabel, onSubmit }: Props) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {open && <Form onClose={onClose} confirmLabel={confirmLabel} onSubmit={onSubmit} />}
      </DialogContent>
    </Dialog>
  )
}
