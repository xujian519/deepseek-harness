/**
 * Cloud MiniMax speech provider. It sends one synchronous T2A request and
 * settles immediately with the returned MP3 bytes. MiniMax bills per character:
 * one Han character counts as two billing characters, and every other
 * character counts as one. Prices are the published CNY rates per 10,000
 * characters: 2.00 for `speech-2.8-turbo` and 3.50 for `speech-2.8-hd`.
 * @module @deepseek-ai/dsh-experimental-video-mode/minimax-speech
 */

import {
  failureCodeFor,
  isRecord,
  minimaxJsonHeaders,
  parseJson,
  rejectionMessage,
  resolveMiniMaxKey,
  type MiniMaxFetchLike,
  type MiniMaxKeyResolver,
} from './minimax-common.ts'
import {
  MediaFailure,
  type MediaArtifact,
  type MediaEstimate,
  type MediaKind,
  type MediaModel,
  type MediaProvider,
  type MediaRequest,
  type MediaTask,
} from './types.ts'

/** Registered provider id of the MiniMax speech backend. */
export const MINIMAX_SPEECH_PROVIDER_ID = 'minimax-speech'

/** Speech model this provider submits by default. */
export const MINIMAX_SPEECH_MODEL = 'speech-2.8-turbo'

/** Default Mandarin voice used when a request names none. */
export const MINIMAX_SPEECH_VOICE = 'Chinese (Mandarin)_News_Anchor'

/** Emotion labels the T2A API accepts. */
export const MINIMAX_SPEECH_EMOTIONS = [
  'happy',
  'sad',
  'angry',
  'fearful',
  'disgusted',
  'surprised',
  'calm',
  'fluent',
  'whisper',
] as const

/** One accepted speech emotion label. */
export type MiniMaxSpeechEmotion = typeof MINIMAX_SPEECH_EMOTIONS[number]

/** Speech settings after defaults. */
export interface MiniMaxSpeechSettings {
  /** Direct bearer API key; empty when the deployment names a credential ref instead. */
  readonly apiKey: string
  /** Credential reference resolved per request through `ctx.credentials`. */
  readonly apiKeyEnv?: string
  /** API origin, for example `https://api.minimax.cn`. */
  readonly baseUrl: string
  /** Speech model id reported to consumers and submitted to the API. */
  readonly model: string
  /** Default system voice id. */
  readonly voiceId: string
  /** Speech speed multiplier in `[0.5, 2]`. */
  readonly speed: number
  /** Volume multiplier in `(0, 10]`. */
  readonly vol: number
  /** Pitch offset in `[-12, 12]`. */
  readonly pitch: number
  /** Fixed emotion, or undefined to let the model infer it from the text. */
  readonly emotion?: MiniMaxSpeechEmotion
  /** Largest accepted artifact size in bytes, inherited from the media runtime. */
  readonly maxArtifactBytes: number
}

/** Published MiniMax T2A price in fen per 10,000 billing characters. */
const PRICE_PER_10K_CHARS_MINOR: Readonly<Record<string, number>> = {
  'speech-2.8-hd': 350,
  'speech-2.8-turbo': 200,
  'speech-2.6-hd': 350,
  'speech-2.6-turbo': 200,
  'speech-02-hd': 350,
  'speech-02-turbo': 200,
  'speech-01-hd': 350,
  'speech-01-turbo': 200,
}

/** MP3 encoding used by the assembler's decoder. */
const SAMPLE_RATE_HZ = 32_000
const BITRATE = 128_000

/** One Han character bills as two characters; every other character bills as one. */
const HAN_CHARACTER = /\p{Script=Han}/u

/**
 * Count the characters MiniMax bills for one text.
 * @param text - synthesis text.
 * @returns the billing character count.
 */
export function billingCharsOf(text: string): number {
  let total = 0
  for (const character of text) total += HAN_CHARACTER.test(character) ? 2 : 1
  return total
}

/**
 * Price one request from its billing characters and published rate.
 * @param chars - billing characters.
 * @param pricePer10k - fen per 10,000 characters.
 * @returns the prorated cost in fen, never below one.
 */
function costMinorOf(chars: number, pricePer10k: number): number {
  return Math.max(1, Math.ceil(chars * pricePer10k / 10_000))
}

