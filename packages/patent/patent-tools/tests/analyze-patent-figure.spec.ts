import { describe, expect, it } from 'vitest'
import type { PatentModelPort } from '@deepseek-ai/dsh-patent-core'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { createAnalyzePatentFigureTool, resolveGateRoute } from '../src/tool/analyze-patent-figure.ts'

const signal = new AbortController().signal
const exec = { signal } as unknown as Parameters<ToolDefinition['execute']>[1]

/** The gate denies or the file is missing before the model is ever called. */
const stubModel: PatentModelPort = {
  async *stream() {
    yield { type: 'done' as const }
  },
}

describe('resolveGateRoute', () => {
  it('prefers the active agent model when both fields are set', () => {
    expect(resolveGateRoute({ provider: 'active-p', model: 'active-m' }, { provider: 'fb-p', model: 'fb-m' }))
      .toEqual({ provider: 'active-p', model: 'active-m' })
  })

  it('falls back to the Config route when the agent model is empty', () => {
    const fallback = { provider: 'fb-p', model: 'fb-m' }
    expect(resolveGateRoute({ provider: '', model: '' }, fallback)).toEqual(fallback)
    expect(resolveGateRoute({}, fallback)).toEqual(fallback)
    expect(resolveGateRoute(undefined, fallback)).toEqual(fallback)
  })

  it('returns undefined when neither source names a route', () => {
    expect(resolveGateRoute(undefined, undefined)).toBeUndefined()
    expect(resolveGateRoute({}, undefined)).toBeUndefined()
  })
})

describe('analyze_patent_figure image gate', () => {
  it('denies when the figure model does not declare image input', async () => {
    const tool = createAnalyzePatentFigureTool({
      model: stubModel,
      gateModel: { provider: 'p', model: 'text-only' },
      resolveImageInputModalities: async () => ['text'],
    })
    await expect(tool.execute({ image_path: 'x.png' }, exec)).rejects.toMatchObject({
      name: 'PatentToolError',
      code: 'model_cannot_accept_image',
    })
    await expect(tool.execute({ image_path: 'x.png' }, exec)).rejects.toThrow('p/text-only')
    await expect(tool.execute({ image_path: 'x.png' }, exec)).rejects.toThrow('image')
  })

  it('denies when the model discloses no modalities (unknown defaults to text-only)', async () => {
    const tool = createAnalyzePatentFigureTool({
      model: stubModel,
      gateModel: { provider: 'p', model: 'm' },
      resolveImageInputModalities: async () => undefined,
    })
    await expect(tool.execute({ image_path: 'x.png' }, exec)).rejects.toMatchObject({
      code: 'model_cannot_accept_image',
    })
  })

  it('denies an empty modality list', async () => {
    const tool = createAnalyzePatentFigureTool({
      model: stubModel,
      gateModel: { provider: 'p', model: 'm' },
      resolveImageInputModalities: async () => [],
    })
    await expect(tool.execute({ image_path: 'x.png' }, exec)).rejects.toMatchObject({
      code: 'model_cannot_accept_image',
    })
  })

  it('allows when image is declared and proceeds to file access', async () => {
    const tool = createAnalyzePatentFigureTool({
      model: stubModel,
      gateModel: { provider: 'p', model: 'vision' },
      resolveImageInputModalities: async () => ['text', 'image'],
    })
    await expect(tool.execute({ image_path: 'does-not-exist.png' }, exec)).rejects.toMatchObject({
      code: 'file_not_found',
    })
  })

  it('does not gate when no resolver is wired', async () => {
    const tool = createAnalyzePatentFigureTool({ model: stubModel, gateModel: { provider: 'p', model: 'm' } })
    await expect(tool.execute({ image_path: 'does-not-exist.png' }, exec)).rejects.toMatchObject({
      code: 'file_not_found',
    })
  })
})
