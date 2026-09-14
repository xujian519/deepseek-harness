import { TestRunner, type SerializedConfig } from 'vitest'
import type { VitestRunner } from 'vitest/suite'

type Test = Parameters<NonNullable<VitestRunner['onBeforeRunTask']>>[0]

/**
 * Custom Vitest runner for the nightly race-stress job.
 *
 * Vitest 4 exposes `repeats` as a per-test option, not a global config. Rather
 * than edit every spec file, this runner injects the repeat count into each
 * collected test task before it runs. The value is read from the environment
 * so local runs can lower it for a quick smoke test.
 */
export default class RaceStressRunner extends TestRunner implements VitestRunner {
  readonly repeats: number

  constructor(config: SerializedConfig) {
    super(config)
    const raw = process.env.DSH_RACE_STRESS_REPEATS ?? '10'
    const parsed = Number(raw)
    if (!Number.isSafeInteger(parsed) || parsed < 1) {
      throw new Error(`DSH_RACE_STRESS_REPEATS must be a positive integer, got ${JSON.stringify(raw)}`)
    }
    this.repeats = parsed
  }

  override onBeforeRunTask(test: Test): Promise<void> {
    // Only touch tests that do not already declare their own repeats, so a
    // spec can opt out by passing { repeats: N } explicitly.
    if ((test.repeats ?? 0) === 0) {
      test.repeats = this.repeats
    }
    return super.onBeforeRunTask(test)
  }
}
