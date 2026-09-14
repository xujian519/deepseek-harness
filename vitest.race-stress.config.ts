import tsconfigPaths from 'vite-tsconfig-paths'
import { defineConfig } from 'vitest/config'
import { standardDecoratorPlugin, vitestExecArgv } from './vitest.shared.ts'

/**
 * Race-stress configuration: repeat a focused, scheduling-sensitive subset of
 * the suite in random order. Any failure is treated as a race bug, not a retry.
 *
 * This config intentionally does not inherit vitest.config.ts's project split:
 * every selected file runs in its own forked worker, which is sufficient
 * isolation for the chosen suites. Coverage is disabled because repeats would
 * distort the per-file gate and the purpose is finding flakes, not measuring
 * coverage.
 */

const pathsPlugin = (): ReturnType<typeof tsconfigPaths> =>
  tsconfigPaths({ projects: ['./tsconfig.base.json'] })

/** Suites where scheduling, lifecycle, or teardown races are most likely. */
const RACE_STRESS_INCLUDES = [
  'packages/core/agent-loop/tests/**/*.spec.ts',
  'packages/core/session/tests/**/*.spec.ts',
  'packages/acp/acp/tests/**/*.spec.ts',
  'packages/subagent/subagent-acp/tests/**/*.spec.ts',
  'packages/subprocess/subprocess-local/tests/**/*.spec.ts',
  'packages/subprocess/subprocess/tests/**/*.spec.ts',
]

// Replicate the platform exclusions from vitest.config.ts so the stress job
// does not try to run POSIX-only subprocess suites on Windows.
const windowsUnsupportedTests = process.platform === 'win32'
  ? [
      'packages/subprocess/subprocess-local/tests/linux-execve.spec.ts',
      'packages/subprocess/subprocess-local/tests/linux-scope.spec.ts',
      'packages/subprocess/subprocess-local/tests/native-containment.spec.ts',
      'packages/subprocess/subprocess-local/tests/native-windows.spec.ts',
      'packages/subprocess/subprocess-local/tests/process-exit.spec.ts',
      'packages/subprocess/subprocess-local/tests/process-inspector.spec.ts',
      'packages/subprocess/subprocess-local/tests/spawn.spec.ts',
      'packages/subprocess/subprocess-local/tests/terminal.spec.ts',
      'packages/subprocess/subprocess-local/tests/windows-inspector.spec.ts',
      'packages/subprocess/subprocess-local/tests/windows-job.spec.ts',
    ]
  : []

export default defineConfig({
  plugins: [pathsPlugin(), standardDecoratorPlugin()],
  test: {
    name: 'race-stress',
    execArgv: vitestExecArgv,
    pool: 'forks',
    setupFiles: ['./scripts/test-proxy-environment.ts', './scripts/test-invariants.ts'],
    include: RACE_STRESS_INCLUDES,
    exclude: windowsUnsupportedTests,
    // The custom runner injects repeats into every collected test because
    // Vitest 4 exposes repeats as a per-test option, not a global config.
    runner: './scripts/vitest-race-stress-runner.ts',
    // Randomize both file and test order so accidental ordering dependencies
    // surface as failures.
    sequence: {
      shuffle: true,
    },
    // No retry: a flake under this job is a bug to fix, not noise to swallow.
    retry: 0,
    coverage: {
      enabled: false,
    },
  },
})
