import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithVizWasm, vizLoadFailureMessage } from '../src/figure/viz-wasm-renderer.ts'
import type { GraphvizRenderSpec } from '../src/figure/graphviz-renderer.ts'

// 内置引擎的默认加载器只在 @viz-js/viz 本身加载失败时走「不缓存失败、下次重试」的
// 收尾分支；把包替换成 instance() 恒抛错的替身才能在单测里命中它（真实包不会失败）。
const mockViz = vi.hoisted(() => ({ instanceCalls: 0 }))

vi.mock('@viz-js/viz', () => ({
  instance: () => {
    mockViz.instanceCalls += 1
    throw new Error('wasm 资产缺失')
  },
}))

let temp: string | undefined

afterEach(async () => {
  mockViz.instanceCalls = 0
  if (temp !== undefined) {
    await rm(temp, { recursive: true, force: true })
    temp = undefined
  }
})

async function tempDir(): Promise<string> {
  temp = await mkdtemp(join(tmpdir(), 'viz-wasm-loader-'))
  return temp
}

function spec(outputDir: string): GraphvizRenderSpec {
  return { dot: 'digraph { a -> b }', filename: 'fig1', format: 'svg', engine: 'dot', outputDir }
}

describe('内置引擎默认加载器', () => {
  it('加载失败映射 not_installed，且失败不缓存（下一次调用重试加载）', async () => {
    const dir = await tempDir()
    const first = await renderWithVizWasm(spec(dir))
    expect(first).toEqual({ ok: false, code: 'not_installed', error: vizLoadFailureMessage('wasm 资产缺失') })

    const second = await renderWithVizWasm(spec(dir))
    expect(second).toMatchObject({ ok: false, code: 'not_installed' })
    expect(mockViz.instanceCalls).toBe(2)
  })
})
