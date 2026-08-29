// @vitest-environment jsdom
/**
 * Coverage round for the chunk loader's production glue the stubbed-loader
 * specs never execute: the default `<script>` injection (success, failure),
 * the per-spec externals tolerance (an unresolvable spec stays undefined
 * until required), and the ETag recorder's no-ETag path (nothing recorded,
 * so the next re-activation re-fetches).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { anyInstanceOf } from './matchers.ts'
import {
  CHUNK_EXTERNALS,
  loadChunk,
  revalidateChunksOnReactivate,
  resetChunks,
  setChunkModuleSystem,
  setChunkScriptLoaderForTests,
} from '../src/client/chunk-loader.ts'
import type { ChunkExports } from '../src/client/chunk-loader.ts'

beforeEach(() => {
  setChunkModuleSystem(undefined)
  delete (globalThis as Record<string, unknown>).__DSH_MODULES__
  delete (globalThis as Record<string, unknown>).__dshChunks__
  resetChunks()
  setChunkScriptLoaderForTests(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.head.innerHTML = ''
})

/** Install a fake module system and simulate a chunk script's registration. */
function simulateScript(name: string, factory: (require: (spec: string) => unknown) => ChunkExports): void {
  const g = globalThis as { __dshChunks__?: Record<string, unknown> }
  g.__dshChunks__ = g.__dshChunks__ ?? {}
  g.__dshChunks__[name] = factory
}

describe('default chunk script loader', () => {
  it('injects a classic async script, then materializes after its load event', async () => {
    setChunkModuleSystem({ import: async spec => ({ seed: spec }) })
    const created: HTMLScriptElement[] = []
    // oxlint-disable-next-line no-deprecated -- capture the real factory before spyOn; oxlint reads the legacy-tag overload as deprecated
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag) as HTMLScriptElement
      if (tag === 'script') created.push(el)
      return el
    })
    const appended = vi.spyOn(document.head, 'append')

    const pending = loadChunk('editor')
    expect(created).toHaveLength(1)
    const el = created[0]!
    expect(el.src).toContain('/sidebar/bundle/editor.js')
    expect(el.async).toBe(true)
    expect(appended).toHaveBeenCalledWith(el)

    // The chunk script executes on the network's schedule: it assigns its
    // factory, and its load event releases the loader.
    simulateScript('editor', require => ({ TextEditor: ((require('react') as { seed: string }).seed) }))
    el.dispatchEvent(new Event('load'))
    const exports = await pending
    expect(exports).toEqual({ TextEditor: 'react' })
    // The element removes itself once consumed.
    expect(el.parentElement).toBeNull()
  })

  it('rejects on the script error event, and the retry re-injects from scratch', async () => {
    setChunkModuleSystem({ import: async spec => ({ seed: spec }) })
    const created: HTMLScriptElement[] = []
    // oxlint-disable-next-line no-deprecated -- capture the real factory before spyOn; oxlint reads the legacy-tag overload as deprecated
    const originalCreate = document.createElement.bind(document)
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreate(tag) as HTMLScriptElement
      if (tag === 'script') created.push(el)
      return el
    })

    const first = loadChunk('editor')
    created[0]!.dispatchEvent(new Event('error'))
    await expect(first).rejects.toThrow('[dsh-better-sidebar] chunk script /sidebar/bundle/editor.js failed to load')

    // The failed load cleared the cache; the retry re-runs the whole loader.
    const second = loadChunk('editor')
    expect(created).toHaveLength(2)
    simulateScript('editor', () => ({ TextEditor: 'ok' }))
    created[1]!.dispatchEvent(new Event('load'))
    await expect(second).resolves.toEqual({ TextEditor: 'ok' })
  })
})

describe('externals table tolerance', () => {
  it('an import the module system rejects stays unresolved until a chunk asks for it', async () => {
    const asked = new Set<string>()
    setChunkModuleSystem({
      import: async (spec) => {
        asked.add(spec)
        if (spec === '@deepseek-ai/dsh-client-runtime/client') throw new Error('no such seed row')
        return { seed: spec }
      },
    })
    setChunkScriptLoaderForTests(async () => {
      simulateScript('terminal', () => ({}))
    })
    // The load succeeds: only the actual require would fail.
    await expect(loadChunk('terminal')).resolves.toEqual({})
    expect(asked).toEqual(new Set(CHUNK_EXTERNALS))
  })
})

describe('ETag recording', () => {
  it('a HEAD response without an ETag records nothing, so re-activation re-fetches', async () => {
    setChunkModuleSystem({ import: async spec => ({ seed: spec }) })
    let scriptCalls = 0
    setChunkScriptLoaderForTests(async () => {
      scriptCalls += 1
      simulateScript('editor', () => ({ TextEditor: `v${scriptCalls}` }))
    })
    // The recorder's HEAD answers without an ETag header.
    const head = vi.fn(async () => ({
      headers: { get: () => null },
    }) as unknown as Response)
    vi.stubGlobal('fetch', head)

    await loadChunk('editor')
    await new Promise((resolve) => { setTimeout(resolve, 5) })
    expect(head).toHaveBeenCalledWith('/sidebar/bundle/editor.js', {
      method: 'HEAD',
      cache: 'no-cache',
      signal: anyInstanceOf(AbortSignal),
    })
    // Nothing recorded → the sweep cannot vouch for the chunk → re-execute.
    await revalidateChunksOnReactivate()
    await loadChunk('editor')
    expect(scriptCalls).toBe(2)
  })
})
