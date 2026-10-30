/**
 * Tests of the cloud MiniMax speech provider: configuration bounds, billing
 * character counting, request construction, synchronous settlement, business
 * and transport failures, credential resolution, and registration.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import VideoMode, {
  MINIMAX_SPEECH_MODEL,
  MINIMAX_SPEECH_PROVIDER_ID,
  MINIMAX_SPEECH_VOICE,
  MiniMaxSpeechProvider,
  billingCharsOf,
  resolveMediaConfig,
  resolveMiniMaxSpeech,
  type MiniMaxConfig,
  type MiniMaxFetchLike,
  type MiniMaxSpeechConfig,
  type MiniMaxSpeechSettings,
  type MediaTask,
} from '../src/index.ts'

/** One recorded provider request. */
interface Call {
  readonly url: string
  readonly method: string
  readonly body: string
  readonly authorization: string | undefined
}

/** Four MPEG frame-header bytes; the provider does not decode the payload. */
const MP3 = new Uint8Array([0xff, 0xfb, 0x90, 0x64])
const MP3_HEX = 'fffb9064'

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

/** Settings with a test key and an enabled speech block. */
function settingsOf(
  speech: MiniMaxSpeechConfig = {},
  parent: MiniMaxConfig = {},
): MiniMaxSpeechSettings {
  return resolveMiniMaxSpeech({
    apiKey: 'sk-test',
    ...parent,
    speech: { enabled: true, ...speech },
  }, 64 * 1024 * 1024)
}

/** Submit one speech request through the provider. */
function submitSpeech(
  provider: MiniMaxSpeechProvider,
  options: {
    readonly prompt?: string
    readonly voice?: string
    readonly model?: string
  } = {},
): Promise<MediaTask> {
  return provider.submit({
    kind: 'speech',
    prompt: options.prompt ?? '你好',
    ...options.voice === undefined ? {} : { voice: options.voice },
    ...options.model === undefined ? {} : { model: options.model },
  }, new AbortController().signal)
}

describe('speech configuration', () => {
  it('applies the turbo defaults and a Mandarin voice', () => {
    const settings = settingsOf()
    expect(settings).toMatchObject({
      apiKey: 'sk-test',
      baseUrl: 'https://api.minimax.cn',
      model: MINIMAX_SPEECH_MODEL,
      voiceId: MINIMAX_SPEECH_VOICE,
      speed: 1,
      vol: 1,
      pitch: 0,
      maxArtifactBytes: 64 * 1024 * 1024,
    })
    expect(settings.apiKeyEnv).toBeUndefined()
    expect(settings.emotion).toBeUndefined()
  })

  it('inherits the parent credential and origin and accepts speech overrides', () => {
    const settings = resolveMiniMaxSpeech({
      apiKeyEnv: ' MINIMAX_API_KEY ',
      baseUrl: 'https://example.test///',
      speech: {
        enabled: true,
        model: 'speech-2.8-hd',
        voiceId: ' female-chengshu ',
        speed: 1.2,
        vol: 2,
        pitch: -3,
        emotion: ' calm ',
      },
    }, 1024)
    expect(settings).toMatchObject({
      apiKey: '',
      apiKeyEnv: 'MINIMAX_API_KEY',
      baseUrl: 'https://example.test',
      model: 'speech-2.8-hd',
      voiceId: 'female-chengshu',
      speed: 1.2,
      vol: 2,
      pitch: -3,
      emotion: 'calm',
      maxArtifactBytes: 1024,
    })
  })

  it('rejects invalid bounds, labels, and an empty origin', () => {
    expect(() => resolveMiniMaxSpeech({ baseUrl: '', speech: { enabled: true } }, 10)).toThrow(/minimax.baseUrl/)
    expect(() => resolveMiniMaxSpeech({ speech: { enabled: true, model: ' ' } }, 10)).toThrow(/speech.model/)
    expect(() => resolveMiniMaxSpeech({ speech: { enabled: true, voiceId: ' ' } }, 10)).toThrow(/speech.voiceId/)
    expect(() => resolveMiniMaxSpeech({ speech: { enabled: true, speed: 0.4 } }, 10)).toThrow(/speech.speed/)
    expect(() => resolveMiniMaxSpeech({ speech: { enabled: true, speed: 2.1 } }, 10)).toThrow(/speech.speed/)
    expect(() => resolveMiniMaxSpeech({ speech: { enabled: true, vol: 0 } }, 10)).toThrow(/speech.vol/)
    expect(() => resolveMiniMaxSpeech({ speech: { enabled: true, vol: 11 } }, 10)).toThrow(/speech.vol/)
    expect(() => resolveMiniMaxSpeech({ speech: { enabled: true, pitch: 1.5 } }, 10)).toThrow(/speech.pitch/)
    expect(() => resolveMiniMaxSpeech({ speech: { enabled: true, pitch: 13 } }, 10)).toThrow(/speech.pitch/)
    expect(() => resolveMiniMaxSpeech({ speech: { enabled: true, emotion: 'excited' } }, 10)).toThrow(/speech.emotion/)
  })

  it('resolves the speech provider only when enabled', () => {
    expect(resolveMediaConfig({ fakeProvider: false }).minimaxSpeech).toBeUndefined()
    const speechOnly = resolveMediaConfig({
      fakeProvider: false,
      minimax: { apiKey: 'k', speech: { enabled: true } },
    })
    expect(speechOnly.minimax).toBeUndefined()
    expect(speechOnly.minimaxSpeech?.model).toBe(MINIMAX_SPEECH_MODEL)
  })

  it('defaults an omitted speech block', () => {
    const settings = resolveMiniMaxSpeech({ apiKey: 'k' }, 10)
    expect(settings.model).toBe(MINIMAX_SPEECH_MODEL)
    expect(settings.voiceId).toBe(MINIMAX_SPEECH_VOICE)
  })

  it('registers the speech model when enabled', async () => {
    const ctx = new Context()
    await ctx.plugin(VideoMode, {
      fakeProvider: false,
      speechModel: MINIMAX_SPEECH_MODEL,
      minimax: { apiKey: 'sk-test', speech: { enabled: true } },
    }).await()
    expect(ctx.media.models('speech').map(model => model.id)).toEqual([MINIMAX_SPEECH_MODEL])
    expect(ctx.media.models('speech')[0]?.provider).toBe(MINIMAX_SPEECH_PROVIDER_ID)
    await ctx.fiber.dispose()
  })
})

