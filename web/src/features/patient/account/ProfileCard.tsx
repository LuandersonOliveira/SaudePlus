import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { OptionSelect } from '@/components/OptionSelect'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { useMe } from '@/features/staff/queries'
import { api, errorMessage } from '@/lib/api'
import { maskCep, maskCns, maskCpf, maskPhone, maskProfileValues, maskRg } from '@/lib/masks'
import { ageFromDate, patientProfileSchema, type PatientProfileInput } from '@/lib/validators'
import { lookupCep } from '@/lib/viacep'
import { QueryError } from '@/components/QueryState'
import { BLOOD_TYPES, buildProfileBody, GENDERS, patientCompleteness, PRIORITIES, RACES, toPatientForm, ZONES } from './logic'

export const EMPTY_PROFILE: PatientProfileInput = {
  full_name: '', social_name: '', birth_date: '', gender: '', mother_name: '', father_name: '', guardian_name: '',
  cpf: '', rg: '', cns: '', mobile: '', phone: '', blood_type: '', priority: '', race: '',
  cep: '', address_number: '', street: '', neighborhood: '', city: '', state: '', zone: '', reference_point: '',
}

export function ProfileCard() {
  const qc = useQueryClient()
  const me = useMe()
  const form = useForm<PatientProfileInput>({ resolver: zodResolver(patientProfileSchema), defaultValues: EMPTY_PROFILE })
  const { register, handleSubmit, reset, setValue, control, watch, formState: { errors, isSubmitting } } = form

  useEffect(() => {
    if (me.data) reset(maskProfileValues(toPatientForm(me.data, EMPTY_PROFILE)))
  }, [me.data, reset])

  const pct = patientCompleteness(me.data)
  const age = ageFromDate(watch('birth_date'))
  const isMinor = age !== null && age >= 0 && age < 18

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

  async function onSubmit(v: PatientProfileInput) {
    try {
      await api.put('/auth/me', buildProfileBody(v))
      toast.success('Perfil salvo')
      await qc.invalidateQueries({ queryKey: ['me'] })
    } catch (e) {
      toast.error(errorMessage(e, 'Erro ao salvar perfil'))
    }
  }

  if (me.isPending) return <Skeleton className="h-96" aria-hidden="true" />
  if (me.isError) return <QueryError message={errorMessage(me.error, 'Erro ao carregar seus dados')} onRetry={() => void me.refetch()} />

  const e = errors
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">Complete seu perfil</CardTitle>
        <CardDescription>
          Quanto mais completo, melhor o atendimento — e alguns dados (como o CNS) ligam seu histórico ao SUS.
        </CardDescription>
        <div className="flex items-center gap-3 pt-2">
          <Progress value={pct} aria-label="Progresso do preenchimento do perfil" />
          <strong>{pct}%</strong>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} noValidate aria-label="Meu perfil" className="grid gap-4">
          <h3 className="font-bold">Identificação</h3>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <FormField label="Nome completo *" error={e.full_name?.message} className="sm:col-span-2">
              {(a) => <Input {...a} autoComplete="name" {...register('full_name')} />}
            </FormField>
            <FormField label={<>Nome social <span className="font-normal text-muted-foreground">(opcional)</span></>} className="sm:col-span-2">
              {(a) => <Input {...a} maxLength={150} {...register('social_name')} />}
            </FormField>
            <FormField label="Data de nascimento *" error={e.birth_date?.message}>
              {(a) => <Input {...a} type="date" {...register('birth_date')} />}
            </FormField>
            <FormField label="Gênero">
              {(a) => (
                <Controller control={control} name="gender" render={({ field }) => <OptionSelect {...a} value={field.value} onChange={field.onChange} options={GENDERS} emptyLabel="Selecione..." />} />
              )}
            </FormField>
            <FormField label="Nome da mãe">{(a) => <Input {...a} {...register('mother_name')} />}</FormField>
            <FormField label={<>Nome do pai <span className="font-normal text-muted-foreground">(opcional)</span></>}>
              {(a) => <Input {...a} {...register('father_name')} />}
            </FormField>
            {isMinor && (
              <FormField label="Responsável legal *" error={e.guardian_name?.message} className="sm:col-span-2">
                {(a) => <Input {...a} maxLength={150} {...register('guardian_name')} />}
              </FormField>
            )}
          </div>

          <h3 className="mt-2 font-bold">Documentos</h3>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <FormField label="CPF *" error={e.cpf?.message}>
              {(a) => (
                <Input {...a} inputMode="numeric" placeholder="000.000.000-00" maxLength={14}
                  {...register('cpf', { onChange: (ev) => (ev.target.value = maskCpf(ev.target.value)) })} />
              )}
            </FormField>
            <FormField label="RG">
              {(a) => (
                <Input {...a} placeholder="00.000.000-0" maxLength={12}
                  {...register('rg', { onChange: (ev) => (ev.target.value = maskRg(ev.target.value)) })} />
              )}
            </FormField>
            <FormField label="Cartão SUS (CNS)" error={e.cns?.message} hint="Liga seu histórico ao SUS. Opcional se não tiver em mãos." className="sm:col-span-2">
              {(a) => (
                <Input {...a} inputMode="numeric" placeholder="000 0000 0000 0000" maxLength={18}
                  {...register('cns', { onChange: (ev) => (ev.target.value = maskCns(ev.target.value)) })} />
              )}
            </FormField>
          </div>

          <h3 className="mt-2 font-bold">Contato e saúde</h3>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <FormField label="Celular *" error={e.mobile?.message}>
              {(a) => (
                <Input {...a} inputMode="tel" placeholder="(00) 90000-0000" maxLength={16}
                  {...register('mobile', { onChange: (ev) => (ev.target.value = maskPhone(ev.target.value, true)) })} />
              )}
            </FormField>
            <FormField label={<>Telefone fixo <span className="font-normal text-muted-foreground">(opcional)</span></>}>
              {(a) => (
                <Input {...a} placeholder="(00) 0000-0000" maxLength={15}
                  {...register('phone', { onChange: (ev) => (ev.target.value = maskPhone(ev.target.value, false)) })} />
              )}
            </FormField>
            <FormField label="Tipo sanguíneo">
              {(a) => (
                <Controller control={control} name="blood_type" render={({ field }) => <OptionSelect {...a} value={field.value} onChange={field.onChange} options={BLOOD_TYPES} emptyLabel="Não sei / Prefiro não informar" />} />
              )}
            </FormField>
            <FormField label="Prioridade legal">
              {(a) => (
                <Controller control={control} name="priority" render={({ field }) => <OptionSelect {...a} value={field.value} onChange={field.onChange} options={PRIORITIES} emptyLabel="Selecione..." />} />
              )}
            </FormField>
            <FormField label="Cor ou raça (autodeclaração)" className="sm:col-span-2">
              {(a) => (
                <Controller control={control} name="race" render={({ field }) => <OptionSelect {...a} value={field.value} onChange={field.onChange} options={RACES} emptyLabel="Prefiro não responder" />} />
              )}
            </FormField>
          </div>

          <h3 className="mt-2 font-bold">Endereço</h3>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <FormField label="CEP" error={e.cep?.message}>
              {(a) => (
                <Input {...a} placeholder="00000-000" maxLength={9}
                  {...register('cep', { onChange: (ev) => (ev.target.value = maskCep(ev.target.value)), onBlur: (ev) => void onCepBlur(ev.target.value) })} />
              )}
            </FormField>
            <FormField label="Número">{(a) => <Input {...a} placeholder="413" {...register('address_number')} />}</FormField>
            <FormField label="Rua / Logradouro" className="sm:col-span-2">
              {(a) => <Input {...a} placeholder="Preenchido pelo CEP (editável)" {...register('street')} />}
            </FormField>
            <FormField label="Bairro">{(a) => <Input {...a} {...register('neighborhood')} />}</FormField>
            <FormField label="Cidade">{(a) => <Input {...a} {...register('city')} />}</FormField>
            <FormField label="UF">
              {(a) => (
                <Input {...a} maxLength={2} placeholder="UF" className="uppercase"
                  {...register('state', { onChange: (ev) => (ev.target.value = ev.target.value.toUpperCase().replace(/[^A-Z]/g, '')) })} />
              )}
            </FormField>
            <FormField label="Zona">
              {(a) => (
                <Controller control={control} name="zone" render={({ field }) => <OptionSelect {...a} value={field.value} onChange={field.onChange} options={ZONES} emptyLabel="Selecione..." />} />
              )}
            </FormField>
            <FormField label="Ponto de referência" className="sm:col-span-2">
              {(a) => <Input {...a} placeholder="Ex: Próximo à Igreja São José..." {...register('reference_point')} />}
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
