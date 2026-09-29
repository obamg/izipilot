import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // `exclude` remplace la liste par défaut de vitest : sans `**/node_modules/**`
    // le scan descend dans mobile/node_modules et fait échouer `npm test` sur les
    // suites de dépendances tierces. `.next/**` écarte les copies du build.
    // `.claude/**` écarte les autres worktrees dont les tests ne doivent pas s'exécuter ici.
    exclude: ['**/node_modules/**', '.next/**', 'tests/e2e/**', 'mcp-server/**', '.claude/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})
