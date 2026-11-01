/**
 * Permissões por nível administrativo. ESPELHA server/src/middleware/capabilities.js — o servidor é a
 * autoridade (devolve 403); aqui só decidimos o que mostrar. Fail-closed: nível ausente ou desconhecido
 * não vira gestor.
 */
export const CAPABILITIES = ['users', 'appointments', 'diseases', 'units', 'audit', 'reports', 'admins'] as const
export type Capability = (typeof CAPABILITIES)[number]

export const LEVEL_CAPS: Record<string, readonly Capability[]> = {
  superadmin: ['users', 'appointments', 'diseases', 'units', 'audit', 'reports', 'admins'],
  gestor: ['users', 'appointments', 'diseases', 'units', 'audit', 'reports'],
  atendimento: ['appointments'],
  alertas: ['diseases'],
}

export const capsFor = (level?: string | null): readonly Capability[] => (level && LEVEL_CAPS[level]) || []

export const can = (level: string | null | undefined, cap: Capability) => capsFor(level).includes(cap)

/** Cadastros aparece se houver ao menos uma sub-aba permitida. */
export const canSeeCadastros = (level?: string | null) => can(level, 'users') || can(level, 'units') || can(level, 'diseases')

export type SubTab = 'pessoas' | 'rede' | 'doencas'

/** Sub-abas de Cadastros que o nível enxerga, na ordem de exibição. */
export function allowedSubTabs(level?: string | null): SubTab[] {
  const out: SubTab[] = []
  if (can(level, 'users')) out.push('pessoas')
  if (can(level, 'units')) out.push('rede')
  if (can(level, 'diseases')) out.push('doencas')
  return out
}
