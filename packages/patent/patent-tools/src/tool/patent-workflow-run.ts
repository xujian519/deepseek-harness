/**
 * `patent_workflow_run` tool: automatically execute a declarative patent
 * workflow (atom stages) or a domain graph. Manifest path runs
 * `runWorkflow` over a built-in manifest; graph path
 * (novelty|inventiveness|enablement) runs a full domain graph through
 * `runGraphWithCheckpoints` with approval-gate resume/approve.
 *
 * Rule-gate deviation: the manifest path's deterministic rule-gate section is
 * dropped (Sati's RuleEngine + defaultPatentRules live in
 * `@deepseek-ai/dsh-patent-rule`); `checkSection` renders empty. The graph
 * path keeps its internal rule_gate node (dsh-patent-core's checker).
 * @module @deepseek-ai/dsh-patent-tools/tool/patent-workflow-run
 */

import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  DOMAIN_GRAPHS,
  InMemoryCheckpointStore,
  JsonFileCheckpointStore,
  grantApproval,
  globalAtomRegistry,
  globalStageHandlerRegistry,
  runGraphWithCheckpoints,
  validateWorkflowManifest,
  type CheckpointStore,
  type DegradationMark,
  type DomainGraphName,
  type GraphCheckpoint,
  type GraphState,
  type StageHandlerRegistry,
  type WorkflowContext,
  type WorkflowManifest,
  type WorkflowRunResult,
} from '@deepseek-ai/dsh-patent-core'
import { builtinPatentManifests } from '@deepseek-ai/dsh-patent-workflow'
import { PatentToolError } from '../error.ts'
import {
  buildWorkflowProvider,
  buildWorkflowRunContext,
  createChainStageExecutor,
  renderWorkflowResultText,
  renderWorkflowStageLines,
  resolveRunPersistTarget,
  runWorkflowWithPersist,
  writeRunArtifacts,
  type WorkflowProviderDeps,
} from './internal/workflow-helpers.ts'

/** The domain graphs the graph path can run. */
export type PatentWorkflowRunGraph = 'novelty' | 'inventiveness' | 'enablement' | 'citation-check'

/** Tool input: manifest or graph path plus the material and approval controls. */
export type PatentWorkflowRunInput = {
  /** Manifest id (default patent_disclosure_v1); mutually exclusive with graph. */
  manifestId?: string
  /** Domain graph to run end-to-end (takes precedence over manifestId). */
  graph?: PatentWorkflowRunGraph
  /** Graph-mode checkpoint id from a previous interrupted run; resumes from it. */
  resumeCheckpointId?: string
  /** Graph-mode approval: grants the gate at this checkpoint then resumes past it. */
  approveCheckpointId?: string
  /** Manifest-mode stage ids of already-approved approval gates (skipped on rerun). */
  approveStageIds?: string[]
  /** Optional case id enabling run/checkpoint persistence. */
  caseId?: string
  /** Initial material consumed by the extract atoms. */
  input: string
  /** claim-chart target objects JSON (default empty). */
  chartTargets?: string
  /** Max prior-art search results (default 5). */
  maxResults?: number
  /** Existing prior-art evidence entries as a JSON array (graph path; citation-check grounds against these). */
  priorArt?: string
}

