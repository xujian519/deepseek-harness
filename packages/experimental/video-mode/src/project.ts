/**
 * The durable video project document and its validation. The project file is
 * the single source of truth for one production: shots, selected attempts,
 * renders, and the budget. Tools mutate it through this module; the client
 * reads the same file, so there is no second state store.
 * @module @deepseek-ai/dsh-experimental-video-mode/project
 */

import { join } from 'node:path'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { FsTarget } from '@deepseek-ai/dsh-fs'
import { MediaFailure, type VideoProject, type VideoRender, type VideoShot } from './types.ts'

/** Project format version written by this package. */
export const PROJECT_SCHEMA_VERSION = 1 as const

/** Relative directory under the Session working directory that holds every production. */
export const VIDEO_ROOT = 'video'

/** One shot as stored in the project file. */
const shotSchema = z.object({
  id: z.string().min(1),
  index: z.number().int().positive(),
  prompt: z.string().min(1),
  durationSec: z.number().positive().max(60),
  status: z.enum(['draft', 'ready', 'generating', 'failed']),
  keyframePath: z.string().min(1).optional(),
  clipPath: z.string().min(1).optional(),
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  costCny: z.number().nonnegative().optional(),
}).strict()

/** One render as stored in the project file. */
const renderSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  durationSec: z.number().positive().optional(),
  costCny: z.number().nonnegative().optional(),
  createdAt: z.string().min(1),
}).strict()

/** The complete project document schema. */
export const projectSchema = z.object({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  id: z.string().min(1).regex(/^[a-z0-9][a-z0-9-]*$/),
  title: z.string().min(1),
  aspect: z.enum(['9:16', '16:9', '1:1']),
  targetSeconds: z.number().positive().max(3600),
  budgetCny: z.number().nonnegative(),
  shots: z.array(shotSchema),
  renders: z.array(renderSchema),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
}).strict()

/** Fields accepted when creating a project. */
export interface NewProject {
  /** Display title. */
  readonly title: string
  /** Output aspect ratio. */
  readonly aspect?: VideoProject['aspect']
  /** Planned duration in seconds. */
  readonly targetSeconds?: number
  /** Hard budget in CNY. */
  readonly budgetCny?: number
  /** Explicit id; derived from the title when omitted. */
  readonly id?: string
}

/**
 * Derive a stable, path-safe project id from a title.
 * @param title - display title.
 * @returns lowercase letters, digits, and hyphens.
 */
export function slugify(title: string): string {
  const slug = title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 48)
  return slug.length > 0 ? slug : `video-${Date.now().toString(36)}`
}

/**
 * Build the project document for a new production.
 * @param input - title, format, duration, budget, and optional id.
 * @returns a validated project.
 * @throws {@link MediaFailure} when the generated document is invalid.
 */
export function newProject(input: NewProject): VideoProject {
  const now = new Date().toISOString()
  const id = input.id ?? slugify(input.title)
  const project: VideoProject = {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    id,
    title: input.title.trim(),
    aspect: input.aspect ?? '9:16',
    targetSeconds: input.targetSeconds ?? 45,
    budgetCny: input.budgetCny ?? 50,
    shots: [],
    renders: [],
    createdAt: now,
    updatedAt: now,
  }
  return validateProject(project)
}

/**
 * Validate a project document, converting schema failures into the stable
 * project failure code.
 * @param value - untrusted document.
 * @returns the same value, typed.
 * @throws {@link MediaFailure} `MEDIA_PROJECT_INVALID`.
 */
export function validateProject(value: unknown): VideoProject {
  const parsed = projectSchema.safeParse(value)
  if (!parsed.success) {
    throw new MediaFailure(`invalid video project: ${parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`, 'MEDIA_PROJECT_INVALID')
  }
  return parsed.data as VideoProject
}

/**
 * Resolve the project file path for one id under a working directory.
 * @param cwd - Session working directory.
 * @param id - project id.
 * @returns the absolute project file path.
 */
