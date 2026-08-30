import { open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertPositiveFinite,
  assertPositiveInteger,
  assertResolvedConfig,
  deepFreeze,
  isEEXIST,
  isENOENT,
  isPlainObject,
  isRecord,
  errorMessage,
  toError,
} from '@deepseek-ai/dsh-value'

/** Resolve with the caught rejection, failing the test when nothing rejects. */
async function caught(probe: Promise<unknown>): Promise<unknown> {
  try {
    await probe
  } catch (error) {
    return error
  }
  throw new Error('expected the probe to reject')
}

describe('isRecord', () => {
  it('accepts plain objects and nested records', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord({ type: 'image', count: 2 })).toBe(true)
    expect(isRecord({ nested: { deep: true } })).toBe(true)
  })

  it('accepts non-plain objects: the guard owns the object shape, not the prototype', () => {
    expect(isRecord(new Date())).toBe(true)
    expect(isRecord(new Map())).toBe(true)
    expect(isRecord(/re/)).toBe(true)
    class InstanceBox { value = 1 }
    expect(isRecord(new InstanceBox())).toBe(true)
  })

  it('rejects null, arrays, primitives, and functions', () => {
    expect(isRecord(null)).toBe(false)
    expect(isRecord(undefined)).toBe(false)
    expect(isRecord([])).toBe(false)
    expect(isRecord(['entry'])).toBe(false)
    expect(isRecord(42)).toBe(false)
    expect(isRecord('text')).toBe(false)
    expect(isRecord(true)).toBe(false)
    expect(isRecord(() => {})).toBe(false)
  })

  it('narrows the value so properties can be read as unknown', () => {
    const value: unknown = { kind: 'response' }
    if (!isRecord(value)) throw new Error('expected a record')
    expect(value.kind).toBe('response')
  })
})

describe('assertPositiveInteger', () => {
  it('accepts integers >= 1 and narrows unknown to number', () => {
    const value: unknown = 3
    assertPositiveInteger('maxDepth', value)
    expect(value + 1).toBe(4)
    assertPositiveInteger('one', 1)
  })

  it('throws a TypeError naming the label for non-integers and values below 1', () => {
    for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => { assertPositiveInteger('limit', bad) }).toThrow(TypeError)
      expect(() => { assertPositiveInteger('limit', bad) }).toThrow('limit must be a positive integer')
    }
  })

  it('throws for non-number values, including numeric strings and null', () => {
    for (const bad of ['1', null, undefined, true, { value: 1 }]) {
      expect(() => { assertPositiveInteger('retries', bad) }).toThrow('retries must be a positive integer')
    }
  })
})

describe('assertPositiveFinite', () => {
  it('accepts positive finite numbers, including non-integers, and narrows unknown to number', () => {
    const value: unknown = 1.5
    assertPositiveFinite('graceMs', value)
    expect(value + 1).toBe(2.5)
    assertPositiveFinite('one', 1)
  })

  it('throws a TypeError naming the label for zero, negatives, infinities, and non-numbers', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '1', null, undefined]) {
      expect(() => { assertPositiveFinite('graceMs', bad) }).toThrow(TypeError)
      expect(() => { assertPositiveFinite('graceMs', bad) }).toThrow('graceMs must be a positive finite number')
    }
  })
})

describe('assertResolvedConfig', () => {
  interface Config { cwd?: string; timeoutMs?: number; graceMs?: number }

  it('returns the same object typed at the resolved shape when every field is present', () => {
    const config = { cwd: '/tmp', timeoutMs: 120_000, graceMs: 3_000 }
    const resolved = assertResolvedConfig<Config>('bash-local', config)
    expect(resolved).toBe(config)
    expect(resolved.timeoutMs).toBe(120_000)
  })

  it('throws naming the label and field when a default-backed field is undefined', () => {
    const config = Object.assign({ cwd: '/tmp', graceMs: 3_000 }, { timeoutMs: undefined })
    expect(() => { assertResolvedConfig('bash-local', config, ['cwd']) })
      .toThrow('bash-local: config field "timeoutMs" is undefined after schema resolution; a schema default did not run')
  })

  it('allows undefined only for the declared defaultless keys', () => {
    const config = { timeoutMs: 120_000, graceMs: 3_000 }
    const resolved = assertResolvedConfig<Config, 'cwd'>('bash-local', config, ['cwd'])
    expect(resolved.cwd).toBeUndefined()
    expect(resolved.timeoutMs).toBe(120_000)
  })

  it('passes an object that omits fields entirely (key presence is not reconstructed)', () => {
    expect(assertResolvedConfig<Config, 'cwd' | 'timeoutMs' | 'graceMs'>('bash-local', {}, ['cwd', 'timeoutMs', 'graceMs']))
      .toEqual({})
  })
})

describe('isPlainObject', () => {
  it('accepts object-prototype and null-prototype records', () => {
    expect(isPlainObject({})).toBe(true)
    expect(isPlainObject({ kind: 'response' })).toBe(true)
    const nullPrototype = Object.create(null) as Record<string, unknown>
    nullPrototype.kind = 'bare'
    expect(isPlainObject(nullPrototype)).toBe(true)
  })

  it('rejects null, arrays, primitives, and class instances', () => {
    expect(isPlainObject(null)).toBe(false)
    expect(isPlainObject(undefined)).toBe(false)
    expect(isPlainObject([])).toBe(false)
    expect(isPlainObject(42)).toBe(false)
    expect(isPlainObject('text')).toBe(false)
    expect(isPlainObject(new Date())).toBe(false)
    expect(isPlainObject(new Map())).toBe(false)
    class InstanceBox { value = 1 }
    expect(isPlainObject(new InstanceBox())).toBe(false)
  })

  it('narrows the value so properties can be read as unknown', () => {
    const value: unknown = { kind: 'response' }
    if (!isPlainObject(value)) throw new Error('expected a plain object')
    expect(value.kind).toBe('response')
  })
})

