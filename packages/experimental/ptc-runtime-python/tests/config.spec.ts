import { describe, expect, it } from 'vitest'
import { resolveRuntimeConfig } from '../src/config.ts'
import type { Config } from '../src/config.ts'

/**
 * Unit cases over the extracted load-time gates. The package suite drives every
 * gate through a real plugin load; what only a direct call can observe is the
 * resolved value the gates hand back and which of two wrong values is reported.
 */
const COMPLETE: Required<Config> = {
  cpuSeconds: 60,
  maxWallMs: 600_000,
  addressSpaceMb: 512,
  maxLogBytes: 65_536,
  maxValueBytes: 32_768,
  graceMs: 3_000,
  pythonBin: 'python3',
}

const FRAME_PARSE_CAP_BYTES = 64 * 1024 * 1024

describe('resolveRuntimeConfig', () => {
  it('returns the configured set when every gate admits it', () => {
    expect(resolveRuntimeConfig(COMPLETE, FRAME_PARSE_CAP_BYTES)).toEqual(COMPLETE)
  })

  it('reports the earliest failing gate when two values are wrong', () => {
    // A float log budget and an address space below the interpreter baseline are
    // both wrong; the gates are ordered, so the budget's integer check decides
    // which message the operator sees.
    expect(() => resolveRuntimeConfig({ ...COMPLETE, maxLogBytes: 3.5, addressSpaceMb: 1 }, FRAME_PARSE_CAP_BYTES))
      .toThrow(/config\.maxLogBytes must be a positive integer/)
  })
})