export function projectPathFor(cwd: string, id: string): string {
  return join(cwd, VIDEO_ROOT, id, 'project.json')
}

/**
 * Read and validate one project.
 * @param ctx - context providing `ctx.fs`.
 * @param path - absolute or working-directory-relative project path.
 * @param cwd - Session working directory for relative resolution.
 * @param signal - caller cancellation.
 * @returns the validated project.
 * @throws {@link MediaFailure} when the file is absent or invalid.
 */
export async function readProject(ctx: Context, path: string, cwd: string, signal?: AbortSignal): Promise<VideoProject> {
  const target = await ctx.fs.resolve(path, { cwd })
  let text: string
  try {
    text = await ctx.fs.readText(target, signal)
  } catch (error) {
    if (error instanceof FsError && error.code === 'FS_NOT_FOUND') {
      throw new MediaFailure(`video project not found at ${path}; run video_project init first`, 'MEDIA_PROJECT_INVALID', { cause: error })
    }
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new MediaFailure(`video project ${path} is not valid JSON: ${messageOf(error)}`, 'MEDIA_PROJECT_INVALID', { cause: error })
  }
  return validateProject(parsed)
}

/**
 * Write one project document atomically through the Session filesystem.
 * @param ctx - context providing `ctx.fs`.
 * @param path - target path.
 * @param project - validated project.
 * @param cwd - Session working directory for relative resolution.
 * @param signal - caller cancellation.
 * @returns the resolved target.
 */
export async function writeProject(
  ctx: Context,
  path: string,
  project: VideoProject,
  cwd: string,
  signal?: AbortSignal,
): Promise<FsTarget> {
  const target = await ctx.fs.resolve(path, { cwd })
  const validated = validateProject(project)
  await ctx.fs.writeText(target, `${JSON.stringify(validated, null, 2)}\n`, undefined, signal)
  return target
}

/**
 * Insert or replace one shot, keeping index order stable.
 * @param project - current project.
 * @param shot - shot to store.
 * @returns a new project with the shot applied.
 */
export function upsertShot(project: VideoProject, shot: VideoShot): VideoProject {
  const shots = project.shots.filter(entry => entry.id !== shot.id)
  shots.push(shot)
  shots.sort((left, right) => left.index - right.index || left.id.localeCompare(right.id))
  return validateProject({ ...project, shots, updatedAt: new Date().toISOString() })
}

/**
 * Remove one shot by id.
 * @param project - current project.
 * @param shotId - shot to remove.
 * @returns a new project without the shot.
 * @throws {@link MediaFailure} when the shot is absent.
 */
export function removeShot(project: VideoProject, shotId: string): VideoProject {
  const shots = project.shots.filter(entry => entry.id !== shotId)
  if (shots.length === project.shots.length) {
    throw new MediaFailure(`shot ${JSON.stringify(shotId)} does not exist`, 'MEDIA_PROJECT_INVALID')
  }
  return validateProject({ ...project, shots, updatedAt: new Date().toISOString() })
}

/**
 * Append one finished render.
 * @param project - current project.
 * @param render - render to record.
 * @returns a new project with the render appended.
 */
export function recordRender(project: VideoProject, render: VideoRender): VideoProject {
  return validateProject({
    ...project,
    renders: [...project.renders.filter(entry => entry.id !== render.id), render],
    updatedAt: new Date().toISOString(),
  })
}

/**
 * Sum the selected attempt costs of every shot.
 * @param project - current project.
 * @returns the accumulated cost in CNY.
 */
export function projectCost(project: VideoProject): number {
  return project.shots.reduce((sum, shot) => sum + (shot.costCny ?? 0), 0)
}

/**
 * Report the shots that cannot appear in a render.
 * @param project - current project.
 * @returns shot ids with no selected clip.
 */
export function missingShotClips(project: VideoProject): readonly string[] {
  return project.shots.filter(shot => shot.clipPath === undefined).map(shot => shot.id)
}

/**
 * Read a thrown value's message without assuming an Error.
 * @param error - caught value.
 * @returns a diagnostic string.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
