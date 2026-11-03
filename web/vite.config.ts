/// <reference types="vitest/config" />
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// A API Express roda em :4000. No dev o Vite faz proxy de /api para ela, de modo
// que o navegador enxerga uma única origem (sem CORS e com o mesmo comportamento
// de produção, onde o Express serve web/dist).
const API_TARGET = process.env.VITE_API_PROXY ?? 'http://localhost:4000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    // 8080 é a origem que a API já libera no CORS (CORS_ORIGIN), que o `doctor`
    // confere e que o README documenta. `localhost` (não 127.0.0.1) pelo mesmo
    // motivo: a origem precisa bater exatamente com o CORS.
    host: 'localhost',
    port: Number(process.env.WEB_PORT) || 8080,
    strictPort: true,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
        // A API monta as rotas na raiz quando não serve o front e grava o cookie de refresh com Path=/auth.
        // O navegador chama /api/auth/*, então sem esta reescrita o cookie nunca voltaria ao servidor (ADR-0011).
        cookiePathRewrite: { '/auth': '/api/auth' },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
})
