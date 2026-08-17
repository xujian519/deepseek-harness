import { describe, expect, it } from 'vitest'
import { PatentToolError } from '../src/error.ts'

describe('PatentToolError', () => {
  it('carries a stable code and details', () => {
    const err = new PatentToolError('invalid_tool_input', 'Search query is empty.', { tool: 'patent_search' })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('PatentToolError')
    expect(err.code).toBe('invalid_tool_input')
    expect(err.message).toBe('Search query is empty.')
    expect(err.details).toEqual({ tool: 'patent_search' })
  })

  it('defaults details to undefined', () => {
    const err = new PatentToolError('tool_execution_failed', 'boom')
    expect(err.details).toBeUndefined()
  })
})
