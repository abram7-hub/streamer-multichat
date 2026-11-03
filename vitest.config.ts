import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': resolve('shared')
    }
  },
  // Komponenty renderera testujemy przez react-dom/server (bez przeglądarki) - JSX jak w buildzie.
  esbuild: {
    jsx: 'automatic'
  },
  test: {
    environment: 'node',
    include: ['electron/**/*.test.ts', 'shared/**/*.test.ts', 'src/**/*.test.tsx']
  }
})
