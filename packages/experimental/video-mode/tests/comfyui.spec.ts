/**
 * Tests of the local ComfyUI provider: workflow placeholder substitution,
 * canvas and frame math, submission through an injected fetch, history
 * settlement, timeout, cancellation, and config registration.
 */

import { setTimeout as delay } from 'node:timers/promises'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import VideoMode, {
  COMFYUI_IMAGE_MODEL,
  COMFYUI_VIDEO_MODEL,
  ComfyUiMediaProvider,
  WAN22_TI2V_WORKFLOW,
  attachStartImage,
  canvasFor,
  fillWorkflow,
  frameCountFor,
  resolveComfyUi,
  shortSideOf,
  solidPng,
  type ComfyUiConfig,
  type FetchLike,
  type MediaTask,
  type WorkflowValues,
} from '../src/index.ts'

/** One recorded provider request. */
interface Call {
  readonly url: string
  readonly method: string
  readonly body: string
}

/** A 16-byte MP4-shaped payload; the provider does not validate signatures. */
const MP4 = new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])

/** JSON response helper. */
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

/** Build a fetch stub that records calls and delegates to a router. */
function recorder(route: (call: Call) => Response | Promise<Response>): { calls: Call[]; fetchImpl: FetchLike } {
  const calls: Call[] = []
  const fetchImpl: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
    }
    calls.push(call)
    return route(call)
  }
  return { calls, fetchImpl }
}

/** Settings with short poll intervals for tests. */
function settingsOf(overrides: ComfyUiConfig = {}) {
  return resolveComfyUi({ enabled: true, pollMs: 1, ...overrides }, 64 * 1024 * 1024)
}

/** Values used by the fill tests. */
const VALUES: WorkflowValues = {
  prompt: 'a cat',
  negativePrompt: 'blurry',
  seed: 7,
  width: 480,
  height: 864,
  frames: 121,
  fps: 24,
  filenamePrefix: 'dsh/video',
  checkpoint: 'wan.safetensors',
  textEncoder: 'umt5.safetensors',
  vae: 'vae.safetensors',
}

describe('comfyui workflow filling', () => {
  it('replaces whole placeholders without changing their type', () => {
    const filled = fillWorkflow(WAN22_TI2V_WORKFLOW, VALUES)
    expect(filled['7']?.inputs.width).toBe(480)
    expect(filled['7']?.inputs.height).toBe(864)
    expect(filled['7']?.inputs.length).toBe(121)
    expect(filled['8']?.inputs.seed).toBe(7)
    expect(filled['10']?.inputs.fps).toBe(24)
    expect(filled['1']?.inputs.unet_name).toBe('wan.safetensors')
    expect(filled['4']?.inputs.text).toBe('a cat')
    expect(filled['5']?.inputs.text).toBe('blurry')
  })

  it('keeps unknown placeholders and substitutes inside longer strings', () => {
    const template = { '1': { class_type: 'X', inputs: { a: '{{missing}}', b: 'prefix-{{prompt}}' } } }
    const filled = fillWorkflow(template, VALUES)
    expect(filled['1']?.inputs.a).toBe('{{missing}}')
    expect(filled['1']?.inputs.b).toBe('prefix-a cat')
  })

  it('wires a first frame into the Wan latent node', () => {
    const attached = attachStartImage(fillWorkflow(WAN22_TI2V_WORKFLOW, VALUES), 'frame.png')
    expect(attached['7']?.inputs.start_image).toEqual(['12', 0])
    expect(attached['12']?.class_type).toBe('LoadImage')
    expect(attached['12']?.inputs.image).toBe('frame.png')
    expect(() => attachStartImage({ '1': { class_type: 'X', inputs: {} } }, 'frame.png'))
      .toThrow(/no Wan22ImageToVideoLatent/)
  })
})

