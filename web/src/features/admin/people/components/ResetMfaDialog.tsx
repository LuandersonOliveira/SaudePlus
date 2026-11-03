import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { FormField } from '@/components/FormField'
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
import { errorMessage } from '@/lib/api'
import { useResetMfa } from '../queries'

const schema = z.object({ password: z.string().min(1, 'Informe a sua senha') })
type Values = z.infer<typeof schema>

/** Superadmin redefine o segundo fator de quem perdeu o aparelho (ADR-0010). Pede a SENHA de quem redefine. */
export function ResetMfaDialog({ target, onClose }: { target: { id: string; name: string } | null; onClose: () => void }) {
  const reset = useResetMfa()
  const [error, setError] = useState<string | null>(null)
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: '' } })

  function close() {
    form.reset()
    setError(null)
    onClose()
  }

  async function confirm(v: Values) {
    if (!target) return
    setError(null)
    try {
      await reset.mutateAsync({ id: target.id, password: v.password })
      toast.success('Segundo fator redefinido')
      close()
    } catch (e) {
      setError(errorMessage(e, 'Não foi possível redefinir o segundo fator.'))
    }
  }

  return (
    <AlertDialog open={!!target} onOpenChange={(o) => !o && !reset.isPending && close()}>
      <AlertDialogContent>
        <form onSubmit={form.handleSubmit(confirm)} noValidate aria-label="Redefinir segundo fator" className="grid gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle>Redefinir o segundo fator?</AlertDialogTitle>
            <AlertDialogDescription>
              A verificação em duas etapas de <strong className="text-foreground">{target?.name}</strong> será apagada e as sessões dela, encerradas. No próximo acesso a pessoa
              configura o segundo fator de novo. A ação fica registrada na auditoria.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FormField label="Sua senha" error={form.formState.errors.password?.message}>
            {(a) => <Input {...a} type="password" autoComplete="current-password" {...form.register('password')} />}
          </FormField>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={reset.isPending}>
              Voltar
            </AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={reset.isPending}>
              {reset.isPending ? 'Redefinindo…' : 'Redefinir'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
