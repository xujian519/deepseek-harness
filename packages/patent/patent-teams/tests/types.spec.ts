// Runtime constants of the durable team types.
import { describe, expect, it } from 'vitest'
import { TERMINAL_TASK_STATUSES } from '../src/types.ts'

describe('TERMINAL_TASK_STATUSES', () => {
  it('lists every status after which a task can no longer be claimed', () => {
    expect([...TERMINAL_TASK_STATUSES]).toEqual(['completed', 'failed', 'cancelled'])
  })
})