/** Tool canonical result: manifest-mode run record or graph-mode run state. */
export type PatentWorkflowRunOutput = {
  /** Whether the run executed (false carries an unknown/validation error). */
  ok: boolean
  /** Which execution path produced this result. */
  mode: 'manifest' | 'graph'
  /** Manifest id (or the graph id patent_<graph> for graph mode). */
  manifestId: string
  /** Graph name (graph mode only). */
  graph?: string
  /** Graph superstep count (graph mode only). */
  steps?: number
  /** Whether the run completed without degraded steps/interruption. */
  completed?: boolean
  /** The run summary (manifest mode). */
  summary?: string
  /** Per-stage results (manifest mode), JSON-safe. */
  stages?: JsonValue[]
  /** Stage ids that produced no (or degraded) output (manifest mode). */
  degradedSteps?: string[]
  /** Persistence note (or the "not enabled" marker without a caseId). */
  persistNote?: string
  /** Persistence failure warning, when present. */
  persistWarning?: string
  /** Approval-gate interrupt note, when the run paused for human confirmation. */
  interruptNote?: string
  /** Final graph state (graph mode), JSON-safe. */
  graphState?: JsonValue
  /** Graph degradation marks (graph mode), JSON-safe. */
  graphDegraded?: JsonValue[]
  /** Last saved checkpoint id (graph mode). */
  checkpointId?: string
  /** Checkpoint note for resume (graph mode). */
  checkpointNote?: string
  /** Soft-outcome message (unknown manifest/checkpoint, validation failure). */
  error?: string
  /** Built-in manifest ids (only when the requested manifest is unknown). */
  available?: string[]
}

/** Tool dependencies: model port + search (inherited) plus cwd and handlers. */
export interface PatentWorkflowRunDeps extends WorkflowProviderDeps {
  /** Working directory (default process.cwd()). */
  cwd?: string
  /** Stage-handler registry (default: the global registry). */
  handlers?: StageHandlerRegistry
}

const DESCRIPTION = [
  "Automatically execute a declarative patent workflow (atom stages) or a domain graph. Manifest path: patent_disclosure_v1 (PFE extraction → prior-art search → per-feature novelty → review gate → claims draft) plus other built-in manifests. Graph path (graph=novelty|inventiveness|enablement|citation-check): runs a full domain graph (LLM nodes + patent search + deterministic rule gate) in one call; citation-check is a deterministic pure-function graph that verifies every `D<id>`/patent-number citation in the conclusion (inventiveness_conclusion/novelty_report/text) appears in priorArt (pass it as a JSON array). Provide the material as 'input'. The review gate pauses the run; re-invoke with resumeCheckpointId (graph) or approveStageIds (manifest) to continue. When caseId is provided, run results, the Mermaid diagram, and graph checkpoints are persisted under `<caseDir>/workflow-runs/`. Requires a model port.",
].join('\n')
/** Render the graph-mode result into model-facing prose. */
function renderGraphRun(value: PatentWorkflowRunOutput): string {
  const graphState = value.graphState as unknown as GraphState | undefined
  const degradedMarks = (value.graphDegraded ?? []) as unknown as DegradationMark[]
  const completion = value.completed ? 'completed' : 'incomplete'
  const keyLines = Object.entries(graphState ?? {})
    .filter(([key]) => !key.startsWith('_') && !key.endsWith('__degradation'))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => {
      const text = typeof v === 'string' ? v : v === undefined ? '' : JSON.stringify(v)
      const preview = text.length > 0 ? `${text.slice(0, 80)}${text.length > 80 ? '…' : ''}` : '(空)'
      return `- ${key}: ${preview}`
    })
  const degraded = degradedMarks.map(d => `- ${d.severity} [${d.reason}] ${d.message}`)
  const verdict = typeof graphState?.rule_gate_verdict === 'string'
    ? graphState.rule_gate_verdict
    : '（未启用）'
  return [
    `patent_workflow_run(graph=${value.graph}): 图引擎执行 ${value.steps ?? 0} 超步，完成状态: ${completion}`,
    ...keyLines,
    ...(degradedMarks.length > 0 ? ['', '⚠️ 降级标记:', ...degraded] : ['', '✅ 无降级']),
    `规则门 verdict: ${verdict}`,
    value.checkpointNote ?? '检查点: 无',
    value.persistNote ?? '',
    ...(value.interruptNote !== undefined ? [value.interruptNote] : []),
  ].join('\n')
}

/**
 * Render the canonical run value into model-facing prose.
 * @param value - the run result.
 * @returns the multi-line result, or the soft-outcome message.
 */
