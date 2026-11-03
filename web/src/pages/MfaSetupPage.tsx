import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { z } from 'zod'
import { Brand } from '@/components/Brand'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { api, errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { homeForRole, setSession, type SessionUser } from '@/lib/session'
import { mfaSchema, type MfaInput } from '@/lib/validators'

/**
 * Configuração OBRIGATÓRIA do segundo fator (ADR-0010). Atendente e admin sem MFA ativo recebem uma sessão
 * restrita e só chegam aqui: a API barra o resto com 403 MFA_SETUP_REQUIRED.
 */
const senhaSchema = z.object({ password: z.string().min(1, 'Informe sua senha') })
type SenhaInput = z.infer<typeof senhaSchema>

interface SetupResponse {
  secret: string
  otpauth_url: string
}
interface EnableResponse {
  token: string
  user: SessionUser
}

/** "ABCDEFGH…" em grupos de 4, mais fácil de conferir ao digitar no aplicativo. */
const emGrupos = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim()

export function MfaSetupPage() {
  const { session, logout, refresh } = useAuth()
  const navigate = useNavigate()
  const [setup, setSetup] = useState<SetupResponse | null>(null)

  const senhaForm = useForm<SenhaInput>({ resolver: zodResolver(senhaSchema), defaultValues: { password: '' } })
  const codigoForm = useForm<MfaInput>({ resolver: zodResolver(mfaSchema), defaultValues: { code: '' } })

  // Quem não está com a sessão restrita (já tem MFA, ou é paciente) não tem o que configurar aqui.
  if (!session || !session.user.mfa_setup) {
    return <Navigate to={session ? homeForRole(session.user.role) : '/auth'} replace />
  }

  async function gerar(v: SenhaInput) {
    try {
      setSetup(await api.post<SetupResponse>('/auth/mfa/setup', { password: v.password }))
    } catch (e) {
      toast.error(errorMessage(e, 'Não foi possível gerar o código de configuração.'))
    }
  }

  async function ativar(v: MfaInput) {
    try {
      const data = await api.post<EnableResponse>('/auth/mfa/enable', { code: v.code })
      // O servidor devolve um token SEM a marca de sessão restrita: é ele que libera o painel.
      setSession(data.token, data.user)
      refresh()
      navigate(homeForRole(data.user.role), { replace: true })
    } catch (e) {
      toast.error(errorMessage(e, 'Código inválido. Confira o aplicativo e tente de novo.'))
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="grid gap-5">
          <Brand />
          <div className="grid gap-1">
            <h1 className="text-xl font-extrabold">Ative a verificação em duas etapas</h1>
            <p className="text-sm text-muted-foreground">
              Contas de atendente e de administração precisam do segundo fator para acessar dados de pacientes. É feito uma vez, com um aplicativo autenticador no celular.
            </p>
          </div>

          {!setup ? (
            <form onSubmit={senhaForm.handleSubmit(gerar)} noValidate aria-label="Gerar código de configuração" className="grid gap-4">
              <FormField label="Confirme sua senha" error={senhaForm.formState.errors.password?.message}>
                {(a) => <Input {...a} type="password" autoComplete="current-password" autoFocus {...senhaForm.register('password')} />}
              </FormField>
              <Button type="submit" disabled={senhaForm.formState.isSubmitting}>
                {senhaForm.formState.isSubmitting ? 'Gerando…' : 'Gerar código de configuração'}
              </Button>
            </form>
          ) : (
            <form onSubmit={codigoForm.handleSubmit(ativar)} noValidate aria-label="Ativar verificação em duas etapas" className="grid gap-4">
              <ol className="grid list-decimal gap-2 pl-5 text-sm">
                <li>Abra um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy…).</li>
                <li>
                  Adicione uma conta com esta chave:
                  <code className="mt-1 block break-all rounded-md bg-muted px-3 py-2 font-mono text-base tracking-wider" aria-label="Chave de configuração">
                    {emGrupos(setup.secret)}
                  </code>
                  <a href={setup.otpauth_url} className="text-primary underline underline-offset-2">
                    Abrir no aplicativo autenticador
                  </a>{' '}
                  (no celular).
                </li>
                <li>Digite abaixo o código de 6 dígitos que o aplicativo mostrar.</li>
              </ol>
              <FormField label="Código" error={codigoForm.formState.errors.code?.message}>
                {(a) => (
                  <Input {...a} inputMode="numeric" maxLength={6} placeholder="000000" autoComplete="one-time-code" {...codigoForm.register('code')} />
                )}
              </FormField>
              <Button type="submit" disabled={codigoForm.formState.isSubmitting}>
                {codigoForm.formState.isSubmitting ? 'Ativando…' : 'Ativar e continuar'}
              </Button>
            </form>
          )}

          <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => logout()}>
            Sair
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}