describe('isENOENT', () => {
  it('accepts a real filesystem absence error', async () => {
    const error = await caught(open(join(tmpdir(), `dsh-value-enoent-missing-${process.pid}`)))
    expect(isENOENT(error)).toBe(true)
  })

  it('rejects non-ENOENT errors and non-error lookalikes so they surface', () => {
    expect(isENOENT(new Error('other failure'))).toBe(false)
    expect(isENOENT(Object.assign(new Error('denied'), { code: 'EACCES' }))).toBe(false)
    expect(isENOENT({ code: 'ENOENT' })).toBe(false)
    expect(isENOENT(null)).toBe(false)
    expect(isENOENT(undefined)).toBe(false)
    expect(isENOENT('ENOENT')).toBe(false)
  })
})

describe('isEEXIST', () => {
  it('accepts a real exclusive-create collision error', async () => {
    const probe = join(tmpdir(), `dsh-value-eexist-${process.pid}`)
    await writeFile(probe, '')
    try {
      const error = await caught(writeFile(probe, '', { flag: 'wx' }))
      expect(isEEXIST(error)).toBe(true)
    } finally {
      await rm(probe, { force: true })
    }
  })

  it('rejects non-EEXIST errors and non-error lookalikes so they surface', () => {
    expect(isEEXIST(new Error('other failure'))).toBe(false)
    expect(isEEXIST({ code: 'EEXIST' })).toBe(false)
    expect(isEEXIST(null)).toBe(false)
    expect(isEEXIST(undefined)).toBe(false)
  })
})

describe('deepFreeze', () => {
  it('freezes nested structure in place and returns the same reference', () => {
    const value = { a: { b: [1, { c: 'x' }] } }
    const frozen = deepFreeze(value)
    expect(frozen).toBe(value)
    expect(Object.isFrozen(value)).toBe(true)
    expect(Object.isFrozen(value.a)).toBe(true)
    expect(Object.isFrozen(value.a.b)).toBe(true)
    expect(Object.isFrozen(value.a.b[1])).toBe(true)
    // ESM runs in strict mode: mutation throws rather than silently failing.
    expect(() => { (value.a.b[1] as { c: string }).c = 'y' }).toThrow(TypeError)
  })

  it('never freezes an AbortSignal: the live cancellation channel keeps working', () => {
    const controller = new AbortController()
    const request = deepFreeze({ model: 'm', signal: controller.signal })
    expect(Object.isFrozen(request)).toBe(true)
    expect(Object.isFrozen(controller.signal)).toBe(false)
    let fired = false
    controller.signal.addEventListener('abort', () => { fired = true }, { once: true })
    controller.abort('stop')
    expect(fired).toBe(true)
    expect(controller.signal.aborted).toBe(true)
  })

  it('passes primitives through and terminates on cycles', () => {
    expect(deepFreeze(42)).toBe(42)
    expect(deepFreeze(null)).toBeNull()
    const cyclic = { self: undefined as unknown }
    cyclic.self = cyclic
    deepFreeze(cyclic)
    expect(Object.isFrozen(cyclic)).toBe(true)
  })

  it('freezes nesting deeper than the JavaScript call stack', () => {
    const depth = 5_000
    const root: unknown[] = []
    let cursor = root
    for (let index = 0; index < depth; index++) {
      const child: unknown[] = []
      cursor.push(child)
      cursor = child
    }

    deepFreeze(root)

    cursor = root
    for (let index = 0; index < depth; index++) {
      expect(Object.isFrozen(cursor)).toBe(true)
      cursor = cursor[0] as unknown[]
    }
    expect(Object.isFrozen(cursor)).toBe(true)
  })
})

describe('errorMessage', () => {
  it('renders Error instances as their message', () => {
    expect(errorMessage(new TypeError('boom'))).toBe('boom')
    expect(errorMessage(new Error(''))).toBe('')
  })

  it('renders non-Error values through their string-message property first', () => {
    expect(errorMessage({ message: 'denied' })).toBe('denied')
    expect(errorMessage({ message: 42 })).toBe('[object Object]')
    expect(errorMessage('offline')).toBe('offline')
    expect(errorMessage(42)).toBe('42')
    expect(errorMessage(undefined)).toBe('undefined')
  })

  it('is total: a trapping thrown value yields the fixed placeholder', () => {
    expect(errorMessage({ toString: () => { throw new Error('coercion trap') } })).toBe('[unrenderable thrown value]')
    expect(errorMessage(new Proxy({}, { get() { throw new Error('getter trap') } }))).toBe('[unrenderable thrown value]')
  })
})

describe('toError', () => {
  it('passes real Error instances through untouched', () => {
    const error = new TypeError('boom')
    expect(toError(error)).toBe(error)
  })

  it('wraps non-Error values in an Error carrying the rendered message', () => {
    const error = toError('offline')
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('offline')
    expect(toError({ message: 'denied' }).message).toBe('denied')
  })

  it('survives a thrown value that traps instanceof', () => {
    const trap = new Proxy({}, { getPrototypeOf() { throw new Error('instanceof trap') } })
    const error = toError(trap)
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toBe('[unrenderable thrown value]')
  })
})
