/**
 * Shared workflow assembly for the ported patent workflow tools: case
 * persistence-path resolution, atomic artifact writes, workflow-result text
 * assembly, the workflow-run context mapping, and StageProvider assembly from an
 * injected model port + search function. Shared by `patent_workflow`,
 * `patent_workflow_run` and `flexible_plan` so the three do not drift.
 *
 * Rule-gate note: Sati's `runRuleGate` helper (RuleEngine + defaultPatentRules)
 * is deliberately NOT ported. The dsh rule engine lives in
 * `@deepseek-ai/dsh-patent-rule` (out of scope here), so the workflow tools
 * render an empty `checkSection` instead. See the port report.
 * @module @deepseek-ai/dsh-patent-tools/tool/internal/workflow-helpers
 */

import { rename, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join } from 'node:path'
import {
  caseWorkflowRunsDir,
  collectPortText,
  type AtomRegistry,
  type PatentModelPort,
  type StageExecutor,
  type StageHandlerRegistry,
  type StageProvider,
  type WorkflowContext,
  type WorkflowManifest,
  type WorkflowRunResult,
  type WorkflowStageResult,
} from '@deepseek-ai/dsh-patent-core'
import { JsonFileWorkflowRunStore, runWorkflow, workflowManifestToMermaid } from '@deepseek-ai/dsh-patent-workflow'
import { createNuoSearchProvider } from '@deepseek-ai/dsh-patent-data'
import { PatentToolError } from '../../error.ts'

/**
 * Resolve the workflow-runs directory for a case id, mirroring Sati's
 * `caseWorkflowRunsDir` convention: an absolute path maps to
 * `<caseId>/workflow-runs`; a relative path containing a separator maps to
 * `<cwd>/<caseId>/workflow-runs`; a plain id maps to
 * `<cwd>/data/cases/<caseId>/workflow-runs`.
 * @param caseId - the case identity (path form or plain id).
 * @param cwd - the working directory the relative paths resolve against.
 * @returns the absolute workflow-runs directory.
 */
export function resolveWorkflowRunsDir(caseId: string, cwd: string): string {
  if (isAbsolute(caseId)) return join(caseId, 'workflow-runs')
  if (caseId.includes('/') || caseId.includes('\\')) return join(cwd, caseId, 'workflow-runs')
  return join(cwd, caseWorkflowRunsDir(caseId))
}

function caseKeyOf(caseId: string): string {
  if (isAbsolute(caseId) || caseId.includes('/') || caseId.includes('\\')) {
    return basename(caseId)
  }
  return caseId
}

/**
 * Write a file atomically: write a sibling temp file then rename over the
 * target, so a concurrent or interrupted write never leaves a half-written file.
 * @param file - the destination path.
 * @param content - the complete UTF-8 content.
 */
export async function atomicWriteFile(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, file)
}

/** Resolved persistence destination for one workflow run. */
export interface WorkflowRunPersistTarget {
  /** Directory the run JSON and Mermaid diagram land in. */
  runsDir: string
  /** Filesystem-safe run key (<caseKey>__<manifestId>). */
  runId: string
}

/**
 * Resolve the persistence target for one run; no case id means no persistence.
 * @param caseId - optional case identity keying the run.
 * @param manifestId - the manifest id used in the run key.
 * @param cwd - the working directory.
 * @returns the target, or undefined when caseId is absent.
 */
export function resolveRunPersistTarget(
  caseId: string | undefined,
  manifestId: string,
  cwd: string,
): WorkflowRunPersistTarget | undefined {
  if (caseId === undefined) return undefined
  return {
    runsDir: resolveWorkflowRunsDir(caseId, cwd),
    runId: `${caseKeyOf(caseId)}__${manifestId}`,
  }
}

/**
 * Write the Mermaid plan diagram after a run and return the persistence note.
 * The run JSON is saved inside runWorkflow via the persist option; this only
 * supplements the .mmd and surfaces any persist warning from the result.
 * @param target - the resolved persistence destination.
 * @param manifest - the manifest whose diagram is rendered.
 * @param result - the run result carrying any persist warning.
 * @returns the model-facing persistence note (never throws).
 */
export async function writeRunArtifacts(
  target: WorkflowRunPersistTarget,
  manifest: WorkflowManifest,
  result: WorkflowRunResult,
): Promise<string> {
  try {
    await atomicWriteFile(join(target.runsDir, `${target.runId}.mmd`), workflowManifestToMermaid(manifest))
    const note = `持久化: ${join(target.runsDir, `${target.runId}.json`)} + ${join(target.runsDir, `${target.runId}.mmd`)}`
    return result.persistWarning ? `${note}\n${result.persistWarning}` : note
  } catch (err) {
    return `持久化失败: ${err instanceof Error ? err.message : String(err)}`
  }
}

