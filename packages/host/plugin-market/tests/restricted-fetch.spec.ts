/**
 * Tests for the restricted catalog HTTP client: URL validation, host
 * blocklisting (literal and resolved), redirect re-validation, and the
 * size/timeout/depth bounds.
 */

import { describe, expect, it, vi } from 'vitest'
import {
  RestrictedFetchError, ipv4ToInt, isBlockedHostname, isBlockedIpv4, isBlockedIpv6,
  restrictedFetchJson, validateCatalogUrl,
} from '../src/restricted-fetch.ts'

describe('ipv4ToInt', () => {
  it('parses a dotted quad to its numeric form', () => {
    expect(ipv4ToInt('127.0.0.1')).toBe(0x7F000001)
    expect(ipv4ToInt('169.254.169.254')).toBe(0xA9FEA9FE)
  })

  it('rejects malformed input', () => {
    expect(ipv4ToInt('300.1.1.1')).toBeUndefined()
    expect(ipv4ToInt('1.2.3')).toBeUndefined()
    expect(ipv4ToInt('not-an-ip')).toBeUndefined()
    expect(ipv4ToInt('1.2.3.4.5')).toBeUndefined()
    expect(ipv4ToInt('1.2.x.4')).toBeUndefined()
  })
})

describe('isBlockedIpv4', () => {
  it('blocks loopback, private, link-local, and metadata ranges', () => {
    expect(isBlockedIpv4('127.0.0.1')).toBe(true)
    expect(isBlockedIpv4('10.0.0.1')).toBe(true)
    expect(isBlockedIpv4('172.16.0.1')).toBe(true)
    expect(isBlockedIpv4('192.168.1.1')).toBe(true)
    expect(isBlockedIpv4('169.254.169.254')).toBe(true)
    expect(isBlockedIpv4('0.0.0.0')).toBe(true)
    expect(isBlockedIpv4('100.64.0.1')).toBe(true)
  })

  it('allows public addresses', () => {
    expect(isBlockedIpv4('8.8.8.8')).toBe(false)
    expect(isBlockedIpv4('104.16.0.1')).toBe(false)
    expect(isBlockedIpv4('not-an-ip')).toBe(false)
  })
})

describe('isBlockedIpv6', () => {
  it('blocks loopback, ULA, link-local, and multicast', () => {
    expect(isBlockedIpv6('::1')).toBe(true)
    expect(isBlockedIpv6('::')).toBe(true)
    expect(isBlockedIpv6('fc00::1')).toBe(true)
    expect(isBlockedIpv6('fd12::1')).toBe(true)
    expect(isBlockedIpv6('fe80::1')).toBe(true)
    expect(isBlockedIpv6('ff02::1')).toBe(true)
  })

  it('blocks IPv4-mapped literals whose embedded address is blocked', () => {
    expect(isBlockedIpv6('::ffff:127.0.0.1')).toBe(true) // loopback
    expect(isBlockedIpv6('::ffff:10.0.0.1')).toBe(true) // private
    expect(isBlockedIpv6('::ffff:192.168.1.1')).toBe(true)
    expect(isBlockedIpv6('::ffff:8.8.8.8')).toBe(false) // global
  })

  it('allows global addresses', () => {
    expect(isBlockedIpv6('2606:4700::1111')).toBe(false)
  })
})

describe('isBlockedHostname', () => {
  it('blocks localhost and literal blocked addresses', () => {
    expect(isBlockedHostname('localhost')).toBe(true)
    expect(isBlockedHostname('127.0.0.1')).toBe(true)
    expect(isBlockedHostname('169.254.169.254')).toBe(true)
    expect(isBlockedHostname('LOCALHOST.')).toBe(true)
  })

  it('allows public hostnames', () => {
    expect(isBlockedHostname('registry.npmjs.org')).toBe(false)
    expect(isBlockedHostname('8.8.8.8')).toBe(false)
  })

  it('blocks IPv6 literals through the hostname path', () => {
    expect(isBlockedHostname('::1')).toBe(true)
    expect(isBlockedHostname('2606:4700::1111')).toBe(false)
  })
})

describe('validateCatalogUrl', () => {
  it('accepts a plain https URL', () => {
    expect(validateCatalogUrl('https://catalog.example/v1/plugins').href)
      .toBe('https://catalog.example/v1/plugins')
  })

  it('rejects non-https, credentials, fragments, and blocked hosts', () => {
    expect(() => validateCatalogUrl('http://catalog.example/v1')).toThrow(RestrictedFetchError)
    expect(() => validateCatalogUrl('https://user:pass@catalog.example/v1')).toThrow(/credentials/)
    expect(() => validateCatalogUrl('https://:secret@catalog.example/v1')).toThrow(/credentials/)
    expect(() => validateCatalogUrl('https://catalog.example/v1#frag')).toThrow(/fragment/)
    expect(() => validateCatalogUrl('https://127.0.0.1/v1')).toThrow(/blocked/)
    expect(() => validateCatalogUrl('not a url')).toThrow(/malformed/)
  })
})

