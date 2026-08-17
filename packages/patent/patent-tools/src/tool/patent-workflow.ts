/**
 * `patent_workflow` tool: run a declarative patent workflow in recap (收口)
 * mode. The host agent produces each stage's text; this tool validates the
 * manifest, assembles a WorkflowRunResult with degraded-step marking and a
 * summary, and persists the result record. No LLM call — the empty handler
 * registry disables atom execution.
 *
 * Deterministic rule-gate deviation: Sati's dual-track checker (RuleEngine +
 * defaultPatentRules) is not ported here (it lives in
 * `@deepseek-ai/dsh-patent-rule`), so the rule-gate section is dropped and
 * `checkSection` renders empty. See the port report.
 * @module @deepseek-ai/dsh-patent-tools/tool/patent-workflow
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue, ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  StageHandlerRegistry,
  validateWorkflowManifest,
  type WorkflowInterrupt,
  type WorkflowManifest,
  type WorkflowRunResult,
  type WorkflowStageResult,
} from '@deepseek-ai/dsh-patent-core'
import { JsonFileWorkflowRunStore, builtinPatentManifests, runWorkflow } from '@deepseek-ai/dsh-patent-workflow'
import {
  renderWorkflowResultText,
  resolveRunPersistTarget,
  writeRunArtifacts,
} from './internal/workflow-helpers.ts'

/** One stage's output as supplied by the host agent. */
export type PatentWorkflowStageOutput = {
  /** Stage id matching manifest.stages[].id. */
  stageId: string
  /** The stage's analysis text produced by the host agent. */
  text: string
}

/** Tool input: which manifest to finalize plus the per-stage outputs. */
export type PatentWorkflowInput = {
  /** Workflow manifest id (default: the first built-in, patent_novelty_v1). */
  manifestId?: string
  /** Per-stage outputs keyed by stage id; missing stages are marked degraded. */
  outputs?: PatentWorkflowStageOutput[]
  /** Case identity for the result record (enables persistence). */
  caseId?: string
}

/** Tool canonical result: the assembled run record plus its persistence note. */
export type PatentWorkflowOutput = {
  /** The manifest id the run was assembled against. */
  manifestId: string
  /** Whether the requested manifest exists in the built-in catalog. */
  found: boolean
  /** Whether the manifest passed validation. */
  valid: boolean
  /** Whether the run completed without degraded steps. */
  completed: boolean
  /** The manifest case type. */
  caseType: string
  /** Per-stage results. */
  stages: WorkflowStageResult[]
  /** Stage ids that produced no (or degraded) output. */
  degradedSteps: string[]
  /** The assembled run summary. */
  summary: string
  /** Persistence note (or the "not enabled" marker without a caseId). */
  persistNote: string
  /** Approval-gate interrupt, when present (never for the recap path). */
  interrupted?: WorkflowInterrupt
  /** Persistence failure warning, when present. */
  persistWarning?: string
  /** Built-in manifest ids (only when the requested manifest is unknown). */
  available?: string[]
  /** Manifest validation message (only when validation failed). */
  error?: string
}

/** Tool dependencies: the working directory persistence resolves against. */
export interface PatentWorkflowToolDeps {
  /** Working directory (default process.cwd()). */
  cwd?: string
}

const DESCRIPTION = [
  'Run a declarative patent workflow (recap mode): validate the manifest, assemble per-stage outputs into a structured result with degraded-step marking and a summary, then persist the record. Built-in manifests: patent_novelty_v1, patent_disclosure_v1, patent_inventiveness_v1, patent_patentability_v1, patent_oa_response_v1, patent_invalidation_v1, patent_infringement_v1. Supply outputs keyed by stage id; missing stages are marked degraded. No LLM call — this tool finalizes text the agent already produced. Use to finalize multi-stage patent analyses (novelty / disclosure / inventiveness / ...) with a single verifiable result record.',
].join('\n')
/**
 * Format a run's stage results into recap-mode lines (flag + stage id +
 * strategy + output preview).
 * @param value - the assembled output.
 * @returns one line per stage.
 */
function recapStageLines(value: PatentWorkflowOutput): string[] {
  return value.stages.map((s) => {
    const flag = s.degraded ? '⚠️ 降级' : '✅'
    const preview = s.output.length > 0 ? `${s.output.slice(0, 80)}${s.output.length > 80 ? '…' : ''}` : '(无输出)'
    return `- ${flag} ${s.stageId} (${s.strategy}): ${preview}`
  })
}

