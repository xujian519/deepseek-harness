/**
 * dsh-self-evolve-benchmark's owned branded ids: the durable benchmark and
 * case directory names that key the store, the scoreboard, and every seam
 * request.
 *
 * The `Branded<B>` primitive itself lives in `@deepseek-ai/dsh-brand` (a
 * zero-dependency type-only package); see that package's README for the
 * nominal-typing policy.
 *
 * @module @deepseek-ai/dsh-self-evolve-benchmark/brand
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque identifier for a benchmark: its directory name under `benchmarks/`. */
export type BenchmarkId = Branded<'BenchmarkId'>

/**
 * Brand a string as a {@link BenchmarkId}.
 * @param id - the benchmark's directory name.
 * @returns the same string, branded; no validation is performed.
 */
export function BenchmarkId(id: string): BenchmarkId {
  return id as BenchmarkId
}

/** Opaque identifier for one benchmark case: its directory name under the benchmark. */
export type CaseId = Branded<'CaseId'>

/**
 * Brand a string as a {@link CaseId}.
 * @param id - the case's directory name.
 * @returns the same string, branded; no validation is performed.
 */
export function CaseId(id: string): CaseId {
  return id as CaseId
}
