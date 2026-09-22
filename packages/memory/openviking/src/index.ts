/**
 * OpenViking context-database integration for DeepSeek Harness.
 *
 * The plugin talks to a running OpenViking HTTP service (never the `ov` CLI,
 * never an embedded server), injects recalled context before model steps,
 * mirrors user/assistant turns into an OpenViking session, and auto-commits
 * that session on a configurable rhythm. The model-facing tool surface is the
 * OpenViking MCP tool set reached through `@deepseek-ai/dsh-mcp-client`.
 *
 * The service may be unreachable: the plugin still loads, ordinary
 * conversation continues, and automatic layers skip with deduplicated
 * warnings while explicit tool calls throw clear errors.
 */

import type { Context, Logger } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
// Type-only: the Loader's `loader/volatile-update` event declaration this
// plugin subscribes to for committed live config changes.
import type {} from '@deepseek-ai/cordis-plugin-loader'

import { errorMessage } from '@deepseek-ai/dsh-value'
import { OpenVikingClient } from './client.ts'
import type { ClientCredentials } from './client.ts'
import { registerOpenVikingCommands } from './commands.ts'
import { Config, assertValidEndpoint } from './config.ts'
import type { AutoRecallConfig } from './config.ts'
import { LearnService } from './learn-service.ts'
import { mountOpenVikingMcp } from './mcp-surface.ts'
import { MemoryRecall } from './memory-recall.ts'
import { RepoContext } from './repo-context.ts'
import { SessionSync } from './session-sync.ts'
import { mountOpenVikingSkill } from './skills.ts'
import { StartupMap } from './startup-map.ts'
import { registerOpenVikingTools } from './tools.ts'
import { StateStore } from './state.ts'
import { registerStatusRoute } from './status-route.ts'
import { guardVikingUri } from './uri-guard.ts'

export { Config } from './config.ts'
export type { AutoCommitConfig, AutoRecallConfig, RepoContextConfig } from './config.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'openviking'
/** Services required by this plugin; `agents` guarantees the registry is ready and lets us adopt live agents. */
export const inject = ['tools', 'systemPrompt', 'agents']

export type { ClientCredentials, FindQuery } from './client.ts'
export { OpenVikingAbortError, OpenVikingError, OpenVikingTimeoutError } from './errors.ts'

/** One warning per failure class per process so an unreachable service stays quiet.
 * @param logger - diagnostics sink.
 * @param key - the failure-class key to deduplicate on.
 * @returns the once-only warning callback.
 */
export function dedupeWarn(logger: { warn(message: string, fields?: object): void }, key: string): () => void {
  let warned = false
  return () => {
    if (warned) return
    warned = true
    logger.warn(`openviking: ${key}`)
  }
}

/** Project the current config onto the client's credential slice. */
function credentialsOf(config: Config): ClientCredentials {
  return {
    endpoint: config.endpoint.get(),
    apiKey: config.apiKey.get(),
    account: config.account.get(),
    user: config.user.get(),
    agentId: config.agentId.get(),
    timeoutMs: config.timeoutMs.get(),
  }
}

/**
 * Mount the plugin.
 * @param ctx - Cordis context.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  assertValidEndpoint(config.endpoint.get())
  const logger = ctx.logger('openviking')

  const client = new OpenVikingClient(credentialsOf(config))

  // The client caches its credential slice as plain fields; a committed live
  // Config change (settings save) re-applies them.
  ctx.on('loader/volatile-update', () => { client.reconfigure(credentialsOf(config)) })

  // Fail-soft boot: probe the service once in the background and warn once;
  // automatic layers stay silent afterward. The plugin never starts a server.
  const warnUnreachable = dedupeWarn(logger, 'service unreachable; automatic memory layers are disabled until it responds')
  ctx.effect(() => {
    logger.info('openviking plugin mounted', { endpoint: config.endpoint.get() })
    const controller = new AbortController()
    void probeHealth(client, logger, warnUnreachable, controller.signal)
    return () => { controller.abort() }
  }, 'openviking:boot-health')

  // Session mirror + auto-commit. The state store opens asynchronously, so
  // the whole plane lives behind one effect: listeners attach only after the
  // store resolved, and disposal removes them with the fiber. Tools read the
  // sync instance through this reference; before the effect resolves, the
  // no-op placeholder makes tool calls settle instead of failing the step.
  let sync: SessionSync = createPreInitSync()
  ctx.effect(async () => {
    const { store, quarantined } = await StateStore.open(config.stateFile.get(), {
      endpoint: config.endpoint.get(),
      account: config.account.get(),
      user: config.user.get(),
      agentId: config.agentId.get(),
    })
    for (const quarantine of quarantined) {
      logger.warn(`openviking: state file quarantined as ${quarantine.path} (${quarantine.issue})`)
    }
    const sessionSync = new SessionSync(client, store, () => ({
      autoCommit: config.autoCommit.get(),
      stateFile: config.stateFile.get(),
    }), logger)
    sync = sessionSync

    // Adopt live sessions and their future siblings; subagents own sessions too.
    // `agent/created` carries every session-start edge (startup/resume/clear/
    // compact), so it subsumes the retired `agent/session-start` event.
    ctx.on('agent/created', (payload: { agent: Agent }) => {
      sessionSync.adopt(payload.agent.session)
    })
    ctx.on('agent/disposed', (payload: { agent: Agent }) => {
      sessionSync.forget(payload.agent.session)
    })
    ctx.on('session/event', (session: Session, event: SessionEvent) => {
      sessionSync.capture(session, event)
    })
    ctx.on('session/flush', (session: Session) => sessionSync.flush(String(session.id)))

    sessionSync.start()
    return async () => { await sessionSync.dispose() }
  }, 'openviking:session-sync')

  // Auto-recall: stage a bounded `<relevant-memories>` block at pre-step and
  // render it through the context-injection channel. The listener is
  // prepended so downstream contributors (agent-instructions, time context)
  // compose the final batch first; recall never rejects a step.
  const recall = new MemoryRecall(client, () => config.autoRecall.get(), logger)
  const repoContext = new RepoContext(client, () => config.repoContext.get(), logger)
  const startupMap = new StartupMap(client)

  ctx.on('agent/pre-step', (payload, next) => openvikingPreStep(recall, repoContext, startupMap, () => config.autoRecall.get(), payload, next), { prepend: true })

  ctx.on('agent/created', () => { openvikingSessionStart(repoContext, startupMap) })

  ctx.on('agent/disposed', (payload) => {
    recall.forget(String(payload.agent.id))
  })

  ctx.inject(['systemPrompt'], (scope) => {
    scope.systemPrompt.context({
      name: 'openviking:repositories',
      order: 118,
      text: () => repoContext.prompt(),
    })
    scope.systemPrompt.context({
      name: 'openviking:library',
      order: 120,
      text: assembly => assembly.agent === undefined ? '' : startupMap.prompt(),
    })
    scope.systemPrompt.context({
      name: 'openviking:memories',
      order: 125,
      text: assembly => assembly.agent === undefined ? '' : recall.renderContext(String(assembly.agent.id)),
    })
  })

  // Model-facing wire surface: viking:// guard, runtime skill, HTTP tools,
  // human command, and the MCP bridge (mounted last; activation never waits
  // on it). The sync provider is a thunk: the session-sync effect assigns the
  // live instance asynchronously, and tools must see it once it exists.
  ctx.on('tools/pre-execute', (exec, next) => {
    const decision = guardVikingUri(exec)
    return decision.kind === 'deny' ? Promise.resolve<PreToolDecision>(decision) : next()
  })
  mountOpenVikingSkill(ctx)
  const learn = new LearnService(client)
  registerOpenVikingTools(ctx, {
    client,
    sync: () => sync,
    learn,
  })
  registerOpenVikingCommands(ctx, learn)
  registerStatusRoute(ctx, client)
  ctx.effect(() => {
    const fiber = mountOpenVikingMcp(ctx, credentialsOf(config))
    return () => fiber.dispose()
  }, 'openviking:mcp')
}

/**
 * One-line label for a health-probe failure.
 * @param error - the failure value.
 * @returns `error.message` for `Error` values, a non-Error object's string `message`, otherwise the string coercion.
 */
