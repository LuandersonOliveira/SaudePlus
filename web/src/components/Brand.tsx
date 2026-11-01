import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

/** Marca Saúde+ com o "ponto lagoa". */
export function Brand({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn('flex items-center gap-2.5 text-lg font-extrabold text-foreground no-underline', className)}>
      <span
        aria-hidden="true"
        className="size-3.5 flex-none rounded-full bg-[radial-gradient(circle_at_30%_30%,#5fc9b8,var(--primary)_70%)] ring-4 ring-accent"
      />
      Saúde+
    </Link>
  )
}
