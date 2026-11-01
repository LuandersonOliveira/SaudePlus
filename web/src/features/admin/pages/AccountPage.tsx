import { DpoCard } from '@/components/account/DpoCard'
import { LgpdCard } from '@/components/account/LgpdCard'
import { PrivacyCard } from '@/components/account/PrivacyCard'
import { ProfileCard } from '@/features/staff/pages/AccountPage'

/**
 * Minha conta do administrador: o mesmo perfil da equipe (sem cargo), LGPD, privacidade e DPO.
 * Sem cartão de MFA por enquanto — o legado também não tinha. O impedimento técnico (segredo em
 * base64url, incompatível com apps autenticadores) acabou: o servidor agora gera base32. O cartão
 * do paciente (patient/account/MfaCard) pode ser reaproveitado aqui.
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
