/// <reference types="node" />
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { allowedSubTabs, can, canSeeCadastros, capsFor, CAPABILITIES, LEVEL_CAPS } from './capabilities'

describe('capacidades por nível', () => {
  it('superadmin tem tudo; gestor tudo menos "admins"', () => {
    expect([...capsFor('superadmin')].sort()).toEqual([...CAPABILITIES].sort())
    expect(can('gestor', 'users')).toBe(true)
    expect(can('gestor', 'admins')).toBe(false)
  })
  it('atendimento só agenda; alertas só doenças', () => {
    expect(capsFor('atendimento')).toEqual(['appointments'])
    expect(capsFor('alertas')).toEqual(['diseases'])
    expect(can('atendimento', 'audit')).toBe(false)
  })
  it('fail-closed: nível ausente, vazio ou desconhecido não tem nenhuma capacidade', () => {
    for (const lvl of [undefined, null, '', 'root', 'GESTOR']) {
      expect(capsFor(lvl)).toEqual([])
      expect(can(lvl, 'appointments')).toBe(false)
    }
  })
  it('Cadastros e sub-abas seguem as capacidades', () => {
    expect(allowedSubTabs('superadmin')).toEqual(['pessoas', 'rede', 'profissionais', 'doencas'])
    expect(allowedSubTabs('alertas')).toEqual(['doencas'])
    expect(allowedSubTabs('atendimento')).toEqual([])
    expect(canSeeCadastros('atendimento')).toBe(false)
    expect(canSeeCadastros('alertas')).toBe(true)
  })
})

describe('sincronia com o servidor', () => {
  // O mapa do front é uma cópia do servidor; este teste falha se os dois divergirem.
  it('LEVEL_CAPS é idêntico a LEVEL_PERMISSIONS de server/src/middleware/capabilities.js', () => {
    const src = readFileSync(path.resolve(import.meta.dirname, '../../../../server/src/middleware/capabilities.js'), 'utf8')
    const block = /const LEVEL_PERMISSIONS = \{([\s\S]*?)\n\};/.exec(src)?.[1] ?? ''
    const server: Record<string, string[]> = {}
    for (const m of block.matchAll(/(\w+):\s*\[([^\]]*)\]/g)) {
      server[m[1]] = m[2].split(',').map((s) => s.replace(/['"\s]/g, '')).filter(Boolean)
    }
    expect(Object.keys(server).length).toBeGreaterThan(0)
    expect(Object.fromEntries(Object.entries(LEVEL_CAPS).map(([k, v]) => [k, [...v].sort()]))).toEqual(
      Object.fromEntries(Object.entries(server).map(([k, v]) => [k, [...v].sort()])),
    )
  })
})
