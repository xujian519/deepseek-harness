/**
 * The model-facing `media` tool: list models, estimate a request, submit a
 * generation, read its status, or cancel it. One tool with an action
 * discriminator keeps the fixed prompt cost to one schema while the actions
 * share kind, model, and output-path vocabulary.
 * @module @deepseek-ai/dsh-experimental-video-mode/tools/media
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'
import type MediaRuntime from '../media.ts'
import { projectCost, readProject } from '../project.ts'
import { MediaFailure, type MediaEstimate, type MediaKind, type MediaRequest, type MediaTask } from '../types.ts'
import { derivedPath, hostPathOf, workingDirectoryOf, writeArtifact } from './shared.ts'

/** Model-visible result of one `media` call. */
interface MediaToolValue {
  readonly action: string
  readonly message: string
  readonly models?: {
    readonly id: string
    readonly kind: string
    readonly provider: string
    readonly price?: { readonly amountMinor: number; readonly currency: string; readonly unit: string }
  }[]
  readonly estimate?: {
    readonly confidence: string
    readonly cost?: { readonly amountMinor: number; readonly currency: string }
    readonly durationSec?: number
  }
  readonly task?: {
    readonly id: string
    readonly status: string
    readonly progress?: number
  }
  readonly artifacts?: {
    readonly path: string
    readonly bytes: number
    readonly mediaType: string
  }[]
}

/** One estimate rendered for the model. */
function renderEstimate(estimate: MediaEstimate): NonNullable<MediaToolValue['estimate']> {
  return {
    confidence: estimate.confidence,
    ...estimate.cost === undefined ? {} : { cost: { amountMinor: estimate.cost.amountMinor, currency: estimate.cost.currency } },
    ...estimate.durationSec === undefined ? {} : { durationSec: estimate.durationSec },
  }
}

/** One task identity rendered for the model. */
function renderTask(task: MediaTask): NonNullable<MediaToolValue['task']> {
  return {
    id: task.id,
    status: task.status,
    ...task.progress === undefined ? {} : { progress: task.progress },
  }
}

/**
 * Build the normalized request from model arguments.
 * @param args - validated tool arguments.
 * @returns the media request.
 */
function requestFrom(args: {
  kind?: MediaKind
  model?: string
  prompt?: string
  negative_prompt?: string
  duration_sec?: number
  aspect_ratio?: string
  resolution?: string
  seed?: number
  voice?: string
}): MediaRequest {
  if (args.kind === undefined) throw new MediaFailure('media requires `kind` for this action', 'MEDIA_REQUEST_INVALID')
  if (args.prompt === undefined || args.prompt.trim().length === 0) {
    throw new MediaFailure('media requires a non-empty `prompt` for this action', 'MEDIA_REQUEST_INVALID')
  }
  return {
    kind: args.kind,
    prompt: args.prompt,
    ...args.model === undefined ? {} : { model: args.model },
    ...args.negative_prompt === undefined ? {} : { negativePrompt: args.negative_prompt },
    ...args.duration_sec === undefined ? {} : { durationSec: args.duration_sec },
    ...args.aspect_ratio === undefined ? {} : { aspectRatio: args.aspect_ratio },
    ...args.resolution === undefined ? {} : { resolution: args.resolution },
    ...args.seed === undefined ? {} : { seed: args.seed },
    ...args.voice === undefined ? {} : { voice: args.voice },
  }
}

/**
 * Create the `media` tool.
 * @param ctx - plugin context.
 * @param media - media runtime.
 * @returns the registry-ready tool.
 */