describe('comfyui canvas math', () => {
  it('computes portrait, landscape, and square canvases on the pixel lattice', () => {
    expect(canvasFor('9:16', 480, 32)).toEqual({ width: 480, height: 864 })
    expect(canvasFor('16:9', 480, 32)).toEqual({ width: 864, height: 480 })
    expect(canvasFor('1:1', 480, 32)).toEqual({ width: 480, height: 480 })
    expect(() => canvasFor('4:3', 480, 32)).toThrow(/Unsupported aspect ratio/)
  })

  it('rounds frames onto the length lattice', () => {
    expect(frameCountFor(5, 24)).toBe(121)
    expect(frameCountFor(10, 24)).toBe(241)
    expect(frameCountFor(0.1, 24)).toBe(1)
  })

  it('parses resolution labels and rejects malformed ones', () => {
    expect(shortSideOf('480p')).toBe(480)
    expect(shortSideOf('720p')).toBe(720)
    expect(() => shortSideOf('480')).toThrow(/Unsupported resolution/)
    expect(() => shortSideOf('1080')).toThrow(/Unsupported resolution/)
  })
})

describe('comfyui provider', () => {
  it('submits a Wan workflow with typed canvas and duration values', async () => {
    const { calls, fetchImpl } = recorder(() => json({ prompt_id: 'prompt-1' }))
    const provider = new ComfyUiMediaProvider(settingsOf(), fetchImpl)
    const task = await provider.submit(
      { kind: 'video', prompt: 'a cat', durationSec: 5, aspectRatio: '9:16', seed: 7 },
      new AbortController().signal,
    )
    expect(task).toMatchObject({ provider: 'comfyui', model: COMFYUI_VIDEO_MODEL, kind: 'video', status: 'submitted' })
    expect(task.id).toBe('comfyui-prompt-1')
    const body = calls[0]?.body ?? ''
    expect(body).toContain('"width":480')
    expect(body).toContain('"height":864')
    expect(body).toContain('"length":121')
    expect(body).toContain('"seed":7')
    expect(body).toContain('"text":"a cat"')
    expect(body).toContain('wan2.2_ti2v_5B_fp16.safetensors')
    expect(body).toContain('"filename_prefix":"dsh/video"')
  })

  it('submits an image workflow at the configured long side', async () => {
    const { calls, fetchImpl } = recorder(() => json({ prompt_id: 'prompt-2' }))
    const provider = new ComfyUiMediaProvider(settingsOf(), fetchImpl)
    const task = await provider.submit(
      { kind: 'image', prompt: 'a lantern', aspectRatio: '16:9' },
      new AbortController().signal,
    )
    expect(task.model).toBe(COMFYUI_IMAGE_MODEL)
    const body = calls[0]?.body ?? ''
    expect(body).toContain('"width":1024')
    expect(body).toContain('"height":576')
    expect(body).toContain('qwen_3_4b.safetensors')
    expect(body).toContain('SaveImage')
  })

  it('settles a running task and downloads its video', async () => {
    let historyPolls = 0
    const { calls, fetchImpl } = recorder((call) => {
      if (call.url.endsWith('/prompt')) return json({ prompt_id: 'prompt-1' })
      if (call.url.includes('/history/')) {
        historyPolls += 1
        if (historyPolls === 1) return json({})
        return json({
          'prompt-1': {
            status: { status_str: 'success', completed: true },
            outputs: { '11': { images: [{ filename: 'dsh_video_00001_.mp4', subfolder: 'dsh/video', type: 'output' }] } },
          },
        })
      }
      if (call.url.includes('/queue')) return json({ queue_running: [['1', 'prompt-1']], queue_pending: [] })
      if (call.url.includes('/view')) return new Response(MP4, { status: 200 })
      throw new Error(`unexpected request ${call.url}`)
    })
    const provider = new ComfyUiMediaProvider(settingsOf(), fetchImpl)
    const submitted = await provider.submit({ kind: 'video', prompt: 'a cat', durationSec: 5 }, new AbortController().signal)
    const running = await provider.poll(submitted, new AbortController().signal)
    expect(running.status).toBe('running')
    await delay(3)
    const done = await provider.poll(running, new AbortController().signal)
    expect(done.status).toBe('succeeded')
    expect(done.artifacts?.[0]).toMatchObject({ kind: 'video', mediaType: 'video/mp4', width: 480, height: 864, durationSec: 5 })
    expect(done.artifacts?.[0]?.bytes).toEqual(MP4)
    expect(calls.some(call => call.url.includes('/view?filename=dsh_video_00001_.mp4'))).toBe(true)
  })

  it('reports a workflow execution error as a failed task', async () => {
    const { fetchImpl } = recorder((call) => {
      if (call.url.endsWith('/prompt')) return json({ prompt_id: 'prompt-3' })
      if (call.url.includes('/history/')) {
        return json({
          'prompt-3': {
            status: {
              status_str: 'error',
              completed: false,
              messages: [['execution_error', { exception_message: 'MPS backend failed' }]],
            },
            outputs: {},
          },
        })
      }
      throw new Error(`unexpected request ${call.url}`)
    })
    const provider = new ComfyUiMediaProvider(settingsOf(), fetchImpl)
    const submitted = await provider.submit({ kind: 'video', prompt: 'a cat' }, new AbortController().signal)
    await delay(3)
    const failed = await provider.poll(submitted, new AbortController().signal)
    expect(failed.status).toBe('failed')
    expect(failed.error?.message).toContain('MPS backend failed')
  })

  it('fails a task that exceeds the configured timeout', async () => {
    const { calls, fetchImpl } = recorder((call) => {
      if (call.url.endsWith('/prompt')) return json({ prompt_id: 'prompt-4' })
      if (call.url.endsWith('/queue') || call.url.endsWith('/interrupt')) return new Response('{}', { status: 200 })
      throw new Error(`unexpected request ${call.url}`)
    })
    const provider = new ComfyUiMediaProvider(settingsOf({ timeoutMs: 1 }), fetchImpl)
    const submitted = await provider.submit({ kind: 'video', prompt: 'a cat' }, new AbortController().signal)
    await delay(5)
    const failed = await provider.poll(submitted, new AbortController().signal)
    expect(failed.status).toBe('failed')
    expect(failed.error?.code).toBe('MEDIA_TASK_TIMEOUT')
    expect(calls.some(call => call.url.endsWith('/interrupt'))).toBe(true)
  })

  it('cancels through the queue and interrupt endpoints', async () => {
    const { calls, fetchImpl } = recorder((call) => {
      if (call.url.endsWith('/prompt')) return json({ prompt_id: 'prompt-5' })
      if (call.url.endsWith('/queue') || call.url.endsWith('/interrupt')) return new Response('{}', { status: 200 })
      throw new Error(`unexpected request ${call.url}`)
    })
    const provider = new ComfyUiMediaProvider(settingsOf(), fetchImpl)
    const submitted: MediaTask = await provider.submit({ kind: 'video', prompt: 'a cat' }, new AbortController().signal)
    await provider.cancel(submitted)
    const deletion = calls.find(call => call.url.endsWith('/queue'))
    expect(deletion?.body).toContain('prompt-5')
    const interruption = calls.find(call => call.url.endsWith('/interrupt'))
    expect(interruption?.body).toContain('prompt-5')
  })

  it('reports a task that ComfyUI stopped tracking', async () => {
    const { fetchImpl } = recorder((call) => {
      if (call.url.endsWith('/prompt')) return json({ prompt_id: 'prompt-6' })
      if (call.url.includes('/history/')) return json({})
      if (call.url.includes('/queue')) return json({ queue_running: [], queue_pending: [] })
      throw new Error(`unexpected request ${call.url}`)
    })
    const provider = new ComfyUiMediaProvider(settingsOf(), fetchImpl)
    const submitted = await provider.submit({ kind: 'video', prompt: 'a cat' }, new AbortController().signal)
    const failed = await provider.poll(submitted, new AbortController().signal)
    expect(failed.status).toBe('failed')
    expect(failed.error?.message).toContain('no longer reports')
  })

  it('uploads a first-frame image before submitting', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-video-frame-'))
    const frame = join(directory, 'frame.png')
    await writeFile(frame, solidPng(8, 8, 200, 30, 30))
    try {
      const { calls, fetchImpl } = recorder((call) => {
        if (call.url.endsWith('/upload/image')) return json({ name: 'frame.png', subfolder: '', type: 'input' })
        if (call.url.endsWith('/prompt')) return json({ prompt_id: 'prompt-frame' })
        throw new Error(`unexpected request ${call.url}`)
      })
      const provider = new ComfyUiMediaProvider(settingsOf(), fetchImpl)
      const task = await provider.submit(
        { kind: 'video', prompt: 'a cat', references: [{ kind: 'image', role: 'first-frame', path: frame }] },
        new AbortController().signal,
      )
      expect(task.status).toBe('submitted')
      expect(calls[0]?.url).toContain('/upload/image')
      expect(calls[0]?.method).toBe('POST')
      const body = calls[1]?.body ?? ''
      expect(body).toContain('"LoadImage"')
      expect(body).toContain('"start_image":["12",0]')
      expect(body).toContain('"image":"frame.png"')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('surfaces a rejected workflow with node diagnostics', async () => {
    const { fetchImpl } = recorder(() => json({ error: { message: 'Prompt outputs failed validation' } }, 400))
    const provider = new ComfyUiMediaProvider(settingsOf(), fetchImpl)
    await expect(provider.submit({ kind: 'video', prompt: 'a cat' }, new AbortController().signal))
      .rejects.toThrow(/Prompt outputs failed validation/)
  })
})

describe('comfyui configuration', () => {
  it('applies defaults and rejects invalid bounds', () => {
    const settings = settingsOf()
    expect(settings.baseUrl).toBe('http://127.0.0.1:8188')
    expect(settings.video.model).toBe(COMFYUI_VIDEO_MODEL)
    expect(settings.video.resolution).toBe('480p')
    expect(settings.image.size).toBe(1024)
    expect(() => settingsOf({ video: { fps: 0 } })).toThrow(/fps/)
    expect(() => settingsOf({ baseUrl: ' ' })).toThrow(/baseUrl/)
    expect(() => settingsOf({ video: { resolution: '480' } })).toThrow(/resolution/)
    expect(() => settingsOf({ video: { defaultDurationSec: 20, maxDurationSec: 10 } })).toThrow(/maxDurationSec/)
  })

  it('registers the provider models when enabled', async () => {
    const ctx = new Context()
    await ctx.plugin(VideoMode, { fakeProvider: false, comfyui: { enabled: true } }).await()
    expect(ctx.media.models('video').map(model => model.id)).toEqual([COMFYUI_VIDEO_MODEL])
    expect(ctx.media.models('image').map(model => model.id)).toEqual([COMFYUI_IMAGE_MODEL])
    await ctx.fiber.dispose()
  })

  it('polls a submitted task through the runtime', async () => {
    const ctx = new Context()
    await ctx.plugin(VideoMode, { fakeProvider: false, videoModel: 'stub/video' }).await()
    let polls = 0
    ctx.media.register({
      id: 'stub',
      capabilities: ['video'],
      models: () => [{
        id: 'stub/video',
        kind: 'video',
        provider: 'stub',
        price: { amountMinor: 1, currency: 'CNY', unit: 'video-second' },
      }],
      available: () => true,
      estimate: () => ({ confidence: 'exact' }),
      submit: async request => ({ id: 'stub-1', provider: 'stub', model: 'stub/video', kind: request.kind, status: 'submitted' }),
      poll: async (task) => {
        polls += 1
        return { ...task, status: 'succeeded' }
      },
      cancel: async () => {},
    })
    const submitted = await ctx.media.submit({ kind: 'video', prompt: 'x' }, new AbortController().signal)
    expect(submitted.status).toBe('submitted')
    const settled = await ctx.media.refresh(submitted.id, new AbortController().signal)
    expect(settled.status).toBe('succeeded')
    expect(polls).toBe(1)
    await ctx.fiber.dispose()
  })
})
