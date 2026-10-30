/**
 * Tests of the cloud MiniMax-H3 provider: request construction, image data
 * URIs, published price estimates, status settlement, download, cancellation,
 * timeout, and config registration.
 */

import { setTimeout as delay } from 'node:timers/promises'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import VideoMode, {
  MINIMAX_PROVIDER_ID,
  MINIMAX_VIDEO_MODEL,
  MiniMaxMediaProvider,
  resolveMediaConfig,
  resolveMiniMax,
  solidPng,
  type MediaTask,
  type MiniMaxConfig,
  type MiniMaxFetchLike,
} from '../src/index.ts'

/** One recorded provider request. */
interface Call {
  readonly url: string
  readonly method: string
  readonly body: string
  readonly authorization: string | undefined
}

/** A 16-byte MP4-shaped payload; the provider does not validate signatures. */
const MP4 = new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0])

/** JSON response helper. */
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

/** Build a fetch stub that records calls and delegates to a router. */
function recorder(route: (call: Call) => Response | Promise<Response>): { calls: Call[]; fetchImpl: MiniMaxFetchLike } {
  const calls: Call[] = []
  const fetchImpl: MiniMaxFetchLike = async (url, init) => {
    const headers = new Headers(init?.headers)
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : '',
      authorization: headers.get('authorization') ?? undefined,
    }
    calls.push(call)
    return route(call)
  }
  return { calls, fetchImpl }
}

/** Settings with short poll intervals and a test key. */
function settingsOf(overrides: MiniMaxConfig = {}) {
  return resolveMiniMax({ enabled: true, apiKey: 'sk-test', pollMs: 1, ...overrides }, 64 * 1024 * 1024)
}

/** Submit one video task through the provider. */
async function submitVideo(
  provider: MiniMaxMediaProvider,
  options: {
    readonly prompt?: string
    readonly durationSec?: number
    readonly resolution?: string
    readonly aspectRatio?: string
    readonly firstFramePath?: string
  } = {},
): Promise<MediaTask> {
  return provider.submit({
    kind: 'video',
    prompt: options.prompt ?? 'a lantern drifts over a river',
    ...options.durationSec === undefined ? {} : { durationSec: options.durationSec },
    ...options.resolution === undefined ? {} : { resolution: options.resolution },
    ...options.aspectRatio === undefined ? {} : { aspectRatio: options.aspectRatio },
    ...options.firstFramePath === undefined
      ? {}
      : { references: [{ kind: 'image', role: 'first-frame', path: options.firstFramePath }] },
  }, new AbortController().signal)
}

describe('minimax configuration', () => {
  it('applies the H3 defaults', () => {
    const settings = settingsOf()
    expect(settings.baseUrl).toBe('https://api.minimax.cn')
    expect(settings.model).toBe(MINIMAX_VIDEO_MODEL)
    expect(settings.resolution).toBe('768P')
    expect(settings.defaultDurationSec).toBe(5)
    expect(settings.maxDurationSec).toBe(15)
    expect(settings.aspectRatio).toBe('9:16')
  })

  it('rejects a missing key, an unsupported resolution, and invalid bounds', () => {
    expect(() => settingsOf({ apiKey: ' ' })).toThrow(/apiKey/)
    expect(() => settingsOf({ resolution: '480P' })).toThrow(/resolution/)
    expect(() => settingsOf({ defaultDurationSec: 3 })).toThrow(/defaultDurationSec/)
    expect(() => settingsOf({ maxDurationSec: 16 })).toThrow(/maxDurationSec/)
    expect(() => settingsOf({ aspectRatio: '2:1' })).toThrow(/aspectRatio/)
    expect(() => settingsOf({ pollMs: 0 })).toThrow(/pollMs/)
    expect(() => settingsOf({ model: 'MiniMax-H3-Highspeed' })).toThrow(/MiniMax-H3/)
  })

  it('resolves the provider only when enabled', () => {
    expect(resolveMediaConfig({ fakeProvider: false }).minimax).toBeUndefined()
    expect(resolveMediaConfig({ fakeProvider: false, minimax: { enabled: true, apiKey: 'k' } }).minimax?.model)
      .toBe(MINIMAX_VIDEO_MODEL)
  })

  it('registers the cloud model when enabled', async () => {
    const ctx = new Context()
    await ctx.plugin(VideoMode, {
      fakeProvider: false,
      videoModel: MINIMAX_VIDEO_MODEL,
      minimax: { enabled: true, apiKey: 'sk-test' },
    }).await()
    expect(ctx.media.models('video').map(model => model.id)).toEqual([MINIMAX_VIDEO_MODEL])
    expect(ctx.media.models('video')[0]?.provider).toBe(MINIMAX_PROVIDER_ID)
    await ctx.fiber.dispose()
  })
})

