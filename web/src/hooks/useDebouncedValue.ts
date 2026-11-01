import { useEffect, useState } from 'react'

/** Devolve `value` só depois de `delay` ms sem mudar (evita uma requisição por tecla). */
export function useDebouncedValue<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}
