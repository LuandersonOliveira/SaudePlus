import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// O Radix não aceita item com value="": a opção "vazia" usa este valor interno e volta a "" para o formulário.
const NONE = '__none'

interface Props {
  id?: string
  value: string
  onChange: (value: string) => void
  options: [value: string, label: string][]
  /** Texto da opção que limpa o campo (valor ""). */
  emptyLabel: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

/** Select do shadcn com uma opção "vazia" que limpa o campo (como os <select> do legado). */
export function OptionSelect({ id, value, onChange, options, emptyLabel, ...aria }: Props) {
  return (
    <Select value={value === '' ? NONE : value} onValueChange={(v) => onChange(v === NONE ? '' : v)}>
      <SelectTrigger id={id} className="w-full" {...aria}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{emptyLabel}</SelectItem>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
