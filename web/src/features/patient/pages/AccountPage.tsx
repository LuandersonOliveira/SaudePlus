import { DpoCard } from '@/components/account/DpoCard'
import { LgpdCard } from '@/components/account/LgpdCard'
import { PrivacyCard } from '@/components/account/PrivacyCard'
import { MfaCard } from '../account/MfaCard'
import { ProfileCard } from '../account/ProfileCard'

/** Aba "Minha conta" do paciente: perfil, LGPD, MFA, privacidade e DPO. */
export function AccountPage() {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <ProfileCard />
      <div className="grid gap-4">
        <LgpdCard />
        <MfaCard />
        <PrivacyCard accessLine="Cada acesso da equipe a documentos pessoais fica registrado na auditoria." />
        <DpoCard />
      </div>
    </div>
  )
}
