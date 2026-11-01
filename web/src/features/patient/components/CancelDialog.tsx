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
import { useCancelBooking } from '../queries'
import type { BookingItem } from '../types'

/** Confirmação de cancelamento (ação destrutiva: alertdialog). O registro continua no histórico como "cancelado". */
export function CancelDialog({ item, onClose }: { item: BookingItem | null; onClose: () => void }) {
  const cancel = useCancelBooking()
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!item) return
    setError(null)
    try {
      await cancel.mutateAsync({ kind: item.kind, id: item.id })
      toast.success('Agendamento cancelado')
      onClose()
    } catch (e) {
      setError(errorMessage(e, 'Erro ao cancelar'))
    }
  }

  return (
    <AlertDialog open={!!item} onOpenChange={(o) => !o && !cancel.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancelar {item?.typeLabel.toLowerCase()}?</AlertDialogTitle>
          <AlertDialogDescription>
            Se você cancelar, pode não haver outra vaga disponível tão cedo. O agendamento continuará visível no histórico
            como cancelado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={cancel.isPending}>Voltar</AlertDialogCancel>
          {/* Button (não AlertDialogAction): só fecha quando a API aceitar o cancelamento. */}
          <Button variant="destructive" onClick={confirm} disabled={cancel.isPending}>
            {cancel.isPending ? 'Cancelando…' : 'Sim, cancelar'}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
