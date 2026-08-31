/**
 * Model-facing self-evolve tools and system-prompt section.
 *
 * Two tools are registered:
 *   - `self_evolve_inspect_patterns` reads the session's projected failure
 *     patterns so the model can decide whether to call the explicit loop tool.
 *   - `self_evolve_now` initiates an explicit evolution loop within the
 *     current session, restricted to the requested levels (default L1 + L2).
 *
 * The base provider targets L1-skill and L2-context only; L3-workflow and
 * L4-harness requests are accepted by the tool but produce no proposals until
 * the advanced providers land. Proposal validation requires the held-in dual
 * verifier; the workspace half is active only when the profile configures
 * `workspaceVerifier.buildCommand` for the basic provider, so base proposals
 * are conservatively rejected and no commits occur without it; the prompt
 * section states that honestly instead of over-promising.
 *
 * @module @deepseek-ai/dsh-tool-self-evolve
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { EvolveLevel, FailurePattern, SelfEvolveResult } from '@deepseek-ai/dsh-self-evolve'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type {} from '@deepseek-ai/dsh-system-prompt'

const SECTION_NAME = 'tool:self-evolve'
const SECTION_ORDER = 130
const PROMPT_SECTION_TEXT
  = `Self-evolve capability (experimental): the harness observes tool and request failures incrementally and, on idle or explicit request, proposes narrow edits to skills and prompt sections.
- Call self_evolve_inspect_patterns to read failure patterns observed for this session.
- Call self_evolve_now with an explicit level list to start one loop.
- The base provider targets L1-skill and L2-context only; requesting L3-workflow or L4-harness produces no proposals yet.
- Proposal validation requires the held-in dual verifier (fork replay + workspace check). The workspace check is active only when the profile configures workspaceVerifier.buildCommand for the basic provider; without it the loop degrades to the conservative weak path and no commits occur — treat any commit as experimental.
- Do not fabricate failure patterns or proposals. The projection-driven pattern view is the authoritative source; inspect it before making any proposal-level claims.`

export const name = 'tool-self-evolve'
export const inject = ['tools', 'systemPrompt', 'selfEvolve', 'agents']

function requireAgent(exec: { agent?: Agent }): Agent {
  if (exec.agent === undefined) throw new Error('self-evolve tools require an Agent-backed session')
  return exec.agent
}

function toLevels(raw: unknown): EvolveLevel[] {
  if (raw === undefined || raw === null) return ['L1-skill', 'L2-context']
  /* v8 ignore next -- the parameter schema validates levels as an array before execute */
  if (!Array.isArray(raw)) throw new Error('`levels` must be an array, when provided')
  const allowed = new Set<EvolveLevel>(['L1-skill', 'L2-context', 'L3-workflow', 'L4-harness'])
  const levels: EvolveLevel[] = []
  for (const item of raw) {
    /* v8 ignore next -- the parameter schema constrains items to the EvolveLevel enum */
    if (!allowed.has(item as EvolveLevel)) throw new Error(`unknown level ${String(item)}`)
    levels.push(item as EvolveLevel)
  }
  return levels
}

/** Model-facing projection of one failure pattern: task-relevant fields only. */
interface InspectPatternView {
  patternId: string
  level: EvolveLevel
  verifierTier: FailurePattern['verifierTier']
  summary: string
  occurrences: number
  supportingSeqs: number[]
}

/**
 * Reduce a seam failure pattern to its model-facing view, dropping the
 * owner-specific `verifierMeta` payload — which can carry full tool render
 * text, stderr prefixes, raw error objects, and provider/model routes — and
 * the internal `causalSignature` so no transport or implementation vocabulary
 * reaches the model (see packages/AGENTS.md model-facing rule).
 */
function toInspectView(pattern: FailurePattern): InspectPatternView {
  return {
    patternId: pattern.patternId,
    level: pattern.level,
    verifierTier: pattern.verifierTier,
    summary: pattern.summary,
    occurrences: pattern.occurrences,
    supportingSeqs: pattern.supportingSeqs,
  }
}

/** Register the model-facing tools and the stable prompt section. */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name: SECTION_NAME, order: SECTION_ORDER, text: PROMPT_SECTION_TEXT })

  ctx.tools.register(defineTool({
    name: 'self_evolve_inspect_patterns',
    description:
      'Read the projected failure-pattern state for the current session. '
      + 'Returned entries are ranked by occurrence count; each cites the durable session '
      + 'seqs of the events that back the pattern. Call this tool before '
      + 'self_evolve_now so you can target real patterns rather than guessing.',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(_args, exec): Promise<JsonValue> {
      const agent = requireAgent(exec)
      const patterns = (await ctx.selfEvolve.readPatterns(agent.session.id)).map(toInspectView)
      return { patterns } as unknown as JsonValue
    },
  }))

  ctx.tools.register(defineTool({
    name: 'self_evolve_now',
    description:
      'Initiate one explicit self-evolve loop for the current session: mine the projected '
      + 'failure patterns, propose narrow edits for the requested levels, and commit proposals '
      + 'that pass the provider\'s validation gate. '
      + '`levels` defaults to skill and prompt-section edits (L1-skill, L2-context). '
      + 'L3-workflow and L4-harness are accepted for forward compatibility but the base provider '
      + 'produces no proposals for those levels yet.',
    parameters: {
      levels: {
        type: 'array',
        description:
          'Edit surfaces this loop may target. Defaults to the two narrowest surfaces. '
          + 'The base provider implements L1-skill and L2-context only; L3-workflow and '
          + 'L4-harness produce no proposals until advanced providers land.',
        items: { type: 'string', enum: ['L1-skill', 'L2-context', 'L3-workflow', 'L4-harness'] },
      },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    async execute(args, exec): Promise<JsonValue> {
      const agent = requireAgent(exec)
      const levels = toLevels(args.levels)
      let result: SelfEvolveResult
      try {
        result = await ctx.selfEvolve.evolveNow(
          {
            sessionId: agent.session.id,
            options: agent.options,
            runMaintenance: agent.runMaintenance.bind(agent),
          },
          exec.signal,
          levels,
        )
      } catch (error: unknown) {
        // The agent's maintenance phase rejects a second loop on a busy
        // agent; translate that raw guard error into a model-facing message.
        if (error instanceof Error && /already has active work/.test(error.message)) {
          throw new Error('self-evolve loop is already running for this agent; wait for it to settle before starting another')
        }
        throw error
      }
      return {
        runId: String(result.runId),
        trigger: result.trigger,
        patternsMined: result.patterns.length,
        proposals: result.proposals.map(p => ({
          proposalId: p.proposalId,
          level: p.level,
          name: p.name,
          addressesPatternIds: p.addressesPatternIds,
        })),
        commits: result.commits.map(c => ({
          proposalId: c.proposal.proposalId,
          regressions: c.validation.regressions.length,
        })),
      }
    },
  }))
}
