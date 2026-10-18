import { describe, expect, it } from 'vitest'
import { PatentToolError } from '../src/error.ts'
import { SectionSourceError } from '../src/figure/section-source.ts'
import { assertRendered, sectionSourceError } from '../src/tool/internal/render-outcome.ts'

describe('assertRendered', () => {
  it('returns quietly on success', () => {
    expect(() => { assertRendered({ ok: true }, 'generate_patent_figure') }).not.toThrow()
  })

  it('maps every failure code onto the shared taxonomy', () => {
    const cases = [
      ['not_installed', 'setup_required'],
      ['aborted', 'tool_aborted'],
      ['render_failed', 'tool_execution_failed'],
    ] as const
    for (const [code, expected] of cases) {
      let thrown: unknown
      try {
        assertRendered({ ok: false, code, error: 'reason' }, 'generate_structure_figure')
      } catch (error) {
        thrown = error
      }
      expect(thrown, code).toBeInstanceOf(PatentToolError)
      expect((thrown as PatentToolError).code, code).toBe(expected)
    }
  })
})

describe('sectionSourceError', () => {
  it('maps each source failure code onto a tool error code', () => {
    const cases = [
      ['invalid_input', 'invalid_tool_input'],
      ['file_not_found', 'file_not_found'],
      ['not_installed', 'setup_required'],
      ['aborted', 'tool_aborted'],
      ['geometry_failed', 'tool_execution_failed'],
      ['hatch_failed', 'tool_execution_failed'],
    ] as const
    for (const [sourceCode, expected] of cases) {
      const error = sectionSourceError(new SectionSourceError(sourceCode, `${sourceCode} reason`), 'generate_patent_figure')
      expect(error, sourceCode).toBeInstanceOf(PatentToolError)
      expect(error.code, sourceCode).toBe(expected)
      expect(error.message, sourceCode).toContain('reason')
    }
  })
})
