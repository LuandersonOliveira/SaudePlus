import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Brand } from '@/components/Brand'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

const navLink = 'text-[0.95rem] font-medium text-foreground no-underline hover:text-secondary-foreground'
const footLink = 'mb-2 block text-sm text-foreground no-underline hover:text-secondary-foreground'

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border-b bg-card px-[clamp(16px,4vw,40px)] py-4">
      <Brand />
      <nav aria-label="Navegação principal" className="flex flex-wrap items-center gap-3 sm:gap-[18px]">
        <Link to="/#como-funciona" className={navLink}>Como funciona</Link>
        <Link to="/#recursos" className={navLink}>Recursos</Link>
        <Link to="/auth" className={navLink}>Entrar</Link>
        <Button asChild size="sm" className="min-h-11">
          <Link to="/auth?tab=signup">Criar conta</Link>
        </Button>
      </nav>
    </header>
  )
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</h2>
      {children}
    </div>
  )
}

export function SiteFooter() {
  return (
    <footer className="bg-card px-5 pb-6 pt-11">
      <div className="mx-auto grid max-w-[1080px] gap-7 md:grid-cols-[2fr_1fr_1fr] md:gap-8">
        <div>
          <Brand className="mb-2.5" />
          <p className="max-w-[280px] text-sm text-muted-foreground">
            Cuidado integrado para a população de Lagoa de Itaenga: consultas, exames e alertas de saúde em um só lugar.
          </p>
        </div>
        <FooterColumn title="Acesso rápido">
          <Link to="/#como-funciona" className={footLink}>Como funciona</Link>
          <Link to="/#recursos" className={footLink}>Recursos</Link>
          <Link to="/auth" className={footLink}>Entrar</Link>
        </FooterColumn>
        <FooterColumn title="Contato">
          <Link to="/privacy" className={footLink}>Política de Privacidade</Link>
          <Link to="/privacy#dpo" className={footLink}>Encarregado de dados (DPO)</Link>
        </FooterColumn>
      </div>
      <Separator className="mx-auto mt-7 max-w-[1080px]" />
      <div className="mx-auto max-w-[1080px] pt-[18px] text-center text-xs text-muted-foreground">
        © Saúde+ — Feito para Lagoa de Itaenga
      </div>
    </footer>
  )
}
