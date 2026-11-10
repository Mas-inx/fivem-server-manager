import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': fileURLToPath(new URL('./src/shared', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    // The end-to-end sync test moves gigabytes; it runs on its own with npm run test:e2e.
    exclude: ['tests/e2e/**', 'node_modules/**'],
    environment: 'node'
  }
})