/** Options for executing a manifest via runWorkflow with optional persistence. */
export interface RunWorkflowWithPersistOptions {
  /** Stage-handler registry (default: the global registry). */
  handlers: StageHandlerRegistry
  /** Atom registry resolving atom.outputSchema[0] (default: the global registry). */
  atoms: AtomRegistry
  /** The assembled StageProvider. */
  provider: StageProvider
  /** Cancellation signal propagated to stage boundaries. */
  signal?: AbortSignal
  /** Case identity keying the run persistence; undefined disables persistence. */
  caseId: string | undefined
  /** Working directory the relative run paths resolve against. */
  cwd: string
  /** Already-approved approval-gate stage ids (skipped on rerun). */
  approvalGrants?: string[]
}

/** Result of a persisted workflow run (the persist target feeds the artifact writes). */
export type PersistedWorkflowRun = {
  result: WorkflowRunResult
  /** Resolved persistence target; undefined when caseId is absent. */
  persistTarget: WorkflowRunPersistTarget | undefined
}

/**
 * Execute a manifest with the shared option wiring (handlers/atoms/provider/
 * signal + optional JsonFileWorkflowRunStore persistence). Shared by
 * patent_workflow_run and flexible_plan(run) so the two do not drift.
 * @param manifest - the manifest to run.
 * @param ctx - the workflow context.
 * @param executor - the chain-stage executor for atom-less stages.
 * @param opts - the run options.
 * @returns the run result plus the resolved persistence target.
 */
export async function runWorkflowWithPersist(
  manifest: WorkflowManifest,
  ctx: WorkflowContext,
  executor: StageExecutor,
  opts: RunWorkflowWithPersistOptions,
): Promise<PersistedWorkflowRun> {
  const persistTarget = resolveRunPersistTarget(opts.caseId, manifest.id, opts.cwd)
  const result = await runWorkflow(manifest, ctx, executor, {
    handlers: opts.handlers,
    atoms: opts.atoms,
    provider: opts.provider,
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    ...(persistTarget !== undefined
      ? { persist: new JsonFileWorkflowRunStore(persistTarget.runsDir), runId: persistTarget.runId }
      : {}),
    ...(opts.approvalGrants !== undefined && opts.approvalGrants.length > 0
      ? { approvalGrants: opts.approvalGrants }
      : {}),
  })
  return { result, persistTarget }
}

/** Options for assembling the tail text of a workflow-run result. */
export interface RenderWorkflowResultTextOptions {
  /** Tool label prefixing the summary line. */
  toolName: string
  /** The run result whose summary/completion drive the text. */
  result: WorkflowRunResult
  /** Per-stage lines already formatted by the caller. */
  stageLines: string[]
  /** Persistence note line. */
  persistNote: string
  /** Deterministic rule-gate section (kept empty in this port). */
  checkSection: string
  /** Optional approval-gate interrupt note. */
  interruptNote?: string
}

/**
 * Assemble the shared workflow-run tail text: summary, stage lines, interrupt
 * note, completion, persistence note, and (empty) rule-gate section.
 * @param opts - the assembly options.
 * @returns the multi-line model-facing text.
 */
export function renderWorkflowResultText(opts: RenderWorkflowResultTextOptions): string {
  const completion = opts.result.completed ? 'completed' : 'incomplete'
  return [
    `${opts.toolName}(${opts.result.manifestId}): ${opts.result.summary}`,
    ...opts.stageLines,
    ...(opts.interruptNote !== undefined ? [opts.interruptNote] : []),
    `完成状态: ${completion}`,
    opts.persistNote,
    ...(opts.checkSection !== '' ? [opts.checkSection] : []),
  ].join('\n')
}

/** Options mapping a tool's input into the workflow context the atoms read. */
export interface BuildWorkflowRunContextOptions {
  /** Case identity (may contain a {caseId} placeholder). */
  caseId?: string
  /** Initial material consumed by the extract atoms. */
  input: string
  /** Max prior-art search results (default 5). */
  maxResults?: number
  /** claim-chart target objects JSON (default empty). */
  chartTargets?: string
}

