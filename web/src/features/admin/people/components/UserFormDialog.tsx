import { useState } from 'react'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { QueryError } from '@/components/QueryState'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { can } from '../../capabilities'
import {
  buildUserBody,
  canChangeAdminCredentials,
  EMPTY_USER_FORM,
  LEVEL_LABEL,
  linkableProfessionals,
  ROLE_LABEL,
  STATUS_LABEL,
  toUserForm,
} from '../logic'
import { useAdminUser, useProfessionalOptions, useSaveUser } from '../queries'
import { ADMIN_LEVELS, ROLES, STATUSES, type AdminUserDetail, type UserFormValues } from '../types'

function Choice<T extends string>({ id, value, onChange, options, label, disabled }: {
  id: string
  value: T
  onChange: (v: T) => void
  options: readonly T[]
  label: (v: T) => string
  disabled?: boolean
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)} disabled={disabled}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {label(o)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

const NO_PROF = '__none'

function Form({ original, onClose }: { original?: AdminUserDetail; onClose: () => void }) {
  const { session } = useAuth()
  const actorLevel = session?.user.admin_level
  const save = useSaveUser()
  const [v, setV] = useState<UserFormValues>(original ? toUserForm(original) : EMPTY_USER_FORM)
  const [error, setError] = useState<string | null>(null)
  const [fieldErr, setFieldErr] = useState<Partial<Record<keyof UserFormValues, string>>>({})
  const set = <K extends keyof UserFormValues>(k: K, val: UserFormValues[K]) => setV((s) => ({ ...s, [k]: val }))

  const editing = !!original
  const professionals = useProfessionalOptions(v.role === 'atendente')
  const profOptions = linkableProfessionals(professionals.data ?? [], original?.professional_id)

  // Trocar e-mail/senha de um administrador exige a capability 'admins' (só o superadmin).
  const lockedCredentials = editing && original.role === 'admin' && !canChangeAdminCredentials(actorLevel)
  const statusChanged = editing && v.account_status !== original.account_status

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setFieldErr({})
    const errs: Partial<Record<keyof UserFormValues, string>> = {}
    if (v.full_name.trim().length < 2) errs.full_name = 'Informe o nome completo.'
    if (!v.email.trim()) errs.email = 'Informe o e-mail.'
    if (Object.keys(errs).length) return setFieldErr(errs)

    const built = buildUserBody(v, { original, actorLevel })
    if (!built.ok) return built.field ? setFieldErr({ [built.field]: built.error }) : setError(built.error)

    try {
      await save.mutateAsync({ id: original?.id, body: built.body })
      toast.success(editing ? 'Usuário atualizado' : 'Usuário criado')
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Erro ao salvar'))
    }
  }

  return (
    <form onSubmit={submit} noValidate aria-label={editing ? 'Editar usuário' : 'Novo usuário'} className="grid gap-4 sm:grid-cols-2">
      <FormField label="Nome completo *" error={fieldErr.full_name}>
        {(a) => <Input {...a} value={v.full_name} maxLength={150} onChange={(e) => set('full_name', e.target.value)} />}
      </FormField>
      <FormField
        label="E-mail *"
        error={fieldErr.email}
        hint={lockedCredentials ? 'Só o superadmin altera o e-mail de um administrador.' : undefined}
      >
        {(a) => <Input {...a} type="email" value={v.email} disabled={lockedCredentials} onChange={(e) => set('email', e.target.value)} />}
      </FormField>
      <FormField label="Celular">
        {(a) => <Input {...a} inputMode="tel" maxLength={30} value={v.mobile} onChange={(e) => set('mobile', e.target.value)} />}
      </FormField>
      <FormField label="Telefone">
        {(a) => <Input {...a} inputMode="tel" maxLength={30} value={v.phone} onChange={(e) => set('phone', e.target.value)} />}
      </FormField>
      <FormField label="Papel *">
        {(a) => <Choice id={a.id} value={v.role} onChange={(r) => set('role', r)} options={ROLES} label={(r) => ROLE_LABEL[r]} />}
      </FormField>
      <FormField label="Status">
        {(a) => <Choice id={a.id} value={v.account_status} onChange={(s) => set('account_status', s)} options={STATUSES} label={(s) => STATUS_LABEL[s].split(' (')[0]} />}
      </FormField>
      {statusChanged && (
        <FormField label="Motivo da alteração *" error={fieldErr.reason} hint="Obrigatório ao mudar o status. Fica registrado na auditoria." className="sm:col-span-2">
          {(a) => <Input {...a} placeholder="Ex.: solicitação do paciente, cadastro duplicado" value={v.reason} onChange={(e) => set('reason', e.target.value)} />}
        </FormField>
      )}
      <FormField label="Cargo">
        {(a) => <Input {...a} value={v.job_role} onChange={(e) => set('job_role', e.target.value)} />}
      </FormField>
      <FormField
        label={editing ? 'Senha (deixe em branco para não alterar)' : 'Senha *'}
        error={fieldErr.password}
        hint={lockedCredentials ? 'Só o superadmin altera a senha de um administrador.' : undefined}
      >
        {(a) => (
          <Input {...a} type="password" autoComplete="new-password" value={v.password} disabled={lockedCredentials} onChange={(e) => set('password', e.target.value)} />
        )}
      </FormField>
      {v.role === 'admin' && can(actorLevel, 'admins') && (
        <FormField label="Nível administrativo">
          {(a) => <Choice id={a.id} value={v.admin_level} onChange={(l) => set('admin_level', l)} options={ADMIN_LEVELS} label={(l) => LEVEL_LABEL[l]} />}
        </FormField>
      )}
      {v.role === 'atendente' && (
        <FormField
          label={editing && !original.professional_id ? 'Profissional (será criado automaticamente se não vinculado)' : 'Vincular a profissional'}
          className="sm:col-span-2"
        >
          {(a) => (
            <Select value={v.professional_id || NO_PROF} onValueChange={(p) => set('professional_id', p === NO_PROF ? '' : p)}>
              <SelectTrigger id={a.id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROF}>Não vinculado</SelectItem>
                {profOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </FormField>
      )}

      {error && (
        <p role="alert" className="rounded-sm bg-danger-soft p-3 text-sm text-destructive sm:col-span-2">
          {error}
        </p>
      )}
      <DialogFooter className="sm:col-span-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
      </DialogFooter>
    </form>
  )
}

function EditLoader({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useAdminUser(id)
  if (q.isPending) return <Skeleton className="h-48" aria-hidden="true" />
  if (q.isError) return <QueryError message={errorMessage(q.error, 'Erro ao carregar usuário')} onRetry={() => void q.refetch()} />
  return <Form original={q.data} onClose={onClose} />
}

/** `editId` vazio = novo usuário; com id = edição. */
export function UserFormDialog({ open, editId, onClose }: { open: boolean; editId: string | null; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editId ? 'Editar usuário' : 'Novo usuário'}</DialogTitle>
          <DialogDescription>{editId ? 'Altere os dados cadastrais e o status da conta.' : 'Crie uma conta para paciente, atendente ou administrador.'}</DialogDescription>
        </DialogHeader>
        {open && (editId ? <EditLoader key={editId} id={editId} onClose={onClose} /> : <Form onClose={onClose} />)}
      </DialogContent>
    </Dialog>
  )
}
