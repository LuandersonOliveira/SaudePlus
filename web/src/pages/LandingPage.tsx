import { BellRing, CalendarCheck, ClipboardList, Clock, Heart, Lock, MapPin, type LucideIcon } from 'lucide-react'
import { Link, Navigate } from 'react-router-dom'
import { SiteFooter, SiteHeader } from '@/components/SiteLayout'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/lib/auth'
import { describeStats, usePublicStats } from '@/lib/publicStats'
import { homeForRole } from '@/lib/session'

const STEPS = [
  {
    title: 'Crie sua conta',
    text: 'Comece com nome e telefone — o resto você completa depois em Minha conta, com ajuda do balcão se precisar.',
    link: { to: '/auth?tab=signup', label: 'Ver o cadastro (2 passos)' },
  },
  { title: 'Agende o que precisar', text: 'Consulta médica ou exame — você vê unidade, dia e hora livres e confirma com resumo.' },
  { title: 'Acompanhe tudo', text: 'Fila do dia, agendamentos e alertas da sua região. Cancele ou reagende quando quiser.' },
]

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: CalendarCheck, title: 'Consultas', text: 'Agende e acompanhe atendimentos com diferentes especialidades.' },
  { icon: ClipboardList, title: 'Exames', text: 'Agende coletas e exames de imagem nos postos do município.' },
  { icon: BellRing, title: 'Alertas', text: 'Veja doenças em alta na sua região e proteja sua família.' },
  {
    icon: Clock,
    title: 'Vagas de verdade + fila do dia',
    text: 'Você vê unidade, dia e hora livres e confirma com resumo. Cancele ou reagende quando quiser, com lembrete na véspera.',
  },
]

const TRUST: { icon: LucideIcon; title: string; text: string; link?: boolean }[] = [
  {
    icon: Lock,
    title: 'Seus dados protegidos',
    text: 'Só você e a equipe responsável pelo seu atendimento têm acesso ao seu histórico.',
    link: true,
  },
  { icon: Heart, title: '100% gratuito', text: 'O Saúde+ não cobra nada da população. Nunca vai pedir cartão de crédito.' },
  {
    icon: MapPin,
    title: 'Feito para Lagoa de Itaenga',
    text: 'Pensado para a rede de saúde local, conectando você aos serviços da sua cidade.',
  },
]

function IconBadge({ icon: Icon, className = '' }: { icon: LucideIcon; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex size-[52px] flex-none items-center justify-center rounded-full bg-accent text-accent-foreground ${className}`}
    >
      <Icon className="size-[26px]" strokeWidth={1.6} />
    </span>
  )
}

export function LandingPage() {
  const { session } = useAuth()
  const { data: stats } = usePublicStats()
  const proof = describeStats(stats)

  // Quem já está logado vai direto para o painel do próprio papel.
  if (session) return <Navigate to={homeForRole(session.user.role)} replace />

  return (
    <>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-[10000] focus:rounded-xs focus:border focus:bg-card focus:px-4 focus:py-2.5 focus:font-semibold focus:shadow-lg"
      >
        Pular para o conteúdo
      </a>
      <SiteHeader />

      <main id="conteudo">
        <section className="hero-wave relative overflow-hidden bg-gradient-to-b from-accent to-background to-70% px-5 pb-24 pt-[72px] text-center">
          <h1 className="mx-auto mb-3 max-w-[680px] text-[clamp(1.7rem,3vw,2.3rem)] font-extrabold leading-tight tracking-tight">
            Marque sua consulta no posto de Lagoa sem ir ao balcão
          </h1>
          <p className="mx-auto mb-7 max-w-[560px] text-[1.05rem] text-muted-foreground">
            Vaga livre de verdade, fila do dia e lembrete na véspera — grátis, em 1 minuto. Para você e sua família.
          </p>
          <div className="flex flex-col justify-center gap-3 sm:flex-row">
            <Button asChild className="min-h-12 sm:min-h-11">
              <Link to="/auth?tab=signup">Criar minha conta grátis</Link>
            </Button>
            <Button asChild variant="outline" className="min-h-12 sm:min-h-11">
              <Link to="/auth">Já tenho conta</Link>
            </Button>
          </div>
          <p className="mx-auto mt-3.5 max-w-[560px] text-sm text-muted-foreground">
            Grátis • Sem cartão •{' '}
            <Link to="/privacy" className="text-secondary-foreground underline">Privacidade (LGPD)</Link> — só você e sua
            equipe veem seus dados.
          </p>
          <p className="mx-auto mt-1 min-h-5 max-w-[560px] text-sm text-muted-foreground" aria-live="polite">
            {proof}
          </p>
        </section>

        <section id="como-funciona" className="mx-auto max-w-[1080px] scroll-mt-20 px-5 pb-16 pt-8">
          <h2 className="mb-2 text-center text-2xl font-extrabold">Como funciona</h2>
          <p className="mx-auto mb-8 max-w-[480px] text-center text-muted-foreground">
            Três passos simples para começar a usar o Saúde+.
          </p>
          <ol className="grid gap-7 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="text-center">
                <span
                  aria-hidden="true"
                  className="mb-3.5 inline-flex size-11 items-center justify-center rounded-full bg-primary text-[1.1rem] font-extrabold text-primary-foreground"
                >
                  {i + 1}
                </span>
                <h3 className="mb-1.5 text-lg font-extrabold">{s.title}</h3>
                <p className="text-[0.92rem] text-muted-foreground">
                  {s.text}
                  {s.link && (
                    <>
                      {' '}
                      <Link to={s.link.to} className="text-secondary-foreground underline">{s.link.label}</Link>.
                    </>
                  )}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section id="recursos" className="mx-auto max-w-[1080px] scroll-mt-20 px-5 pb-16 pt-2">
          <h2 className="mb-8 text-center text-2xl font-extrabold">Tudo que você precisa</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {FEATURES.map(({ icon, title, text }) => (
              <Card key={title}>
                <CardHeader>
                  <IconBadge icon={icon} className="mb-1.5" />
                  <CardTitle className="text-lg font-extrabold text-secondary-foreground">{title}</CardTitle>
                </CardHeader>
                <CardContent className="text-muted-foreground">{text}</CardContent>
              </Card>
            ))}
          </div>
        </section>

        <Separator />
        <section className="bg-card">
          <div className="mx-auto grid max-w-[1080px] gap-7 px-5 py-10 md:grid-cols-3">
            {TRUST.map(({ icon, title, text, link }) => (
              <div key={title} className="flex items-start gap-3.5">
                <IconBadge icon={icon} />
                <div>
                  <h3 className="mb-1 text-base font-extrabold">{title}</h3>
                  <p className="text-[0.88rem] text-muted-foreground">
                    {text}
                    {link && (
                      <>
                        {' '}
                        <Link to="/privacy" className="text-secondary-foreground underline">Privacidade</Link>.
                      </>
                    )}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
        <Separator />
      </main>

      <SiteFooter />
    </>
  )
}
