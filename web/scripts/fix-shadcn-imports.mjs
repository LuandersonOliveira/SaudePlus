// Rode depois de `npx shadcn add ...`.
//
// O CLI atual gera `import { cn } from "cn"` (um pacote npm de terceiros) e o
// adiciona às dependências. Aqui o helper é o `src/lib/utils` (clsx + tailwind-merge),
// então reescrevemos os imports e removemos o pacote.
import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = new URL('../src/components/ui/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
let changed = 0
for (const f of readdirSync(dir).filter((n) => n.endsWith('.tsx'))) {
  const p = join(dir, f)
  const src = readFileSync(p, 'utf8')
  const out = src.replaceAll('from "cn"', 'from "@/lib/utils"')
  if (out !== src) {
    writeFileSync(p, out)
    changed++
  }
}

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
if (pkg.dependencies?.cn) execSync('npm uninstall cn', { stdio: 'inherit' })
console.log(`fix-shadcn-imports: ${changed} arquivo(s) ajustado(s).`)
