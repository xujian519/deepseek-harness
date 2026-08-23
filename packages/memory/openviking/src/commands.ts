/**
 * Human slash command: `/memlearn <lesson>`.
 *
 * The exact same redact/dedupe/persist service as the `memlearn` model tool;
 * no model turn runs, and the raw input never enters the session log.
 * @module @deepseek-ai/dsh-openviking/commands
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'

import type { LearnService } from './learn-service.ts'

/**
 * Register the `/memlearn` command when the command registry is mounted.
 * @param ctx - plugin context.
 * @param learn - the learning service.
 */
export function registerOpenVikingCommands(ctx: Context, learn: LearnService): void {
  ctx.inject(['commands'], (commandsCtx) => {
    commandsCtx.effect(() =>
      commandsCtx.commands.register({
        name: 'memlearn',
        description: 'Capture a lesson into OpenViking memory (merge or playbook).',
        input: { hint: 'the lesson to remember' },
        // The domain event owns the payload: raw input is not duplicated.
        recordInput: false,
        async handler(invocation) {
          const lesson = invocation.rawInput.trim()
          if (lesson.length === 0) {
            return { kind: 'error', text: 'memlearn requires the lesson text after the command.' } satisfies CommandResult
          }
          const result = await learn.capture({ lesson }, invocation.signal)
          return {
            kind: result.result === 'failed' ? 'error' : 'success',
            text: result.result === 'no-match'
              ? `No existing memory matched (${result.detail})`
              : result.detail,
          } satisfies CommandResult
        },
      }),
    'openviking: /memlearn command')
  })
}
