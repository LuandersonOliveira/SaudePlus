import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import type { SessionUser } from '@/lib/session'
import { loginSchema, mfaSchema, type LoginInput, type MfaInput } from '@/lib/validators'

interface Props {
  defaultEmail?: string
  onForgot: () => void
  onSuccess: (user?: SessionUser) => void
}

export function LoginForm({ defaultEmail = '', onForgot, onSuccess }: Props) {
  const { login, verifyMfa } = useAuth()
  const [ticket, setTicket] = useState<string | null>(null)

  const loginForm = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: defaultEmail, password: '' },
  })
  const mfaForm = useForm<MfaInput>({ resolver: zodResolver(mfaSchema), defaultValues: { code: '' } })

  async function submitLogin(v: LoginInput) {
    try {
      const data = await login(v.email, v.password)
      if (data.mfa_required && data.mfa_ticket) {
        setTicket(data.mfa_ticket)
        return
      }
      onSuccess(data.user)
    } catch (e) {
      toast.error(errorMessage(e, 'Erro ao entrar'))
    }
  }

  async function submitMfa(v: MfaInput) {
    try {
      const data = await verifyMfa(ticket!, v.code)
      onSuccess(data.user)
    } catch (e) {
      toast.error(errorMessage(e, 'Código inválido'))
    }
  }

  if (ticket) {
    const { register, handleSubmit, formState } = mfaForm
    return (
      <form onSubmit={handleSubmit(submitMfa)} noValidate aria-label="Verificação em duas etapas" className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Sua conta usa verificação em duas etapas. Abra o app autenticador e digite o código de 6 dígitos.
        </p>
        <FormField label="Código" error={formState.errors.code?.message}>
          {(a) => (
            <Input {...a} inputMode="numeric" maxLength={6} placeholder="000000" autoFocus autoComplete="one-time-code" {...register('code')} />
          )}
        </FormField>
        <Button type="submit" disabled={formState.isSubmitting}>
          Verificar e entrar
        </Button>
      </form>
    )
  }

  const { register, handleSubmit, formState } = loginForm
  return (
    <form onSubmit={handleSubmit(submitLogin)} noValidate aria-label="Entrar na conta" className="grid gap-4">
      <FormField label="E-mail" error={formState.errors.email?.message}>
        {(a) => <Input {...a} type="email" autoComplete="email" {...register('email')} />}
      </FormField>
      <FormField label="Senha" error={formState.errors.password?.message}>
        {(a) => <Input {...a} type="password" autoComplete="current-password" {...register('password')} />}
      </FormField>
      <Button type="submit" disabled={formState.isSubmitting}>
        {formState.isSubmitting ? 'Entrando…' : 'Entrar'}
      </Button>
      <p className="text-center text-sm">
        <button type="button" onClick={onForgot} className="text-primary underline underline-offset-2">
          Esqueci minha senha
        </button>
      </p>
    </form>
  )
}
