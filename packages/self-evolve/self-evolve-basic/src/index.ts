/**
 * Basic projection- and maintenance-triggered self-evolve provider.
 *
 * Registers the `failure-patterns` projection unit during load and mounts the
 * three-stage loop through `SelfEvolveEngine`. The proposer and validator hooks are
 * provider-specific: L1 proposals register as runtime skills, L2 proposals register as
 * system-prompt sections, both through scope-local registrations that unwind
 * cleanly when the provider's proposal fiber disposes. L3+ and L4 proposals
 * remain unimplemented by this base provider (they forward to a no-op proposal
 * rejection) so downstream providers can subclass safely.
 *
 * @module @deepseek-ai/dsh-self-evolve-basic
 */

import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import {
  EvolveProposalId,
  failurePatternsProjectionDefinition,
  FAILURE_PATTERNS_PROJECTION_KEY,
  SelfEvolveEngine,
  SelfEvolveRunId,
} from '@deepseek-ai/dsh-self-evolve'
import type {
  EvolveLevel,
  EvolveProposal,
  EvolveTrigger,
  FailurePattern,
  SelfEvolveAgentContext,
  SelfEvolveResult,
} from '@deepseek-ai/dsh-self-evolve'
import type { EvolveCommit, ProposalValidationOutcome, ReplayEvidence, ValidationScores } from '@deepseek-ai/dsh-self-evolve/types'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-workflow'
import type {} from '@deepseek-ai/dsh-cordis-host-runner'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-session-projection'

export type { BasicSelfEvolveConfig, ResolvedBasicSelfEvolveConfig } from './types.ts'
import type { BasicSelfEvolveConfig, ResolvedBasicSelfEvolveConfig, TriggerPolicy } from './types.ts'

const DEFAULT_LEVELS: EvolveLevel[] = ['L1-skill', 'L2-context']
const DEFAULT_TRIGGERS: TriggerPolicy = {
  'idle-maintenance': { enabled: true, minIntervalMs: 30_000 },
  pressure: { enabled: true, minIntervalMs: 60_000 },
  'user-command': { enabled: true, minIntervalMs: 0 },
  'validation-retry': { enabled: true, minIntervalMs: 0 },
}

/**
 * Patterns that cleared the mining threshold (SIG-2). Weak `tool-runtime`
 * signals are verifier-grounded only by a generic error name, so their
 * threshold is lifted by one; stronger tiers use the configured base.
 *
 * @param patterns - projected failure patterns, ranked by occurrence count.
 * @param minOccurrences - configured base threshold.
 * @returns the patterns eligible for proposal targeting.
 */
export function eligiblePatterns(patterns: FailurePattern[], minOccurrences: number): FailurePattern[] {
  return patterns.filter((pattern) => {
    const lift = pattern.verifierTier === 'tool-runtime' ? 1 : 0
    return pattern.occurrences >= minOccurrences + lift
  })
}

/** Render one candidate as plain text for replay prompts and the judge. */
function candidateText(proposal: EvolveProposal): string {
  const candidate = proposal.candidate
  switch (candidate.kind) {
    case 'L1-skill':
      return candidate.content
    case 'L2-context':
      return `${candidate.sectionName}: ${candidate.sectionText}`
    case 'L3-workflow':
      return `workflow ${candidate.scriptName}:\n${candidate.scriptBody}`
    case 'L4-harness':
      return `plugin ${candidate.pluginIdPrefix} (host=${candidate.hostCode !== undefined ? 'provided' : 'none'}, client=${candidate.clientCode !== undefined ? 'provided' : 'none'})`
  }
}

/** Compact event-type window around a failure seq, for the replay prompt. */
function caseContextText(session: Session, lastSeq: number): string {
  const events = session.events
  const index = events.findIndex(event => event.seq === lastSeq)
  if (index < 0) return `失败事件 seq ${lastSeq}`
  const window = events.slice(Math.max(0, index - 2), index + 3)
  return window.map(event => `[${event.seq}] ${event.type}`).join(' → ')
}

/** Fold a fork child's own events (after the end-seed marker) into pattern ids. */
function classifyChildSession(session: Session): string[] {
  let state = failurePatternsProjectionDefinition.init()
  let afterSeed = false
  for (const event of session.events) {
    if (event.type === 'session/end-seed') {
      afterSeed = true
      continue
    }
    if (!afterSeed) continue
    state = failurePatternsProjectionDefinition.apply(state, event)
  }
  return Object.keys(state.patterns)
}

/** Plain text of one content block, or null for non-text blocks. */
function blockText(block: { type: string; text?: unknown }): string | null {
  return block.type === 'text' && typeof block.text === 'string' ? block.text : null
}

/** Join the text blocks of a content list into one plain-text surface. */
function extractContentText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: 'text'; text: string } => (
      typeof block === 'object' && block !== null
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string'
    ))
    .map(block => block.text)
    .join('\n')
}

/** Whether rendered tool text carries a shell failure marker (P3.1 trigger). */
function hasShellFailureMarkers(text: string): boolean {
  return /(?:^|\n)\[exit code: ([1-9]\d*)\]$/.test(text)
    || /(?:^|\n)\[killed by signal: [A-Z0-9]+\]$/.test(text)
}

/** Parse one step-reflection JSON output (P3.1); null when unparseable. */
function parseReflection(text: string): { confidence: number; patternId: string; suggestion: string } | null {
  const match = /\{[\s\S]*\}/.exec(text)
  if (match === null) return null
  try {
    const raw = JSON.parse(match[0]) as Record<string, unknown>
    const confidence = typeof raw.confidence === 'number' && Number.isFinite(raw.confidence)
      ? Math.min(1, Math.max(0, raw.confidence))
      : undefined
    const patternId = typeof raw.patternId === 'string' && raw.patternId.length > 0 ? raw.patternId : undefined
    const suggestion = typeof raw.suggestion === 'string' ? raw.suggestion : ''
    if (confidence === undefined || patternId === undefined) return null
    return { confidence, patternId, suggestion }
  } catch {
    // swallow a malformed reflection response: low-cost reflection degrades silently
    return null
  }
}

/** Parse the LLM proposer's JSON proposal array (P3.2); malformed entries drop out. */
function parseLlmProposals(text: string): EvolveProposal[] {
  const match = /\[[\s\S]*\]/.exec(text)
  if (match === null) return []
  try {
    const raw = JSON.parse(match[0]) as unknown
    if (!Array.isArray(raw)) return []
    const proposals: EvolveProposal[] = []
    for (const entry of raw) {
      const item = entry as Record<string, unknown>
      const candidate = item.candidate as Record<string, unknown> | undefined
      const name = typeof item.name === 'string' ? item.name : ''
      const purpose = typeof item.purpose === 'string' ? item.purpose : ''
      const addresses = Array.isArray(item.addressesPatternIds)
        ? item.addressesPatternIds.filter((id): id is string => typeof id === 'string')
        : []
      if (name.length === 0 || purpose.length === 0 || candidate === undefined) continue
      if (candidate.kind === 'L1-skill' && typeof candidate.skillName === 'string' && typeof candidate.content === 'string') {
        proposals.push({
          proposalId: String(proposalIdSeq()),
          runId: SelfEvolveRunId('pending'),
          level: 'L1-skill',
          name,
          purpose,
          addressesPatternIds: addresses,
          candidate: {
            kind: 'L1-skill',
            skillName: candidate.skillName,
            content: candidate.content,
            ...(typeof candidate.whenToUse === 'string' ? { whenToUse: candidate.whenToUse } : {}),
          },
        })
      } else if (candidate.kind === 'L2-context' && typeof candidate.sectionName === 'string' && typeof candidate.sectionText === 'string') {
        const sectionText = candidate.sectionText
        proposals.push({
          proposalId: String(proposalIdSeq()),
          runId: SelfEvolveRunId('pending'),
          level: 'L2-context',
          name,
          purpose,
          addressesPatternIds: addresses,
          candidate: {
            kind: 'L2-context',
            sectionName: candidate.sectionName,
            sectionText,
            order: typeof candidate.order === 'number' ? candidate.order : SECTION_ORDER_PATCH,
            estimatedBytes: sectionText.length,
          },
        })
      }
    }
    return proposals
  } catch {
    // swallow a malformed proposer response: the loop degrades to zero proposals
    return []
  }
}

/**
 * Parse the judge's JSON score object, clamped to [0, 1]. Returns null when
 * the output carries no parseable object with all four dimensions, so the
 * caller degrades to structural scores.
 */
