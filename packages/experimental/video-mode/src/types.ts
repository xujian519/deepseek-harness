/**
 * Vocabulary for the experimental video mode: the media provider seam, the
 * durable project document, the edit decision list the assembler consumes, and
 * the typed failures every tool routes on.
 * @module @deepseek-ai/dsh-experimental-video-mode/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'

/** Media capabilities a provider may serve. */
export type MediaKind = 'image' | 'video' | 'speech'

/** Terminal and in-flight states of one media task. */
export type MediaTaskStatus = 'queued' | 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** Currency carried by a price. */
export type MediaCurrency = 'CNY' | 'USD'

/** Provider price in the smallest currency unit, per the named unit. */
export interface MediaPrice {
  /** Integer minor units, for example fen for CNY. */
  readonly amountMinor: number
  /** Currency of {@link amountMinor}. */
  readonly currency: MediaCurrency
  /** What one price covers: `image`, `video-second`, or `1000-chars`. */
  readonly unit: 'image' | 'video-second' | '1000-chars'
}

/** One model a provider serves. */
export interface MediaModel {
  /** Provider-local model id, unique within the provider. */
  readonly id: string
  /** Capability this model produces. */
  readonly kind: MediaKind
  /** Registered provider id. */
  readonly provider: string
  /** Longest accepted duration for `video`. */
  readonly maxDurationSec?: number
  /** Accepted aspect ratios, for example `9:16`. */
  readonly aspectRatios?: readonly string[]
  /** Accepted reference roles for `video`. */
  readonly referenceModes?: readonly ('image' | 'first-frame' | 'last-frame')[]
  /** Whether a `video` model produces an audio track. */
  readonly audio?: boolean
  /** Published price, when the provider knows it. */
  readonly price?: MediaPrice
}

/** One reference input attached to a media request. */
export interface MediaReference {
  /** Reference media kind. */
  readonly kind: 'image' | 'video' | 'audio'
  /** Path readable through the calling Session filesystem. */
  readonly path: string
  /** Role the provider should give the reference. */
  readonly role?: 'style' | 'character' | 'first-frame' | 'last-frame'
}

/** One normalized generation request. */
export interface MediaRequest {
  /** Requested capability. */
  readonly kind: MediaKind
  /** Provider model id; omitted selects the configured default for the kind. */
  readonly model?: string
  /** Positive prompt. */
  readonly prompt: string
  /** Content the provider should avoid. */
  readonly negativePrompt?: string
  /** Reference inputs. */
  readonly references?: readonly MediaReference[]
  /** Requested duration for `video` and `speech`; `speech` defaults to the spoken text length. */
  readonly durationSec?: number
  /** Requested aspect ratio for `image` and `video`. */
  readonly aspectRatio?: string
  /** Requested resolution, for example `720p`. */
  readonly resolution?: string
  /** Deterministic seed when the provider accepts one. */
  readonly seed?: number
  /** Voice id for `speech`. */
  readonly voice?: string
}

/** One produced artifact. A provider returns inline bytes or a downloadable URL. */
export interface MediaArtifact {
  /** Stable id within the task. */
  readonly id: string
  /** Artifact kind. */
  readonly kind: MediaKind
  /** Verified media type the consumer writes with. */
  readonly mediaType: string
  /** Complete artifact bytes; preferred over {@link url}. */
  readonly bytes?: Uint8Array
  /** Provider URL when bytes are fetched by the runtime. */
  readonly url?: string
  /** Duration for `video` and `speech`. */
  readonly durationSec?: number
  /** Encoded width for `image` and `video`. */
  readonly width?: number
  /** Encoded height for `image` and `video`. */
  readonly height?: number
}

/** Failure carried by a settled task. */
export interface MediaTaskError {
  /** Stable code the consumer routes on. */
  readonly code: string
  /** Human-readable explanation. */
  readonly message: string
}

/** Cost of one settled task. */
export interface MediaCost {
  /** Integer minor units. */
  readonly amountMinor: number
  /** Currency of {@link amountMinor}. */
  readonly currency: MediaCurrency
}

/** One task a provider owns. */
export interface MediaTask {
  /** Task id assigned by the runtime. */
  readonly id: string
  /** Provider id. */
  readonly provider: string
  /** Provider model id. */
  readonly model: string
  /** Requested capability. */
  readonly kind: MediaKind
  /** Current state. */
  readonly status: MediaTaskStatus
  /** Completion fraction in `[0, 1]`. */
  readonly progress?: number
  /** Produced artifacts, present when `succeeded`. */
  readonly artifacts?: readonly MediaArtifact[]
  /** Settled cost, present when the provider reports one. */
  readonly cost?: MediaCost
  /** Failure, present when `failed`. */
  readonly error?: MediaTaskError
}

/** Cost and duration preview for one request. */
export interface MediaEstimate {
  /** Expected cost, omitted when the provider has no price for the selection. */
  readonly cost?: MediaCost
  /** Expected duration for `video` and `speech`. */
  readonly durationSec?: number
  /** How the figures were derived. */
  readonly confidence: 'exact' | 'estimated' | 'unknown'
}

