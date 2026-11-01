import { QueryError } from '@/components/QueryState'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtSimpleDate } from '@/features/staff/logic'
import { maskProfileValues } from '@/lib/masks'
import { errorMessage } from '@/lib/api'
import { useAdminUser } from '../queries'
import { ROLE_LABEL } from '../logic'

const dash = (v?: string | number | null) => (v === null || v === undefined || v === '' ? '—' : String(v))

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm">{value}</dd>
    </div>
  )
}

function Body({ id }: { id: string }) {
  const q = useAdminUser(id)
  if (q.isPending) return <Skeleton className="h-40" aria-hidden="true" />
  if (q.isError) return <QueryError message={errorMessage(q.error, 'Erro ao carregar o perfil')} onRetry={() => void q.refetch()} />
  const u = q.data
  const docs = maskProfileValues({ cpf: u.cpf ?? '', rg: u.rg ?? '', cns: u.cns ?? '', cep: u.cep ?? '' })
  const address = [u.street, u.address_number, u.neighborhood, u.city, u.state, docs.cep].filter(Boolean).join(', ')
  const birth = u.birth_date ? fmtSimpleDate(u.birth_date) : ''

  return (
    <div className="grid gap-5">
      <section>
        <h3 className="mb-2 font-bold">Identificação e contato</h3>
        <dl className="grid gap-3 sm:grid-cols-2">
          <Item label="Nome" value={dash(u.full_name)} />
          <Item label="E-mail" value={dash(u.email)} />
          <Item label="Papel" value={ROLE_LABEL[u.role] ?? dash(u.role)} />
          <Item label="Status" value={dash(u.account_status)} />
          <Item label="Profissional vinculado" value={dash(u.professional_name)} />
          <Item label="Celular" value={dash(u.mobile)} />
          <Item label="Nascimento" value={dash(birth)} />
          <Item label="Gênero" value={dash(u.gender)} />
          <Item label="Tipo sanguíneo" value={dash(u.blood_type)} />
          <Item label="Cargo" value={dash(u.job_role)} />
          <Item label="Mãe" value={dash(u.mother_name)} />
          <Item label="Pai" value={dash(u.father_name)} />
          <Item label="Prioridade legal" value={dash(u.priority)} />
          <Item label="Responsável (menor)" value={dash(u.guardian_name)} />
        </dl>
      </section>
      <section>
        <h3 className="mb-2 font-bold">Documentos protegidos</h3>
        <p className="mb-2 text-xs text-muted-foreground">A abertura destes dados fica registrada na auditoria.</p>
        <dl className="grid gap-3 sm:grid-cols-3">
          <Item label="CPF" value={dash(docs.cpf)} />
          <Item label="RG" value={dash(docs.rg)} />
          <Item label="CNS (Cartão SUS)" value={dash(docs.cns)} />
        </dl>
      </section>
      <section>
        <h3 className="mb-2 font-bold">Endereço</h3>
        <dl className="grid gap-3">
          <Item label="Endereço" value={dash(address)} />
        </dl>
      </section>
    </div>
  )
}

export function UserViewDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Detalhes do usuário</DialogTitle>
          <DialogDescription>Perfil completo da conta.</DialogDescription>
        </DialogHeader>
        {id && <Body id={id} />}
      </DialogContent>
    </Dialog>
  )
}