export { errorMessage as errorLabel }

/** A SessionSync-shaped no-op used before the async state store resolves.
 * @returns the placeholder sync instance.
 */
export function createPreInitSync(): SessionSync {
  return {
    flush: () => Promise.resolve(),
    commit: () => Promise.resolve(),
  } as unknown as SessionSync
}

/** Fire-and-forget refreshes for a newly started session; failures are
 * swallowed so a session never waits on an unreachable service.
 * @param repoContext - repository list refresher.
 * @param startupMap - library-overview refresher.
 */
export function openvikingSessionStart(repoContext: RepoContext, startupMap: StartupMap): void {
  repoContext.refresh().catch(() => {})
  startupMap.refresh().catch(() => {})
}

/**
 * The pre-step handler: accept the downstream decision first (so the batch is
 * final), then stage recall and repository context for the assembly. Recall
 * never rejects a step — all searches degrade to empty silently.
 * @param recall - the memory recall stager.
 * @param repoContext - repository-list refresher.
 * @param startupMap - library-overview refresher (cadence-driven).
 * @param autoRecall - live auto-recall settings; the turn cadence comes from here.
 * @param payload - the pre-step payload.
 * @param next - the downstream waterfall decision.
 * @returns the downstream decision (never modified by recall).
 */
export async function openvikingPreStep(
  recall: MemoryRecall,
  repoContext: RepoContext,
  startupMap: StartupMap,
  autoRecall: () => AutoRecallConfig,
  payload: { agent: Agent; step: number; messages: readonly UserMessage[]; signal: AbortSignal },
  next: () => Promise<PreStepDecision>,
): Promise<PreStepDecision> {
  const decision = await next()
  if (decision.kind !== 'enter' || payload.signal.aborted) return decision
  await Promise.allSettled([
    recall.prepareStep(payload.agent, payload.step, payload.messages, payload.signal),
    repoContext.refresh(payload.signal),
  ])
  const cadence = autoRecall().startupMapEveryTurns
  const turns = recall.userTurnCount(String(payload.agent.id))
  if (cadence > 0 && turns > 0 && turns % cadence === 0 && startupMap.lastRefreshTurn !== turns) {
    startupMap.lastRefreshTurn = turns
    // Cadence-driven background refresh: this step never waits on the library
    // overview, and a failure keeps the previous map.
    startupMap.refresh(payload.signal).catch(() => {})
  }
  return decision
}

/** One background health probe: a reachable service resolves silently; any
 * failure logs once and reports through the caller's deduplicated warner.
 * @param client - the OpenViking client to probe.
 * @param logger - diagnostics sink.
 * @param warn - deduplicated warning callback.
 * @param signal - cancellation for the in-flight probe.
 */
export function probeHealth(
  client: Pick<OpenVikingClient, 'health'>,
  logger: Pick<Logger, 'info'>,
  warn: () => void,
  signal: AbortSignal,
): Promise<void> {
  return client.health(signal).then(
    () => undefined,
    (error: unknown) => {
      logger.info('openviking health check failed', { error: errorMessage(error) })
      warn()
    },
  )
}
