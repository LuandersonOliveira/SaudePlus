import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState, ListSkeleton, QueryError } from '@/components/QueryState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { errorMessage } from '@/lib/api'
import { fmtDate } from '@/lib/validators'
import { actorLabel, PAGE_SIZES, parsePageSize } from '../logic'
import { useAuditLog, useVerifyAudit } from '../queries'
import type { AuditFilters } from '../types'

function ChainStatus({ verify }: { verify: ReturnType<typeof useVerifyAudit> }) {
  if (verify.isPending) return <span>Verificando…</span>
  if (verify.isError) return <span>Erro: {errorMessage(verify.error, 'não foi possível verificar')}</span>
  const r = verify.data
  if (!r) return null
  return r.ok ? (
    <span>
      <Badge className="border-transparent bg-success-soft text-success">ÍNTEGRA</Badge> {r.checked} linha(s) verificadas. Cabeça:{' '}
      <code className="rounded-xs bg-muted px-1">{(r.head || '').slice(0, 16)}…</code>
    </span>
  ) : (
    <span>
      <Badge className="border-transparent bg-danger-soft text-destructive">VIOLADA</Badge> Falha na linha{' '}
      <code className="rounded-xs bg-muted px-1">{String(r.firstBad ?? '?')}</code>: {r.reason || ''}
    </span>
  )
}

export function AuditPage() {
  // Os filtros vivem na URL: recarregar mantém o lugar e o Voltar funciona. Digitar não grava (só ao filtrar).
  const [params, setParams] = useSearchParams()
  const filters: AuditFilters = {
    entityType: params.get('entityType') ?? '',
    action: params.get('action') ?? '',
    pageSize: parsePageSize(params.get('pageSize')),
  }
  const [entityType, setEntityType] = useState(filters.entityType)
  const [action, setAction] = useState(filters.action)

  const log = useAuditLog(filters)
  const verify = useVerifyAudit()

  const apply = (next: Partial<AuditFilters>) => {
    const merged = { ...filters, ...next }
    const p = new URLSearchParams()
    if (merged.entityType.trim()) p.set('entityType', merged.entityType.trim())
    if (merged.action.trim()) p.set('action', merged.action.trim())
    if (merged.pageSize !== 50) p.set('pageSize', String(merged.pageSize))
    setParams(p, { replace: true })
  }

  const rows = log.data?.pages.flatMap((p) => p.rows) ?? []
  const total = log.data?.pages.at(-1)?.total ?? 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl font-extrabold">Ações administrativas recentes</CardTitle>
        <CardDescription>Quem fez o quê e quando — confirmações, cancelamentos e gestão de alertas.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <form
          aria-label="Filtrar auditoria"
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            apply({ entityType, action })
          }}
        >
          <div className="grid min-w-40 flex-1 gap-1.5">
            <Label htmlFor="audit-entity" className="sr-only">
              Tipo da entidade
            </Label>
            <Input id="audit-entity" placeholder="Tipo da entidade…" autoComplete="off" spellCheck={false} value={entityType} onChange={(e) => setEntityType(e.target.value)} />
          </div>
          <div className="grid min-w-40 flex-1 gap-1.5">
            <Label htmlFor="audit-action" className="sr-only">
              Ação
            </Label>
            <Input id="audit-action" placeholder="Ação…" autoComplete="off" spellCheck={false} value={action} onChange={(e) => setAction(e.target.value)} />
          </div>
          <Button type="submit" variant="outline">
            Filtrar
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setEntityType('')
              setAction('')
              apply({ entityType: '', action: '' })
            }}
          >
            Limpar
          </Button>
          <Button type="button" variant="outline" disabled={verify.isPending} onClick={() => verify.mutate()}>
            Verificar integridade
          </Button>
          <div className="grid gap-1.5">
            <Label htmlFor="audit-size" className="sr-only">
              Quantas ações por página
            </Label>
            <Select value={String(filters.pageSize)} onValueChange={(v) => apply({ pageSize: Number(v) })}>
              <SelectTrigger id="audit-size" aria-label="Quantas ações por página" className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n} por página
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </form>

        <div role="status" aria-live="polite" className="min-h-5 text-sm text-muted-foreground">
          <ChainStatus verify={verify} />
        </div>

        <div aria-busy={log.isFetching}>
          {log.isPending ? (
            <ListSkeleton />
          ) : log.isError ? (
            <QueryError message={errorMessage(log.error, 'Não foi possível carregar a auditoria.')} onRetry={() => void log.refetch()} />
          ) : rows.length === 0 ? (
            <EmptyState>Nenhuma ação registrada ainda.</EmptyState>
          ) : (
            <>
              <ul>
                {rows.map((r, i) => (
                  <li key={r.id ?? i} className="flex flex-wrap items-start justify-between gap-3 border-b py-3 last:border-b-0">
                    <div className="min-w-0">
                      <p className="font-bold">
                        {actorLabel(r)} <Badge variant="secondary">{r.action}</Badge>
                      </p>
                      {/* O texto mais longo da linha (ator, ação, detalhes) precisa quebrar, ou a página estoura no celular. */}
                      <p className="break-words text-sm text-muted-foreground">
                        {r.entity_type} · {r.details || ''}
                      </p>
                    </div>
                    <span className="text-sm text-muted-foreground">{fmtDate(r.created_at)}</span>
                  </li>
                ))}
              </ul>
              {log.hasNextPage ? (
                <div className="pt-3">
                  <Button variant="outline" size="sm" disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()} aria-label={`Carregar mais ${total - rows.length} ações de auditoria`}>
                    {log.isFetchingNextPage ? 'Carregando…' : `Carregar mais (${rows.length} de ${total})`}
                  </Button>
                </div>
              ) : (
                <p className="pt-3 text-sm text-muted-foreground">{total} ação(ões) no total.</p>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
