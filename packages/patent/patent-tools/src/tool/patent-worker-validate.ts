/**
 * `patent_worker_validate` tool: validate a patent worker's output against its
 * declared contract (required fields). Missing hard-contract fields mark the
 * output degraded without interrupting; unknown worker names return a
 * `found: false` canonical value (soft outcome).
 * @module @deepseek-ai/dsh-patent-tools/tool/patent-worker-validate
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  WorkerRegistry,
  defaultPatentWorkers,
  validateWorkerOutput,
  type WorkerContract,
} from '@deepseek-ai/dsh-patent-workflow'

/** Tool input: the worker to check plus the output text to validate. */
export type PatentWorkerValidateInput = {
  /** Worker name from the built-in catalog. */
  workerName: string
  /** Output text to validate against the worker's declared contract. */
  outputText: string
}

/** Tool canonical result: a pass/degraded verdict plus the missing-field lists. */
export type PatentWorkerValidateOutput = {
  /** The requested worker name (echoed). */
  workerName: string
  /** Whether the worker exists in the built-in catalog. */
  found: boolean
  /** Whether all hard-contract required fields are present. */
  valid: boolean
  /** Hard-contract fields absent from the output. */
  missingHardFields: string[]
  /** Soft-contract fields absent from the output. */
  missingSoftFields: string[]
  /** Degradation reason (only when degraded). */
  degradationReason?: string
  /** Built-in worker names (only when the requested worker is unknown). */
  availableWorkers?: string[]
}

const DESCRIPTION = [
  'Validate a patent worker output against its declared contract (required fields). Missing hard-contract fields mark the output degraded (never interrupts); soft-contract gaps are reported separately. Returns the pass/degraded verdict plus the missing hard/soft field lists. Use for contract-level quality review of patent products (technical analysis, search report, novelty/inventiveness analysis, OA response, quality report).',
].join('\n')
/**
 * Render the canonical validation value into model-facing prose.
 * @param value - the validation result.
 * @returns the multi-line verdict and missing-field summary.
 */
export function renderWorkerValidate(value: PatentWorkerValidateOutput): string {
  if (!value.found) {
    const available = (value.availableWorkers ?? []).join(', ')
    return `patent_worker_validate: 未知 worker "${value.workerName}"（可用: ${available}）`
  }
  const verdict = value.valid ? '通过 ✅' : `降级 ⚠️（${value.degradationReason ?? '硬性字段缺失'}）`
  const hard = value.missingHardFields.length > 0
    ? `缺失硬性字段: ${value.missingHardFields.join('、')}`
    : '硬性字段齐全'
  const soft = value.missingSoftFields.length > 0 ? `缺失软性字段: ${value.missingSoftFields.join('、')}` : ''
  return `patent_worker_validate(${value.workerName}): ${verdict}\n${hard}${soft ? `\n${soft}` : ''}`
}

/** A worker catalog pre-populated with the built-in patent workers. */
function buildRegistry(): WorkerRegistry {
  const registry = new WorkerRegistry()
  for (const worker of defaultPatentWorkers()) {
    registry.register(worker)
  }
  return registry
}

/**
 * Build the `patent_worker_validate` tool over the built-in worker catalog.
 * @returns a registry-ready tool definition (no external dependencies).
 */
export function createPatentWorkerValidateTool(): ToolDefinition {
  const registry = buildRegistry()

  return defineTool({
    name: 'patent_worker_validate',
    description: DESCRIPTION,
    parameters: {
      workerName: {
        type: 'string',
        required: true,
        description: 'Worker name from the built-in catalog (e.g. patent-technical-analyzer, patent-novelty-analyzer, quality_checker).',
      },
      outputText: {
        type: 'string',
        required: true,
        description: 'Output text to validate against the worker contract.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          workerName: { type: 'string', required: true },
          found: { type: 'boolean', required: true },
          valid: { type: 'boolean', required: true },
          missingHardFields: { type: 'array', items: { type: 'string' }, required: true },
          missingSoftFields: { type: 'array', items: { type: 'string' }, required: true },
          degradationReason: { type: 'string' },
          availableWorkers: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderWorkerValidate(value) }],
    },
    // oxlint-disable-next-line typescript/require-await -- tool contract requires async execute
    async execute(args) {
      const worker: WorkerContract | undefined = registry.get(args.workerName)
      if (!worker) {
        const names = registry.list().map(w => w.name)
        return {
          workerName: args.workerName,
          found: false,
          valid: false,
          missingHardFields: [],
          missingSoftFields: [],
          availableWorkers: names,
        }
      }
      const validation = validateWorkerOutput(worker, args.outputText)
      return {
        workerName: args.workerName,
        found: true,
        valid: validation.valid,
        missingHardFields: validation.missingHardFields,
        missingSoftFields: validation.missingSoftFields,
        ...(validation.degradationReason !== undefined ? { degradationReason: validation.degradationReason } : {}),
      }
    },
  })
}