/**
 * Map a tool's input into the workflow context: the atom input keys
 * (text/source_text/extraction_input/claim) all point at the same material.
 * Shared by patent_workflow_run (manifest + graph) and flexible_plan (run).
 * @param opts - the mapping options.
 * @returns the workflow context.
 */
export function buildWorkflowRunContext(opts: BuildWorkflowRunContextOptions): WorkflowContext {
  return {
    ...(opts.caseId !== undefined ? { caseId: opts.caseId } : {}),
    input: opts.input,
    text: opts.input,
    source_text: opts.input,
    extraction_input: opts.input,
    claim: opts.input,
    chart_targets: opts.chartTargets ?? '',
    max_results: String(opts.maxResults ?? 5),
  }
}

/** Model + search dependencies the workflow provider is assembled from. */
export interface WorkflowProviderDeps {
  /** Streaming patent-domain model port the atoms bridge into string calls. */
  model?: PatentModelPort
  /** Prior-art search function (default: the nuo-patent provider). */
  search?: StageProvider['search']
}

/** Context the workflow provider reads (case identity, propagated to atoms). */
export interface WorkflowProviderContext {
  /** Case identity propagated to atoms that persist or merge by case. */
  caseId?: string
}

/**
 * Assemble a StageProvider from the injected model port + search function. The
 * atoms bridge `provider.llm` into their string LLM calls; search defaults to
 * the nuo-patent provider when not injected. Returns undefined when no model is
 * available so callers can report a clear setup error instead of degrading.
 * @param deps - model + search dependencies.
 * @param context - optional case identity.
 * @returns the provider, or undefined without a model.
 */
export function buildWorkflowProvider(
  deps: WorkflowProviderDeps,
  context: WorkflowProviderContext = {},
): StageProvider | undefined {
  const model = deps.model
  if (!model) return undefined
  // callLLM bridges the port into the string seam the graph LLM nodes use;
  // llm feeds the atoms' builtin/llm bridge (which also prefers callLLM).
  const search: StageProvider['search'] = deps.search ?? createNuoSearchProvider().search
  return {
    callLLM: async (prompt, opts, signal) =>
      collectPortText(model, prompt, signal, {
        ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts?.jsonSchema !== undefined ? { schema: opts.jsonSchema } : {}),
      }),
    llm: model,
    ...(search === undefined ? {} : { search }),
    caseId: context.caseId ?? '',
  }
}

/**
 * Build a chain-stage executor for atom-less (收口) stages: calls the provider
 * LLM with the stage description as the instruction and the workflow input as
 * the material. Without a usable call seam it fails loud — an echo stub would
 * silently "complete" every stage with the input text.
 * @param provider - the assembled StageProvider (must exist — callers check first).
 * @param toolLabel - tool name for the setup_required diagnostic.
 * @returns a StageExecutor for atom-less stages.
 */
export function createChainStageExecutor(
  provider: StageProvider,
  toolLabel: string,
): StageExecutor {
  const call = provider.callLLM
  return async (stage, ctx) => {
    if (!call) {
      throw new PatentToolError('setup_required', `${toolLabel}: 模型端口不可用，无法执行收口阶段。`, {})
    }
    const prompt = [
      '你是资深专利代理师。请完成当前工作流阶段，输出阶段成果文本：',
      stage.description,
      '```',
      (ctx.input ?? '').slice(0, 12000),
      '```',
    ].join('\n')
    return await call(prompt, { temperature: 0.3 })
  }
}

/**
 * Compute a stage's recap flag and output preview. Shared by the recap and run
 * tools so the two renderers cannot drift.
 * @param stage - the stage result.
 * @returns the degraded flag and the truncated output preview.
 */
export function stageFlagAndPreview(stage: WorkflowStageResult): { flag: string; preview: string } {
  const flag = stage.degraded ? '⚠️ 降级' : '✅'
  const preview = stage.output.length > 0 ? `${stage.output.slice(0, 80)}${stage.output.length > 80 ? '…' : ''}` : '(无输出)'
  return { flag, preview }
}

/**
 * Format a run's stage results into the shared per-stage lines (flag + stage id
 * + atom note + output preview). Shared by patent_workflow_run and
 * flexible_plan(run).
 * @param result - the run result.
 * @returns one line per executed stage.
 */
export function renderWorkflowStageLines(result: WorkflowRunResult): string[] {
  return result.stages.map((s) => {
    const { flag, preview } = stageFlagAndPreview(s)
    return `- ${flag} ${s.stageId}${s.atom !== undefined ? ` [atom:${s.atom}]` : ''}: ${preview}`
  })
}
