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
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { JobOutcome, JobRegistry, JobSpec } from '@deepseek-ai/dsh-jobs'
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
  type StageProvider,
  type WorkflowContext,
  type WorkflowManifest,
  type WorkflowRunResult,
} from '@deepseek-ai/dsh-patent-core'
import { builtinPatentManifests } from '@deepseek-ai/dsh-patent-workflow'
import { PatentToolError } from '../error.ts'
import { loggedToolModel } from './internal/model-call-log.ts'
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

declare module '@deepseek-ai/dsh-jobs' {
  interface JobKindMap {
    /** 一次后台执行的 `patent_workflow_run` manifest 运行。 */
    'patent-workflow': 'patent-workflow'
  }
}

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
  /** Claims text, when supplied separately from `input` (element-level atoms read this instead). */
  claims?: string
  /** claim-chart target objects JSON (default empty). */
  chartTargets?: string
  /** Max prior-art search results (default 5). */
  maxResults?: number
  /** Existing prior-art evidence entries as a JSON array (graph path; citation-check grounds against these). */
  priorArt?: string
  /**
   * Register the manifest run as a background job and return its id at once
   * (collect with `job_output`, stop with `job_kill`) instead of holding the
   * turn until every stage finishes. Manifest path only.
   */
  run_in_background?: boolean
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
  /** Whether this call registered a background job instead of running to completion. */
  background?: boolean
  /** The background job id to collect with `job_output` (`background` only). */
  jobId?: string
}

/** Tool dependencies: model port + search (inherited) plus cwd and handlers. */
export interface PatentWorkflowRunDeps extends WorkflowProviderDeps {
  /** Working directory (default process.cwd()). */
  cwd?: string
  /** Stage-handler registry (default: the global registry). */
  handlers?: StageHandlerRegistry
  /**
   * Read the background job registry (`ctx.jobs`) at call time. Lazy because
   * this plugin may load before or after the registry; absent (or undefined
   * when read) means `run_in_background` fails loud instead of silently
   * blocking the turn.
   */
  jobs?: () => WorkflowRunJobRegistry | undefined
}

/**
 * The `ctx.jobs` face this tool uses: registering one job. Narrowed to the
 * consumed method so the tool cannot depend on registry operations it does not
 * call; the real service satisfies it.
 */
export type WorkflowRunJobRegistry = Pick<JobRegistry, 'start'>