export function createMediaTool(ctx: Context, media: MediaRuntime): ToolDefinition {
  return defineTool({
    name: 'media',
    description: 'Generate or inspect images, video clips, and speech through the configured media providers. '
      + 'Actions: `models` lists available models and prices; `estimate` previews cost and duration without generating; '
      + '`generate` submits one generation and writes the artifact to `output_path`; `status` polls one task once and writes a settled artifact when `output_path` is given; '
      + '`cancel` stops one. Prefer `estimate` before a paid generation. '
      + 'The synthetic provider is for demos and tests; configure a real provider for production. '
      + 'Generated files land under the Session workspace; keep each shot in its own directory.',
    parameters: {
      action: {
        type: 'string', required: true,
        enum: ['models', 'estimate', 'generate', 'status', 'cancel'],
        description: 'Operation to run.',
      },
      kind: {
        type: 'string', enum: ['image', 'video', 'speech'],
        description: 'Capability to generate. Required for estimate and generate.',
      },
      model: { type: 'string', description: 'Model id from `models`; omitted uses the configured default.' },
      prompt: { type: 'string', description: 'Positive generation prompt. Required for estimate and generate.' },
      negative_prompt: { type: 'string', description: 'Content the model should avoid.' },
      duration_sec: { type: 'number', description: 'Requested video or speech duration in seconds.' },
      aspect_ratio: { type: 'string', description: 'Requested aspect ratio, for example `9:16`.' },
      resolution: { type: 'string', description: 'Requested resolution, for example `720p`.' },
      seed: { type: 'integer', description: 'Deterministic seed when the provider accepts one.' },
      first_frame_path: {
        type: 'string',
        description: 'Image that starts the video clip, relative to the Session working directory. Sent as the provider first-frame reference; video only.',
      },
      voice: { type: 'string', description: 'Speech voice id.' },
      output_path: { type: 'string', description: 'Artifact path relative to the Session working directory. Required for generate.' },
      wait: {
        type: 'boolean',
        description: 'Wait for settlement before returning. Defaults to true; a false value submits and returns the task id immediately.',
      },
      task_id: { type: 'string', description: 'Task id for status and cancel.' },
      project_path: {
        type: 'string',
        description: 'Project file used to enforce the remaining budget. Video mode should pass it on every generate call.',
      },
      confirm_cost: {
        type: 'boolean',
        description: 'Confirm a generation whose estimated cost is above the configured approval threshold. Ask the user first.',
      },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          message: { type: 'string', required: true },
          models: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                provider: { type: 'string', required: true },
                price: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    amountMinor: { type: 'integer', required: true },
                    currency: { type: 'string', required: true },
                    unit: { type: 'string', required: true },
                  },
                },
              },
            },
          },
          estimate: {
            type: 'object', additionalProperties: false,
            properties: {
              confidence: { type: 'string', required: true },
              cost: {
                type: 'object', additionalProperties: false,
                properties: {
                  amountMinor: { type: 'integer', required: true },
                  currency: { type: 'string', required: true },
                },
              },
              durationSec: { type: 'number' },
            },
          },
          task: {
            type: 'object', additionalProperties: false,
            properties: {
              id: { type: 'string', required: true },
              status: { type: 'string', required: true },
              progress: { type: 'number' },
            },
          },
          artifacts: {
            type: 'array',
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                bytes: { type: 'integer', required: true },
                mediaType: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec): Promise<MediaToolValue> {
      switch (args.action) {
        case 'models': {
          const models = media.models(args.kind)
          return {
            action: 'models',
            message: models.length === 0
              ? `No media models serve ${args.kind ?? 'any capability'}. Mount a provider or enable the synthetic provider.`
              : models.map(model => `${model.provider}/${model.id} [${model.kind}]${model.price === undefined ? '' : ` ${model.price.amountMinor} ${model.price.currency} minor units per ${model.price.unit}`}`).join('\n'),
            models: models.map((model) => {
              const price = model.price === undefined
                ? undefined
                : {
                  amountMinor: model.price.amountMinor,
                  currency: model.price.currency,
                  unit: model.price.unit,
                }
              return {
                id: model.id,
                kind: model.kind,
                provider: model.provider,
                ...price === undefined ? {} : { price },
              }
            }),
          }
        }
        case 'estimate': {
          const estimate = media.estimate(requestFrom(args))
          return {
            action: 'estimate',
            message: `Estimated ${estimate.cost === undefined ? 'an unknown cost' : `${estimate.cost.amountMinor} ${estimate.cost.currency} minor units`} with ${estimate.confidence} confidence.`,
            estimate: renderEstimate(estimate),
          }
        }
        case 'generate': {
          const cwd = await workingDirectoryOf(ctx, exec)
          if (args.output_path === undefined || args.output_path.trim().length === 0) {
            throw new MediaFailure('media generate requires `output_path`', 'MEDIA_REQUEST_INVALID')
          }
          const request = requestFrom(args)
          const firstFramePath = args.first_frame_path
          const framed: MediaRequest = firstFramePath === undefined
            ? request
            : {
              ...request,
              references: [{ kind: 'image', role: 'first-frame', path: await hostPathOf(ctx, firstFramePath, cwd) }],
            }
          if (args.project_path !== undefined) {
            const project = await readProject(ctx, args.project_path, cwd, exec.signal)
            const spent = projectCost(project)
            const remaining = project.budgetCny - spent
            const estimate = media.estimate(framed)
            const costCny = estimate.cost?.currency === 'CNY' ? estimate.cost.amountMinor / 100 : undefined
            if (costCny !== undefined && costCny > remaining) {
              throw new MediaFailure(
                `estimated ${costCny.toFixed(2)} CNY exceeds the ${remaining.toFixed(2)} CNY remaining in the project budget; `
                + 'raise the budget or use a cheaper model',
                'MEDIA_BUDGET_EXCEEDED',
              )
            }
            if (estimate.cost !== undefined && costCny === undefined && args.confirm_cost !== true) {
              throw new MediaFailure(
                'the estimate is not in CNY and cannot be compared with the project budget; ask the user, then retry with confirm_cost',
                'MEDIA_BUDGET_EXCEEDED',
              )
            }
            if (costCny !== undefined && costCny > media.settings.approvalThresholdCny && args.confirm_cost !== true) {
              throw new MediaFailure(
                `estimated ${costCny.toFixed(2)} CNY is above the ${media.settings.approvalThresholdCny.toFixed(2)} CNY confirmation threshold; `
                + 'ask the user, then retry with confirm_cost: true',
                'MEDIA_BUDGET_EXCEEDED',
              )
            }
          }
          const task = args.wait === false
            ? await media.submit(framed, exec.signal)
            : await media.generate(framed, exec.signal)
          if (task.status === 'failed') {
            throw new MediaFailure(`media task ${task.id} failed: ${task.error?.message ?? 'provider reported failure'}`, 'MEDIA_TASK_FAILED')
          }
          if (task.status === 'cancelled') {
            throw new MediaFailure(`media task ${task.id} was cancelled`, 'MEDIA_TASK_FAILED')
          }
          if (task.status !== 'succeeded') {
            return {
              action: 'generate',
              message: `Submitted ${task.kind} task ${task.id} (${task.status}). Read it with media status and the same output_path, then write its artifact.`,
              task: renderTask(task),
            }
          }
          const artifacts: { path: string; bytes: number; mediaType: string }[] = []
          for (const [index, artifact] of (task.artifacts ?? []).entries()) {
            const written = await writeArtifact(
              ctx, artifact, derivedPath(args.output_path, index), cwd, media.settings.maxArtifactBytes, exec.signal,
            )
            artifacts.push({ ...written, mediaType: artifact.mediaType })
          }
          if (artifacts.length === 0) {
            throw new MediaFailure(`media task ${task.id} succeeded without artifacts`, 'MEDIA_ARTIFACT_INVALID')
          }
          return {
            action: 'generate',
            message: `Generated ${task.kind} with ${task.provider}/${task.model}. Wrote ${artifacts.map(entry => entry.path).join(', ')}.`
              + (task.cost === undefined ? '' : ` Cost ${task.cost.amountMinor} ${task.cost.currency} minor units.`),
            task: renderTask(task),
            artifacts,
          }
        }
        case 'status': {
          if (args.task_id === undefined) throw new MediaFailure('media status requires `task_id`', 'MEDIA_REQUEST_INVALID')
          const task = await media.refresh(args.task_id, exec.signal)
          const artifacts: { path: string; bytes: number; mediaType: string }[] = []
          if (task.status === 'succeeded' && task.artifacts !== undefined && args.output_path !== undefined) {
            const cwd = await workingDirectoryOf(ctx, exec)
            for (const [index, artifact] of task.artifacts.entries()) {
              const written = await writeArtifact(
                ctx, artifact, derivedPath(args.output_path, index), cwd, media.settings.maxArtifactBytes, exec.signal,
              )
              artifacts.push({ ...written, mediaType: artifact.mediaType })
            }
          }
          return {
            action: 'status',
            message: `Task ${task.id} is ${task.status}${task.error === undefined ? '' : `: ${task.error.message}`}.`
              + (artifacts.length === 0 ? '' : ` Wrote ${artifacts.map(entry => entry.path).join(', ')}.`),
            task: renderTask(task),
            ...artifacts.length === 0 ? {} : { artifacts },
          }
        }
        case 'cancel': {
          if (args.task_id === undefined) throw new MediaFailure('media cancel requires `task_id`', 'MEDIA_REQUEST_INVALID')
          const task = await media.cancel(args.task_id)
          return { action: 'cancel', message: `Task ${task.id} is ${task.status}.`, task: renderTask(task) }
        }
      }
    },
  })
}
