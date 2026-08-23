/**
 * Opt-in end-to-end gate against a REAL OpenViking server.
 *
 * Enable with OPENVIKING_E2E=1 plus a reachable endpoint (default
 * `http://127.0.0.1:1934`). Skips otherwise, including in CI without a
 * server secret. Stores a unique session, mirrors two messages, commits, and
 * asserts the session survives with its live tail — the property no stub can
 * certify.
 */

import { describe, expect, it } from 'vitest'

import { OpenVikingClient } from '../src/client.ts'

const ENABLED = process.env.OPENVIKING_E2E === '1'
const ENDPOINT = process.env.OPENVIKING_URL ?? process.env.OPENVIKING_BASE_URL ?? 'http://127.0.0.1:1934'

const e2e = ENABLED ? describe : describe.skip

e2e('OpenViking real-server round trip', () => {
  it('creates a session, mirrors messages, commits, and keeps the live tail', async () => {
    const client = new OpenVikingClient({
      endpoint: ENDPOINT,
      apiKey: process.env.OPENVIKING_API_KEY ?? '',
      account: process.env.OPENVIKING_ACCOUNT ?? '',
      user: process.env.OPENVIKING_USER ?? '',
      agentId: 'dsh-e2e',
      timeoutMs: 30_000,
    })

    const health = await client.health()
    expect(health.status).toBe('ok')

    const sessionId = `dsh-e2e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const userIds = ['user-1']
    const assistantIds = ['assistant-1']

    await client.createSession(sessionId)
    await client.addMessage(sessionId, {
      role: 'user',
      content: 'Sentinel question: what is the capital of Venus?',
      source_message_ids: userIds,
      message_kind: 'user_query',
    })
    await client.addMessage(sessionId, {
      role: 'assistant',
      content: 'Sentinel answer: the capital of Venus is Cloud City.',
      source_message_ids: assistantIds,
      message_kind: 'assistant_step',
    })
    await client.commit(sessionId, { keepRecentCount: 10 })

    // The committed session must still be listable with its live tail.
    const session = await client.getSession(sessionId)
    expect(session).toMatchObject({ session_id: sessionId })
    expect((session as { message_count?: number }).message_count).toBeGreaterThanOrEqual(2)
  }, 60_000)
})