function parseJudgeScores(text: string): ValidationScores | null {
  const match = /\{[\s\S]*\}/.exec(text)
  if (match === null) return null
  try {
    const raw = JSON.parse(match[0]) as Record<string, unknown>
    const score = (value: unknown): number | undefined => (
      typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined
    )
    const activatesWhenCorrect = score(raw.activatesWhenCorrect)
    const clarity = score(raw.clarity)
    const noRegressionIntroduced = score(raw.noRegressionIntroduced)
    const safety = score(raw.safety)
    if (activatesWhenCorrect === undefined || clarity === undefined || noRegressionIntroduced === undefined || safety === undefined) {
      return null
    }
    return { activatesWhenCorrect, clarity, noRegressionIntroduced, safety }
  } catch {
    // swallow a malformed judge response: unparseable output degrades to structural scores
    return null
  }
}

function makeIdSeq<T>(prefix: string, brand: (id: string) => T): () => T {
  let counter = 0
  const fullPrefix = `${prefix}-${Date.now().toString(36)}`
  return () => brand(`${fullPrefix}-${(counter++).toString(36)}`)
}

const runIdSeq = makeIdSeq('selfev', SelfEvolveRunId)
const proposalIdSeq = makeIdSeq('prop', EvolveProposalId)

const MAX_SECTION_NAME_DIGEST = 8
const SECTION_ORDER_PATCH = 260
/** Rolling window for the per-session autonomous-loop cap (`maxDailyLoopsPerSession`). */
const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000
/** How many recent per-pattern rejection rows the proposer prefix summarizes. */
const NEGATIVE_RESULTS_CONTEXT_ITEMS = 3
/** Missing-rate value for an unavailable verifier dimension (P1.4 weak path). */
const WEAK_VERIFIER_RATE = 0.3
/** Consecutive same-pattern regressions that trigger a champion rollback (P1.8). */
const REGRESSION_ROLLBACK_THRESHOLD = 2
/** Minimum workflow agents for an L3 smoke to count as passing (P2.1). */
const L3_SMOKE_MIN_AGENTS = 1
/** Step-reflection LLM budget (P3.1): input chars and output tokens. */
const REFLECTION_MAX_INPUT_CHARS = 2048
const REFLECTION_MAX_OUTPUT_TOKENS = 512
/** Rolling window for the cross-session global pattern merge (P4.2). */
const GLOBAL_PATTERN_WINDOW_MS = 24 * 60 * 60 * 1000
/** Structural scores for smoke and dual-verified acceptances (P1.4 LLM judge replaces these). */
const SMOKE_SCORES: ValidationScores = {
  activatesWhenCorrect: 1,
  clarity: 1,
  noRegressionIntroduced: 1,
  safety: 1,
}

/** One append-only negative-result row (P1.7b, 翁荔挑战 4). */
export interface NegativeResultRow {
  /** Wall-clock timestamp of the rejection. */
  ts: number
  /** The pattern the rejected proposal targeted. */
  patternId: string
  /** The rejected proposal's immutable identity. */
  proposalId: string
  /** Rejection reason from the validation outcome. */
  reason: Extract<ProposalValidationOutcome, { kind: 'rejected' }>['reason']
  /** Verifier-grounded failure detail. */
  diagnostic: string
  /** Partial per-dimension scores recorded before the rejection. */
  deconstructedScores?: Partial<ValidationScores>
  /** Repair hint the next proposal cycle should read first. */
  nextRoundSuggestion: string
}

/** Durable champion archive row (P1.8): the candidate a rollback restores. */
export interface ChampionArchiveRow {
  ts: number
  patternId: string
  proposalId: string
  name: string
  candidate: EvolveProposal['candidate']
}

/** Resolve and validate public configuration; throw at load time. */
function resolveConfig(config: BasicSelfEvolveConfig): ResolvedBasicSelfEvolveConfig {
  const triggers: TriggerPolicy = { ...DEFAULT_TRIGGERS }
  if (config.triggers !== undefined) {
    for (const key of Object.keys(config.triggers) as (keyof TriggerPolicy)[]) {
      triggers[key] = { ...triggers[key], ...config.triggers[key] }
    }
  }
  const resolved: ResolvedBasicSelfEvolveConfig = {
    maxDailyLoopsPerSession: config.maxDailyLoopsPerSession ?? 4,
    triggers,
    defaultLevels: config.defaultLevels ?? DEFAULT_LEVELS,
    minPatternOccurrences: config.minPatternOccurrences ?? 2,
    maxProposalsPerLoop: config.maxProposalsPerLoop ?? 2,
    maxDirtyLinesAddedPerCommit: config.maxDirtyLinesAddedPerCommit ?? 2,
    requireDualVerification: config.requireDualVerification ?? true,
    minAcceptConfidence: config.minAcceptConfidence ?? 0.5,
    maxHeldOutCases: config.maxHeldOutCases ?? 5,
    maxPromptInflationBytesPerWeek: config.maxPromptInflationBytesPerWeek ?? 2048,
    l4ReapprovalHours: config.l4ReapprovalHours ?? 24,
    maxStepReflectionsPerTurn: config.maxStepReflectionsPerTurn ?? 1,
    reflectionMinConfidence: config.reflectionMinConfidence ?? 0.85,
    patternFreezeHours: config.patternFreezeHours ?? 24,
    maxBudgetCharsPerLoop: config.maxBudgetCharsPerLoop ?? 32_768,
  }
  if (config.proposerTarget !== undefined && Object.keys(config.proposerTarget).length > 0) {
    if (config.proposerTarget.provider === undefined || config.proposerTarget.model === undefined) {
      throw new Error('self-evolve: proposerTarget must include both provider and model')
    }
    resolved.proposerTarget = config.proposerTarget
  }
  if (config.validatorTarget !== undefined && Object.keys(config.validatorTarget).length > 0) {
    if (config.validatorTarget.provider === undefined || config.validatorTarget.model === undefined) {
      throw new Error('self-evolve: validatorTarget must include both provider and model')
    }
    resolved.validatorTarget = config.validatorTarget
  }
  if (
    resolved.proposerTarget !== undefined
    && resolved.validatorTarget !== undefined
    && resolved.proposerTarget.provider === resolved.validatorTarget.provider
    && resolved.proposerTarget.model === resolved.validatorTarget.model
  ) {
    // Validator 漂移防护: the judge must never share the proposer's route.
    throw new Error('self-evolve: validatorTarget must differ from proposerTarget (validator drift protection)')
  }
  return resolved
}

/** Per-session rate-limiting state. */
interface SessionRateState {
  loopStarts: number[]
  lastStartByTrigger: Record<string, number>
  /** patternId → frozen-until epoch for the 24h proposal freeze (P3.3). */
  frozenPatterns: Map<string, number>
}

/**
 * Dependency-light self-evolve backend. Real implementations subclass
 * `proposeForPatterns()` and `validateProposal()`; trigger gating, projection
 * mining, rate limits, event brackets, and durable-log emission stay fixed.
 */
export class BasicSelfEvolveEngine extends SelfEvolveEngine {
  static inject = ['sessionProjections', 'sessions', 'skills', 'systemPrompt', 'agents']

  static Config: z<BasicSelfEvolveConfig> = z.object({
    maxDailyLoopsPerSession: z.number().step(1).min(0).default(4),
    triggers: z.dict(
      z.object({
        enabled: z.boolean(),
        minIntervalMs: z.number().step(1).min(0),
      }),
      z.union([
        z.const('idle-maintenance'),
        z.const('pressure'),
        z.const('user-command'),
        z.const('validation-retry'),
      ]),
    ).default(DEFAULT_TRIGGERS),
    defaultLevels: z.array(z.union([
      z.const('L1-skill'),
      z.const('L2-context'),
      z.const('L3-workflow'),
      z.const('L4-harness'),
    ])).default(DEFAULT_LEVELS),
    minPatternOccurrences: z.number().step(1).min(1).default(2),
    maxProposalsPerLoop: z.number().step(1).min(1).default(2),
    requireDualVerification: z.boolean().default(true),
    minAcceptConfidence: z.number().step(0.01).min(0).max(1).default(0.5),
    maxHeldOutCases: z.number().step(1).min(0).max(10).default(5),
    maxPromptInflationBytesPerWeek: z.number().step(1).min(0).default(2048),
    l4ReapprovalHours: z.number().step(0.5).min(0).default(24),
    maxStepReflectionsPerTurn: z.number().step(1).min(0).max(10).default(1),
    reflectionMinConfidence: z.number().step(0.01).min(0).max(1).default(0.85),
    patternFreezeHours: z.number().step(0.5).min(0).default(24),
    maxBudgetCharsPerLoop: z.number().step(1).min(0).default(32_768),
    proposerTarget: z.object({
      provider: z.string(),
      model: z.string(),
    }),
    validatorTarget: z.object({
      provider: z.string(),
      model: z.string(),
    }),
    maxDirtyLinesAddedPerCommit: z.number().step(1).min(0).default(2),
  })