/**
 * Decode the hex audio field MiniMax returns.
 * @param value - hex-encoded MP3 bytes.
 * @returns the decoded bytes.
 * @throws {@link MediaFailure} `MEDIA_ARTIFACT_INVALID` for an empty or malformed value.
 */
function decodeAudio(value: string): Uint8Array {
  if (value.length === 0 || value.length % 2 !== 0 || !/^[0-9a-f]+$/iu.test(value)) {
    throw new MediaFailure('MiniMax speech returned malformed audio data', 'MEDIA_ARTIFACT_INVALID')
  }
  return new Uint8Array(Buffer.from(value, 'hex'))
}

/**
 * Map a MiniMax business status to a stable failure code.
 * @param status - `base_resp.status_code` from the response.
 * @returns the failure code.
 */
function businessCodeFor(status: number): MediaFailure['code'] {
  if (status === 1004) return 'MEDIA_PROVIDER_UNAVAILABLE'
  if (status === 1008) return 'MEDIA_BUDGET_EXCEEDED'
  return 'MEDIA_TASK_FAILED'
}

/**
 * MiniMax speech provider. `submit` performs the synchronous T2A request and
 * returns a succeeded task with inline MP3 bytes; `poll` and `cancel` are
 * idempotent because the task never leaves the provider.
 */
export class MiniMaxSpeechProvider implements MediaProvider {
  /** Registered provider id. */
  readonly id = MINIMAX_SPEECH_PROVIDER_ID

  /** Capability this provider serves. */
  readonly capabilities: readonly MediaKind[] = ['speech']

  private readonly modelsById: readonly MediaModel[]
  private readonly pricePer10k: number | undefined
  private counter = 0

  /**
   * @param settings - resolved provider settings.
   * @param fetchImpl - fetch implementation; tests inject a stub.
   * @param resolveApiKey - credential resolver for `apiKeyEnv`; omitted reads the process environment.
   */
  constructor(
    private readonly settings: MiniMaxSpeechSettings,
    private readonly fetchImpl: MiniMaxFetchLike = fetch,
    private readonly resolveApiKey?: MiniMaxKeyResolver,
  ) {
    const pricePer10k = PRICE_PER_10K_CHARS_MINOR[settings.model]
    this.pricePer10k = pricePer10k
    this.modelsById = [{
      id: settings.model,
      kind: 'speech',
      provider: MINIMAX_SPEECH_PROVIDER_ID,
      ...pricePer10k === undefined
        ? {}
        : { price: { amountMinor: Math.ceil(pricePer10k / 10), currency: 'CNY', unit: '1000-chars' } },
    }]
  }

  /** Models the configured MiniMax key serves. */
  models(): readonly MediaModel[] {
    return this.modelsById
  }

  /** A key or credential reference was configured; reachability is proven by the first submission. */
  available(): boolean {
    return this.settings.apiKey.length > 0 || this.settings.apiKeyEnv !== undefined
  }

  /** Explain the missing credential so selection can report a remedy. */
  unavailableReason(): string | undefined {
    return this.available() ? undefined : 'set MINIMAX_API_KEY in the environment or name it through minimax.apiKeyEnv'
  }

  /**
   * Estimate one speech request from the published per-character rate.
   * @param request - requested generation.
   * @returns the prorated cost, or unknown for non-speech kinds.
   */
  estimate(request: MediaRequest): MediaEstimate {
    if (request.kind !== 'speech') return { confidence: 'unknown' }
    if (this.pricePer10k === undefined) return { confidence: 'unknown' }
    return {
      cost: { amountMinor: costMinorOf(billingCharsOf(request.prompt), this.pricePer10k), currency: 'CNY' },
      confidence: 'exact',
    }
  }

