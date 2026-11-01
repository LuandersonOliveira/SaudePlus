import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { errorMessage, forgotPassword, resetPassword } from '@/lib/api'
import { forgotSchema, resetSchema, type ForgotInput, type ResetInput } from '@/lib/validators'

const linkClass = 'text-primary underline underline-offset-2'

export function ForgotForm({ onBack }: { onBack: () => void }) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ForgotInput>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: '' },
  })

  async function submit(v: ForgotInput) {
    try {
      const res = await forgotPassword(v.email)
      // A resposta é a mesma exista ou não a conta (a rota não enumera usuários).
      toast.success(res?.message || 'Se houver uma conta com este e-mail, enviaremos um link.')
    } catch (e) {
      toast.error(errorMessage(e, 'Não foi possível pedir o link agora'))
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate aria-label="Pedir redefinição de senha" className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Informe seu e-mail. Se houver uma conta com ele, você recebe um link para criar uma nova senha.
      </p>
      <FormField label="E-mail" error={errors.email?.message}>
        {(a) => <Input {...a} type="email" autoComplete="email" {...register('email')} />}
      </FormField>
      <Button type="submit" disabled={isSubmitting}>Enviar link</Button>
      <p className="text-sm">
        <button type="button" className={linkClass} onClick={onBack}>Voltar para o login</button>
      </p>
    </form>
  )
}

export function ResetForm({ token, onDone, onRequestNew }: { token: string | null; onDone: () => void; onRequestNew: () => void }) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<ResetInput>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', password2: '' },
  })

  async function submit(v: ResetInput) {
    if (!token) {
      toast.error('Este link não tem código. Peça um novo.')
      onRequestNew()
      return
    }
    try {
      await resetPassword(token, v.password)
      toast.success('Senha trocada. Entre com a nova senha.')
      reset()
      onDone()
    } catch (e) {
      toast.error(errorMessage(e, 'Link inválido ou expirado.'))
    }
  }

  return (
    <form onSubmit={handleSubmit(submit)} noValidate aria-label="Criar nova senha" className="grid gap-4">
      <p className="text-sm text-muted-foreground">Crie uma nova senha para sua conta.</p>
      <FormField label="Nova senha" error={errors.password?.message}>
        {(a) => <Input {...a} type="password" autoComplete="new-password" {...register('password')} />}
      </FormField>
      <FormField label="Repita a senha" error={errors.password2?.message}>
        {(a) => <Input {...a} type="password" autoComplete="new-password" {...register('password2')} />}
      </FormField>
      <Button type="submit" disabled={isSubmitting}>Salvar nova senha</Button>
      <p className="text-sm">
        <button type="button" className={linkClass} onClick={onRequestNew}>Pedir um novo link</button>
      </p>
    </form>
  )
}
