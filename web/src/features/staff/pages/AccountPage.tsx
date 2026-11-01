import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { api, errorMessage } from '@/lib/api'
import { maskCep, maskCns, maskCpf, maskPhone, maskProfileValues, maskRg } from '@/lib/masks'
import { profileSchema, type ProfileInput } from '@/lib/validators'
import { lookupCep } from '@/lib/viacep'
import { DpoCard } from '@/components/account/DpoCard'
import { LgpdCard } from '@/components/account/LgpdCard'
import { PrivacyCard } from '@/components/account/PrivacyCard'
import { formatJobRole, profileCompleteness } from '../logic'
import { useMe } from '../queries'
import type { MeUser } from '../types'

const EMPTY: ProfileInput = {
  full_name: '', social_name: '', birth_date: '', gender: '', cpf: '', rg: '', cns: '', mobile: '', phone: '',
  cep: '', address_number: '', street: '', neighborhood: '', city: '', state: '',
}

const FIELD_KEYS = Object.keys(EMPTY) as (keyof ProfileInput)[]

function toForm(user: MeUser): ProfileInput {
  return Object.fromEntries(FIELD_KEYS.map((k) => [k, String(user[k] ?? '')])) as ProfileInput
}

const GENDERS: [string, string][] = [
  ['masculino', 'Masculino'],
  ['feminino', 'Feminino'],
  ['outro', 'Outro'],
  ['prefiro_nao_informar', 'Prefiro não informar'],
]

