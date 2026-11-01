import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { PasswordDialog } from '@/components/PasswordDialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useMe } from '@/features/staff/queries'
import { api, errorMessage } from '@/lib/api'
import { mfaSchema } from '@/lib/validators'

type Dialog = 'setup' | 'disable' | null

/** Verificação em duas etapas (TOTP): ativar (senha → segredo → código) e desativar (senha). */
export function MfaCard() {
  const qc = useQueryClient()
  const me = useMe()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [enabling, setEnabling] = useState(false)

  const on = !!Number(me.data?.totp_enabled)
  const refreshMe = () => qc.invalidateQueries({ queryKey: ['me'] })

  async function enable(e: React.FormEvent) {
    e.preventDefault()
    const parsed = mfaSchema.safeParse({ code })
    if (!parsed.success) return setCodeError(parsed.error.issues[0].message)
    setCodeError(null)
    setEnabling(true)
    try {
      await api.post('/auth/mfa/enable', { code: parsed.data.code })
      toast.success('Verificação em 2 etapas ativada')
      setSecret(null)
      setCode('')
      await refreshMe()
    } catch (err) {
      toast.error(errorMessage(err, 'Código inválido'))
    } finally {
      setEnabling(false)
    }
  }

  const status = me.isPending
    ? 'Verificando…'
    : me.isError
      ? 'Não foi possível verificar.'
      : on
        ? 'Ativada. O login exige o código do app autenticador.'
        : 'Desativada. Recomendado para atendentes e administradores.'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">Verificação em duas etapas (MFA)</CardTitle>
        <CardDescription role="status" aria-live="polite">
          {status}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {secret && !on && (
          <div className="grid gap-3 rounded-md border p-4">
            <p className="text-sm text-muted-foreground">1. Cadastre este segredo no app autenticador (Google/Microsoft Authenticator):</p>
            <code className="select-all break-all rounded-xs bg-muted px-2 py-1.5 text-sm" aria-label="Segredo do autenticador">
              {secret}
            </code>
            <form onSubmit={enable} noValidate className="grid gap-2">
              <Label htmlFor="mfa-code" className="text-sm text-muted-foreground">
                2. Digite o código de 6 dígitos que o app mostrar:
              </Label>
              <div className="flex flex-wrap items-start gap-2">
                <Input
                  id="mfa-code"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="Código de 6 dígitos"
                  autoComplete="one-time-code"
                  className="max-w-48"
                  aria-invalid={!!codeError}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
                <Button type="submit" size="sm" disabled={enabling}>
                  Ativar
                </Button>
              </div>
              {codeError && <p className="text-sm text-destructive">{codeError}</p>}
            </form>
          </div>
        )}

        {!me.isPending && !me.isError && (
          <div className="flex flex-wrap gap-2">
            {on ? (
              <Button variant="outline" size="sm" onClick={() => setDialog('disable')}>
                Desativar
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setDialog('setup')}>
                Ativar verificação em 2 etapas
              </Button>
            )}
          </div>
        )}

        {/* O back exige a senha antes de gerar o segredo: um token válido sozinho não assume o 2º fator de outra pessoa. */}
        <PasswordDialog
          open={dialog === 'setup'}
          onClose={() => setDialog(null)}
          title="Ativar verificação em 2 etapas"
          description="Confirme sua senha para gerar o segredo do app autenticador."
          confirmLabel="Gerar segredo"
          onSubmit={async (password) => {
            const data = await api.post<{ secret: string }>('/auth/mfa/setup', { password })
            setSecret(data.secret)
            toast.success('Segredo gerado — cadastre no app autenticador')
          }}
        />
        <PasswordDialog
          open={dialog === 'disable'}
          onClose={() => setDialog(null)}
          title="Desativar verificação em duas etapas"
          description="Digite sua senha para confirmar."
          confirmLabel="Desativar"
          onSubmit={async (password) => {
            await api.post('/auth/mfa/disable', { password })
            toast.success('MFA desativado')
            await refreshMe()
          }}
        />
      </CardContent>
    </Card>
  )
}
