import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { PatentModelPort, PatentModelRequest } from '@deepseek-ai/dsh-patent-core'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { FigureAnalysisResult } from '../src/tool/analyze-patent-figure.ts'
import type { FigureIndexEntry } from '../src/figure/index-store.ts'
import { createAnalyzePatentFigureTool, resolveGateRoute } from '../src/tool/analyze-patent-figure.ts'
import { createTwoStepAnalysisEngine } from '../src/figure/analysis-engine.ts'

const signal = new AbortController().signal
const exec = { signal } as unknown as Parameters<ToolDefinition['execute']>[1]

const ref: ImageAttachmentRef = {
  attachmentId: AttachmentId('sha256:feed'),
  mediaType: 'image/png',
  bytes: 10,
  width: 1,
  height: 1,
}

/** A port that records each request and answers with `text`. */
function capturingModel(text: string, seen: PatentModelRequest[]): PatentModelPort {
  return {
    stream: async function* (request: PatentModelRequest) {
      seen.push(request)
      yield { type: 'delta' as const, text }
      yield { type: 'done' as const }
    },
  }
}

const visionDeps = {
  imageModel: capturingModel('{}', []),
  saveImage: async () => ref,
  gateModel: { provider: 'p', model: 'vision' },
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
  it('denies a text-only model before any file IO', async () => {
    const tool = createAnalyzePatentFigureTool({
      ...visionDeps,
      resolveImageInputModalities: async () => ['text'],
    })
    await expect(tool.execute({ image_path: 'x.png' }, exec)).rejects.toMatchObject({
      name: 'PatentToolError',
      code: 'model_cannot_accept_image',
    })
  })

  it('denies when the model discloses no modalities (unknown defaults to text-only)', async () => {
    const tool = createAnalyzePatentFigureTool({
      ...visionDeps,
      resolveImageInputModalities: async () => undefined,
    })
    await expect(tool.execute({ image_path: 'x.png' }, exec)).rejects.toMatchObject({
      code: 'model_cannot_accept_image',
    })
  })

  it('denies an empty modality list', async () => {
    const tool = createAnalyzePatentFigureTool({
      ...visionDeps,
      resolveImageInputModalities: async () => [],
    })
    await expect(tool.execute({ image_path: 'x.png' }, exec)).rejects.toMatchObject({
      code: 'model_cannot_accept_image',
    })
  })

  it('runs un-gated when no resolver is wired, proceeding to file access', async () => {
    const tool = createAnalyzePatentFigureTool({ ...visionDeps })
    await expect(tool.execute({ image_path: 'does-not-exist.png' }, exec)).rejects.toMatchObject({
      code: 'file_not_found',
    })
  })

  it('fails loud with setup guidance when no figure route is configured', async () => {
    const tool = createAnalyzePatentFigureTool({ saveImage: async () => ref })
    await expect(tool.execute({ image_path: 'x.png' }, exec)).rejects.toMatchObject({
      code: 'setup_required',
    })
  })

  it('fails loud when the attachment store is absent', async () => {
    const tool = createAnalyzePatentFigureTool({
      imageModel: visionDeps.imageModel,
      gateModel: visionDeps.gateModel,
    })
    await expect(tool.execute({ image_path: 'x.png' }, exec)).rejects.toMatchObject({
      code: 'setup_required',
    })
  })
})

