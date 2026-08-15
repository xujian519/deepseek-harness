import { defineConfig } from 'vitest/config'

// The desktop shell has its own Vitest config so `pnpm --filter
// @deepseek-ai/dsh-desktop run test` does not inherit the repo-root config,
// whose cwd-relative include would miss this package's tests.
export default defineConfig({
  test: {
    include: ['tests/**/*.spec.ts'],
  },
})
