/**
 * Model-facing HTTP tools: `memcommit`, `memqueue`, `memlearn`.
 *
 * These three live on HTTP rather than the MCP surface because MCP cannot
 * carry their semantics: committing the *current DSH session* (MCP
 * `remember` stores into the server's own short-lived session), reading the
 * observer queue as a model-facing status, and deliberately minting or
 * merging lessons (redaction, dedupe, skill playbooks).
 * @module @deepseek-ai/dsh-openviking/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

import { OpenVikingClient } from './client.ts'
import type { SessionSync } from './session-sync.ts'
import type { LearnService } from './learn-service.ts'

/** Commit the caller's DSH session into OpenViking. Mounts only when a tools service exists.
 * @param ctx - Cordis context scoped to this registration.
 * @param options - client, session sync, and learning service for the tool executions.
 */
export function registerOpenVikingTools(ctx: Context, options: {
  client: OpenVikingClient
  sync: SessionSync
  learn: LearnService
}): void {
  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.effect(() => {
      const disposers = [
        toolsCtx.tools.register(defineTool({
          name: 'memcommit',
          description: 'Commit the current DeepSeek Harness session into OpenViking and extract persistent memories. Use after a task the user will want remembered.',
          parameters: {},
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                committed: { type: 'boolean', required: true },
                session: { type: 'string', required: true },
              },
            },
            render: (_args, value) => [{ type: 'text', text: value.committed
              ? `Committed session ${value.session}. Memories extracted in the background.`
              : `Session ${value.session} had nothing to commit.` }],
          },
          timeoutMs: 60_000,
          async execute(_args, exec) {
            const agent = exec.agent
            if (agent === undefined) throw new Error('memcommit requires an agent context')
            const sessionId = String(agent.session.id)
            await options.sync.flush(sessionId)
            await options.sync.commit(sessionId)
            return { committed: true, session: sessionId }
          },
        })),
        toolsCtx.tools.register(defineTool({
          name: 'memqueue',
          description: 'Show the OpenViking observer queue status: pending, in-progress, and errored indexing work.',
          parameters: {},
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                healthy: { type: 'boolean', required: true },
                errors: { type: 'boolean', required: true },
                status: { type: 'string', required: true },
              },
            },
            render: (_args, value) => [{ type: 'text', text: value.healthy && !value.errors
              ? `OpenViking observer queue is healthy.\n${value.status}`
              : `OpenViking observer queue has errors.\n${value.status}` }],
          },
          timeoutMs: 30_000,
          async execute(_args, exec) {
            const queue = await options.client.queue(exec.signal)
            return { healthy: queue.is_healthy, errors: queue.has_errors, status: queue.status }
          },
        })),
        toolsCtx.tools.register(defineTool({
          name: 'memlearn',
          description: 'Deliberately capture a reusable lesson: merge into an existing memory or mint/update a skill playbook. Redacts common secrets before writing.',
          parameters: {
            lesson: { type: 'string', required: true, description: 'The lesson text to persist.' },
            capability: { type: 'string', description: '`skill` mints or updates a playbook; `target` appends to an explicit memory URI; omit for semantic merge.' },
            target: { type: 'string', description: 'URI for `capability: target`; `viking://` only.' },
            skill: { type: 'string', description: 'Playbook name for `capability: skill`; kebab-case.' },
            min_score: { type: 'number', description: 'Merge match threshold for the semantic path (0–1, default 0.5).' },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                result: { type: 'string', required: true },
                uri: { type: 'string' },
                detail: { type: 'string' },
              },
            },
            render: (_args, value) => [{ type: 'text', text: value.detail ?? value.result }],
          },
          timeoutMs: 60_000,
          async execute(args, exec) {
            return options.learn.capture({
              lesson: args.lesson,
              capability: args.capability,
              target: args.target,
              skill: args.skill,
              minScore: args.min_score,
            }, exec.signal)
          },
        })),
      ]
      return () => { for (const dispose of disposers) dispose() }
    }, 'openviking: http tools')
  })
}

/** Keep the import used for typed tool registration consumers. */
export type { ToolRunContext }