export function renderWorkflowRun(value: PatentWorkflowRunOutput): string {
  if (!value.ok) return `patent_workflow_run: ${value.error ?? '失败'}`
  if (value.mode === 'graph') return renderGraphRun(value)
  return renderWorkflowResultText({
    toolName: 'patent_workflow_run',
    result: value as unknown as WorkflowRunResult,
    stageLines: renderWorkflowStageLines(value as unknown as WorkflowRunResult),
    persistNote: value.persistNote ?? '',
    checkSection: '',
    ...(value.interruptNote !== undefined ? { interruptNote: value.interruptNote } : {}),
  })
}

/**
 * Build the `patent_workflow_run` tool.
 * @param deps - model port, search, working directory, and handler registry.
 * @returns a registry-ready tool definition.
 */
export function createPatentWorkflowRunTool(deps: PatentWorkflowRunDeps = {}): ToolDefinition {
  const manifests = new Map(builtinPatentManifests.map(({ manifest }) => [manifest.id, manifest]))
  const cwd = deps.cwd ?? process.cwd()

  return defineTool({
    name: 'patent_workflow_run',
    description: DESCRIPTION,
    parameters: {
      manifestId: { type: 'string', description: "Workflow manifest id. Defaults to 'patent_disclosure_v1'." },
      graph: {
        type: 'string',
        enum: ['novelty', 'inventiveness', 'enablement', 'citation-check'],
        description: 'Domain graph to run end-to-end (takes precedence over manifestId).',
      },
      resumeCheckpointId: { type: 'string', description: 'Graph checkpoint id from a previous interrupted run; resumes from it.' },
      approveCheckpointId: { type: 'string', description: 'Graph checkpoint id to grant and resume past (approves the gate).' },
      approveStageIds: {
        type: 'array',
        items: { type: 'string' },
        description: "Manifest stage ids of already-approved approval gates (e.g. ['review_gate']); skipped on rerun.",
      },
      caseId: { type: 'string', description: 'Optional case id enabling run/checkpoint persistence.' },
      input: { type: 'string', required: true, description: 'Initial material consumed by the extract atoms.' },
      chartTargets: { type: 'string', description: 'claim-chart target objects JSON (default empty).' },
      maxResults: { type: 'number', description: 'Max prior-art search results (default 5).' },
      priorArt: { type: 'string', description: 'Existing prior-art evidence entries as a JSON array (graph path; citation-check grounds citations against these).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          mode: { type: 'string', required: true, enum: ['manifest', 'graph'] },
          manifestId: { type: 'string', required: true },
          graph: { type: 'string' },
          steps: { type: 'integer' },
          completed: { type: 'boolean' },
          summary: { type: 'string' },
          stages: { type: 'array' },
          degradedSteps: { type: 'array', items: { type: 'string' } },
          persistNote: { type: 'string' },
          persistWarning: { type: 'string' },
          interruptNote: { type: 'string' },
          graphState: { type: 'json' },
          graphDegraded: { type: 'array' },
          checkpointId: { type: 'string' },
          checkpointNote: { type: 'string' },
          error: { type: 'string' },
          available: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderWorkflowRun(value) }],
    },
    async execute(args, exec) {
      const input = args
      if (input.graph !== undefined) {
        return executeGraphRun(input, deps, cwd, exec.signal)
      }

      const manifestId = input.manifestId ?? 'patent_disclosure_v1'
      const manifest: WorkflowManifest | undefined = manifests.get(manifestId)
      if (!manifest) {
        const available = [...manifests.keys()]
        return {
          ok: false,
          mode: 'manifest' as const,
          manifestId,
          error: `未知 manifest "${manifestId}"（可用: ${available.join(', ')}）`,
          available,
        }
      }
      try {
        validateWorkflowManifest(manifest)
      } catch (err) {
        /* v8 ignore next 6 -- every built-in manifest validates; kept as a fail-safe for future catalog edits. */
        return {
          ok: false,
          mode: 'manifest' as const,
          manifestId,
          error: `manifest 校验失败: ${err instanceof Error ? err.message : String(err)}`,
        }
      }

      const provider = buildWorkflowProvider(deps, { ...(input.caseId !== undefined ? { caseId: input.caseId } : {}) })
      if (!provider) {
        throw new PatentToolError(
          'setup_required',
          'patent_workflow_run: 未提供模型客户端（deps.model 缺失），无法执行原子阶段。请在有模型会话中调用。',
        )
      }

      const workflowCtx = buildRunContext(input)
      const executor = createChainStageExecutor(provider, 'patent_workflow_run')
      const { result, persistTarget } = await runWorkflowWithPersist(manifest, workflowCtx, executor, {
        handlers: deps.handlers ?? globalStageHandlerRegistry,
        atoms: globalAtomRegistry,
        provider,
        signal: exec.signal,
        caseId: input.caseId,
        cwd,
        ...(input.approveStageIds !== undefined && input.approveStageIds.length > 0
          ? { approvalGrants: input.approveStageIds }
          : {}),
      })

      const persistNote = persistTarget
        ? await writeRunArtifacts(persistTarget, manifest, result)
        : '持久化: 未启用（未提供 caseId）'
      const interruptNote = result.interrupted
        ? `⏸ 审批门暂停: "${result.interrupted.stageId}"（${result.interrupted.message}）——等待人工确认，后续阶段未执行`
        : undefined

      return {
        ok: true,
        mode: 'manifest' as const,
        manifestId: manifest.id,
        completed: result.completed,
        summary: result.summary,
        stages: result.stages as unknown as JsonValue[],
        degradedSteps: result.degradedSteps,
        persistNote,
        ...(interruptNote !== undefined ? { interruptNote } : {}),
        /* v8 ignore next -- the built-in run stores surface no persist warning in this build. */
        ...(result.persistWarning !== undefined ? { persistWarning: result.persistWarning } : {}),
      }
    },
  })
}

