/**
 * A catalog provider owns request contracts beyond its API implementations,
 * and a route that overrides the catalog protocol must keep them. pi-ai wraps
 * the OpenCode gateways' implementations to add the per-conversation
 * `x-opencode-session` they require, and the Cloudflare providers' to resolve
 * the account and gateway placeholders in a model's endpoint from the ambient
 * values that provider's own auth resolution supplies. These tests pin every
 * route shape that reaches those providers, and the shapes that must receive
 * neither treatment.
 */

import { afterEach, describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { PiAiAuthInjection } from '../src/adapter.ts'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'
import type { MockServer } from './mock-server.ts'

afterEach(async () => {
  await closeMockServers()
})

/** The header OpenCode's gateways route on. */
const SESSION_HEADER = 'x-opencode-session'

/** The ambient values a Cloudflare route's own auth resolution reads. */
const CLOUDFLARE_ENV = {
  CLOUDFLARE_API_KEY: 'cf-key',
  CLOUDFLARE_ACCOUNT_ID: 'account-7',
  CLOUDFLARE_GATEWAY_ID: 'gateway-9',
}

/** The LLM seam's session-id brand; `dsh-session` owns the domain value. */
type SessionId = Branded<'SessionId'>

const SESSION_A = brandString<SessionId>('session-a')
const SESSION_B = brandString<SessionId>('session-b')

interface Request {
  provider: string
  model: string
  sessionId?: SessionId
}

/** One request as the mock endpoint received it. */
interface ReceivedRequest {
  headers: Record<string, string | string[] | undefined>
  path: string
}

/**
 * The ambient auth context for a route whose provider asks the environment for
 * values. `memoryAuth` answers every name with nothing, so a Cloudflare route
 * would report itself unconfigured before any wrapper ran.
 * @param env - values to answer by name.
 * @returns the auth injection to hand `PiAiAdapter`.
 */
function ambientAuth(env: Readonly<Record<string, string>>): PiAiAuthInjection {
  return {
    ...memoryAuth(),
    authContext: {
      env: name => Promise.resolve(env[name]),
      fileExists: () => Promise.resolve(false),
    },
  }
}

/**
 * Send one request through the real adapter over the real profile resolver and
 * return what the mock endpoint received.
 * @param server - the mock endpoint the route points at.
 * @param providers - the provider dictionary to resolve.
 * @param request - the provider, model, and optional session to send.
 * @param auth - the auth injection; defaults to one that answers nothing.
 * @returns the captured request headers and path.
 */
async function sendRequest(
  server: MockServer,
  providers: Record<string, LlmPiAi.PiAiProviderProfile>,
  request: Request,
  auth: PiAiAuthInjection = memoryAuth(),
): Promise<ReceivedRequest> {
  const adapter = new PiAiAdapter({
    profiles: () => resolveProfiles(providers),
    resolveApiKey: () => Promise.resolve('test-key'),
    auth,
  })
  const options: GenerateOptions = {
    provider: request.provider,
    model: request.model,
    messages: [],
    ...request.sessionId === undefined ? {} : { sessionId: request.sessionId },
  }
  for await (const _chunk of adapter.stream(options)) { /* drain */ }
  return { headers: server.headers.at(-1) ?? {}, path: server.paths.at(-1) ?? '' }
}

describe('OpenCode session header', () => {
  it('carries the session header on a catalog route that keeps its catalog protocol', async () => {
    const server = await mockServer([{ events: textEvents }])
    const { headers } = await sendRequest(server, {
      'opencode-go': { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url },
    }, { provider: 'opencode-go', model: 'deepseek-v4-flash', sessionId: SESSION_A })

    expect(headers[SESSION_HEADER]).toBe('session-a')
  })

  it('re-applies the header when a profile repoints a catalog route at another protocol', async () => {
    const server = await mockServer([{ events: textEvents }])
    // The shape that reaches this path: a model the installed catalog has not
    // caught up with, which a mixed-protocol route cannot default and therefore
    // requires the route-level `api`.
    const { headers } = await sendRequest(server, {
      'opencode-go': {
        apiKeyEnv: 'PI_TEST_KEY',
        baseURL: server.url,
        api: 'openai-completions',
        models: [{ id: 'glm-5.5-preview' }],
      },
    }, { provider: 'opencode-go', model: 'glm-5.5-preview', sessionId: SESSION_A })

    expect(headers[SESSION_HEADER]).toBe('session-a')
  })

  it('carries the header on the Zen catalog route too', async () => {
    const server = await mockServer([{ events: textEvents }])
    const { headers } = await sendRequest(server, {
      opencode: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url, api: 'openai-completions' },
    }, { provider: 'opencode', model: 'deepseek-v4-flash', sessionId: SESSION_A })

    expect(headers[SESSION_HEADER]).toBe('session-a')
  })

  it('derives the header per conversation rather than per process', async () => {
    const server = await mockServer([{ events: textEvents }, { events: textEvents }, { events: textEvents }])
    const providers = { 'opencode-go': { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url } }
    for (const sessionId of [SESSION_A, SESSION_B, SESSION_A]) {
      await sendRequest(server, providers, { provider: 'opencode-go', model: 'deepseek-v4-flash', sessionId })
    }

    expect(server.headers.map(headers => headers[SESSION_HEADER])).toEqual(['session-a', 'session-b', 'session-a'])
  })

  it('keeps a session header the deployment pinned itself', async () => {
    const server = await mockServer([{ events: textEvents }])
    const { headers } = await sendRequest(server, {
      'opencode-go': {
        apiKeyEnv: 'PI_TEST_KEY',
        baseURL: server.url,
        headers: { 'X-OpenCode-Session': 'deployment-pinned' },
      },
    }, { provider: 'opencode-go', model: 'deepseek-v4-flash', sessionId: SESSION_A })

    expect(headers[SESSION_HEADER]).toBe('deployment-pinned')
  })

  it('leaves a route pi-ai does not ship without the header', async () => {
    const server = await mockServer([{ events: textEvents }])
    const { headers } = await sendRequest(server, {
      'acme-gateway': {
        api: 'openai-completions',
        baseURL: server.url,
        models: [{ id: 'acme-model' }],
      },
    }, { provider: 'acme-gateway', model: 'acme-model', sessionId: SESSION_A })

    expect(headers[SESSION_HEADER]).toBeUndefined()
  })

  it('does not leak a session id to a provider that did not ask for one', async () => {
    const server = await mockServer([{ events: textEvents }])
    const { headers } = await sendRequest(server, {
      deepseek: { apiKeyEnv: 'PI_TEST_KEY', baseURL: server.url },
    }, { provider: 'deepseek', model: 'deepseek-flash', sessionId: SESSION_A })

    expect(headers[SESSION_HEADER]).toBeUndefined()
  })
})

