/** Post-GC process memory sampling shared by benchmark workers. */

import { scheduler } from 'node:timers/promises'

/** One post-GC process memory observation in megabytes. */
export interface BenchmarkMemorySnapshot {
  readonly heapUsedMb: number
  readonly externalMb: number
  readonly arrayBuffersMb: number
  readonly rssMb: number
  readonly peakRssMb: number
}

/** Memory difference between two observations in megabytes. */
export interface BenchmarkMemoryDelta {
  readonly heapUsedMb: number
  readonly externalMb: number
  readonly arrayBuffersMb: number
  readonly rssMb: number
}

function megabytes(bytes: number): number {
  return Math.round(bytes / 104_857.6) / 10
}

/**
 * Read the current process memory, including its peak RSS.
 * @returns the observation in megabytes.
 */
export function memorySnapshot(): BenchmarkMemorySnapshot {
  const memory = process.memoryUsage()
  return {
    heapUsedMb: megabytes(memory.heapUsed),
    externalMb: megabytes(memory.external),
    arrayBuffersMb: megabytes(memory.arrayBuffers),
    rssMb: megabytes(memory.rss),
    peakRssMb: Math.round(process.resourceUsage().maxRSS / 102.4) / 10,
  }
}

/**
 * Collect garbage twice and observe the resulting memory.
 * @returns the post-collection observation.
 */
export async function collectGarbage(): Promise<BenchmarkMemorySnapshot> {
  const gc = (globalThis as typeof globalThis & { gc?: () => void }).gc
  if (gc === undefined) throw new Error('benchmark worker requires --expose-gc')
  gc()
  await scheduler.yield()
  gc()
  return memorySnapshot()
}

/**
 * Subtract two observations.
 * @param before - observation taken before the measured work.
 * @param after - observation taken after it.
 * @returns the per-field difference in megabytes.
 */
export function memoryDelta(
  before: BenchmarkMemorySnapshot,
  after: BenchmarkMemorySnapshot,
): BenchmarkMemoryDelta {
  return {
    heapUsedMb: Math.round((after.heapUsedMb - before.heapUsedMb) * 10) / 10,
    externalMb: Math.round((after.externalMb - before.externalMb) * 10) / 10,
    arrayBuffersMb: Math.round((after.arrayBuffersMb - before.arrayBuffersMb) * 10) / 10,
    rssMb: Math.round((after.rssMb - before.rssMb) * 10) / 10,
  }
}
