import { DpoCard } from '@/components/account/DpoCard'
import { LgpdCard } from '@/components/account/LgpdCard'
import { PrivacyCard } from '@/components/account/PrivacyCard'
import { ProfileCard } from '@/features/staff/pages/AccountPage'

/**
 * Minha conta do administrador: o mesmo perfil da equipe (sem cargo), LGPD, privacidade e DPO.
 * Sem cartão de MFA — o legado também não tinha, e o segredo gerado pelo servidor (base64url) não é
 * compatível com apps autenticadores; ver achados da Fase 6.
 */
export function AdminAccountPage() {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <ProfileCard showJobRole={false} />
      <div className="grid gap-4">
        <LgpdCard />
        <PrivacyCard accessLine="Cada acesso da equipe a documentos pessoais fica registrado na auditoria." />
        <DpoCard />
      </div>
    </div>
  )
}
