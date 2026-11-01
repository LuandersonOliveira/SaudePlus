import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'

function Form({ onClose }: { onClose: () => void }) {
  const { logout } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function confirm(e: React.FormEvent) {
    e.preventDefault()
    if (!password) return setError('Informe sua senha.')
    setBusy(true)
    setError(null)
    try {
      await api.delete('/auth/me', { password })
      toast.success('Conta excluída')
      logout()
      navigate('/', { replace: true })
    } catch (err) {
      setError(errorMessage(err, 'Não foi possível excluir.'))
      setBusy(false)
    }
  }

  return (
    <form onSubmit={confirm} noValidate className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="del-pass">Senha</Label>
        <Input
          id="del-pass"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <AlertDialogFooter>
        <AlertDialogCancel type="button" onClick={onClose}>
          Voltar
        </AlertDialogCancel>
        {/* Button (não AlertDialogAction): a ação só fecha o diálogo quando a API aceitar. */}
        <Button type="submit" variant="destructive" disabled={busy}>
          {busy ? 'Excluindo…' : 'Excluir conta'}
        </Button>
      </AlertDialogFooter>
    </form>
  )
}

export function DeleteAccountDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir sua conta?</AlertDialogTitle>
          <AlertDialogDescription>
            Seus dados pessoais serão anonimizados e você perderá o acesso ao painel. Confirme com sua senha.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {open && <Form onClose={onClose} />}
      </AlertDialogContent>
    </AlertDialog>
  )
}