const DESCRIPTION = [
  'Automatically execute a declarative patent workflow (atom stages) or a domain graph.',
  'Manifest path: 8 built-in manifests — patent_disclosure_v1 (PFE extraction → prior-art search → per-feature novelty → review gate → claims draft), patent_novelty_v1, patent_inventiveness_v1 (three-step method), patent_patentability_v1, patent_oa_response_v1 (office-action parsing → claim chart → response draft), patent_invalidation_v1 (invalidation grounds → claim chart → novelty + inventiveness), patent_reexamination_v1 (rejection grounds → claim chart → novelty + inventiveness), patent_infringement_v1 (claim chart → all-elements/equivalence check → report).',
  'Graph path (graph=novelty|inventiveness|enablement|citation-check): runs a full domain graph (LLM nodes + patent search + deterministic rule gate) in one call; citation-check is a deterministic pure-function graph that verifies every `D<id>`/patent-number citation in the conclusion (inventiveness_conclusion/novelty_report/text) appears in priorArt (pass it as a JSON array).',
  'Provide the material as the input argument; pass the claims text separately as claims when it should not be mixed into that material.',
  'The review gate pauses the run; re-invoke with resumeCheckpointId (graph) or approveStageIds (manifest) to continue. When caseId is provided, run results, the Mermaid diagram, and graph checkpoints are persisted under `<caseDir>/workflow-runs/`. Requires a model port.',
  'A manifest run holds the turn until it finishes or pauses at an approval gate, so pass run_in_background: true to get a job id at once and keep working (collect with job_output, stop with job_kill); graph runs are foreground-only.',
].join(' ')
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
  if (value.background === true && value.jobId !== undefined) {
    return `patent_workflow_run(${value.manifestId}): 已在后台启动 job ${value.jobId}——用 job_output 收集结果，job_kill 停止。`
  }
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
  const manifests = new Map(builtinPatentManifests.map(manifest => [manifest.id, manifest]))
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
      claims: { type: 'string', description: 'Claims text, when supplied separately from `input` (e.g. the office action as input plus the claims under review); element-level atoms then read the claims instead of the initial material.' },
      chartTargets: { type: 'string', description: 'claim-chart target objects JSON (default empty).' },
      maxResults: { type: 'number', description: 'Max prior-art search results (default 5).' },
      priorArt: { type: 'string', description: 'Existing prior-art evidence entries as a JSON array (graph path; citation-check grounds citations against these).' },
      run_in_background: { type: 'boolean', description: 'Manifest path only: register the run as a background job and return its id immediately (collect with job_output, stop with job_kill) instead of holding the turn until every stage finishes. Defaults to false.' },
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
          background: { type: 'boolean' },
          jobId: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderWorkflowRun(value) }],
    },
    async execute(args, exec) {
      const input = args
      if (input.graph !== undefined) {
        if (input.run_in_background === true) {
          throw new PatentToolError(
            'invalid_tool_input',
            'patent_workflow_run: run_in_background 仅支持 manifest 路径，graph 路径只有前台执行一种方式；需要后台化时改用 manifest 路径。',
            { tool: 'patent_workflow_run' },
          )
        }
        return executeGraphRun(input, deps, cwd, exec)
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

      const provider = buildManifestProvider(deps, exec, manifestId, input.caseId)
      // Input parsing happens here, not inside the run: malformed arguments must
      // fail the call, never register a job that then reports its own failure.
      const runInput: ManifestRunInput = { manifest, deps, provider, ctx: buildRunContext(input), input, cwd }
      if (input.run_in_background !== true) {
        return await runManifest(runInput, exec.signal)
      }
      const jobs = deps.jobs?.()
      if (jobs === undefined) {
        throw new PatentToolError(
          'setup_required',
          'patent_workflow_run: 本会话未启用后台任务，run_in_background 不可用；去掉该参数前台执行。',
          { tool: 'patent_workflow_run' },
        )
      }
      return startBackgroundManifestRun(jobs, exec.agent?.id, runInput)
    },
  })
}

/** 一次 manifest 运行的全部输入；前台调用与后台 job 走同一条执行路径。 */
interface ManifestRunInput {
  /** The manifest to run. */
  manifest: WorkflowManifest
  /** Tool dependencies carrying the handler registry. */
  deps: PatentWorkflowRunDeps
  /** The assembled stage provider (built before a background job registers, so a missing model fails the call, not the job). */
  provider: StageProvider
  /** The workflow context mapped from the parsed arguments. */
  ctx: WorkflowContext
  /** The tool call arguments. */
  input: PatentWorkflowRunInput
  /** Working directory the run paths resolve against. */
  cwd: string
}

/**
 * Assemble the manifest path's StageProvider. Fails loud without a model
 * client: an echo stub would silently "complete" every stage.
 * @param deps - tool dependencies carrying the model port.
 * @param exec - the calling tool context (the model port resolves against its agent).
 * @param manifestId - manifest id for the call-site log entry.
 * @param caseId - optional case identity propagated to the atoms.
 * @returns the provider.
 */
function buildManifestProvider(
  deps: PatentWorkflowRunDeps,
  exec: Pick<ToolRunContext, 'agent'>,
  manifestId: string,
  caseId: string | undefined,
): StageProvider {
  const provider = buildWorkflowProvider(
    bindModel(deps, exec, manifestId),
    { ...(caseId !== undefined ? { caseId } : {}) },
  )
  if (!provider) {
    throw new PatentToolError(
      'setup_required',
      'patent_workflow_run: 未提供模型客户端（deps.model 缺失），无法执行原子阶段。请在有模型会话中调用。',
    )
  }
  return provider
}

/**
 * Execute one manifest run and map its result into the tool's canonical value.
 * Foreground calls pass the tool-call signal; a background job passes its own,
 * because the run outlives the call that started it.
 * @param run - the run inputs (manifest, provider, arguments, cwd).
 * @param signal - cancellation signal for this run.
 * @returns the canonical run output.
 */