describe('speech provider', () => {
  it('reports availability from a direct key or credential reference', () => {
    const available = new MiniMaxSpeechProvider(settingsOf())
    expect(available.available()).toBe(true)
    expect(available.unavailableReason()).toBeUndefined()

    const missing = new MiniMaxSpeechProvider(settingsOf({}, { apiKey: '' }))
    expect(missing.available()).toBe(false)
    expect(missing.unavailableReason()).toContain('MINIMAX_API_KEY')

    const referenced = new MiniMaxSpeechProvider(settingsOf({}, { apiKey: '', apiKeyEnv: 'MINIMAX_API_KEY' }))
    expect(referenced.available()).toBe(true)
  })

  it('lists the configured model with its published rate', () => {
    const turbo = new MiniMaxSpeechProvider(settingsOf())
    expect(turbo.models()).toEqual([{
      id: MINIMAX_SPEECH_MODEL,
      kind: 'speech',
      provider: MINIMAX_SPEECH_PROVIDER_ID,
      price: { amountMinor: 20, currency: 'CNY', unit: '1000-chars' },
    }])

    const hd = new MiniMaxSpeechProvider(settingsOf({ model: 'speech-2.8-hd' }))
    expect(hd.models()[0]?.price?.amountMinor).toBe(35)

    const custom = new MiniMaxSpeechProvider(settingsOf({ model: 'speech-custom' }))
    expect(custom.models()[0]?.price).toBeUndefined()
  })

  it('counts Han characters as two billing characters', () => {
    expect(billingCharsOf('你好a')).toBe(5)
    expect(billingCharsOf('abc')).toBe(3)
  })

  it('estimates the prorated cost and rejects other capabilities', () => {
    const turbo = new MiniMaxSpeechProvider(settingsOf())
    expect(turbo.estimate({ kind: 'speech', prompt: 'x'.repeat(1000) }))
      .toEqual({ cost: { amountMinor: 20, currency: 'CNY' }, confidence: 'exact' })
    expect(turbo.estimate({ kind: 'speech', prompt: '你好'.repeat(500) }))
      .toEqual({ cost: { amountMinor: 40, currency: 'CNY' }, confidence: 'exact' })
    expect(turbo.estimate({ kind: 'video', prompt: 'x' })).toEqual({ confidence: 'unknown' })

    const hd = new MiniMaxSpeechProvider(settingsOf({ model: 'speech-2.8-hd' }))
    expect(hd.estimate({ kind: 'speech', prompt: 'x'.repeat(1000) }))
      .toEqual({ cost: { amountMinor: 35, currency: 'CNY' }, confidence: 'exact' })

    const custom = new MiniMaxSpeechProvider(settingsOf({ model: 'speech-custom' }))
    expect(custom.estimate({ kind: 'speech', prompt: 'x' })).toEqual({ confidence: 'unknown' })
  })

  it('synthesizes audio, reports the actual duration and cost, and advances task ids', async () => {
    const { calls, fetchImpl } = recorder(() => json({
      data: { audio: MP3_HEX, status: 2 },
      extra_info: { audio_length: 9900, usage_characters: 26, audio_format: 'mp3' },
      base_resp: { status_code: 0, status_msg: 'success' },
    }))
    const provider = new MiniMaxSpeechProvider(settingsOf(), fetchImpl)

    const first = await submitSpeech(provider, { prompt: '你好' })
    expect(first).toMatchObject({
      id: 'minimax-speech-1',
      provider: MINIMAX_SPEECH_PROVIDER_ID,
      model: MINIMAX_SPEECH_MODEL,
      kind: 'speech',
      status: 'succeeded',
      cost: { amountMinor: 1, currency: 'CNY' },
    })
    expect(first.artifacts).toHaveLength(1)
    expect(first.artifacts?.[0]).toMatchObject({
      id: 'speech',
      kind: 'speech',
      mediaType: 'audio/mpeg',
      durationSec: 9.9,
    })
    expect(first.artifacts?.[0]?.bytes).toEqual(MP3)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      url: 'https://api.minimax.cn/v1/t2a_v2',
      method: 'POST',
      authorization: 'Bearer sk-test',
    })
    const body = JSON.parse(calls[0]?.body ?? '{}') as {
      model?: string
      text?: string
      stream?: boolean
      voice_setting?: Record<string, unknown>
      audio_setting?: Record<string, unknown>
      subtitle_enable?: boolean
    }
    expect(body).toMatchObject({
      model: MINIMAX_SPEECH_MODEL,
      text: '你好',
      stream: false,
      voice_setting: { voice_id: MINIMAX_SPEECH_VOICE, speed: 1, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: 'mp3', channel: 1 },
      subtitle_enable: false,
    })
    expect(body.voice_setting?.emotion).toBeUndefined()

    const second = await submitSpeech(provider)
    expect(second.id).toBe('minimax-speech-2')
  })

  it('uses a request voice and the configured emotion', async () => {
    const { calls, fetchImpl } = recorder(() => json({ data: { audio: MP3_HEX } }))
    const provider = new MiniMaxSpeechProvider(settingsOf({ emotion: 'calm' }), fetchImpl)
    await submitSpeech(provider, { voice: ' female-shaonv ' })
    const body = JSON.parse(calls[0]?.body ?? '{}') as { voice_setting?: Record<string, unknown> }
    expect(body.voice_setting).toMatchObject({ voice_id: 'female-shaonv', emotion: 'calm' })

    await submitSpeech(provider, { voice: '   ' })
    const fallback = JSON.parse(calls[1]?.body ?? '{}') as { voice_setting?: Record<string, unknown> }
    expect(fallback.voice_setting?.voice_id).toBe(MINIMAX_SPEECH_VOICE)
  })

  it('rejects a non-speech request and an unknown model', async () => {
    const provider = new MiniMaxSpeechProvider(settingsOf(), recorder(() => json({})).fetchImpl)
    await expect(provider.submit({ kind: 'video', prompt: 'x' }, new AbortController().signal))
      .rejects.toThrow(/serves speech only/)
    await expect(submitSpeech(provider, { model: 'speech-9.9' }))
      .rejects.toMatchObject({ code: 'MEDIA_MODEL_UNKNOWN' })
  })

  it('maps transport failures to stable codes', async () => {
    const payment = new MiniMaxSpeechProvider(
      settingsOf(),
      recorder(() => json({ error: { message: 'insufficient balance' } }, 402)).fetchImpl,
    )
    await expect(submitSpeech(payment)).rejects.toMatchObject({
      code: 'MEDIA_BUDGET_EXCEEDED',
      message: 'MiniMax speech rejected the request: insufficient balance',
    })

    const invalid = new MiniMaxSpeechProvider(
      settingsOf(),
      recorder(() => json({ error: { message: 'bad text' } }, 400)).fetchImpl,
    )
    await expect(submitSpeech(invalid)).rejects.toMatchObject({ code: 'MEDIA_REQUEST_INVALID' })

    const plain = new MiniMaxSpeechProvider(
      settingsOf(),
      recorder(() => new Response('gateway down', { status: 503 })).fetchImpl,
    )
    await expect(submitSpeech(plain)).rejects.toMatchObject({
      code: 'MEDIA_TASK_FAILED',
      message: 'MiniMax speech rejected the request: gateway down',
    })
  })

  it('maps business failures from base_resp', async () => {
    const auth = new MiniMaxSpeechProvider(
      settingsOf(),
      recorder(() => json({ base_resp: { status_code: 1004, status_msg: 'invalid api key' } })).fetchImpl,
    )
    await expect(submitSpeech(auth)).rejects.toMatchObject({
      code: 'MEDIA_PROVIDER_UNAVAILABLE',
      message: 'MiniMax speech error 1004: invalid api key',
    })

    const balance = new MiniMaxSpeechProvider(
      settingsOf(),
      recorder(() => json({ base_resp: { status_code: 1008, status_msg: 'no balance' } })).fetchImpl,
    )
    await expect(submitSpeech(balance)).rejects.toMatchObject({ code: 'MEDIA_BUDGET_EXCEEDED' })

    const other = new MiniMaxSpeechProvider(
      settingsOf(),
      recorder(() => json({ base_resp: { status_code: 2013, status_msg: '' } })).fetchImpl,
    )
    await expect(submitSpeech(other)).rejects.toMatchObject({
      code: 'MEDIA_TASK_FAILED',
      message: 'MiniMax speech error 2013: no diagnostic returned',
    })
  })

  it('accepts a response without base_resp and reports a fractional duration', async () => {
    const provider = new MiniMaxSpeechProvider(
      settingsOf(),
      recorder(() => json({ data: { audio: MP3_HEX }, extra_info: { audio_length: 500, usage_characters: 2 } })).fetchImpl,
    )
    const task = await submitSpeech(provider)
    expect(task.artifacts?.[0]?.durationSec).toBe(0.5)
    expect(task.cost).toEqual({ amountMinor: 1, currency: 'CNY' })
  })

  it('rejects missing, malformed, and oversized audio', async () => {
    const missingData = new MiniMaxSpeechProvider(
      settingsOf(),
      recorder(() => json({ base_resp: { status_code: 0 } })).fetchImpl,
    )
    await expect(submitSpeech(missingData)).rejects.toThrow(/returned no audio/)

    const missingAudio = new MiniMaxSpeechProvider(
      settingsOf(),
      recorder(() => json({ data: { status: 2 } })).fetchImpl,
    )
    await expect(submitSpeech(missingAudio)).rejects.toThrow(/returned no audio/)

    for (const audio of ['', 'fff', 'zz']) {
      const malformed = new MiniMaxSpeechProvider(
        settingsOf(),
        recorder(() => json({ data: { audio } })).fetchImpl,
      )
      await expect(submitSpeech(malformed)).rejects.toMatchObject({ code: 'MEDIA_ARTIFACT_INVALID' })
    }

    const uppercase = new MiniMaxSpeechProvider(
      settingsOf(),
      recorder(() => json({ data: { audio: 'FFFB9064' } })).fetchImpl,
    )
    expect((await submitSpeech(uppercase)).artifacts?.[0]?.bytes).toEqual(MP3)

    const oversized = new MiniMaxSpeechProvider(
      { ...settingsOf(), maxArtifactBytes: 2 },
      recorder(() => json({ data: { audio: MP3_HEX } })).fetchImpl,
    )
    await expect(submitSpeech(oversized)).rejects.toMatchObject({ code: 'MEDIA_ARTIFACT_TOO_LARGE' })
  })

  it('omits the duration and derives the cost when extra_info is absent or partial', async () => {
    const absent = new MiniMaxSpeechProvider(
      settingsOf(),
      recorder(() => json({ data: { audio: MP3_HEX } })).fetchImpl,
    )
    const task = await submitSpeech(absent, { prompt: '你' })
    expect(task.artifacts?.[0]?.durationSec).toBeUndefined()
    expect(task.cost).toEqual({ amountMinor: 1, currency: 'CNY' })

    const zeroLength = new MiniMaxSpeechProvider(
      settingsOf(),
      recorder(() => json({ data: { audio: MP3_HEX }, extra_info: { audio_length: 0 } })).fetchImpl,
    )
    expect((await submitSpeech(zeroLength)).artifacts?.[0]?.durationSec).toBeUndefined()

    const nonNumber = new MiniMaxSpeechProvider(
      settingsOf(),
      recorder(() => json({
        data: { audio: MP3_HEX },
        extra_info: { audio_length: '9900', usage_characters: '26' },
      })).fetchImpl,
    )
    const fallback = await submitSpeech(nonNumber, { prompt: 'x'.repeat(10) })
    expect(fallback.artifacts?.[0]?.durationSec).toBeUndefined()
    expect(fallback.cost).toEqual({ amountMinor: 1, currency: 'CNY' })
  })

  it('omits the cost for a model without a published price', async () => {
    const provider = new MiniMaxSpeechProvider(
      settingsOf({ model: 'speech-custom' }),
      recorder(() => json({ data: { audio: MP3_HEX }, extra_info: { usage_characters: 1000 } })).fetchImpl,
    )
    const task = await submitSpeech(provider)
    expect(task.model).toBe('speech-custom')
    expect(task.cost).toBeUndefined()
    expect(task.artifacts?.[0]?.mediaType).toBe('audio/mpeg')
  })

  it('resolves a named credential per request and fails when it is unset', async () => {
    const settings = resolveMiniMaxSpeech({
      apiKeyEnv: 'DSH_MINIMAX_SPEECH_KEY',
      speech: { enabled: true },
    }, 1024)
    const seen: string[] = []
    const provider = new MiniMaxSpeechProvider(
      settings,
      recorder(() => json({ data: { audio: MP3_HEX } })).fetchImpl,
      async (ref) => {
        seen.push(ref)
        return 'sk-stored'
      },
    )
    await submitSpeech(provider)
    expect(seen).toEqual(['DSH_MINIMAX_SPEECH_KEY'])

    const empty = new MiniMaxSpeechProvider(
      settings,
      recorder(() => json({ data: { audio: MP3_HEX } })).fetchImpl,
      async () => '',
    )
    await expect(submitSpeech(empty)).rejects.toThrow(/DSH_MINIMAX_SPEECH_KEY is not set/)

    const missing = new MiniMaxSpeechProvider(
      settings,
      recorder(() => json({ data: { audio: MP3_HEX } })).fetchImpl,
      async () => undefined,
    )
    await expect(submitSpeech(missing)).rejects.toMatchObject({ code: 'MEDIA_PROVIDER_UNAVAILABLE' })
  })

  it('resolves a speech credential through the runtime credential service', async () => {
    const originalFetch = globalThis.fetch
    const authorizations: (string | null)[] = []
    globalThis.fetch = async (_url, init) => {
      authorizations.push(new Headers(init?.headers).get('authorization'))
      return json({ data: { audio: MP3_HEX } })
    }
    try {
      const ctx = new Context()
      ctx.provide('credentials', {
        resolve: async () => ({ value: 'sk-runtime', source: 'file' }),
      } as never)
      await ctx.plugin(VideoMode, {
        fakeProvider: false,
        speechModel: MINIMAX_SPEECH_MODEL,
        minimax: { apiKeyEnv: 'DSH_RUNTIME_SPEECH_KEY', speech: { enabled: true } },
      }).await()
      const task = await ctx.media.submit({ kind: 'speech', prompt: '你好' }, new AbortController().signal)
      expect(task.status).toBe('succeeded')
      expect(authorizations).toEqual(['Bearer sk-runtime'])
      await ctx.fiber.dispose()
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('returns the task unchanged from poll and treats cancel as a no-op', async () => {
    const provider = new MiniMaxSpeechProvider(settingsOf())
    const task: MediaTask = {
      id: 't-1',
      provider: MINIMAX_SPEECH_PROVIDER_ID,
      model: MINIMAX_SPEECH_MODEL,
      kind: 'speech',
      status: 'succeeded',
    }
    expect(await provider.poll(task)).toEqual(task)
    await expect(provider.cancel()).resolves.toBeUndefined()
  })
})
