import { describe, expect, it } from 'vitest'
import z from '@deepseek-ai/schemastery'
import { redactSecrets } from '../src/index.ts'

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
    expect(() => redactSecrets({
      type: 'tuple',
      list: [{ type: 'object', dict: { token: { type: 'string', meta: { role: 'secret' } } } }],
    } as never, ['x'])).toThrow(
      /cannot redact a value under schema node type "tuple"/,
    )
  })

  it('fails closed when a reachable secret sits under the element schema of an unexpandable container', () => {
    expect(() => redactSecrets({
      type: 'lazy',
      inner: { type: 'object', dict: { token: { type: 'string', meta: { role: 'secret' } } } },
    } as never, { token: 'x' })).toThrow(
      /cannot redact a value under schema node type "lazy"/,
    )
  })

  it('does not fail closed when an unexpandable container holds no value', () => {
    const WithUnion = z.object({ choice: z.union([z.object({ a: z.string() }), z.number()]) })
    const { value, secrets } = redactSecrets(WithUnion as z<never>, {})
    expect(value).toEqual({})
    expect(secrets).toEqual([])
  })
  it('strips a secret declared by a union branch and records the position', () => {
    const schema = z.object({
      choice: z.union([z.object({ token: z.string().role('secret') }), z.object({ token: z.string() })]),
    })
    const { value, secrets } = redactSecrets(schema as z<never>, { choice: { token: 'union-secret' } })
    expect(value).toEqual({ choice: {} })
    expect(secrets).toEqual([{ path: ['choice', 'token'], set: true }])
  })

  it('strips a secret declared inside a transform', () => {
    const schema = z.object({
      when: z.transform(z.object({ token: z.string().role('secret') }), value => value),
    })
    const { value, secrets } = redactSecrets(schema as z<never>, { when: { token: 'transformed-secret' } })
    expect(value).toEqual({ when: {} })
    expect(secrets).toEqual([{ path: ['when', 'token'], set: true }])
  })

  it('strips a secret declared by an intersection member and keeps sibling fields', () => {
    const schema = z.object({
      profile: z.intersect([z.object({ token: z.string().role('secret') }), z.object({ name: z.string() })]),
    })
    const { value, secrets } = redactSecrets(schema as z<never>, {
      profile: { token: 'intersection-secret', name: 'visible' },
    })
    expect(value).toEqual({ profile: { name: 'visible' } })
    expect(secrets).toEqual([{ path: ['profile', 'token'], set: true }])
  })

  it('rebuilds dict entries as own data properties so a __proto__ key cannot set the prototype', () => {
    const schema = z.object({ tokens: z.dict(z.string()) })
    const tokens = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>
    const { value } = redactSecrets(schema as z<never>, { tokens })
    const rebuilt = (value as { tokens: Record<string, unknown> }).tokens
    expect(Object.getPrototypeOf(rebuilt)).toBe(Object.prototype)
    expect(Object.getOwnPropertyDescriptor(rebuilt, '__proto__')?.value).toEqual({ polluted: true })
    expect(rebuilt.polluted).toBeUndefined()
  })
})

it('preserves values when an unspecified union declares no secret alternatives', () => {
  expect(redactSecrets(new z({ type: 'union' }) as z<never>, 'visible')).toEqual({ value: 'visible', secrets: [] })
})