describe('restrictedFetchJson', () => {
  it('fetches and parses a JSON document', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }))
    const resolve = vi.fn(async () => ['93.184.216.34'])
    const result = await restrictedFetchJson('https://catalog.example/v1', {}, resolve, fetchImpl)
    expect(result).toEqual({ ok: 1 })
    expect(fetchImpl).toHaveBeenCalledWith('https://catalog.example/v1', expect.objectContaining({ redirect: 'manual' }))
  })

  it('rejects a host whose resolved address is blocked', async () => {
    const fetchImpl = vi.fn()
    const resolve = vi.fn(async () => ['127.0.0.1'])
    await expect(restrictedFetchJson('https://catalog.example/v1', {}, resolve, fetchImpl))
      .rejects.toMatchObject({ code: 'blocked-host' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('re-validates every redirect hop and caps the depth', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      // restrictedFetchJson always passes the normalized href string.
      const href = url as string
      if (href.startsWith('https://catalog.example/a')) return new Response(null, { status: 302, headers: { location: '/b' } })
      if (href.startsWith('https://catalog.example/b')) return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/evil' } })
      return new Response('{}', { status: 200 })
    })
    const resolve = vi.fn(async () => ['93.184.216.34'])
    await expect(restrictedFetchJson('https://catalog.example/a', { maxRedirects: 3 }, resolve, fetchImpl))
      .rejects.toMatchObject({ code: 'blocked-host' })
  })

  it('caps redirect depth', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: '/loop' } }))
    const resolve = vi.fn(async () => ['93.184.216.34'])
    await expect(restrictedFetchJson('https://catalog.example/a', { maxRedirects: 2 }, resolve, fetchImpl))
      .rejects.toMatchObject({ code: 'too-many-redirects' })
  })

  it('rejects a redirect without a location header', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302 }))
    const resolve = vi.fn(async () => ['93.184.216.34'])
    await expect(restrictedFetchJson('https://catalog.example/a', {}, resolve, fetchImpl))
      .rejects.toMatchObject({ code: 'network' })
  })

  it('bounds the response size', async () => {
    const fetchImpl = vi.fn(async () => new Response('x'.repeat(100), { status: 200 }))
    const resolve = vi.fn(async () => ['93.184.216.34'])
    await expect(restrictedFetchJson('https://catalog.example/a', { maxBytes: 10 }, resolve, fetchImpl))
      .rejects.toMatchObject({ code: 'too-large' })
  })

  it('rejects a non-JSON body and a failed HTTP status', async () => {
    const resolve = vi.fn(async () => ['93.184.216.34'])
    await expect(restrictedFetchJson('https://catalog.example/a', {}, resolve, vi.fn(async () => new Response('not json', { status: 200 }))))
      .rejects.toMatchObject({ code: 'network' })
    await expect(restrictedFetchJson('https://catalog.example/a', {}, resolve, vi.fn(async () => new Response('nope', { status: 404 }))))
      .rejects.toMatchObject({ code: 'network' })
  })

  it('times out a stalled body', async () => {
    const stalled = new ReadableStream({
      start() { /* never pushes */ },
      cancel() { throw new Error('cancel failed') },
    })
    const fetchImpl = vi.fn(async () => new Response(stalled, { status: 200 }))
    const resolve = vi.fn(async () => ['93.184.216.34'])
    await expect(restrictedFetchJson('https://catalog.example/a', { timeoutMs: 20 }, resolve, fetchImpl))
      .rejects.toMatchObject({ code: 'timeout' })
  })

  it('rejects a response with no body as non-JSON', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }))
    const resolve = vi.fn(async () => ['93.184.216.34'])
    await expect(restrictedFetchJson('https://catalog.example/a', {}, resolve, fetchImpl))
      .rejects.toMatchObject({ code: 'network' })
  })

  it('wraps a network failure', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('fetch failed') })
    const resolve = vi.fn(async () => ['93.184.216.34'])
    await expect(restrictedFetchJson('https://catalog.example/a', {}, resolve, fetchImpl))
      .rejects.toMatchObject({ code: 'network' })
  })

  it('wraps a DNS resolution failure as a network error', async () => {
    const fetchImpl = vi.fn()
    const resolve = vi.fn(async () => { throw new Error('ENOTFOUND') })
    await expect(restrictedFetchJson('https://catalog.example/a', {}, resolve, fetchImpl))
      .rejects.toMatchObject({ code: 'network' })
  })
})