describe('analyze_patent_figure vision path', () => {
  it('saves the image, sends the ref with the prompt, and reports the gated route', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-patent-fig-gate-'))
    try {
      await writeFile(join(dir, 'fig1.png'), 'fake-image!')
      const seen: PatentModelRequest[] = []
      const saved: unknown[] = []
      const upserts: unknown[] = []
      const tool = createAnalyzePatentFigureTool({
        imageModel: capturingModel(JSON.stringify({
          figure_type: 'structure',
          overall_description: '整体结构示意图',
          confidence: 0.9,
          components: [{ ref_number: '1', name: '壳体', kind: 'mechanical', description: '外壳' }],
          connections: [],
          figure_description: '图1是本发明实施例提供的装置的结构示意图；图中：1-壳体；',
          warnings: [],
        }), seen),
        saveImage: async (input) => {
          saved.push(input)
          return ref
        },
        gateModel: { provider: 'deepseek-official', model: 'vision' },
        resolveImageInputModalities: async () => ['text', 'image'],
        upsertIndex: async (entry) => {
          upserts.push(entry)
        },
        cwd: dir,
      })
      const result = (await tool.execute(
        { image_path: 'fig1.png', figure_number: 1, claim_context: '权利要求上下文', invention_name: '一种装置' },
        exec,
      )) as FigureAnalysisResult
      expect(result.modelUsed).toBe('deepseek-official/vision')
      expect(result.usable).toBe(true)
      expect(result.warnings).toHaveLength(0)
      expect(saved).toHaveLength(1)
      const savedInput = saved[0] as { data: Uint8Array; mediaType: string; name: string }
      expect(savedInput.mediaType).toBe('image/png')
      expect(savedInput.name).toBe('fig1.png')
      expect(savedInput.data.length).toBeGreaterThan(0)
      expect(seen).toHaveLength(1)
      const request = seen[0] ?? { messages: [] }
      expect(request.messages).toHaveLength(1)
      expect(request.messages[0]?.images).toEqual([ref])
      expect(request.messages[0]?.content).toContain('图1')
      expect(request.messages[0]?.content).toContain('图片已随本请求提供')
      expect(request.messages[0]?.content).not.toContain('尚未接入')
      expect(upserts).toHaveLength(1)
      const entry = upserts[0] as FigureIndexEntry
      expect(entry.imagePath).toBe('fig1.png')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('rejects unsupported extensions before file access', async () => {
    const tool = createAnalyzePatentFigureTool({ ...visionDeps })
    await expect(tool.execute({ image_path: 'x.bmp' }, exec)).rejects.toMatchObject({
      code: 'invalid_tool_input',
    })
  })

  it('maps a store admission failure to invalid_tool_input', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-patent-fig-gate-'))
    try {
      await writeFile(join(dir, 'fig1.png'), 'fake-image!')
      const tool = createAnalyzePatentFigureTool({
        ...visionDeps,
        saveImage: async () => {
          throw new Error('not a real png')
        },
        cwd: dir,
      })
      await expect(tool.execute({ image_path: 'fig1.png' }, exec)).rejects.toMatchObject({
        code: 'invalid_tool_input',
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

/** A port that answers the n-th call with the n-th text (last text repeats). */
function scriptedModel(texts: string[], seen: PatentModelRequest[]): PatentModelPort {
  let call = 0
  return {
    stream: async function* (request: PatentModelRequest) {
      seen.push(request)
      const text = texts[Math.min(call, texts.length - 1)] ?? ''
      call++
      yield { type: 'delta' as const, text }
      yield { type: 'done' as const }
    },
  }
}

const STRUCTURE_PASS = JSON.stringify({
  figure_type: 'structure',
  overall_description: '整体结构示意图',
  confidence: 0.9,
  components: [{ ref_number: '1', name: '壳体', kind: 'mechanical', description: '外壳' }],
  connections: [],
  warnings: [],
})

describe('figure analysis engine seam', () => {
  it('exposes the two-step engine factory with the seam contract', () => {
    const engine = createTwoStepAnalysisEngine({ model: capturingModel('', []) })
    expect(engine.kind).toBe('two-step')
    expect(typeof engine.analyze).toBe('function')
  })
})

describe('analyze_patent_figure two-step mode', () => {
  function twoStepTool(dir: string, texts: string[], seen: PatentModelRequest[]) {
    const model = scriptedModel(texts, seen)
    return createAnalyzePatentFigureTool({
      imageModel: model,
      analysisEngine: createTwoStepAnalysisEngine({ model }),
      saveImage: async () => ref,
      gateModel: { provider: 'p', model: 'vision' },
      resolveImageInputModalities: async () => ['text', 'image'],
      cwd: dir,
    })
  }

  it('performs two model passes and reports the second-pass description', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-patent-fig-2step-'))
    try {
      await writeFile(join(dir, 'fig1.png'), 'fake-image!')
      const seen: PatentModelRequest[] = []
      const description = '图1是本发明实施例提供的装置的结构示意图；图中：1-壳体；'
      const tool = twoStepTool(dir, [STRUCTURE_PASS, description], seen)
      const result = (await tool.execute({ image_path: 'fig1.png', figure_number: 1, invention_name: '一种装置' }, exec)) as FigureAnalysisResult
      expect(seen).toHaveLength(2)
      expect(seen[0]?.messages[0]?.content).toContain('结构抽取')
      expect(seen[0]?.messages[0]?.images).toEqual([ref])
      expect(seen[1]?.messages[0]?.content).toContain('附图说明')
      expect(seen[1]?.messages[0]?.content).toContain('壳体')
      expect(seen[1]?.messages[0]?.images).toEqual([ref])
      // 第二步生成的说明文字成为最终 figureDescription。
      expect(result.figureDescription).toBe(description)
      // 结果形状与单步一致：同字段、组件/置信度来自第一步结构。
      expect(result.figureType).toBe('structure')
      expect(result.components).toHaveLength(1)
      expect(result.components[0]?.refNumber).toBe('1')
      expect(result.confidence).toBe(0.9)
      expect(result.usable).toBe(true)
      expect(result.modelUsed).toBe('p/vision')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('degrades to a best-effort result with a warning when the first pass is unparseable', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-patent-fig-2step-'))
    try {
      await writeFile(join(dir, 'fig1.png'), 'fake-image!')
      const seen: PatentModelRequest[] = []
      const tool = twoStepTool(dir, ['这不是 JSON 输出'], seen)
      const result = (await tool.execute({ image_path: 'fig1.png', figure_number: 1 }, exec)) as FigureAnalysisResult
      // 调用不失败；空组件 best-effort + 警告；第二步被跳过（仅一次模型调用）。
      expect(result.components).toEqual([])
      expect(result.usable).toBe(false)
      expect(result.figureType).toBe('unknown')
      expect(result.warnings.join('\n')).toContain('结构抽取')
      expect(seen).toHaveLength(1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('denies a text-only route in two-step mode with the same image-capability error', async () => {
    const model = capturingModel('{}', [])
    const tool = createAnalyzePatentFigureTool({
      imageModel: model,
      analysisEngine: createTwoStepAnalysisEngine({ model }),
      saveImage: async () => ref,
      gateModel: { provider: 'p', model: 'vision' },
      resolveImageInputModalities: async () => ['text'],
    })
    await expect(tool.execute({ image_path: 'x.png' }, exec)).rejects.toMatchObject({
      code: 'model_cannot_accept_image',
    })
  })
})