/** 解析工具输入的 priorArt JSON（校验失败在输入边界报错，不静默降级）。 */
function parsePriorArt(raw: string): unknown[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    /* v8 ignore next -- JSON.parse only rejects with Error values. */
    const detail = err instanceof Error ? err.message : String(err)
    throw new PatentToolError(
      'invalid_tool_input',
      `priorArt 必须是 JSON 数组（现有技术证据条目）: ${detail}`,
      { tool: 'patent_workflow_run' },
    )
  }
  if (!Array.isArray(parsed)) {
    throw new PatentToolError('invalid_tool_input', 'priorArt 必须是 JSON 数组（现有技术证据条目）。', {
      tool: 'patent_workflow_run',
    })
  }
  return parsed
}

/** 装配工作流上下文（manifest 与 graph 两条路径共用同一输入映射）。 */
function buildRunContext(input: PatentWorkflowRunInput): WorkflowContext {
  return buildWorkflowRunContext({
    ...(input.caseId !== undefined ? { caseId: input.caseId } : {}),
    input: input.input,
    ...(input.maxResults !== undefined ? { maxResults: input.maxResults } : {}),
    ...(input.chartTargets !== undefined ? { chartTargets: input.chartTargets } : {}),
    ...(input.priorArt !== undefined ? { priorArt: parsePriorArt(input.priorArt) } : {}),
  })
}

/** Load the checkpoint a resume spec names, routing grant specs through grant approval. */
async function loadResumeCheckpoint(
  store: CheckpointStore,
  spec: { checkpointId: string; grant: boolean },
): Promise<GraphCheckpoint | undefined> {
  return spec.grant
    ? await grantApproval(store, spec.checkpointId)
    : await store.load(spec.checkpointId)
}

