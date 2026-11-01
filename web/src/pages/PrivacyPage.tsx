/*
  AVISO: texto estruturado conforme a LGPD (Fase 1), mas AINDA NÃO revisado
  por advogado. Antes do uso real com dados da população, a Secretaria deve
  submeter esta política + docs/governanca/ROPA.md + docs/governanca/RIPD.md
  à Procuradoria/DPO.
*/
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '@/components/Brand'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { DPO_UNAVAILABLE, describeDpo, usePublicDpo } from '@/lib/publicStats'

export const POLICY_VERSION = 'v1-2026-10-09'

function Code({ children }: { children: ReactNode }) {
  return <code className="rounded-xs bg-muted px-1.5 py-0.5 text-[0.85em]">{children}</code>
}

function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <Card id={id} className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="text-lg font-extrabold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3 text-[0.95rem] [&_ul]:grid [&_ul]:list-disc [&_ul]:gap-2 [&_ul]:pl-5">
        {children}
      </CardContent>
    </Card>
  )
}

function DpoContact() {
  const { data, isPending, isError } = usePublicDpo()
  if (isPending) return <Skeleton className="inline-block h-4 w-56 align-middle" aria-label="Carregando contato" />
  return <span>{isError ? DPO_UNAVAILABLE : describeDpo(data)}</span>
}

export function PrivacyPage() {
  return (
    <>
      <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-card px-[clamp(16px,4vw,40px)] py-4">
        <Brand />
        <Button asChild variant="ghost">
          <Link to="/">Voltar ao início</Link>
        </Button>
      </header>

      <main className="mx-auto grid max-w-[720px] gap-4 px-5 pb-16 pt-8">
        <div className="grid gap-2">
          <h1 className="text-[clamp(1.7rem,3vw,2.3rem)] font-extrabold leading-tight tracking-tight">
            Política de Privacidade
          </h1>
          <p className="text-muted-foreground">
            <Badge variant="outline" className="mr-2">Versão {POLICY_VERSION}</Badge>
            Escrita em linguagem simples, sem juridiquês.
          </p>
        </div>

        <Section title="Quem cuida dos seus dados">
          <div>
            <strong>Controladora:</strong> Secretaria Municipal de Saúde de Lagoa de Itaenga/PE (opera o Saúde+ para
            executar políticas públicas do SUS). <strong>Encarregado (DPO):</strong> <DpoContact />
          </div>
        </Section>

        <Section title="Quais dados coletamos">
          <p>
            <strong>Cadastro:</strong> nome, nome social (opcional), e-mail, telefones, CPF, RG, Cartão SUS (CNS),
            nascimento, endereço e dados de perfil de saúde (tipo sanguíneo, prioridade legal, etc.).{' '}
            <strong>Uso:</strong> consultas e exames que você agenda (local, data/hora, profissional, observações) e
            lembretes gerados.
          </p>
        </Section>

        <Section title="Por que podemos tratar — base legal (LGPD)">
          <p>
            Seus dados de saúde são <strong>dados sensíveis</strong> e só são tratados porque a lei permite, nas
            hipóteses do <strong>art. 11 da LGPD</strong>:
          </p>
          <ul>
            <li><strong>Tutela da saúde</strong> (art. 11, II, f) — organizar seu atendimento na rede municipal;</li>
            <li>
              <strong>Execução de política pública de saúde</strong> (art. 11, II, b + art. 23) — SUS, Lei 8.080/1990.
            </li>
          </ul>
          <p>
            Não pedimos "aceite" genérico porque o fundamento é legal, não consentimento. Se um dia usarmos seus dados
            para algo fora do SUS (pesquisa, por exemplo), pediremos autorização específica e destacada — e você poderá
            revogar quando quiser.
          </p>
        </Section>

        <Section title="Quem pode ver seus dados">
          <p>
            Você (só os seus). Atendentes veem o necessário para confirmar seu atendimento (sem CPF/RG). Administradores
            da Secretaria veem o cadastro completo, com cada acesso registrado em trilha de auditoria. Nenhum paciente
            vê dado de outro paciente. Dados nunca são vendidos nem usados para vantagem econômica.
          </p>
        </Section>

        <Section title="Como protegemos">
          <p>
            Senha com hash irreversível; CPF/RG/CNS <strong>cifrados no banco</strong> (AES-256); sessão curta com
            renovação controlada; bloqueio contra tentativas de invasão; acessos por papel (paciente/atendente/admin);
            backups e retenção controlada. Detalhes técnicos: <Code>docs/planos/PLANO_RNDS_LGPD.md</Code>.
          </p>
        </Section>

        <Section title="Seus direitos (LGPD, art. 18)">
          <ul>
            <li>
              <strong>Ver tudo:</strong> logado, peça sua cópia em <em>Meu painel → seus dados</em> (ou via API{' '}
              <Code>GET /auth/me/export</Code>);
            </li>
            <li>
              <strong>Corrigir:</strong> edite seu perfil em <em>Meu painel</em> (<Code>PUT /auth/me</Code>);
            </li>
            <li>
              <strong>Excluir:</strong> <Code>DELETE /auth/me</Code> com sua senha — seu perfil é anonimizado,
              agendamentos futuros cancelados e a conta desativada. O histórico clínico vira estatística anônima e a
              auditoria é preservada por obrigação legal;
            </li>
            <li>
              <strong>Falar com o DPO:</strong> contato acima. Respondemos em até 15 dias.
            </li>
          </ul>
        </Section>

        <Section title="Por quanto tempo guardamos">
          <p>
            Enquanto sua conta estiver ativa. Contas de paciente sem acesso há mais de <strong>5 anos</strong> têm o
            perfil anonimizado automaticamente. Registros de saúde seguem os prazos legais do SUS. Tabela completa em{' '}
            <Code>docs/governanca/ROPA.md</Code>.
          </p>
        </Section>

        <Section title="Contato" id="dpo">
          <div>
            Dúvidas sobre seus dados? Escreva para o Encarregado: <DpoContact />
          </div>
        </Section>
      </main>

      <footer className="px-8 pb-8 text-center text-sm text-muted-foreground">
        © Saúde+ — Feito para Lagoa de Itaenga
      </footer>
    </>
  )
}
