import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { redactSecrets } from '../src/index.ts'
import { MemorySettings } from './memory.ts'

const Profile = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref'),
  baseURL: z.string(),
})

const Adapter: z<object> = z.object({
  apiKey: z.string().role('secret'),
  providers: z.dict(Profile),
  fallbacks: z.array(Profile),
  nested: z.object({
    token: z.string().role('secret'),
  }),
})

describe('redactSecrets', () => {
  it('strips secrets from object, dict, and array containers and records each position', () => {
    const { value, secrets } = redactSecrets(Adapter as z<never>, {
      apiKey: 'top-secret',
      providers: {
        openai: { apiKey: 'sk-live', apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://x' },
        anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      },
      fallbacks: [{ apiKey: 'fb', baseURL: 'https://y' }],
      nested: {},
    })
    expect(value).toEqual({
      providers: {
        openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://x' },
        anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY' },
      },
      fallbacks: [{ baseURL: 'https://y' }],
      nested: {},
    })
    expect(secrets).toEqual([
      { path: ['apiKey'], set: true },
      { path: ['providers', 'openai', 'apiKey'], set: true },
      { path: ['providers', 'anthropic', 'apiKey'], set: false },
      { path: ['fallbacks', '0', 'apiKey'], set: true },
      { path: ['nested', 'token'], set: false },
    ])
  })

  it('enumerates unset object-property slots without inventing containers', () => {
    const { value, secrets } = redactSecrets(Adapter as z<never>, undefined)
    expect(value).toBeUndefined()
    expect(secrets).toEqual([
      { path: ['apiKey'], set: false },
      { path: ['nested', 'token'], set: false },
    ])
  })

  it('never mutates the input and preserves keys outside the schema', () => {
    const input = Object.freeze({
      apiKey: 'frozen',
      extra: Object.freeze({ keep: true }),
    })
    const { value } = redactSecrets(Adapter as z<never>, input)
    expect(input.apiKey).toBe('frozen')
    expect(value).toEqual({ extra: { keep: true }, nested: undefined } as never)
    expect((value as { extra: unknown }).extra).toEqual({ keep: true })
  })

  it('passes malformed container values through untouched', () => {
    const { value, secrets } = redactSecrets(Adapter as z<never>, {
      providers: 'not-a-dict',
      fallbacks: 'not-an-array',
    })
    expect(value).toEqual({ providers: 'not-a-dict', fallbacks: 'not-an-array' })
    expect(secrets).toEqual([
      { path: ['apiKey'], set: false },
      { path: ['nested', 'token'], set: false },
    ])
  })

  it('treats a secret-role container as one opaque secret leaf', () => {
    const Weird = z.object({ blob: z.object({ inner: z.string() }).role('secret') })
    const { value, secrets } = redactSecrets(Weird as z<never>, { blob: { inner: 'x' } })
    expect(value).toEqual({})
    expect(secrets).toEqual([{ path: ['blob'], set: true }])
  })

  it('drops a dict entry whose entire value is the secret', () => {
    const Tokens = z.object({ tokens: z.dict(z.string().role('secret')) })
    const { value, secrets } = redactSecrets(Tokens as z<never>, { tokens: { a: 'x', b: 'y' } })
    expect(value).toEqual({ tokens: {} })
    expect(secrets).toEqual([
      { path: ['tokens', 'a'], set: true },
      { path: ['tokens', 'b'], set: true },
    ])
  })

  it('tolerates structural nodes missing their relation maps', () => {
    expect(redactSecrets({ type: 'dict' } as never, { k: 'v' })).toEqual({ value: { k: 'v' }, secrets: [] })
    expect(redactSecrets({ type: 'object' } as never, { k: 'v' })).toEqual({ value: { k: 'v' }, secrets: [] })
    expect(redactSecrets({ type: 'array' } as never, ['v'])).toEqual({ value: ['v'], secrets: [] })
    expect(redactSecrets({ type: 'transform' } as never, 'x')).toEqual({ value: 'x', secrets: [] })
  })

  it('passes scalar nodes and scalar-member unions through', () => {
    const Schema = z.object({
      name: z.string(),
      count: z.number(),
      theme: z.union(['dark', 'light']),
      choice: z.union([z.string(), z.number()]),
    })
    const { value, secrets } = redactSecrets(Schema as z<never>, { name: 'x', count: 1, theme: 'dark', choice: 2 })
    expect(value).toEqual({ name: 'x', count: 1, theme: 'dark', choice: 2 })
    expect(secrets).toEqual([])
  })

  it('passes unexpandable containers through when no secret is reachable', () => {
    const WithUnion = z.object({ choice: z.union([z.object({ a: z.string() }), z.number()]) })
    const WithTransform = z.object({ when: z.transform(z.string(), s => new Date(s)) })
    const { value, secrets } = redactSecrets(WithUnion as z<never>, { choice: { a: 'x' } })
    expect(value).toEqual({ choice: { a: 'x' } })
    expect(secrets).toEqual([])
    const transform = redactSecrets(WithTransform as z<never>, { when: '2026-01-01' })
    expect(transform.value).toEqual({ when: '2026-01-01' })
    expect(transform.secrets).toEqual([])
    const tuple = redactSecrets({ type: 'tuple', list: [{ type: 'object', dict: {} }] } as never, ['x'])
    expect(tuple.value).toEqual(['x'])
    expect(tuple.secrets).toEqual([])
    const intersect = redactSecrets({ type: 'intersect', list: [{ type: 'object', dict: {} }] } as never, { a: 1 })
    expect(intersect.value).toEqual({ a: 1 })
    expect(intersect.secrets).toEqual([])
  })

  it('fails closed when a reachable secret sits under an unexpandable container', () => {
    const SecretUnion = z.object({ choice: z.union([z.object({ token: z.string().role('secret') }), z.number()]) })
    const SecretTransform = z.object({
      when: z.transform(z.object({ token: z.string().role('secret') }), s => s.token),
    })
    expect(() => redactSecrets(SecretUnion as z<never>, { choice: { token: 'x' } })).toThrow(
      /cannot redact a value under schema node type "union"/,
    )
    expect(() => redactSecrets(SecretTransform as z<never>, { when: { token: 'x' } })).toThrow(
      /cannot redact a value under schema node type "transform"/,
    )
    expect(() => redactSecrets({
      type: 'tuple',
      list: [{ type: 'object', dict: { token: { type: 'string', meta: { role: 'secret' } } } }],
    } as never, ['x'])).toThrow(
      /cannot redact a value under schema node type "tuple"/,
    )
    expect(() => redactSecrets({
      type: 'intersect',
      list: [{ type: 'object', dict: { token: { type: 'string', meta: { role: 'secret' } } } }],
    } as never, { token: 'x' })).toThrow(
      /cannot redact a value under schema node type "intersect"/,
    )
    expect(() => redactSecrets({
      type: 'union',
      list: [{ type: 'string', meta: { role: 'secret' } }, { type: 'number' }],
    } as never, 'x')).toThrow(
      /cannot redact a value under schema node type "union"/,
    )
  })

  it('does not fail closed when an unexpandable container holds no value', () => {
    const WithUnion = z.object({ choice: z.union([z.object({ a: z.string() }), z.number()]) })
    const { value, secrets } = redactSecrets(WithUnion as z<never>, {})
    expect(value).toEqual({})
    expect(secrets).toEqual([])
  })
})

describe('describe() layers and redaction', () => {
  const NS = 'adapter'

  async function boot(doc?: Record<string, unknown>) {
    const ctx = new Context()
    await ctx.plugin(MemorySettings, doc === undefined ? undefined : { doc })
    return ctx
  }

  it('exposes detached base and user layers beside the resolved value', async () => {
    const ctx = await boot({ adapter: { baseURL: 'https://user' } })
    const base = { apiKey: 'entry-key', baseURL: 'https://base' }
    ctx.settings.register(NS, Profile, { base })
    const [descriptor] = ctx.settings.describe()
    expect(descriptor?.base).toEqual(base)
    expect(descriptor?.base).not.toBe(base)
    expect(descriptor?.user).toEqual({ baseURL: 'https://user' })
    expect(descriptor?.value).toEqual({ apiKey: 'entry-key', baseURL: 'https://user' })
    ;(descriptor?.user as Record<string, unknown>).baseURL = 'mutated'
    expect(ctx.settings.describe()[0]?.user).toEqual({ baseURL: 'https://user' })
    expect(descriptor?.secrets).toBeUndefined()
  })

  it('omits the layers when neither a base nor a user section exists', async () => {
    const ctx = await boot()
    ctx.settings.register(NS, Profile)
    const [descriptor] = ctx.settings.describe()
    expect(descriptor).not.toHaveProperty('base')
    expect(descriptor).not.toHaveProperty('user')
  })

  it('describes a section that became malformed after registration as having no user layer', async () => {
    const ctx = await boot({ adapter: { baseURL: 'https://user' } })
    const provider = ctx.get('settings') as MemorySettings
    ctx.settings.register(NS, Profile, { base: { baseURL: 'https://base' } })
    provider.pushExternal({ adapter: 5 })
    const [descriptor] = ctx.settings.describe()
    expect(descriptor).not.toHaveProperty('user')
    // The malformed publish kept the last good resolved value.
    expect(descriptor?.value).toEqual({ baseURL: 'https://user' })
  })

  it('redacts a descriptor that has neither base nor user layer', async () => {
    const ctx = await boot()
    ctx.settings.register(NS, Profile)
    const [descriptor] = ctx.settings.describe({ redactSecrets: true })
    expect(descriptor).not.toHaveProperty('base')
    expect(descriptor).not.toHaveProperty('user')
    expect(descriptor?.secrets).toEqual([{ path: ['apiKey'], set: false }])
  })

  it('redacts every layer and enumerates secret slots under redactSecrets', async () => {
    const ctx = await boot({ adapter: { apiKey: 'user-key', baseURL: 'https://user' } })
    ctx.settings.register(NS, Profile, { base: { apiKey: 'entry-key' } })
    const [descriptor] = ctx.settings.describe({ redactSecrets: true })
    expect(descriptor?.value).toEqual({ baseURL: 'https://user' })
    expect(descriptor?.base).toEqual({})
    expect(descriptor?.user).toEqual({ baseURL: 'https://user' })
    expect(descriptor?.secrets).toEqual([{ path: ['apiKey'], set: true }])
    const [verbatim] = ctx.settings.describe()
    expect(verbatim?.value).toEqual({ apiKey: 'user-key', baseURL: 'https://user' })
  })
})