  /**
   * Synthesize one speech request and settle it with the returned MP3.
   * @param request - requested generation.
   * @param signal - caller cancellation.
   * @returns the succeeded task with its audio artifact and actual cost.
   * @throws {@link MediaFailure} for an unknown model, missing credential, rejected request, or malformed audio.
   */
  async submit(request: MediaRequest, signal: AbortSignal): Promise<MediaTask> {
    if (request.kind !== 'speech') {
      throw new MediaFailure(`MiniMax speech serves speech only, not ${request.kind}`, 'MEDIA_REQUEST_INVALID')
    }
    if ((request.model ?? this.settings.model) !== this.settings.model) {
      throw new MediaFailure(`MiniMax serves no speech model ${JSON.stringify(request.model)}`, 'MEDIA_MODEL_UNKNOWN')
    }
    const requestedVoice = request.voice?.trim() ?? ''
    const voiceId = requestedVoice.length === 0 ? this.settings.voiceId : requestedVoice
    const body = {
      model: this.settings.model,
      text: request.prompt,
      stream: false,
      voice_setting: {
        voice_id: voiceId,
        speed: this.settings.speed,
        vol: this.settings.vol,
        pitch: this.settings.pitch,
        ...this.settings.emotion === undefined ? {} : { emotion: this.settings.emotion },
      },
      audio_setting: {
        sample_rate: SAMPLE_RATE_HZ,
        bitrate: BITRATE,
        format: 'mp3',
        channel: 1,
      },
      subtitle_enable: false,
    }
    const response = await this.fetchImpl(`${this.settings.baseUrl}/v1/t2a_v2`, {
      method: 'POST',
      headers: minimaxJsonHeaders(await resolveMiniMaxKey(this.settings, this.resolveApiKey)),
      body: JSON.stringify(body),
      signal,
    })
    const text = await response.text()
    if (!response.ok) {
      throw new MediaFailure(
        `MiniMax speech rejected the request: ${rejectionMessage(text, response.statusText)}`,
        failureCodeFor(response.status),
      )
    }
    const parsed = parseJson(text)
    const base = isRecord(parsed) && isRecord(parsed.base_resp) ? parsed.base_resp : undefined
    if (base !== undefined && typeof base.status_code === 'number' && base.status_code !== 0) {
      const reason = typeof base.status_msg === 'string' && base.status_msg.length > 0
        ? base.status_msg
        : 'no diagnostic returned'
      throw new MediaFailure(`MiniMax speech error ${base.status_code}: ${reason}`, businessCodeFor(base.status_code))
    }
    const data = isRecord(parsed) && isRecord(parsed.data) ? parsed.data : undefined
    const hex = data !== undefined && typeof data.audio === 'string' ? data.audio : undefined
    if (hex === undefined) {
      throw new MediaFailure('MiniMax speech returned no audio', 'MEDIA_ARTIFACT_INVALID')
    }
    const bytes = decodeAudio(hex)
    if (bytes.length > this.settings.maxArtifactBytes) {
      throw new MediaFailure(
        `MiniMax speech returned ${bytes.length} bytes, above the configured ${this.settings.maxArtifactBytes}-byte cap`,
        'MEDIA_ARTIFACT_TOO_LARGE',
      )
    }
    const info = isRecord(parsed) && isRecord(parsed.extra_info) ? parsed.extra_info : undefined
    const audioLength = info !== undefined && typeof info.audio_length === 'number' && Number.isFinite(info.audio_length)
      ? info.audio_length
      : undefined
    const usage = info !== undefined && typeof info.usage_characters === 'number' && Number.isFinite(info.usage_characters)
      ? info.usage_characters
      : undefined
    const costMinor = this.pricePer10k === undefined
      ? undefined
      : costMinorOf(usage ?? billingCharsOf(request.prompt), this.pricePer10k)
    const artifact: MediaArtifact = {
      id: 'speech',
      kind: 'speech',
      mediaType: 'audio/mpeg',
      bytes,
      ...audioLength === undefined || audioLength <= 0 ? {} : { durationSec: audioLength / 1000 },
    }
    this.counter += 1
    return {
      id: `${MINIMAX_SPEECH_PROVIDER_ID}-${this.counter}`,
      provider: this.id,
      model: this.settings.model,
      kind: 'speech',
      status: 'succeeded',
      ...costMinor === undefined ? {} : { cost: { amountMinor: costMinor, currency: 'CNY' } },
      artifacts: [artifact],
    }
  }

  /**
   * Return the task unchanged; synthesis settles during submission.
   * @param task - current task.
   * @returns the same task.
   */
  poll(task: MediaTask): Promise<MediaTask> {
    return Promise.resolve(task)
  }

  /** Cancellation is a no-op because synthesis settles during submission. */
  cancel(): Promise<void> {
    return Promise.resolve()
  }
}
