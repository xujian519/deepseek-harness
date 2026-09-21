import type { WritingPattern } from '../../src/types.ts'

/**
 * Build a pattern for a spec, defaulting everything the spec does not vary.
 * @param overrides - the fields under test; `id` is always taken from the spec.
 * @returns the pattern.
 */
export function makePattern(overrides: Partial<WritingPattern> & { id: string }): WritingPattern {
  return {
    name: `pattern ${overrides.id}`,
    category: 'claim_drafting',
    summary: `summary of ${overrides.id}`,
    steps: [],
    examples: [],
    dos: [],
    donts: [],
    quality: 1,
    ...overrides,
  }
}
