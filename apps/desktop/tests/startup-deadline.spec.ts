import { describe, expect, it } from 'vitest'
import { withStartupDeadline } from '../src/startup-deadline.ts'

describe('desktop startup deadline', () => {
  it('returns a stage result that settles before the deadline', async () => {
    await expect(withStartupDeadline('starting the backend', Promise.resolve('ready'), 1_000)).resolves.toBe('ready')
  })

  it('propagates a stage failure unchanged', async () => {
    await expect(withStartupDeadline('starting the backend', Promise.reject(new Error('backend exploded')), 1_000))
      .rejects.toThrow(/backend exploded/u)
  })

  it('names the stalled stage when the deadline expires', async () => {
    const stalled = new Promise<never>(() => {})
    await expect(withStartupDeadline('opening the desktop bridge', stalled, 20))
      .rejects.toThrow(/startup did not finish opening the desktop bridge within 20ms/u)
  })
})
