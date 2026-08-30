import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { emitContained, invokeContained } from '@deepseek-ai/dsh-contained-emit'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'test/event': (value: unknown) => void
  }
}

const render = (value: unknown): string => (value instanceof Error ? value.message : String(value))

describe('invokeContained', () => {
  it('runs every listener even after an earlier one throws synchronously', () => {
    const ctx = new Context()
    const warn = vi.fn()
    ctx.logger.warn = warn
    const ran: string[] = []
    invokeContained(
      ctx,
      'evt',
      [
        () => { throw new Error('first throws') },
        () => { ran.push('second') },
      ],
      [],
      render,
    )
    expect(ran).toEqual(['second'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith('evt listener threw: first throws')
  })

  it('contains a rejected returned promise as one warn line', async () => {
    const ctx = new Context()
    const warn = vi.fn()
    ctx.logger.warn = warn
    invokeContained(
      ctx,
      'evt',
      [() => Promise.reject(new Error('async failure'))],
      [],
      render,
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(warn).toHaveBeenCalledWith('evt listener rejected: async failure')
  })

  it('passes the payload to every callback and contains nothing on success', () => {
    const ctx = new Context()
    const warn = vi.fn()
    ctx.logger.warn = warn
    const seen: unknown[] = []
    invokeContained(
      ctx,
      'evt',
      [
        (value: unknown) => { seen.push(value) },
        (value: unknown) => seen.push(value),
      ],
      ['payload'],
      render,
    )
    expect(seen).toEqual(['payload', 'payload'])
    expect(warn).not.toHaveBeenCalled()
  })

  it('renders the caught value through the injected renderer', () => {
    const ctx = new Context()
    const warn = vi.fn()
    ctx.logger.warn = warn
    invokeContained(
      ctx,
      'agent "a1": agent/disposed',
      [() => { throw new Error('boom') }],
      [],
      (value: unknown) => `rendered:${String(value)}`,
    )
    expect(warn).toHaveBeenCalledWith('agent "a1": agent/disposed listener threw: rendered:Error: boom')
  })
})

describe('emitContained', () => {
  it('dispatches through the context so registered scoped listeners run', () => {
    const ctx = new Context()
    const warn = vi.fn()
    ctx.logger.warn = warn
    const seen: unknown[] = []
    ctx.on('test/event', (value: unknown) => { seen.push(value) })
    emitContained(ctx, 'test/event', ['test/event', 'payload'], render)
    expect(seen).toEqual(['payload'])
    expect(warn).not.toHaveBeenCalled()
  })

  it('runs each registered listener even when one throws', () => {
    const ctx = new Context()
    const warn = vi.fn()
    ctx.logger.warn = warn
    const ran: string[] = []
    ctx.on('test/event', () => { throw new Error('listener one fails') })
    ctx.on('test/event', () => { ran.push('two') })
    emitContained(ctx, 'test/event', ['test/event'], render)
    expect(ran).toEqual(['two'])
    expect(warn).toHaveBeenCalledWith('test/event listener threw: listener one fails')
  })

  it('forwards the scoped carrier by leading args, matching ctx.emit', () => {
    const ctx = new Context()
    const warn = vi.fn()
    ctx.logger.warn = warn
    const carrier = { marker: true }
    const seen: unknown[] = []
    ctx.on('test/event', (value: unknown) => { seen.push(value) })
    emitContained(ctx, 'test/event', [carrier, 'test/event', 'scoped'], render)
    expect(seen).toEqual(['scoped'])
    expect(warn).not.toHaveBeenCalled()
  })
})
