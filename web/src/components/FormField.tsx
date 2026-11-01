import { useId, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'

interface FormFieldProps {
  label: ReactNode
  error?: string
  hint?: ReactNode
  className?: string
  /** Recebe os atributos de acessibilidade que ligam rótulo, dica e erro ao controle. */
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby'?: string }) => ReactNode
}

/** Rótulo + controle + dica + erro, com ids ligados para leitor de tela. */
export function FormField({ label, error, hint, className, children }: FormFieldProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined

  return (
    // minmax(0,1fr): sem isto a coluna implícita cresce com o conteúdo (um select com texto longo estoura
    // a coluna do grid pai e encosta no vizinho).
    <div className={`grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2 ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describedBy })}
      {hint && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