/** Graph-mode execution: build the subgraph, assemble the provider, run with checkpoints. */
async function executeGraphRun(
  input: PatentWorkflowRunInput,
  deps: PatentWorkflowRunDeps,
  cwd: string,
  signal?: AbortSignal,
): Promise<PatentWorkflowRunOutput> {
  const graphName = input.graph as DomainGraphName
  const def = DOMAIN_GRAPHS[graphName]
  const provider = buildWorkflowProvider(deps, { ...(input.caseId !== undefined ? { caseId: input.caseId } : {}) })
  if (!provider) {
    throw new PatentToolError(
      'setup_required',
      `patent_workflow_run: 未提供模型客户端（deps.model 缺失），无法执行图 ${graphName}。请在有模型会话中调用。`,
    )
  }

  const workflowCtx = buildRunContext(input)

  const graph = def.build({ handlers: deps.handlers ?? globalStageHandlerRegistry }).compile(def.entry)
  const graphId = `patent_${graphName}`
  let store: CheckpointStore | undefined
  let persistNote = '持久化: 未启用（未提供 caseId）'
  if (input.caseId !== undefined) {
    const persistTarget = resolveRunPersistTarget(input.caseId, graphId, cwd)
    /* v8 ignore next -- resolveRunPersistTarget is only undefined when caseId is, which the branch above excludes. */
    if (persistTarget !== undefined) {
      store = new JsonFileCheckpointStore(join(persistTarget.runsDir, 'checkpoints'))
      persistNote = `持久化: checkpoints 目录 ${join(persistTarget.runsDir, 'checkpoints')}`
    }
  }
  store ??= new InMemoryCheckpointStore()

  let resumeSpec: { checkpointId: string; grant: boolean } | undefined = undefined
  if (input.approveCheckpointId !== undefined) {
    resumeSpec = { checkpointId: input.approveCheckpointId, grant: true }
  } else if (input.resumeCheckpointId !== undefined) {
    resumeSpec = { checkpointId: input.resumeCheckpointId, grant: false }
  }
  let resumeFrom: GraphCheckpoint | undefined
  if (resumeSpec !== undefined) {
    resumeFrom = await loadResumeCheckpoint(store, resumeSpec)
    if (resumeFrom === undefined) {
      return {
        ok: false,
        mode: 'graph',
        manifestId: graphId,
        graph: graphName,
        error: `检查点 "${resumeSpec.checkpointId}" 不存在（可用 checkpoints 目录下的 id）。`,
      }
    }
  }

  const { result, checkpointId } = await runGraphWithCheckpoints(graph, workflowCtx, {
    store,
    graphId,
    provider,
    /* v8 ignore next -- execute always passes an AbortSignal through. */
    ...(signal !== undefined ? { signal } : {}),
    ...(resumeFrom !== undefined ? { resumeFrom } : {}),
  })

  const checkpointNote = checkpointId
    ? `检查点: ${checkpointId}${result.interrupted !== undefined ? '（中断可续跑）' : ''}`
    : /* v8 ignore next -- every graph run starts at least one superstep, so a checkpoint id is always produced. */ '检查点: 无'
  const interruptNote = result.interrupted !== undefined
    ? `⏸ 审批门暂停: "${result.interrupted.node}"（${result.interrupted.message}）——可用 resumeCheckpointId 续跑`
    : undefined

  return {
    ok: true,
    mode: 'graph',
    manifestId: graphId,
    graph: graphName,
    steps: result.steps,
    completed: result.completed,
    summary: '',
    stages: [],
    degradedSteps: [],
    persistNote,
    ...(interruptNote !== undefined ? { interruptNote } : {}),
    graphState: result.state as unknown as JsonValue,
    graphDegraded: result.degraded as unknown as JsonValue[],
    /* v8 ignore next -- every graph run starts at least one superstep, so a checkpoint id is always produced. */
    ...(checkpointId !== undefined ? { checkpointId } : {}),
    checkpointNote,
  }
}