/** A media provider registered on the runtime. */
export interface MediaProvider {
  /** Unique provider id. */
  readonly id: string
  /** Capabilities the provider serves. */
  readonly capabilities: readonly MediaKind[]
  /** Models this provider currently serves. */
  models(): readonly MediaModel[]
  /** Cheap local readiness check; must not make network calls. */
  available(): boolean
  /** Estimate cost and duration without side effects. */
  estimate(request: MediaRequest): MediaEstimate
  /** Start one task. A synchronous provider may return `succeeded` immediately. */
  submit(request: MediaRequest, signal: AbortSignal): Promise<MediaTask>
  /** Read the latest state of one task. */
  poll(task: MediaTask, signal: AbortSignal): Promise<MediaTask>
  /** Request cancellation. Idempotent. */
  cancel(task: MediaTask): Promise<void>
}

/** Stable failure codes of the video mode. */
export type MediaFailureCode =
  | 'MEDIA_PROVIDER_UNAVAILABLE'
  | 'MEDIA_PROVIDER_AMBIGUOUS'
  | 'MEDIA_MODEL_UNKNOWN'
  | 'MEDIA_REQUEST_INVALID'
  | 'MEDIA_TASK_NOT_FOUND'
  | 'MEDIA_TASK_TIMEOUT'
  | 'MEDIA_TASK_FAILED'
  | 'MEDIA_BUDGET_EXCEEDED'
  | 'MEDIA_ARTIFACT_INVALID'
  | 'MEDIA_ARTIFACT_TOO_LARGE'
  | 'MEDIA_PROJECT_INVALID'
  | 'MEDIA_DELIVERY_BLOCKED'
  | 'MEDIA_EDL_INVALID'
  | 'MEDIA_FFMPEG_MISSING'
  | 'MEDIA_ASSEMBLY_FAILED'

/** Typed failure of the media seam, project store, assembler, or delivery checks. */
export class MediaFailure extends HarnessError {
  /** Stable machine-routable failure class. */
  override readonly code: MediaFailureCode

  /**
   * @param message - human-readable explanation naming the remedy.
   * @param code - stable failure class.
   * @param options - optional cause chain.
   */
  constructor(message: string, code: MediaFailureCode, options?: ErrorOptions) {
    super(message, code, options)
    this.code = code
  }
}

/** One shot in the project document. */
export interface VideoShot {
  /** Stable shot id, unique in the project. */
  readonly id: string
  /** One-based display order. */
  readonly index: number
  /** Visual prompt sent to the image or video model. */
  readonly prompt: string
  /** Planned duration in seconds. */
  readonly durationSec: number
  /** Production state derived from the selected attempt. */
  readonly status: 'draft' | 'ready' | 'generating' | 'failed'
  /** Selected keyframe path, relative to the project directory. */
  readonly keyframePath?: string
  /** Selected clip path, relative to the project directory. */
  readonly clipPath?: string
  /** Provider and model of the selected clip. */
  readonly provider?: string
  /** Provider and model of the selected clip. */
  readonly model?: string
  /** Cost of the selected attempt in CNY. */
  readonly costCny?: number
}

/** One finished render of the project. */
export interface VideoRender {
  /** Render id, unique in the project. */
  readonly id: string
  /** Output path, relative to the project directory. */
  readonly path: string
  /** Measured duration in seconds. */
  readonly durationSec?: number
  /** Total generation cost of the render in CNY. */
  readonly costCny?: number
  /** ISO-8601 creation time. */
  readonly createdAt: string
}

/** The project document; the single source of truth for one video production. */
export interface VideoProject {
  /** Format version of this document. */
  readonly schemaVersion: 1
  /** Stable project id, also the directory name. */
  readonly id: string
  /** Display title. */
  readonly title: string
  /** Output aspect ratio. */
  readonly aspect: '9:16' | '16:9' | '1:1'
  /** Planned duration in seconds. */
  readonly targetSeconds: number
  /** Hard budget in CNY. */
  readonly budgetCny: number
  /** Ordered shots. */
  readonly shots: readonly VideoShot[]
  /** Finished renders. */
  readonly renders: readonly VideoRender[]
  /** ISO-8601 creation time. */
  readonly createdAt: string
  /** ISO-8601 last mutation time. */
  readonly updatedAt: string
}

/** One visual clip of an edit decision list. */
export type EdlVisualClip =
  | { readonly kind: 'video'; readonly source: string; readonly inSec?: number; readonly outSec: number }
  | { readonly kind: 'image'; readonly source: string; readonly durationSec: number }
  | { readonly kind: 'color'; readonly color: string; readonly durationSec: number }

/** One audio clip of an edit decision list. */
export interface EdlAudioClip {
  /** Path readable through the calling Session filesystem. */
  readonly source: string
  /** Start offset in the source. */
  readonly inSec?: number
  /** End offset in the source. */
  readonly outSec?: number
  /** Linear gain in decibels. */
  readonly gainDb?: number
}

/** The assembly contract: a complete, reproducible description of one render. */
export interface Edl {
  /** Format version of this document. */
  readonly version: 1
  /** Output canvas. */
  readonly canvas: {
    /** Width in pixels. */
    readonly width: number
    /** Height in pixels. */
    readonly height: number
    /** Frames per second. */
    readonly fps: number
  }
  /** Ordered visual clips. */
  readonly clips: readonly EdlVisualClip[]
  /** Audio clips mixed over the visual track. */
  readonly audio?: readonly EdlAudioClip[]
  /** Subtitle file burned into the picture. */
  readonly subtitles?: string
  /** Output path relative to the calling Session working directory. */
  readonly output: string
}
