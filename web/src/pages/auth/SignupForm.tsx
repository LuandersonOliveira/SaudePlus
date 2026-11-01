import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { errorMessage, signup } from '@/lib/api'
import { maskCpf, maskPhone } from '@/lib/masks'
import { passwordStrength } from '@/lib/password'
import { ageFromDate, SIGNUP_STEP1_FIELDS, signupSchema, type SignupInput } from '@/lib/validators'

const STRENGTH_COLOR = { weak: 'bg-destructive', medium: 'bg-warning', strong: 'bg-success' } as const

export function SignupForm({ onDone }: { onDone: (email: string) => void }) {
  const [step, setStep] = useState<1 | 2>(1)
  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      full_name: '', birth_date: '', cpf: '', mobile: '', guardian_name: '', email: '', password: '', confirm: '',
    },
  })
  const { register, handleSubmit, watch, trigger, setFocus, formState: { errors, isSubmitting } } = form

  const age = ageFromDate(watch('birth_date'))
  const isMinor = age !== null && age >= 0 && age < 18
  const strength = passwordStrength(watch('password'))

  async function next() {
    const fields = isMinor ? SIGNUP_STEP1_FIELDS : SIGNUP_STEP1_FIELDS.filter((f) => f !== 'guardian_name')
    if (await trigger(fields)) {
      setStep(2)
      return
    }
    const first = fields.find((f) => form.getFieldState(f).error)
    if (first) setFocus(first)
  }

  async function submit(v: SignupInput) {
    try {
      const res = await signup({
        role: 'paciente',
        email: v.email,
        password: v.password,
        full_name: v.full_name,
        birth_date: v.birth_date || null,
        cpf: v.cpf || null,
        guardian_name: isMinor ? v.guardian_name?.trim() || null : null,
        mobile: v.mobile || null,
        job_role: null,
      })
      toast.success(res?.message || 'Conta criada! Você já pode entrar.')
      onDone(v.email)
    } catch (e) {
      toast.error(errorMessage(e, 'Erro ao criar conta'))
    }
  }

  // Enter no passo 1 avança em vez de enviar (o passo 2 ainda nem existe).
  const onSubmit = step === 1 ? (e: React.FormEvent) => { e.preventDefault(); void next() } : handleSubmit(submit)

  return (
    <form onSubmit={onSubmit} noValidate aria-label="Criar conta" className="grid gap-4">
      <ol className="flex gap-2 text-xs font-bold" aria-label={`Etapa ${step} de 2`} aria-live="polite">
        {['Você', 'Acesso'].map((nome, i) => (
          <li
            key={nome}
            aria-current={step === i + 1 ? 'step' : undefined}
            className={`flex-1 rounded-sm border-b-4 pb-1 text-center ${
              step > i + 1 ? 'border-success text-success' : step === i + 1 ? 'border-primary text-foreground' : 'border-border text-muted-foreground'
            }`}
          >
            {i + 1}. {nome}
          </li>
        ))}
      </ol>

      {step === 1 ? (
        <div className="grid items-start gap-4 sm:grid-cols-2">
          <FormField label="Nome completo *" error={errors.full_name?.message} className="sm:col-span-2">
            {(a) => <Input {...a} autoComplete="name" {...register('full_name')} />}
          </FormField>
          <FormField label="Data de nascimento *" error={errors.birth_date?.message}>
            {(a) => <Input {...a} type="date" {...register('birth_date')} />}
          </FormField>
          <FormField
            label="CPF *"
            error={errors.cpf?.message}
            hint="Usado para garantir que seus agendamentos fiquem vinculados unicamente a você."
          >
            {(a) => (
              <Input
                {...a}
                inputMode="numeric"
                placeholder="000.000.000-00"
                maxLength={14}
                {...register('cpf', { onChange: (e) => (e.target.value = maskCpf(e.target.value)) })}
              />
            )}
          </FormField>
          <FormField
            label="Celular *"
            error={errors.mobile?.message}
            hint="Usado para avisar caso sua consulta precise ser reagendada."
            className="sm:col-span-2"
          >
            {(a) => (
              <Input
                {...a}
                inputMode="tel"
                autoComplete="tel"
                placeholder="(00) 90000-0000"
                maxLength={16}
                {...register('mobile', { onChange: (e) => (e.target.value = maskPhone(e.target.value, true)) })}
              />
            )}
          </FormField>
          {isMinor && (
            <FormField
              label="Nome do responsável legal / acompanhante *"
              error={errors.guardian_name?.message}
              hint="Menores de 18 anos não comparecem a consultas nem assinam termos de saúde desacompanhados."
              className="sm:col-span-2"
            >
              {(a) => <Input {...a} maxLength={150} {...register('guardian_name')} />}
            </FormField>
          )}
          <Button type="button" className="sm:col-span-2" onClick={next}>
            Continuar
          </Button>
        </div>
      ) : (
        <div className="grid gap-4">
          <FormField label="E-mail *" error={errors.email?.message}>
            {(a) => <Input {...a} type="email" autoComplete="email" {...register('email')} />}
          </FormField>
          <FormField
            label={<>Senha * <span className="font-normal text-muted-foreground">— mínimo 6 caracteres</span></>}
            error={errors.password?.message}
            hint="Sua senha é criptografada e ninguém da equipe tem acesso a ela."
          >
            {(a) => (
              <>
                <Input {...a} type="password" autoComplete="new-password" {...register('password')} />
                <div className="h-1.5 overflow-hidden rounded-full bg-border" aria-hidden>
                  <div
                    className={`h-full transition-all ${strength.level ? STRENGTH_COLOR[strength.level] : ''}`}
                    style={{ width: `${strength.percent}%` }}
                  />
                </div>
                <p className="min-h-4 text-xs text-muted-foreground" aria-live="polite">
                  {strength.label}
                </p>
              </>
            )}
          </FormField>
          <FormField label="Confirmar senha *" error={errors.confirm?.message}>
            {(a) => <Input {...a} type="password" autoComplete="new-password" {...register('confirm')} />}
          </FormField>
          <div className="flex gap-3">
            <Button type="button" variant="outline" onClick={() => setStep(1)}>
              Voltar
            </Button>
            <Button type="submit" className="flex-1" disabled={isSubmitting}>
              {isSubmitting ? 'Criando…' : 'Criar conta'}
            </Button>
          </div>
        </div>
      )}
    </form>
  )
}