/**
 * Render the canonical recap value into model-facing prose.
 * @param value - the assembled run record.
 * @returns the multi-line result, or the unknown/validation message.
 */
export function renderPatentWorkflow(value: PatentWorkflowOutput): string {
  if (!value.found) {
    return `patent_workflow: 未知 manifest "${value.manifestId}"（可用: ${(value.available ?? []).join(', ')}）`
  }
  if (!value.valid) {
    return `patent_workflow: manifest 校验失败: ${value.error ?? ''}`
  }
  return renderWorkflowResultText({
    toolName: 'patent_workflow',
    result: value as unknown as WorkflowRunResult,
    stageLines: recapStageLines(value),
    persistNote: value.persistNote,
    checkSection: '',
  })
}

/**
 * Build the `patent_workflow` recap tool.
 * @param deps - optional working-directory injection for persistence.
 * @returns a registry-ready tool definition.
 */
export function createPatentWorkflowTool(deps: PatentWorkflowToolDeps = {}): ToolDefinition {
  const manifests = new Map(builtinPatentManifests.map(({ manifest }) => [manifest.id, manifest]))
  const cwd = deps.cwd ?? process.cwd()

  return defineTool({
    name: 'patent_workflow',
    description: DESCRIPTION,
    parameters: {
      manifestId: { type: 'string', description: "Workflow manifest id. Defaults to 'patent_novelty_v1'." },
      caseId: {
        type: 'string',
        description: 'Optional case id for result records; when provided the run persists under <caseDir>/workflow-runs/.',
      },
      outputs: {
        type: 'array',
        description: 'Per-stage outputs keyed by stage id. Missing stages are marked degraded.',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            stageId: { type: 'string', required: true },
            text: { type: 'string', required: true },
          },
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          manifestId: { type: 'string', required: true },
          found: { type: 'boolean', required: true },
          valid: { type: 'boolean', required: true },
          completed: { type: 'boolean', required: true },
          caseType: { type: 'string', required: true },
          stages: { type: 'array', required: true },
          degradedSteps: { type: 'array', items: { type: 'string' }, required: true },
          summary: { type: 'string', required: true },
          persistNote: { type: 'string', required: true },
          interrupted: { type: 'json' },
          persistWarning: { type: 'string' },
          available: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderPatentWorkflow(value as unknown as PatentWorkflowOutput) }],
    },
    async execute(args) {
      const manifestId = args.manifestId ?? builtinPatentManifests[0]?.manifest.id ?? 'patent_novelty_v1'
      const manifest: WorkflowManifest | undefined = manifests.get(manifestId)
      if (!manifest) {
        const available = [...manifests.keys()]
        return {
          manifestId,
          found: false,
          valid: false,
          completed: false,
          caseType: '',
          stages: [],
          degradedSteps: [],
          summary: '',
          persistNote: '',
          available,
        }
      }
      try {
        validateWorkflowManifest(manifest)
      } catch (err) {
        return {
          manifestId,
          found: true,
          valid: false,
          completed: false,
          caseType: manifest.caseType,
          stages: [],
          degradedSteps: [],
          summary: '',
          persistNote: '',
          error: err instanceof Error ? err.message : String(err),
        }
      }

      const byId = new Map((args.outputs ?? []).map(o => [o.stageId, o.text]))
      const persistTarget = resolveRunPersistTarget(args.caseId, manifest.id, cwd)
      const result = await runWorkflow(
        manifest,
        { ...(args.caseId !== undefined ? { caseId: args.caseId } : {}) },
        async stage => byId.get(stage.id) ?? '',
        {
          handlers: new StageHandlerRegistry(),
          ...(persistTarget !== undefined ? { persist: new JsonFileWorkflowRunStore(persistTarget.runsDir) } : {}),
          ...(persistTarget?.runId !== undefined ? { runId: persistTarget.runId } : {}),
        },
      )

      const persistNote = persistTarget
        ? await writeRunArtifacts(persistTarget, manifest, result)
        : '持久化: 未启用（未提供 caseId）'

      return {
        manifestId,
        found: true,
        valid: true,
        completed: result.completed,
        caseType: result.caseType,
        stages: result.stages as unknown as JsonValue[],
        degradedSteps: result.degradedSteps,
        summary: result.summary,
        persistNote,
        ...(result.interrupted !== undefined ? { interrupted: result.interrupted as unknown as JsonValue } : {}),
        ...(result.persistWarning !== undefined ? { persistWarning: result.persistWarning } : {}),
      }
    },
  })
}