/** Perfil do usuário da equipe. `showJobRole=false` esconde o cargo (administradores não têm cargo). */
export function ProfileCard({ showJobRole = true }: { showJobRole?: boolean } = {}) {
  const qc = useQueryClient()
  const me = useMe()
  const form = useForm<ProfileInput>({ resolver: zodResolver(profileSchema), defaultValues: EMPTY })
  const { register, handleSubmit, reset, setValue, control, formState: { errors, isSubmitting } } = form

  useEffect(() => {
    if (me.data) reset(maskProfileValues(toForm(me.data)))
  }, [me.data, reset])

  const pct = profileCompleteness(me.data)

  async function onCepBlur(cep: string) {
    try {
      const addr = await lookupCep(cep)
      if (addr === null && cep.replace(/\D/g, '').length === 8) return void toast.error('CEP não encontrado.')
      if (!addr) return
      setValue('street', addr.street)
      setValue('neighborhood', addr.neighborhood)
      setValue('city', addr.city)
      setValue('state', addr.state.toUpperCase())
    } catch {
      /* sem internet — a pessoa preenche manualmente */
    }
  }

  async function onSubmit(v: ProfileInput) {
    try {
      // PUT /auth/me é parcial: '' limpa o campo, undefined mantém. CPF/RG/CNS são a
      // exceção: o formulário não os recebe preenchidos, então vazio = "não mexa".
      await api.put('/auth/me', {
        ...v,
        full_name: v.full_name.trim(),
        cpf: v.cpf.trim() || undefined,
        rg: v.rg.trim() || undefined,
        cns: v.cns.trim() || undefined,
      })
      toast.success('Perfil atualizado')
      await qc.invalidateQueries({ queryKey: ['me'] })
    } catch (e) {
      toast.error(errorMessage(e, 'Erro ao salvar'))
    }
  }

  if (me.isPending) return <Skeleton className="h-96" aria-hidden="true" />
  if (me.error) return <p role="alert" className="text-sm text-destructive">{errorMessage(me.error, 'Erro ao carregar seus dados')}</p>

  const e = errors
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">Meu perfil</CardTitle>
        <CardDescription>Seus dados de cadastro como profissional. O cargo só pode ser alterado pelo administrador.</CardDescription>
        <div className="flex items-center gap-3 pt-2">
          <Progress value={pct} aria-label="Perfil completo" />
          <strong>{pct}%</strong>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate aria-label="Meu perfil" className="grid gap-4">
          <h3 className="font-bold">Identificação</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nome completo *" error={e.full_name?.message} className="sm:col-span-2">
              {(a) => <Input {...a} autoComplete="name" {...register('full_name')} />}
            </FormField>
            <FormField label={<>Nome social <span className="font-normal text-muted-foreground">(opcional)</span></>} error={e.social_name?.message} className="sm:col-span-2">
              {(a) => <Input {...a} maxLength={150} {...register('social_name')} />}
            </FormField>
            <FormField label="Data de nascimento" error={e.birth_date?.message}>
              {(a) => <Input {...a} type="date" {...register('birth_date')} />}
            </FormField>
            <FormField label="Gênero" error={e.gender?.message}>
              {(a) => (
                <Controller
                  control={control}
                  name="gender"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger {...a} className="w-full">
                        <SelectValue placeholder="Selecione..." />
                      </SelectTrigger>
                      <SelectContent>
                        {GENDERS.map(([v, l]) => (
                          <SelectItem key={v} value={v}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              )}
            </FormField>
            {showJobRole && (
              <FormField label="Cargo / Função" hint="O cargo é definido pelo administrador." className="sm:col-span-2">
                {(a) => <Input {...a} disabled value={formatJobRole(me.data?.job_role)} readOnly />}
              </FormField>
            )}
          </div>

          <h3 className="mt-2 font-bold">Documentos</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="CPF" error={e.cpf?.message}>
              {(a) => (
                <Input {...a} inputMode="numeric" placeholder="000.000.000-00" maxLength={14}
                  {...register('cpf', { onChange: (ev) => (ev.target.value = maskCpf(ev.target.value)) })} />
              )}
            </FormField>
            <FormField label="RG" error={e.rg?.message}>
              {(a) => (
                <Input {...a} placeholder="00.000.000-0" maxLength={12}
                  {...register('rg', { onChange: (ev) => (ev.target.value = maskRg(ev.target.value)) })} />
              )}
            </FormField>
            <FormField label="Cartão SUS (CNS)" error={e.cns?.message}>
              {(a) => (
                <Input {...a} inputMode="numeric" placeholder="15 dígitos" maxLength={18}
                  {...register('cns', { onChange: (ev) => (ev.target.value = maskCns(ev.target.value)) })} />
              )}
            </FormField>
          </div>

          <h3 className="mt-2 font-bold">Contato e endereço</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Celular *" error={e.mobile?.message}>
              {(a) => (
                <Input {...a} inputMode="tel" placeholder="(00) 90000-0000" maxLength={16}
                  {...register('mobile', { onChange: (ev) => (ev.target.value = maskPhone(ev.target.value, true)) })} />
              )}
            </FormField>
            <FormField label={<>Telefone fixo <span className="font-normal text-muted-foreground">(opcional)</span></>} error={e.phone?.message}>
              {(a) => (
                <Input {...a} placeholder="(00) 0000-0000" maxLength={15}
                  {...register('phone', { onChange: (ev) => (ev.target.value = maskPhone(ev.target.value, false)) })} />
              )}
            </FormField>
            <FormField label="CEP" error={e.cep?.message}>
              {(a) => (
                <Input {...a} placeholder="00000-000" maxLength={9}
                  {...register('cep', {
                    onChange: (ev) => (ev.target.value = maskCep(ev.target.value)),
                    onBlur: (ev) => void onCepBlur(ev.target.value),
                  })} />
              )}
            </FormField>
            <FormField label="Número" error={e.address_number?.message}>
              {(a) => <Input {...a} placeholder="413" {...register('address_number')} />}
            </FormField>
            <FormField label="Rua / Logradouro" className="sm:col-span-2">
              {(a) => <Input {...a} placeholder="Preenchido pelo CEP (editável)" {...register('street')} />}
            </FormField>
            <FormField label="Bairro">{(a) => <Input {...a} {...register('neighborhood')} />}</FormField>
            <FormField label="Cidade">{(a) => <Input {...a} {...register('city')} />}</FormField>
            <FormField label="UF" error={e.state?.message}>
              {(a) => (
                <Input {...a} maxLength={2} placeholder="UF" className="uppercase"
                  {...register('state', { onChange: (ev) => (ev.target.value = ev.target.value.toUpperCase().replace(/[^A-Z]/g, '')) })} />
              )}
            </FormField>
          </div>

          <div>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Salvando…' : 'Salvar perfil'}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

export function AccountPage() {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <ProfileCard />
      <div className="grid gap-4">
        <LgpdCard />
        <PrivacyCard accessLine="Cada acesso seu a documentos de pacientes fica registrado na auditoria." />
        <DpoCard />
      </div>
    </div>
  )
}