describe('minimax provider', () => {
  it('submits a text-to-video request with the configured ratio and price', async () => {
    const { calls, fetchImpl } = recorder(() => json({ task_id: '424010985738629' }))
    const provider = new MiniMaxMediaProvider(settingsOf(), fetchImpl)
    const task = await submitVideo(provider, { durationSec: 4, aspectRatio: '16:9' })

    expect(task).toMatchObject({
      id: 'minimax-424010985738629',
      provider: 'minimax',
      model: MINIMAX_VIDEO_MODEL,
      kind: 'video',
      status: 'submitted',
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.minimax.cn/v2/video_generation')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.authorization).toBe('Bearer sk-test')
    const body = JSON.parse(calls[0]?.body ?? '{}') as {
      model?: string
      content?: { type?: string; text?: string }[]
      duration?: number
      resolution?: string
      ratio?: string
    }
    expect(body.model).toBe(MINIMAX_VIDEO_MODEL)
    expect(body.content).toEqual([{ type: 'text', text: 'a lantern drifts over a river' }])
    expect(body.duration).toBe(4)
    expect(body.resolution).toBe('768P')
    expect(body.ratio).toBe('16:9')

    expect(provider.estimate({ kind: 'video', prompt: 'x', durationSec: 4, resolution: '2K' }))
      .toEqual({ cost: { amountMinor: 320, currency: 'CNY' }, durationSec: 4, confidence: 'exact' })
    expect(provider.estimate({ kind: 'video', prompt: 'x', durationSec: 5 }))
      .toEqual({ cost: { amountMinor: 250, currency: 'CNY' }, durationSec: 5, confidence: 'exact' })
  })

  it('attaches a local first frame as a PNG data URI and forces adaptive ratio', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-minimax-'))
    try {
      const frame = join(directory, 'start.png')
      await writeFile(frame, solidPng(4, 4, 255, 128, 0))
      const { calls, fetchImpl } = recorder(() => json({ task_id: 't-1' }))
      const provider = new MiniMaxMediaProvider(settingsOf(), fetchImpl)
      await submitVideo(provider, { firstFramePath: frame, aspectRatio: '9:16' })

      const body = JSON.parse(calls[0]?.body ?? '{}') as {
        content?: { type?: string; role?: string; image_url?: { url?: string } }[]
        ratio?: string
      }
      expect(body.ratio).toBe('adaptive')
      expect(body.content?.[1]?.type).toBe('image_url')
      expect(body.content?.[1]?.role).toBe('first_frame')
      expect(body.content?.[1]?.image_url?.url).toMatch(/^data:image\/png;base64,/)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects mixing a first frame with a reference image', async () => {
    const provider = new MiniMaxMediaProvider(settingsOf(), recorder(() => json({ task_id: 't-1' })).fetchImpl)
    await expect(provider.submit({
      kind: 'video',
      prompt: 'x',
      references: [
        { kind: 'image', role: 'first-frame', path: '/tmp/start.png' },
        { kind: 'image', role: 'style', path: '/tmp/style.png' },
      ],
    }, new AbortController().signal)).rejects.toThrow(/cannot mix/)
  })

  it('rejects a 480P request and a non-integer duration', async () => {
    const provider = new MiniMaxMediaProvider(settingsOf(), recorder(() => json({ task_id: 't-1' })).fetchImpl)
    await expect(submitVideo(provider, { resolution: '480P' })).rejects.toThrow(/768P or 2K/)
    await expect(submitVideo(provider, { durationSec: 4.5 })).rejects.toThrow(/whole-second/)
  })

  it('maps a payment failure to the budget failure code', async () => {
    const provider = new MiniMaxMediaProvider(
      settingsOf(),
      recorder(() => json({ error: { message: 'insufficient balance' } }, 402)).fetchImpl,
    )
    await expect(submitVideo(provider)).rejects.toMatchObject({ code: 'MEDIA_BUDGET_EXCEEDED' })
  })

  it('settles a running task and downloads its video', async () => {
    let statusPolls = 0
    const { fetchImpl } = recorder((call) => {
      if (call.url.endsWith('/v2/video_generation')) return json({ task_id: 't-1' })
      if (call.url.includes('/v2/query/video_generation/')) {
        statusPolls += 1
        return statusPolls === 1
          ? json({ task: { id: 't-1', status: 'running' } })
          : json({
            task: {
              id: 't-1',
              status: 'succeeded',
              content: { url: 'https://cdn.example.test/video.mp4' },
            },
          })
      }
      if (call.url === 'https://cdn.example.test/video.mp4') {
        return new Response(MP4, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': String(MP4.length) } })
      }
      return json({ error: { message: 'unexpected call' } }, 500)
    })
    const provider = new MiniMaxMediaProvider(settingsOf(), fetchImpl)
    const submitted = await submitVideo(provider, { durationSec: 4 })
    const running = await provider.poll(submitted, new AbortController().signal)
    expect(running.status).toBe('running')
    await delay(2)
    const settled = await provider.poll(running, new AbortController().signal)
    expect(settled.status).toBe('succeeded')
    expect(settled.artifacts?.[0]).toMatchObject({
      id: 'video',
      kind: 'video',
      mediaType: 'video/mp4',
      durationSec: 4,
    })
    expect(settled.artifacts?.[0]?.bytes).toEqual(MP4)
  })

  it('reports the provider failure message', async () => {
    const { fetchImpl } = recorder((call) => {
      if (call.url.endsWith('/v2/video_generation')) return json({ task_id: 't-1' })
      return json({ task: { id: 't-1', status: 'failed', error: { code: '1026', message: 'sensitive content' } } })
    })
    const provider = new MiniMaxMediaProvider(settingsOf(), fetchImpl)
    const submitted = await submitVideo(provider)
    const settled = await provider.poll(submitted, new AbortController().signal)
    expect(settled.status).toBe('failed')
    expect(settled.error).toEqual({ code: 'MEDIA_TASK_FAILED', message: 'sensitive content' })
  })

  it('cancels through the delete endpoint', async () => {
    const { calls, fetchImpl } = recorder((call) => {
      if (call.url.endsWith('/v2/video_generation')) return json({ task_id: 't-1' })
      return json({ task_id: 't-1', action: 'cancelled', status: 'cancelled' })
    })
    const provider = new MiniMaxMediaProvider(settingsOf(), fetchImpl)
    const submitted = await submitVideo(provider)
    await provider.cancel(submitted)
    expect(calls[1]?.method).toBe('DELETE')
    expect(calls[1]?.url).toBe('https://api.minimax.cn/v2/video_generation/t-1')
  })

  it('times out a task that does not settle', async () => {
    const { calls, fetchImpl } = recorder((call) => {
      if (call.url.endsWith('/v2/video_generation')) return json({ task_id: 't-1' })
      if (call.method === 'DELETE') return json({ task_id: 't-1', action: 'cancelled', status: 'cancelled' })
      return json({ task: { id: 't-1', status: 'running' } })
    })
    const provider = new MiniMaxMediaProvider(settingsOf({ timeoutMs: 1 }), fetchImpl)
    const submitted = await submitVideo(provider)
    await delay(2)
    const settled = await provider.poll(submitted, new AbortController().signal)
    expect(settled.status).toBe('failed')
    expect(settled.error?.code).toBe('MEDIA_TASK_TIMEOUT')
    expect(calls.some(call => call.method === 'DELETE')).toBe(true)
  })

  it('rejects an artifact above the configured cap', async () => {
    const { fetchImpl } = recorder((call) => {
      if (call.url.endsWith('/v2/video_generation')) return json({ task_id: 't-1' })
      if (call.url.includes('/v2/query/video_generation/')) {
        return json({ task: { id: 't-1', status: 'succeeded', content: { url: 'https://cdn.example.test/large.mp4' } } })
      }
      return new Response(MP4, { status: 200, headers: { 'content-length': '999999' } })
    })
    const settings = resolveMiniMax({ enabled: true, apiKey: 'k', pollMs: 1 }, 100)
    const provider = new MiniMaxMediaProvider(settings, fetchImpl)
    const submitted = await submitVideo(provider)
    const settled = await provider.poll(submitted, new AbortController().signal)
    expect(settled.status).toBe('failed')
    expect(settled.error?.code).toBe('MEDIA_ARTIFACT_TOO_LARGE')
  })
})
