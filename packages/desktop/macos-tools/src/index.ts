/**
 * The macOS native tools host plugin: seven model tools that drive macOS
 * system CLIs (open, osascript, pbcopy/pbpaste, say) with argv-array spawns
 * and no shell. Host effects beyond the session resolve one-time approval
 * through the approval seam and fail closed without it. Mounted only where
 * the deployment composes it; the desktop bundle gates it to darwin.
 * @module @deepseek-ai/dsh-macos-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-user-approval'
import { createExecFileRunner } from './runner.ts'
import { createMacosTools, createStatPathCheck, type MacosLimits } from './tools.ts'

export const name = 'macos-tools'
export const inject = ['tools']

const DEFAULT_COMMAND_TIMEOUT_MS = 15_000
const DEFAULT_CLIPBOARD_READ_MAX_CHARS = 20_000
const DEFAULT_CLIPBOARD_WRITE_MAX_CHARS = 1_000_000
const DEFAULT_SPEAK_MAX_CHARS = 4_000
const DEFAULT_NOTIFY_MAX_CHARS = 4_000

/** Plugin configuration; every field defaults and validates at load. */
export interface Config {
  /** Timeout for every system-CLI invocation, in milliseconds (default 15000). */
  readonly commandTimeoutMs?: number
  /** Character cap for one clipboard read (default 20000). */
  readonly clipboardReadMaxChars?: number
  /** Character cap for one clipboard write (default 1000000). */
  readonly clipboardWriteMaxChars?: number
  /** Character cap for one spoken text (default 4000). */
  readonly speakMaxChars?: number
  /** Character cap for a notification title plus message (default 4000). */
  readonly notifyMaxChars?: number
}

/** Runtime configuration schema for the macOS native tools plugin. */
export const Config: z<Config> = z.object({
  commandTimeoutMs: z.number().default(DEFAULT_COMMAND_TIMEOUT_MS),
  clipboardReadMaxChars: z.number().default(DEFAULT_CLIPBOARD_READ_MAX_CHARS),
  clipboardWriteMaxChars: z.number().default(DEFAULT_CLIPBOARD_WRITE_MAX_CHARS),
  speakMaxChars: z.number().default(DEFAULT_SPEAK_MAX_CHARS),
  notifyMaxChars: z.number().default(DEFAULT_NOTIFY_MAX_CHARS),
})

/**
 * Fail loud on any non-positive limit; schemastery defaults fill omissions.
 * @param config - the validated plugin config.
 * @returns the final limits the tool factory consumes.
 */
function resolveLimits(config: Config): MacosLimits {
  const limits = {
    commandTimeoutMs: config.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
    clipboardReadMaxChars: config.clipboardReadMaxChars ?? DEFAULT_CLIPBOARD_READ_MAX_CHARS,
    clipboardWriteMaxChars: config.clipboardWriteMaxChars ?? DEFAULT_CLIPBOARD_WRITE_MAX_CHARS,
    speakMaxChars: config.speakMaxChars ?? DEFAULT_SPEAK_MAX_CHARS,
    notifyMaxChars: config.notifyMaxChars ?? DEFAULT_NOTIFY_MAX_CHARS,
  }
  for (const [field, value] of Object.entries(limits)) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`macos-tools: ${field} must be a positive integer`)
    }
  }
  return limits
}

/** Register the seven macOS native tools on the composed tool registry. */
export function apply(ctx: Context, config: Config = {}): void {
  const tools = createMacosTools({
    run: createExecFileRunner(),
    approver: ctx.get('approval'),
    stat: createStatPathCheck(),
    limits: resolveLimits(config),
  })
  for (const tool of tools) ctx.tools.register(tool)
}