async function runManifest(run: ManifestRunInput, signal: AbortSignal): Promise<PatentWorkflowRunOutput> {
  const { manifest, deps, provider, ctx: workflowCtx, input, cwd } = run
  const executor = createChainStageExecutor(provider, 'patent_workflow_run')
  const { result, persistTarget } = await runWorkflowWithPersist(manifest, workflowCtx, executor, {
    handlers: deps.handlers ?? globalStageHandlerRegistry,
    atoms: globalAtomRegistry,
    provider,
    signal,
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
    mode: 'manifest',
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
}

/**
 * Register a manifest run as a background job and return its id at once. The
 * run owns its own AbortController: once the tool call returns, the caller's
 * signal no longer speaks for this run, so `job_kill` and owner teardown are
 * what cancel it. The settled job carries the same rendered text a foreground
 * call returns, handed to the model's first `job_output` read.
 * @param jobs - the job registry face.
 * @param owner - the calling agent's session, when the call has one.
 * @param run - the run inputs.
 * @returns the canonical output carrying the job id.
 */
function startBackgroundManifestRun(
  jobs: WorkflowRunJobRegistry,
  owner: JobSpec['owner'],
  run: ManifestRunInput,
): PatentWorkflowRunOutput {
  const jobId = jobs.start({
    kind: 'patent-workflow',
    label: `${run.manifest.id}${run.input.caseId !== undefined ? ` (${run.input.caseId})` : ''}`,
    ...(owner !== undefined ? { owner } : {}),
    run: () => {
      const controller = new AbortController()
      const done = (async (): Promise<JobOutcome> => {
        try {
          const value = await runManifest(run, controller.signal)
          return {
            status: 'completed',
            // The run either finished its stages or paused at an approval gate;
            // degraded stages are reported in the rendered result, not here.
            detail: value.interruptNote !== undefined ? 'interrupted' : 'completed',
            result: renderWorkflowRun(value),
          }
        } catch (error: unknown) {
          return {
            status: controller.signal.aborted ? 'killed' : 'failed',
            detail: error instanceof Error ? error.message : String(error),
          }
        }
      })()
      return {
        cancel: (reason?: string) => { controller.abort(reason ?? 'patent_workflow_run background job killed') },
        done,
      }
    },
  })
  return { ok: true, mode: 'manifest', manifestId: run.manifest.id, background: true, jobId }
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

/** The provider deps with the model port bound to the calling agent's session. */
function bindModel(
  deps: PatentWorkflowRunDeps,
  exec: Pick<ToolRunContext, 'agent'>,
  manifestId: string,
): PatentWorkflowRunDeps {
  const model = loggedToolModel(exec, deps.model, { callSite: 'patent_workflow_run', manifestId })
  return model === undefined ? deps : { ...deps, model }
}

/** 装配工作流上下文（manifest 与 graph 两条路径共用同一输入映射）。 */
function buildRunContext(input: PatentWorkflowRunInput): WorkflowContext {
  return buildWorkflowRunContext({
    ...(input.caseId !== undefined ? { caseId: input.caseId } : {}),
    input: input.input,
    ...(input.claims !== undefined ? { claims: input.claims } : {}),
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
  exec: Pick<ToolRunContext, 'agent' | 'signal'>,
): Promise<PatentWorkflowRunOutput> {
  const graphName = input.graph as DomainGraphName
  const def = DOMAIN_GRAPHS[graphName]
  const graphId = `patent_${graphName}`
  const provider = buildWorkflowProvider(
    bindModel(deps, exec, graphId),
    { ...(input.caseId !== undefined ? { caseId: input.caseId } : {}) },
  )
  if (!provider) {
    throw new PatentToolError(
      'setup_required',
      `patent_workflow_run: 未提供模型客户端（deps.model 缺失），无法执行图 ${graphName}。请在有模型会话中调用。`,
    )
  }

  const workflowCtx = buildRunContext(input)

  const graph = def.build({ handlers: deps.handlers ?? globalStageHandlerRegistry }).compile(def.entry)
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
    signal: exec.signal,
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
