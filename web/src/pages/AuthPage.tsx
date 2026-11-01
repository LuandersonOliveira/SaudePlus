import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Brand } from '@/components/Brand'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAuth } from '@/lib/auth'
import { homeForRole, type SessionUser } from '@/lib/session'
import { LoginForm } from './auth/LoginForm'
import { ForgotForm, ResetForm } from './auth/PasswordResetForms'
import { SignupForm } from './auth/SignupForm'

type View = 'login' | 'signup' | 'forgot' | 'reset'

function initialView(search: string): View {
  const tab = new URLSearchParams(search).get('tab')
  return tab === 'signup' ? 'signup' : tab === 'reset' ? 'reset' : 'login'
}

export function AuthPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [view, setView] = useState<View>(() => initialView(location.search))
  // O token do link de redefinição fica só em memória: sai da URL assim que a
  // página lê, para não sobrar no histórico nem em um "copiar endereço".
  const [resetToken, setResetToken] = useState<string | null>(() =>
    new URLSearchParams(location.search).get('tab') === 'reset'
      ? new URLSearchParams(location.search).get('token')
      : null,
  )
  const [emailPrefill, setEmailPrefill] = useState('')

  useEffect(() => {
    if (new URLSearchParams(location.search).get('token')) {
      navigate(location.pathname, { replace: true })
    }
  }, [location.search, location.pathname, navigate])

  // Link de redefinição sem token cai no pedido do link.
  const effectiveView: View = view === 'reset' && !resetToken ? 'forgot' : view

  if (session) {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from ?? homeForRole(session.user.role)} replace />
  }

  function enter(user?: SessionUser) {
    const from = (location.state as { from?: string } | null)?.from
    navigate(from ?? homeForRole(user?.role ?? 'paciente'), { replace: true })
  }

  const showTabs = effectiveView === 'login' || effectiveView === 'signup'

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-lg">
        <CardContent className="grid gap-5">
          <Brand />

          {showTabs ? (
            <Tabs value={effectiveView} onValueChange={(v) => setView(v as View)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Entrar</TabsTrigger>
                <TabsTrigger value="signup">Criar conta</TabsTrigger>
              </TabsList>
              <TabsContent value="login" className="pt-4">
                <LoginForm key={emailPrefill} defaultEmail={emailPrefill} onForgot={() => setView('forgot')} onSuccess={enter} />
              </TabsContent>
              <TabsContent value="signup" className="pt-4">
                <SignupForm
                  onDone={(email) => {
                    setEmailPrefill(email)
                    setView('login')
                  }}
                />
              </TabsContent>
            </Tabs>
          ) : effectiveView === 'forgot' ? (
            <ForgotForm onBack={() => setView('login')} />
          ) : (
            <ResetForm
              token={resetToken}
              onDone={() => {
                setResetToken(null)
                setView('login')
              }}
              onRequestNew={() => {
                setResetToken(null)
                setView('forgot')
              }}
            />
          )}

          <p className="text-center text-xs text-muted-foreground">Campos marcados com * são obrigatórios.</p>
        </CardContent>
      </Card>
    </main>
  )
}
