/** Mostrado enquanto a sessão é recuperada pelo cookie (access token só existe em memória, ADR-0011). */
export function SessionLoading() {
  return (
    <div role="status" aria-busy="true" className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Recuperando sua sessão…
    </div>
  )
}