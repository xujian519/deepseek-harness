import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_FREECAD_RENDER_TIMEOUT_MS, DEFAULT_GRAPHVIZ_RENDER_TIMEOUT_MS } from '@deepseek-ai/dsh-patent-tools'

describe('Config 渲染预算', () => {
  it('缺省取渲染器导出的默认超时', () => {
    const config = Config({})
    expect(config.graphvizRenderTimeoutMs).toBe(DEFAULT_GRAPHVIZ_RENDER_TIMEOUT_MS)
    expect(config.freecadRenderTimeoutMs).toBe(DEFAULT_FREECAD_RENDER_TIMEOUT_MS)
  })

  it('接受 cordis.yml 给出的显式超时', () => {
    const config = Config({ graphvizRenderTimeoutMs: 5_000, freecadRenderTimeoutMs: 300_000 })
    expect(config.graphvizRenderTimeoutMs).toBe(5_000)
    expect(config.freecadRenderTimeoutMs).toBe(300_000)
  })

  it('拒绝非正超时', () => {
    expect(() => Config({ graphvizRenderTimeoutMs: 0 })).toThrow()
    expect(() => Config({ freecadRenderTimeoutMs: -1 })).toThrow()
  })
})
