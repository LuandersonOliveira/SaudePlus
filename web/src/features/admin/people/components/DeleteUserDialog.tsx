import { useState } from 'react'
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
import { errorMessage } from '@/lib/api'
import { useDeleteUser } from '../queries'

export function DeleteUserDialog({ target, onClose }: { target: { id: string; name: string } | null; onClose: () => void }) {
  const del = useDeleteUser()
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!target) return
    setError(null)
    try {
      await del.mutateAsync(target.id)
      toast.success('Usuário excluído')
      onClose()
    } catch (e) {
      setError(errorMessage(e, 'Erro ao excluir'))
    }
  }

  return (
    <AlertDialog open={!!target} onOpenChange={(o) => !o && !del.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir usuário?</AlertDialogTitle>
          <AlertDialogDescription>
            O usuário será ocultado (soft-delete). Ele não poderá mais acessar o sistema.
            <span className="mt-2 block font-semibold text-foreground">{target?.name}</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={del.isPending}>Voltar</AlertDialogCancel>
          <Button variant="destructive" onClick={confirm} disabled={del.isPending}>
            {del.isPending ? 'Excluindo…' : 'Excluir'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