describe('Cloudflare endpoint placeholders', () => {
  it('resolves the account placeholder when a catalog route overrides its protocol', async () => {
    const server = await mockServer([{ events: textEvents }])
    const { path } = await sendRequest(server, {
      'cloudflare-workers-ai': {
        apiKeyEnv: 'CLOUDFLARE_API_KEY',
        api: 'openai-completions',
        baseURL: `${server.url}/{CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
        models: [{ id: 'acme-model' }],
      },
    }, { provider: 'cloudflare-workers-ai', model: 'acme-model' }, ambientAuth(CLOUDFLARE_ENV))

    expect(path).toBe('/account-7/ai/v1/chat/completions')
  })

  it('resolves both placeholders on the AI gateway route', async () => {
    const server = await mockServer([{ events: textEvents }])
    const { path } = await sendRequest(server, {
      'cloudflare-ai-gateway': {
        apiKeyEnv: 'CLOUDFLARE_API_KEY',
        api: 'openai-completions',
        baseURL: `${server.url}/{CLOUDFLARE_ACCOUNT_ID}/{CLOUDFLARE_GATEWAY_ID}/compat`,
        models: [{ id: 'acme-gateway-model' }],
      },
    }, { provider: 'cloudflare-ai-gateway', model: 'acme-gateway-model' }, ambientAuth(CLOUDFLARE_ENV))

    expect(path).toBe('/account-7/gateway-9/compat/chat/completions')
  })

  it('leaves a route pi-ai does not ship with its literal placeholders', async () => {
    const server = await mockServer([{ events: textEvents }])
    const { path } = await sendRequest(server, {
      'acme-cloudflare': {
        api: 'openai-completions',
        baseURL: `${server.url}/{CLOUDFLARE_ACCOUNT_ID}/ai/v1`,
        models: [{ id: 'acme-model' }],
      },
    }, { provider: 'acme-cloudflare', model: 'acme-model' }, ambientAuth(CLOUDFLARE_ENV))

    expect(path).toContain('CLOUDFLARE_ACCOUNT_ID')
  })
})