  /** Resolved provider configuration with defaults applied. */
  readonly config: ResolvedBasicSelfEvolveConfig
  private readonly sessionRateStates = new Map<string, SessionRateState>()
  /** Live self-evolve-generated L2 sections, for prompt-inflation pruning (P1.9). */
  private readonly liveSections = new Map<string, { text: string; registeredAt: number; dispose: () => void }>()
  /** Consecutive same-pattern regressions, for champion rollback (P1.8). */
  private readonly regressionCounts = new Map<string, number>()
  /** L4 plugins this provider drove, keyed by pluginId → current proposalId (P2.2). */
  private readonly l4Pending = new Map<string, string>()
  /** L4 approval ledger, keyed by pluginId → last approved proposal + timestamp (P2.3). */
  private readonly l4Ledger = new Map<string, { proposalId: string; approvedAt: number }>()
  /** Per-session step-reflection counts for the current turn (P3.1). */
  private readonly reflectionCounts = new Map<string, { turn: number; count: number }>()
  /** Per-session per-pattern proposal counts for the 24h freeze (P3.3). */
  private readonly proposalCounts = new Map<string, number>()
  /** Byte budget charged across one loop's LLM calls and searches (P3.4); null outside a loop. */
  private loopBudget: { used: number } | null = null

  constructor(ctx: Context, config: BasicSelfEvolveConfig) {
    super(ctx)
    this.config = resolveConfig(config)
    ctx.effect(() => ctx.sessionProjections.register(failurePatternsProjectionDefinition))
    ctx.effect(() => ctx.on('session/event', (session: Session, event) => {
      if (event.type !== 'turn/end') return
      if (!this.config.triggers['idle-maintenance'].enabled) return
      const agent = ctx.agents.get(session.id)
      if (agent === undefined) return
      if (agent.status !== 'idle') return
      void (async () => {
        try {
          await this.evolveIfNeeded(
            {
              sessionId: agent.session.id,
              options: agent.options,
              runMaintenance: agent.runMaintenance.bind(agent),
            },
            'idle-maintenance',
            new AbortController().signal,
          )
        } catch (error: unknown) {
          // The loop itself emits the bracket-closing end event with its error
          // when the failure happened inside executeLoop; failures outside it
          // (mining or policy errors) surface only here, so log them instead
          // of swallowing.
          ctx.logger('self-evolve').warn(`idle-maintenance evolveIfNeeded failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      })()
    }))
    ctx.effect(() => ctx.on('agent/request-error', (payload, next) => {
      // Durable record of a failed model request (G1): the failure projection
      // classifies it as the llm-provider tier keyed on failure.code. The
      // waterfall must delegate regardless of our recording outcome.
      try {
        payload.agent.session.append('agent/request-error', {
          provider: payload.provider,
          statusCode: payload.failure.status,
          error: { code: payload.failure.code, name: 'LlmFailure', message: payload.failure.message },
        })
      } catch (error: unknown) {
        // A session closed during teardown cannot take appends; the projection
        // is best-effort and the failure is already durable in the log.
        ctx.logger('self-evolve').debug(`agent/request-error append skipped: ${error instanceof Error ? error.message : String(error)}`)
      }
      return next()
    }))
    ctx.effect(() => ctx.on('cordis/before-approval', (info, next) => next().then((base) => {
      // L4 re-approval guard (P2.3): a plugin this provider drove before is
      // forced through human approval again when the current proposal differs
      // from the last approved one or the approval is older than
      // `l4ReapprovalHours` — even when approveFutureVersions would
      // auto-approve.
      const pending = this.l4Pending.get(info.pluginId)
      const ledger = this.l4Ledger.get(info.pluginId)
      if (pending !== undefined && ledger !== undefined) {
        const stale = pending !== ledger.proposalId
          || Date.now() - ledger.approvedAt > this.config.l4ReapprovalHours * 3_600_000
        if (stale) return true
      }
      return base
    })))
    ctx.effect(() => ctx.on('agent/pre-step', async (payload, next): Promise<PreStepDecision> => {
      // Step reflection (P3.1): when the current turn already failed, one
      // low-budget LLM reflection per turn may reinforce an existing pattern.
      // The step pipeline must proceed regardless of the reflection outcome.
      if (!payload.signal.aborted && this.config.maxStepReflectionsPerTurn > 0) {
        try {
          await this.maybeReflect(payload.agent, payload.turn, payload.step, payload.signal)
        } catch (error: unknown) {
          ctx.logger('self-evolve').debug(`step reflection skipped: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return next()
    }))
  }

  async evolveIfNeeded(
    agent: SelfEvolveAgentContext,
    trigger: EvolveTrigger,
    signal: AbortSignal,
    levels: EvolveLevel[] = this.config.defaultLevels,
  ): Promise<SelfEvolveResult | null> {
    if (!this.config.triggers[trigger].enabled) return null
    const state = this.rateState(agent.sessionId)
    const now = Date.now()
    const triggerKey = String(trigger)
    const lastStart = state.lastStartByTrigger[triggerKey] ?? 0
    if (now - lastStart < this.config.triggers[trigger].minIntervalMs) return null
    // The 24-hour autonomous-loop cap bounds how much of the session budget an
    // unattended loop sequence can consume; explicit user commands bypass it.
    if (this.isAutonomousTrigger(trigger) && this.recentLoopCount(state) >= this.config.maxDailyLoopsPerSession) {
      return null
    }
    const patterns = await this.filterEligiblePatterns(agent.sessionId)
    if (patterns.length === 0) return null
    return this.runLoop(agent, trigger, patterns, levels, signal)
  }

  async evolveNow(
    agent: SelfEvolveAgentContext,
    signal: AbortSignal,
    levels: EvolveLevel[] = this.config.defaultLevels,
  ): Promise<SelfEvolveResult> {
    const patterns = await this.filterEligiblePatterns(agent.sessionId)
    return this.runLoop(agent, 'user-command', patterns, levels, signal)
  }

  async readPatterns(sessionId: string): Promise<FailurePattern[]> {
    const session = this.requireSession(sessionId)
    const snapshot = this.ctx.sessionProjections.snapshot(session)
    const state = snapshot.values[FAILURE_PATTERNS_PROJECTION_KEY] as { patterns?: Record<string, FailurePattern> } | undefined
    if (state === undefined || state.patterns === undefined) return []
    const sorted = Object.values(state.patterns).sort((a, b) => b.occurrences - a.occurrences)
    // Cross-session occurrence merge (P4.2): other sessions' occurrences
    // within the 24h window push sparse patterns over the mining threshold.
    const global = await this.readGlobalPatternOccurrences(sessionId)
    // Enrich each pattern with its durable rejection history (P1.6) so the
    // proposer sees prior failed attempts as few-shot counterexamples.
    const enriched: FailurePattern[] = []
    for (const pattern of sorted) {
      const globalOccurrences = global.get(pattern.patternId) ?? 0
      const occurrences = pattern.occurrences + globalOccurrences
      const failed = await this.readNegativeResults(pattern.patternId, NEGATIVE_RESULTS_CONTEXT_ITEMS)
      if (failed.length === 0) {
        enriched.push(globalOccurrences > 0 ? { ...pattern, occurrences } : pattern)
        continue
      }
      enriched.push({ ...pattern, occurrences, verifierMeta: { ...pattern.verifierMeta, failedProposals: failed } })
    }
    return enriched
  }

  /** Hook point for subclass implementations; base produces L2 prompt sections for L1-skill patterns.
   * When `proposerTarget` is configured and the llm service is mounted, the LLM proposer (P3.2)
   * runs instead; the template remains the default. `_agentOptions` is the routed proposer target
   * for subclass LLM calls. */
  protected async proposeForPatterns(
    patterns: FailurePattern[],
    levels: readonly EvolveLevel[],
    _agentOptions: { provider?: string; model?: string },
    signal: AbortSignal,
    sessionId?: string,
  ): Promise<EvolveProposal[]> {
    if (sessionId !== undefined) {
      const llm = await this.proposeWithLlm(patterns, levels, signal, sessionId)
      if (llm.length > 0) return llm
    }
    return this.proposeTemplate(patterns, levels)
  }

  /** The P0/P1 template proposer: one L2 prompt section per L1-skill pattern. */
  private async proposeTemplate(patterns: FailurePattern[], levels: readonly EvolveLevel[]): Promise<EvolveProposal[]> {
    if (!levels.includes('L2-context')) return []
    const out: EvolveProposal[] = []
    for (const pattern of patterns) {
      if (pattern.level !== 'L1-skill') continue
      const localId = pattern.patternId.includes(':')
        ? pattern.patternId.slice(pattern.patternId.indexOf(':') + 1)
        : pattern.patternId
      const sectionName = `self-evolve-patch-${localId.slice(0, MAX_SECTION_NAME_DIGEST)}`
      const lastSeq = pattern.supportingSeqs[pattern.supportingSeqs.length - 1]
      const contextHint = lastSeq !== undefined
        ? `supportingSeqs 最后一次失败 (seq ${lastSeq}) 的上下文`
        : '该 pattern 的上下文'
      const negatives = await this.readNegativeResults(pattern.patternId, NEGATIVE_RESULTS_CONTEXT_ITEMS)
      const failurePrefix = negatives.length > 0
        ? `此前针对该模式的 ${negatives.length} 次提案均被拒绝（${[...new Set(negatives.map(n => n.reason))].join('、')}），不要重复同样方案。`
        : ''
      const sectionText = `当你遇到以下工具错误模式时：${pattern.summary}。${failurePrefix}请先检查 ${contextHint}，不要立即重复同样的调用顺序；外部进程错误先诊断 exitCode 和 stderr 再修复。`
      const proposal: EvolveProposal = {
        proposalId: String(proposalIdSeq()),
        runId: SelfEvolveRunId('pending'),
        level: 'L2-context',
        name: sectionName,
        purpose: `L1-skill pattern ${pattern.patternId} 的 L2 上下文修补`,
        addressesPatternIds: [pattern.patternId],
        candidate: {
          kind: 'L2-context',
          sectionName,
          sectionText,
          order: SECTION_ORDER_PATCH,
          estimatedBytes: sectionText.length,
        },
      }
      out.push(proposal)
      if (out.length >= this.config.maxProposalsPerLoop) break
    }
    return out
  }

  /**
   * Replay one case with the candidate applied (P1.2), via the `fork`
   * subagent provider when it is mounted. The child is seeded with the
   * parent's completed-turn prefix and instructed to re-attempt the failing
   * action under the candidate; the child's own events (after the end-seed
   * marker) are folded with the failure projection to detect retriggered
   * patterns. Returns `null` when the replay infrastructure is unavailable
   * (no subagents service, no fork provider, or no live parent agent), so
   * the weak path applies.
   *
   * @param agent - owner session and maintenance runner.
   * @param proposal - the candidate being validated.
   * @param caseText - description of the failing case to re-attempt.
   * @param signal - cancels the fork and its turn work.
   * @returns replay exit code and retriggered pattern ids, or `null` when unavailable.
   */
  protected async replayCase(
    agent: SelfEvolveAgentContext,
    proposal: EvolveProposal,
    caseText: string,
    signal: AbortSignal,
  ): Promise<{ exitCode: number; retriggeredPatternIds: string[] } | null> {
    const subagents = this.ctx.get('subagents')
    const parent = this.ctx.agents.get(agent.sessionId)
    if (subagents === undefined || parent === undefined || subagents.getProvider('fork') === undefined) return null
    const run = await subagents.start('fork', {
      prompt: [{
        type: 'text',
        text: `你正在验证一个自进化修补提案，请如实重放以下失败场景并应用修补方案，完成一次验证执行。\n失败场景：${caseText}\n修补方案：${candidateText(proposal)}\n请按修补方案重新执行原本失败的操作，完成后用一句话说明结果。`,
      }],
      parent,
      signal,
    })
    try {
      const result = await run.result
      const exitCode = result.stopReason === 'completed' ? 0 : 1
      const retriggeredPatternIds = run.localAgent === undefined ? [] : classifyChildSession(run.localAgent.session)
      return { exitCode, retriggeredPatternIds }
    } finally {
      await run.dispose()
    }
  }

  /**
   * Replay signal for one proposal's held-in case (dual verifier A): re-attempt
   * the pattern's last supporting failure under the candidate (P1.2). Reports
   * the signal unavailable (null) when the replay infrastructure is absent.
   * L3-workflow candidates substitute the workflow smoke run (P2.1).
   */
  protected async collectReplaySignal(
    agent: SelfEvolveAgentContext,
    proposal: EvolveProposal,
    pattern: FailurePattern,
    signal: AbortSignal,
  ): Promise<{ exitCode: number; retriggeredPatternIds: string[] } | null> {
    if (proposal.candidate.kind === 'L3-workflow') {
      return this.runWorkflowSmoke(agent, proposal, signal)
    }
    const session = this.ctx.sessions.get(SessionId(agent.sessionId))
    const lastSeq = pattern.supportingSeqs[pattern.supportingSeqs.length - 1]
    const context = session === undefined || lastSeq === undefined
      ? `模式 ${pattern.patternId}（${pattern.summary}）`
      : `模式 ${pattern.patternId}（${pattern.summary}）最近一次失败事件链：${caseContextText(session, lastSeq)}`
    return this.replayCase(agent, proposal, context, signal)
  }

  /**
   * L3 workflow smoke run (Phase 2, P2.1): execute the candidate script once
   * through the workflow engine; it passes when the run completes with at
   * least one started agent. Returns null when the workflow engine or the
   * live parent agent is absent, so the weak path applies.
   */
  protected async runWorkflowSmoke(
    agent: SelfEvolveAgentContext,
    proposal: EvolveProposal,
    signal: AbortSignal,
  ): Promise<{ exitCode: number; retriggeredPatternIds: string[] } | null> {
    const candidate = proposal.candidate
    if (candidate.kind !== 'L3-workflow') return null
    const workflowEngine = this.ctx.get('workflowEngine')
    const parent = this.ctx.agents.get(agent.sessionId)
    if (workflowEngine === undefined || parent === undefined) return null
    const run = workflowEngine.start({
      script: candidate.scriptBody,
      meta: { name: candidate.scriptName, description: proposal.purpose },
      parent,
      signal,
    })
    try {
      const result = await run.result
      const passed = result.stopReason === 'completed' && result.agentsStarted >= L3_SMOKE_MIN_AGENTS
      return { exitCode: passed ? 0 : 1, retriggeredPatternIds: [] }
    } finally {
      await run.dispose()
    }
  }

  /**
   * Workspace signal for one proposal's held-in case (dual verifier B: `git
   * diff --stat` + build health). The base provider has no workspace verifier
   * (P1.3), so it reports the signal unavailable; subclasses override.
   */
  protected async collectWorkspaceSignal(_proposal: EvolveProposal): Promise<{ dirtyLines: number; noDirtyFallback: boolean } | null> {
    return null
  }

  /**
   * Held-out signal for one proposal (P1.3): search the current session's
   * history for events matching the pattern summary (up to
   * `maxHeldOutCases`), and replay each similar case with the candidate.
   * Returns `null` when sessionQuery is unavailable or no similar case is
   * found (weak path applies).
   */
  protected async collectHeldOutSignal(
    agent: SelfEvolveAgentContext,
    proposal: EvolveProposal,
    pattern: FailurePattern,
    signal: AbortSignal,
  ): Promise<{ passed: number; cases: number } | null> {
    const sessionQuery = this.ctx.get('sessionQuery')
    const session = this.ctx.sessions.get(SessionId(agent.sessionId))
    if (sessionQuery === undefined || session === undefined) return null
    const page = await sessionQuery.searchEvents({
      sessionId: session.id,
      query: pattern.summary,
      limit: this.config.maxHeldOutCases,
    }, { signal })
    const hits = page.items.filter(hit => !pattern.supportingSeqs.includes(hit.seq))
    if (hits.length === 0) return null
    let passed = 0
    for (const hit of hits) {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      const replay = await this.replayCase(
        agent,
        proposal,
        `相似历史失败 [seq ${hit.seq}]: ${hit.snippet.slice(0, 200)}`,
        signal,
      )
      if (replay !== null && replay.exitCode === 0 && replay.retriggeredPatternIds.length === 0) passed += 1
    }
    return { passed, cases: hits.length }
  }

  /**
   * LLM judge (P1.4): four fixed-dimension structural scores for the candidate
   * given the replay evidence. Returns `null` when no `validatorTarget` is
   * configured or the llm service is unavailable, so structural scores apply.
   */
  protected async _judge(
    proposal: EvolveProposal,
    evidence: ReplayEvidence[],
    signal: AbortSignal,
  ): Promise<ValidationScores | null> {
    const target = this.config.validatorTarget
    const llm = this.ctx.get('llm')
    if (target === undefined || llm === undefined) return null
    const system = '你是自进化修补提案的结构化评审员。只输出一个 JSON 对象，四个维度各给 0 到 1 之间的数字：'
      + '{"activatesWhenCorrect": 只在目标失败类上激活的准确性, "clarity": 措辞无歧义且自包含, '
      + '"noRegressionIntroduced": 未引入已观察到的回归, "safety": 不包含破坏性或过宽编辑}'
    const payload = JSON.stringify({ proposal: candidateText(proposal), evidence })
    this.chargeBudget(payload.length + system.length)
    const assembler = new BlockAssembler()
    const stream = llm.stream({
      provider: target.provider,
      model: target.model,
      messages: [createUserMessage({
        content: [{ type: 'text', text: payload }],
        source: { kind: 'plugin', plugin: 'dsh-self-evolve-basic' },
      })],
      system,
      temperature: 0,
      maxTokens: 200,
      signal,
    })
    for await (const chunk of stream) assembler.push(chunk)
    return parseJudgeScores(assembler.blocks().map(blockText).filter((text): text is string => text !== null).join('\n'))
  }

  /**
   * Validate one proposal through the Phase 1 pipeline: held-in dual
   * verification (when both signals are available), held-out similarity
   * replay, the LLM judge, and the aggregate confidence gate
   * `min(scores) × heldInRate × heldOutRate`. Missing dimensions degrade to
   * the weak rate (0.3), so unverifiable proposals are rejected
   * conservatively instead of committing on trust.
   */
  protected async validateProposal(
    agent: SelfEvolveAgentContext,
    proposal: EvolveProposal,
    signal: AbortSignal,
  ): Promise<ProposalValidationOutcome> {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    if (proposal.candidate.kind === 'L4-harness') {
      return this.validateL4Proposal(agent, proposal, signal)
    }
    const patterns = await this.readPatterns(agent.sessionId)
    const addressed = patterns.find(pattern => pattern.patternId === proposal.addressesPatternIds[0])
    const evidence: ReplayEvidence[] = []

    let heldInRate: number | null = null
    if (this.config.requireDualVerification) {
      const [replay, workspace] = await Promise.all([
        addressed !== undefined ? this.collectReplaySignal(agent, proposal, addressed, signal) : null,
        this.collectWorkspaceSignal(proposal),
      ])
      if (replay !== null && workspace !== null) {
        const held = this._verifyHeldInCase(replay, workspace)
        evidence.push({
          kind: 'held-in',
          coversPatternIds: proposal.addressesPatternIds,
          passed: held.passed,
          verifierSignal: held.reason ?? 'dual-verification',
          note: held.passed ? 'held-in 双 verifier 均通过。' : `held-in 双 verifier 拒绝（${held.reason}）。`,
        })
        if (!held.passed) {
          return {
            kind: 'rejected',
            reason: 'held-in-failed',
            heldInPassed: 0,
            regressions: [],
            replayEvidence: evidence,
            diagnostic: `held-in dual verification rejected (${held.reason})`,
            nextRoundSuggestion: '修复 held-in 重放或工作区脏状态后再重新提案。',
          }
        }
        heldInRate = 1
      } else {
        heldInRate = WEAK_VERIFIER_RATE
        evidence.push({
          kind: 'held-in',
          coversPatternIds: proposal.addressesPatternIds,
          passed: false,
          verifierSignal: 'verifier-unavailable',
          note: 'held-in 双 verifier 信号不可用（重放/工作区基础设施未接入），按弱路径 0.3 计。',
        })
      }
    }

    let heldOutPassed = 0
    let heldOutRate = WEAK_VERIFIER_RATE
    if (addressed !== undefined) {
      const heldOut = await this.collectHeldOutSignal(agent, proposal, addressed, signal)
      if (heldOut !== null) {
        heldOutPassed = heldOut.passed
        heldOutRate = heldOut.cases > 0 ? heldOut.passed / heldOut.cases : WEAK_VERIFIER_RATE
        evidence.push({
          kind: 'held-out',
          coversPatternIds: proposal.addressesPatternIds,
          passed: heldOutRate >= 0.6,
          verifierSignal: `held-out ${heldOut.passed}/${heldOut.cases}`,
          note: heldOutRate >= 0.6 ? 'held-out 通过率达标。' : 'held-out 通过率不足，保守拒绝。',
        })
      }
    }
    if (heldOutRate === WEAK_VERIFIER_RATE) {
      evidence.push({
        kind: 'held-out',
        coversPatternIds: proposal.addressesPatternIds,
        passed: false,
        verifierSignal: 'held-out-unavailable',
        note: 'held-out 相似案例或 sessionQuery 不可用，按弱路径 0.3 计。',
      })
    }

    const scores = (await this._judge(proposal, evidence, signal)) ?? SMOKE_SCORES
    const confidence = Math.min(scores.activatesWhenCorrect, scores.clarity, scores.noRegressionIntroduced, scores.safety)
      * (heldInRate ?? 1)
      * heldOutRate
    if (confidence >= this.config.minAcceptConfidence) {
      return {
        kind: 'accepted',
        heldInPassed: heldInRate === 1 ? 1 : 0,
        heldOutPassed,
        regressions: [],
        deconstructedScores: scores,
        confidence,
        replayEvidence: evidence,
        nextRoundSuggestion: '',
      }
    }
    return {
      kind: 'rejected',
      reason: 'low-confidence',
      heldInPassed: heldInRate === 1 ? 1 : 0,
      heldOutPassed,
      regressions: [],
      deconstructedScores: scores,
      confidence,
      replayEvidence: evidence,
      diagnostic: `confidence ${confidence.toFixed(2)} 低于阈值 ${this.config.minAcceptConfidence}`
        + `（scores=${Math.min(scores.activatesWhenCorrect, scores.clarity, scores.noRegressionIntroduced, scores.safety).toFixed(2)}, heldIn=${heldInRate ?? 1}, heldOut=${heldOutRate.toFixed(2)}）`,
      nextRoundSuggestion: '提供可复验的 held-in 重放或 held-out 证据后再重新提案。',
    }
  }

  /**
   * L4 validation (Phase 2, P2.2): define the plugin from the candidate and
   * run it through `dynamicCordisRunner`. A Client-bearing package always
   * enters the human approval flow; refusals reject the proposal, while an
   * armed run (awaiting-approval / starting / running) is accepted — the
   * activation settles asynchronously through the runner. The approval ledger
   * feeds the re-approval guard (P2.3).
   */
  protected async validateL4Proposal(
    agent: SelfEvolveAgentContext,
    proposal: EvolveProposal,
    signal: AbortSignal,
  ): Promise<ProposalValidationOutcome> {
    const runner = this.ctx.get('dynamicCordisRunner')
    const parent = this.ctx.agents.get(agent.sessionId)
    if (runner === undefined || parent === undefined) {
      return {
        kind: 'rejected',
        reason: 'approval-denied',
        regressions: [],
        diagnostic: 'L4-harness 需要 dynamicCordisRunner 服务（当前组合未挂载）。',
        nextRoundSuggestion: '在挂载 cordis-host-runner 的组合中启用 L4 提案。',
      }
    }
    const candidate = proposal.candidate
    if (candidate.kind !== 'L4-harness') {
      throw new Error('validateL4Proposal: expected an L4-harness candidate')
    }
    const receipt = runner.define({
      sessionId: agent.sessionId as never,
      plugin: { kind: 'new', idPrefix: candidate.pluginIdPrefix },
      name: proposal.name,
      purpose: proposal.purpose,
      code: {
        ...(candidate.hostCode !== undefined ? { host: candidate.hostCode } : {}),
        ...(candidate.clientCode !== undefined ? { client: candidate.clientCode } : {}),
      },
    })
    this.l4Pending.set(receipt.pluginId, proposal.proposalId)
    const response = await runner.run(parent, receipt.pluginId, receipt.packageId, 'run', signal)
    if (!response.ok) {
      return {
        kind: 'rejected',
        reason: 'approval-denied',
        regressions: [],
        diagnostic: `L4 run refused (${response.reason}): ${response.message ?? ''}`,
        nextRoundSuggestion: '修复 L4 候选定义或审批路径后重新提案。',
      }
    }
    return {
      kind: 'accepted',
      heldInPassed: 0,
      heldOutPassed: 0,
      regressions: [],
      deconstructedScores: SMOKE_SCORES,
      confidence: 1,
      replayEvidence: [{
        kind: 'held-in',
        coversPatternIds: proposal.addressesPatternIds,
        passed: true,
        verifierSignal: `cordis-run-${response.status}`,
        note: `L4 提案已进入 ${response.status} 流程（激活经 runner 异步落定）。`,
      }],
      nextRoundSuggestion: '',
    }
  }

  /**
   * Held-In dual-verifier check (翁荔挑战 1): a single case only passes when BOTH
   * independent signals confirm the proposal — a) the replayed supporting seq
   * exits cleanly with no re-appearance of the same patternId, and b) the
   * build/dirty-state signal reports no workspace regression. Any mixed T+F
   * result is treated as rejected-no-regression (not counted as a future
   * pattern regression, so naive proposers cannot learn to game it).
   */
  protected _verifyHeldInCase(
    replay: { exitCode: number; retriggeredPatternIds: string[] },
    workspace: { dirtyLines: number; noDirtyFallback: boolean },
  ): { passed: boolean; reason?: 'replay-failed' | 'workspace-dirty' } {
    const replayPassed = replay.exitCode === 0 && replay.retriggeredPatternIds.length === 0
    const buildPassed = workspace.noDirtyFallback || workspace.dirtyLines <= this.config.maxDirtyLinesAddedPerCommit
    if (replayPassed && buildPassed) return { passed: true }
    return {
      passed: false,
      reason: !replayPassed ? 'replay-failed' : 'workspace-dirty',
    }
  }

  /** Durable negative-results file under the resolved DSH home. */
  protected negativeResultsFile(): string {
    return dshHomePath('self-evolve', 'negative-results.jsonl')
  }

  /**
   * Append one rejected proposal to the durable negative-results log (P1.7b).
   * Failures propagate: a negative result that cannot be persisted is a
   * harness-data failure and closes the loop bracket with an error.
   *
   * @param proposal - the rejected proposal.
   * @param outcome - the rejection outcome; diagnostic and suggestion become the knowledge row.
   */
  protected async persistNegativeResult(
    proposal: EvolveProposal,
    outcome: Extract<ProposalValidationOutcome, { kind: 'rejected' }>,
  ): Promise<void> {
    const file = this.negativeResultsFile()
    const row: NegativeResultRow = {
      ts: Date.now(),
      patternId: proposal.addressesPatternIds[0] ?? '',
      proposalId: proposal.proposalId,
      reason: outcome.reason,
      diagnostic: outcome.diagnostic,
      ...(outcome.deconstructedScores !== undefined ? { deconstructedScores: outcome.deconstructedScores } : {}),
      nextRoundSuggestion: outcome.nextRoundSuggestion,
    }
    await mkdir(dirname(file), { recursive: true })
    await appendFile(file, `${JSON.stringify(row)}\n`, { flag: 'a' })
  }

  /**
   * Read the most recent negative results for one pattern (P1.8 prefix feed).
   *
   * @param patternId - the pattern whose failed proposals to load.
   * @param limit - maximum rows to return, most recent last.
   * @returns the matching rows; empty when the log does not exist yet.
   */
  async readNegativeResults(patternId: string, limit = NEGATIVE_RESULTS_CONTEXT_ITEMS): Promise<NegativeResultRow[]> {
    let raw: string
    try {
      raw = await readFile(this.negativeResultsFile(), 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const rows: NegativeResultRow[] = []
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue
      try {
        const parsed = JSON.parse(line) as NegativeResultRow
        if (parsed.patternId === patternId) rows.push(parsed)
      } catch {
        // swallow a malformed line: the log is append-only diagnostics and a
        // corrupt row must not block mining
      }
    }
    return rows.slice(-limit)
  }

  /** Commit one accepted proposal. Base handles L1 skill and L2 prompt sections.
   * Registrations are wrapped in `ctx.effect` scoped to the provider's context; disposal
   * (on validation-failure abort, or the provider fiber unwinding) removes the runtime
   * skill or prompt section cleanly. Accepted L1 skills are additionally persisted to
   * `<project>/.dsh/skills/<name>/SKILL.md` (P1.5) and the pre-commit state is archived
   * as a rollback champion (P1.8).
   */
  protected async applyCommit(
    agent: SelfEvolveAgentContext,
    proposal: EvolveProposal,
    validation: Extract<ProposalValidationOutcome, { kind: 'accepted' }>,
  ): Promise<{ commitSeq: number }> {
    const session = this.requireSession(agent.sessionId)
    const candidate = proposal.candidate
    await this.archiveChampion(proposal)
    switch (candidate.kind) {
      case 'L1-skill':
        this.ctx.effect(() => this.ctx.skills.register({
          name: candidate.skillName,
          description: proposal.purpose,
          whenToUse: candidate.whenToUse ?? '',
          source: 'runtime-evolve',
          content: candidate.content,
        }))
        await this.persistSkillFile(agent, proposal)
        break
      case 'L2-context':
        this.ctx.effect(() => {
          const disposer = this.ctx.systemPrompt.section({
            name: candidate.sectionName,
            order: candidate.order,
            text: candidate.sectionText,
          })
          const previous = this.liveSections.get(candidate.sectionName)
          if (previous !== undefined) previous.dispose()
          this.liveSections.set(candidate.sectionName, {
            text: candidate.sectionText,
            registeredAt: Date.now(),
            dispose: disposer,
          })
          return disposer
        })
        break
      case 'L3-workflow': {
        // The validation smoke already gated the candidate; the commit-time
        // smoke is the roadmap's belt-and-suspenders confirmation.
        const smoke = await this.runWorkflowSmoke(agent, proposal, new AbortController().signal)
        if (smoke === null || smoke.exitCode !== 0) {
          throw new Error(`applyCommit: L3 workflow smoke failed (${smoke === null ? 'workflow engine unavailable' : 'run did not complete with agents'})`)
        }
        break
      }
      case 'L4-harness': {
        // The plugin was defined and run during validation; committing records
        // the accepted candidate and updates the approval ledger (P2.3).
        for (const [pluginId, proposalId] of this.l4Pending) {
          if (proposalId === proposal.proposalId) {
            this.l4Ledger.set(pluginId, { proposalId, approvedAt: Date.now() })
          }
        }
        break
      }
      default:
        throw new Error('applyCommit: unsupported candidate kind')
    }
    const commitEvent = session.append('self-evolve/commit', { runId: proposal.runId, commit: { proposal, validation, commitSeq: 0 } })
    return { commitSeq: commitEvent.seq }
  }

  /**
   * Persist an accepted L1 skill to `<project>/.dsh/skills/<name>/SKILL.md`
   * (P1.5) through the fs capability when it is mounted. The skill-filesystem
   * provider's file observation picks the file up on its next scan; runtime
   * registration is unaffected when fs is absent.
   */
  protected async persistSkillFile(agent: SelfEvolveAgentContext, proposal: EvolveProposal): Promise<void> {
    const fs = this.ctx.get('fs')
    if (fs === undefined) return
    const candidate = proposal.candidate
    if (candidate.kind !== 'L1-skill') return
    const session = this.requireSession(agent.sessionId)
    const cwd = session.header.cwd ?? process.cwd()
    const frontmatter = (value: string): string => value.replace(/\n/g, ' ')
    const content = `---\nname: ${candidate.skillName}\ndescription: ${frontmatter(proposal.purpose)}\nwhenToUse: ${frontmatter(candidate.whenToUse ?? '')}\n---\n\n${candidate.content}\n`
    const target = await fs.resolve(join('.dsh', 'skills', candidate.skillName, 'SKILL.md'), { cwd })
    await fs.writeText(target, content)
  }

  /**
   * Archive the candidate a rollback would restore BEFORE the new commit
   * replaces it (P1.8): one JSON row per proposal under
   * `$DSH_HOME/self-evolve/archive/<patternId>/<proposalId>.json`.
   */
  protected async archiveChampion(proposal: EvolveProposal): Promise<void> {
    const patternId = proposal.addressesPatternIds[0]
    if (patternId === undefined) return
    const file = join(dshHomePath('self-evolve', 'archive', patternId), `${proposal.proposalId}.json`)
    const row: ChampionArchiveRow = {
      ts: Date.now(),
      patternId,
      proposalId: proposal.proposalId,
      name: proposal.name,
      candidate: proposal.candidate,
    }
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify(row)}\n`)
  }

  /**
   * Restore the latest archived champion candidate for a pattern after
   * repeated regressions (P1.8): re-register it through the owning seam (L1
   * skill / L2 section) without re-validating. L3/L4 candidates have no
   * base-provider apply path and are skipped.
   */
  protected async rollbackPattern(patternId: string): Promise<void> {
    const archiveDir = dshHomePath('self-evolve', 'archive', patternId)
    let files: string[]
    try {
      files = (await readdir(archiveDir)).filter(file => file.endsWith('.json'))
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    files.sort()
    const latest = files[files.length - 1]
    if (latest === undefined) return
    const row = JSON.parse(await readFile(join(archiveDir, latest), 'utf8')) as ChampionArchiveRow
    const candidate = row.candidate
    switch (candidate.kind) {
      case 'L1-skill':
        this.ctx.effect(() => this.ctx.skills.register({
          name: candidate.skillName,
          description: row.name,
          whenToUse: candidate.whenToUse ?? '',
          source: 'runtime-evolve-rollback',
          content: candidate.content,
        }))
        break
      case 'L2-context':
        this.ctx.effect(() => {
          const disposer = this.ctx.systemPrompt.section({
            name: candidate.sectionName,
            order: candidate.order,
            text: candidate.sectionText,
          })
          const previous = this.liveSections.get(candidate.sectionName)
          if (previous !== undefined) previous.dispose()
          this.liveSections.set(candidate.sectionName, {
            text: candidate.sectionText,
            registeredAt: Date.now(),
            dispose: disposer,
          })
          return disposer
        })
        break
      default:
        return
    }
  }

  /**
   * Long-horizon prompt-inflation pruning (P1.9, 翁荔挑战 7): when live
   * self-evolve L2 sections exceed `maxPromptInflationBytesPerWeek`, archive
   * the oldest sections to `$DSH_HOME/self-evolve/l2-archive/` and dispose
   * their effects until the total is back under budget. Usage counting (7-day
   * zero-use) is approximated by age: the oldest registered sections are
   * pruned first.
   */
  protected async pruneInflatedSections(): Promise<void> {
    const budget = this.config.maxPromptInflationBytesPerWeek
    let total = 0
    for (const section of this.liveSections.values()) total += section.text.length
    if (total <= budget) return
    const ordered = [...this.liveSections.entries()].sort((a, b) => a[1].registeredAt - b[1].registeredAt)
    for (const [name, section] of ordered) {
      if (total <= budget) break
      await this.archiveSection(name, section.text)
      section.dispose()
      this.liveSections.delete(name)
      total -= section.text.length
    }
  }

  private async archiveSection(name: string, text: string): Promise<void> {
    const file = join(dshHomePath('self-evolve', 'l2-archive'), `${name}.md`)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, `${text}\n`, { flag: 'a' })
  }

  /** Count one rejected proposal for its pattern; true when rollback triggers (P1.8). */
  private trackRegression(patternId: string): boolean {
    const next = (this.regressionCounts.get(patternId) ?? 0) + 1
    this.regressionCounts.set(patternId, next)
    return next >= REGRESSION_ROLLBACK_THRESHOLD
  }

  private resetRegressions(patternId: string): void {
    this.regressionCounts.delete(patternId)
  }

  /** Charge one LLM/search byte cost against the running loop budget (P3.4). */
  private chargeBudget(cost: number): void {
    if (this.loopBudget === null) return
    this.loopBudget.used += cost
    if (this.loopBudget.used > this.config.maxBudgetCharsPerLoop) {
      throw new DOMException(`budget-exceeded: ${this.loopBudget.used} chars over ${this.config.maxBudgetCharsPerLoop}`, 'AbortError')
    }
  }

  /** Whether the current turn contains a durable failure surface (P3.1 trigger). */
  private turnHasFailure(session: Session, turn: number): boolean {
    for (const event of session.events) {
      const data = event.data as { turn?: unknown; message?: { content?: unknown }; error?: unknown }
      if (data.turn !== turn) continue
      if (event.type === 'agent/request-error') return true
      if (event.type === 'tool/result') {
        if (data.error !== undefined) return true
        if (hasShellFailureMarkers(extractContentText(data.message?.content))) return true
      }
    }
    return false
  }

  /**
   * Step reflection (P3.1): at most `maxStepReflectionsPerTurn` times per
   * turn, when the turn already carries a durable failure, run one
   * low-budget LLM reflection (2K input chars, 512 output tokens) that names
   * an existing pattern; confidence at or above `reflectionMinConfidence`
   * reinforces it via a `self-evolve/reflection` session event. Failures are
   * best-effort — the step pipeline never blocks on reflection.
   */
  protected async maybeReflect(agent: Agent, turn: number, step: number, signal: AbortSignal): Promise<void> {
    const session = this.ctx.sessions.get(agent.session.id)
    const llm = this.ctx.get('llm')
    if (session === undefined || llm === undefined) return
    if (agent.options.provider === undefined || agent.options.model === undefined) return
    const state = this.reflectionCounts.get(agent.session.id)
    if (state !== undefined && state.turn === turn && state.count >= this.config.maxStepReflectionsPerTurn) return
    if (!this.turnHasFailure(session, turn)) return
    const patterns = await this.readPatterns(agent.session.id)
    if (patterns.length === 0) return
    this.reflectionCounts.set(agent.session.id, { turn, count: (state?.turn === turn ? state.count : 0) + 1 })
    const prompt = '你正在为一次失败的 agent 步骤做低成本反思。从以下现有失败模式中选一个最匹配的（只输出 JSON：'
      + '{"confidence": 0到1, "patternId": 精确的模式id, "suggestion": 一句修复建议}）：\n'
      + patterns.map(p => `${p.patternId}: ${p.summary}`).join('\n')
    const trimmed = prompt.slice(0, REFLECTION_MAX_INPUT_CHARS)
    const assembler = new BlockAssembler()
    const stream = llm.stream({
      provider: agent.options.provider,
      model: agent.options.model,
      messages: [createUserMessage({ content: [{ type: 'text', text: trimmed }], source: { kind: 'plugin', plugin: 'dsh-self-evolve-basic' } })],
      temperature: 0,
      maxTokens: REFLECTION_MAX_OUTPUT_TOKENS,
      signal,
    })
    for await (const chunk of stream) assembler.push(chunk)
    const reflection = parseReflection(assembler.blocks().map(blockText).filter((text): text is string => text !== null).join('\n'))
    if (reflection === null || reflection.confidence < this.config.reflectionMinConfidence) return
    if (!patterns.some(p => p.patternId === reflection.patternId)) return
    session.append('self-evolve/reflection', {
      turn,
      step,
      patternId: reflection.patternId,
      confidence: reflection.confidence,
      suggestion: reflection.suggestion.slice(0, 200),
    })
  }

  /**
   * LLM proposer (P3.2): when `proposerTarget` is configured and the llm
   * service is mounted, generate L1/L2 proposals from the eligible patterns
   * with the JoyCode CSR experience section (`resolved <summary>` search
   * hits) and the per-pattern negative-results prefix as few-shot context.
   * Falls back to the template proposer when the route is unavailable.
   */
  protected async proposeWithLlm(
    patterns: FailurePattern[],
    levels: readonly EvolveLevel[],
    signal: AbortSignal,
    sessionId: string,
  ): Promise<EvolveProposal[]> {
    const target = this.config.proposerTarget
    const llm = this.ctx.get('llm')
    if (target === undefined || llm === undefined) return []
    const session = this.ctx.sessions.get(SessionId(sessionId))
    const section = await this.buildProposerContext(patterns, levels, session)
    if (section === null) return []
    const prompt = `你是一个自进化修补提案器。为以下失败模式生成最多 ${this.config.maxProposalsPerLoop} 个 L1-skill 或 L2-context 修补提案。`
      + '只输出 JSON 数组：[{"name","purpose","addressesPatternIds":["patternId"],"candidate":{"kind":"L1-skill","skillName","content","whenToUse"?} 或 {"kind":"L2-context","sectionName","sectionText","order":260}}]。'
      + '\n\n' + section
    this.chargeBudget(prompt.length)
    const assembler = new BlockAssembler()
    const stream = llm.stream({
      provider: target.provider,
      model: target.model,
      messages: [createUserMessage({ content: [{ type: 'text', text: prompt }], source: { kind: 'plugin', plugin: 'dsh-self-evolve-basic' } })],
      temperature: 0.4,
      maxTokens: 1024,
      signal,
    })
    for await (const chunk of stream) assembler.push(chunk)
    const text = assembler.blocks().map(blockText).filter((text): text is string => text !== null).join('\n')
    return parseLlmProposals(text).slice(0, this.config.maxProposalsPerLoop)
  }

  /** Assemble the proposer context: patterns, negative results, and CSR hits (P3.2). */
  private async buildProposerContext(
    patterns: FailurePattern[],
    levels: readonly EvolveLevel[],
    session: Session | undefined,
  ): Promise<string | null> {
    if (levels.length === 0) return null
    const sections: string[] = []
    for (const pattern of patterns.slice(0, this.config.maxProposalsPerLoop * 2)) {
      const failed = await this.readNegativeResults(pattern.patternId, NEGATIVE_RESULTS_CONTEXT_ITEMS)
      let block = `模式 ${pattern.patternId}（${pattern.summary}，occurrences=${pattern.occurrences}）`
      if (failed.length > 0) {
        block += `\n此前 ${failed.length} 次提案被拒：${failed.map(f => `${f.reason}: ${f.nextRoundSuggestion}`).join('; ')}`
      }
      const sessionQuery = this.ctx.get('sessionQuery')
      if (sessionQuery !== undefined && session !== undefined) {
        // JoyCode CSR experience section: how similar failures were actually resolved.
        const page = await sessionQuery.searchEvents({ sessionId: session.id, query: `resolved ${pattern.summary}`, limit: 3 })
        if (page.items.length > 0) {
          block += `\n相似问题解决经验：${page.items.map(hit => `[seq ${hit.seq}] ${hit.snippet.slice(0, 160)}`).join(' | ')}`
        }
        this.chargeBudget(page.items.length * 200)
      }
      sections.push(block)
    }
    return sections.join('\n\n')
  }

  /** One parsed step-reflection output (P3.1). */
  /**
   * Per-session per-pattern freeze (P3.3): count proposals per pattern and
   * freeze a pattern for `patternFreezeHours` once it has been proposed
   * twice; the third targeting attempt skips it.
   */
  private markProposed(sessionId: string, patternId: string): void {
    const key = `${sessionId}:${patternId}`
    const next = (this.proposalCounts.get(key) ?? 0) + 1
    this.proposalCounts.set(key, next)
    if (next >= 2) {
      const state = this.rateState(sessionId)
      state.frozenPatterns.set(patternId, Date.now() + this.config.patternFreezeHours * 3_600_000)
    }
  }

  /** Append the run's patterns to the cross-session global log (P4.1). */
  protected async persistGlobalPatterns(agent: SelfEvolveAgentContext, patterns: FailurePattern[]): Promise<void> {
    if (patterns.length === 0) return
    const file = dshHomePath('self-evolve', 'global-patterns.jsonl')
    await mkdir(dirname(file), { recursive: true })
    const rows = patterns.map(p => `${JSON.stringify({ ts: Date.now(), sessionId: agent.sessionId, patternId: p.patternId, occurrences: p.occurrences })}\n`).join('')
    await appendFile(file, rows, { flag: 'a' })
  }

  /** Cross-session occurrences for a session's patterns within the 24h window (P4.2). */
  protected async readGlobalPatternOccurrences(sessionId: string): Promise<Map<string, number>> {
    const file = dshHomePath('self-evolve', 'global-patterns.jsonl')
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
      throw error
    }
    const cutoff = Date.now() - GLOBAL_PATTERN_WINDOW_MS
    const merged = new Map<string, number>()
    for (const line of raw.split('\n')) {
      if (line.trim().length === 0) continue
      try {
        const row = JSON.parse(line) as { ts: number; sessionId: string; patternId: string; occurrences: number }
        if (row.ts < cutoff || row.sessionId === sessionId) continue
        merged.set(row.patternId, (merged.get(row.patternId) ?? 0) + row.occurrences)
      } catch {
        // swallow a malformed row: the log is append-only diagnostics and a
        // corrupt row must not block mining
      }
    }
    return merged
  }

  private rateState(sessionId: string): SessionRateState {
    const existing = this.sessionRateStates.get(sessionId)
    if (existing !== undefined) return existing
    const created: SessionRateState = { loopStarts: [], lastStartByTrigger: {}, frozenPatterns: new Map() }
    this.sessionRateStates.set(sessionId, created)
    return created
  }

  private async filterEligiblePatterns(sessionId: string): Promise<FailurePattern[]> {
    const all = await this.readPatterns(sessionId)
    const state = this.rateState(sessionId)
    const now = Date.now()
    return eligiblePatterns(all, this.config.minPatternOccurrences)
      .filter((pattern) => {
        const frozenUntil = state.frozenPatterns.get(pattern.patternId)
        return frozenUntil === undefined || frozenUntil <= now
      })
  }

  private isAutonomousTrigger(trigger: EvolveTrigger): boolean {
    return trigger === 'idle-maintenance' || trigger === 'pressure' || trigger === 'validation-retry'
  }

  private recentLoopCount(state: SessionRateState): number {
    const cutoff = Date.now() - DAILY_WINDOW_MS
    state.loopStarts = state.loopStarts.filter(timestamp => timestamp > cutoff)
    return state.loopStarts.length
  }

  private runLoop(
    agent: SelfEvolveAgentContext,
    trigger: EvolveTrigger,
    patterns: FailurePattern[],
    levels: readonly EvolveLevel[],
    signal: AbortSignal,
  ): Promise<SelfEvolveResult> {
    const state = this.rateState(agent.sessionId)
    state.loopStarts.push(Date.now())
    state.lastStartByTrigger[String(trigger)] = Date.now()
    const runId = runIdSeq()
    return agent.runMaintenance(async (maintenanceSignal) => {
      const combined = AbortSignal.any([signal, maintenanceSignal])
      return this.executeLoop(runId, agent, trigger, patterns, levels.slice(), combined)
    })
  }

  private async executeLoop(
    runId: SelfEvolveRunId,
    agent: SelfEvolveAgentContext,
    trigger: EvolveTrigger,
    patterns: FailurePattern[],
    levels: EvolveLevel[],
    signal: AbortSignal,
  ): Promise<SelfEvolveResult> {
    const session = this.requireSession(agent.sessionId)
    const targeting = patterns.slice(0, this.config.maxProposalsPerLoop).map(p => p.patternId)
    const startEvent = session.append('self-evolve/start', { runId, sessionId: agent.sessionId, trigger, startedAt: Date.now(), levels, targeting })
    this.ctx.emit('self-evolve-loop/start', { runId, trigger })
    session.append('self-evolve/mined', {
      runId,
      patterns: patterns.map(p => ({
        patternId: p.patternId,
        verifierTier: p.verifierTier,
        causalSignature: p.causalSignature,
        level: p.level,
        summary: p.summary,
        occurrences: p.occurrences,
        supportingSeqs: p.supportingSeqs,
        verifierMeta: p.verifierMeta,
      })),
      targeting,
    })
    const committed: EvolveCommit[] = []
    this.loopBudget = { used: 0 }
    try {
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      // Long-horizon prompt-inflation guard (P1.9): prune before mining so the
      // loop never proposes while the prompt budget is already over.
      await this.pruneInflatedSections()
      const agentOptions = { ...agent.options }
      if (this.config.proposerTarget !== undefined) {
        agentOptions.provider = this.config.proposerTarget.provider
        agentOptions.model = this.config.proposerTarget.model
      }
      const proposalsRaw = await this.proposeForPatterns(patterns, levels, agentOptions, signal, agent.sessionId)
      const proposals = proposalsRaw
        .map(p => ({ ...p, runId }))
        .slice(0, this.config.maxProposalsPerLoop)
      for (const proposal of proposals) {
        // Per-pattern freeze accounting (P3.3): two proposals freeze a pattern.
        const addressed = proposal.addressesPatternIds[0]
        if (addressed !== undefined) this.markProposed(agent.sessionId, addressed)
        session.append('self-evolve/proposed', { runId, proposal })
        const outcome = await this.validateProposal(agent, proposal, signal)
        session.append('self-evolve/validated', { runId, proposalId: proposal.proposalId, outcome })
        if (outcome.kind !== 'accepted') {
          await this.persistNegativeResult(proposal, outcome)
          const patternId = proposal.addressesPatternIds[0]
          if (patternId !== undefined && this.trackRegression(patternId)) {
            await this.rollbackPattern(patternId)
            this.resetRegressions(patternId)
          }
          continue
        }
        this.resetRegressions(proposal.addressesPatternIds[0] ?? '')
        const result = await this.applyCommit(agent, proposal, outcome)
        session.append('self-evolve/commit', { runId, commit: { proposal, validation: outcome, commitSeq: result.commitSeq } })
        committed.push({ proposal, validation: outcome, commitSeq: result.commitSeq })
      }
      // Cross-session global pattern log (P4.1): recorded before the end event
      // so a fresh session can meet thresholds earlier (P4.2).
      await this.persistGlobalPatterns(agent, patterns)
      const endEvent = session.append('self-evolve/end', {
        runId,
        committedProposalIds: committed.map(c => c.proposal.proposalId),
        endedAt: Date.now(),
      })
      this.ctx.emit('self-evolve-loop/end', { runId })
      return {
        runId,
        trigger,
        patterns,
        proposals,
        commits: committed,
        startSeq: startEvent.seq,
        endSeq: endEvent.seq,
      }
    } catch (error: unknown) {
      const diagnostic = error instanceof Error ? error.stack ?? error.message : String(error)
      session.append('self-evolve/end', {
        runId,
        committedProposalIds: committed.map(c => c.proposal.proposalId),
        error: diagnostic,
        endedAt: Date.now(),
      })
      this.ctx.emit('self-evolve-loop/end', { runId, error: diagnostic })
      throw error
    } finally {
      this.loopBudget = null
    }
  }

  private requireSession(sessionId: string): Session {
    const session = this.ctx.sessions.get(SessionId(sessionId))
    if (session === undefined) throw new Error(`self-evolve: unknown sessionId ${sessionId}`)
    return session
  }
}

export default BasicSelfEvolveEngine
