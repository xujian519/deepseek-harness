/**
 * `law_verify` tool: decide law citations against the shipped index.
 *
 * The tool reports what it can and cannot support. An article that is indexed but
 * not yet transcribed is reported as unverified rather than accepted, so a
 * partially transcribed index never reads as a clean bill of health.
 * @module @deepseek-ai/dsh-patent-law/tool/law-verify
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { parseLawReference } from '../reference.ts'
import { renderCitationRows, resolveCitationPolicy, verifyCitation, verifyCitations } from '../verify.ts'
import type {
  CitationDecision,
  CitationFinding,
  CitationPolicy,
  CitationPolicySet,
  LawBaseline,
  LawName,
} from '../types.ts'

/** Thrown when the tool input cannot be turned into references to check. */
export class LawVerifyToolError extends Error {
  /** Stable error code for the model and logs. */
  readonly code: string

  /**
   * @param code - stable error code.
   * @param message - what is wrong with the input.
   */
  constructor(code: string, message: string) {
    super(message)
    this.name = 'LawVerifyToolError'
    this.code = code
  }
}

/** Input for the law_verify tool. */
export type LawVerifyInput = {
  /** Free text whose citations are extracted and checked. */
  text?: string
  /** References to check as written, each of which must parse as exactly one reference. */
  references?: string[]
  /** The proposition the citations are offered in support of, when there is one. */
  proposition?: string
}

/** One checked citation as the tool reports it. */
export type LawVerifyFinding = {
  /** The reference as written. */
  raw: string
  /** The law it belongs to, when the reference could be read. */
  law?: string
  /** Article number, for a statute reference. */
  article?: number
  /** Paragraph number, when the reference names one. */
  paragraph?: number
  /** Normalized guideline section path, for a guideline reference. */
  sectionPath?: string
  decision: CitationDecision
  /** How this deployment treats the decision. */
  policy: CitationPolicy
  reason: string
}

/** Output of the law_verify tool. */
export type LawVerifyOutput = {
  findings: LawVerifyFinding[]
  /** True when at least one finding is treated as a block. */
  blocked: boolean
  counts: Record<CitationDecision, number>
}

/** Injected collaborators: the loaded index and the deployment's policy. */
export type LawVerifyToolOptions = {
  baselines: Map<LawName, LawBaseline>
  policies: CitationPolicySet
}

const DESCRIPTION = [
  '- Checks law citations against the law index shipped with this deployment: 《专利法》《专利法实施细则》 by article (and paragraph), 《专利审查指南》 by normalized section path.',
  '- Each citation is decided as 已核验 / 与所引命题不符 / 条号超出有效范围 / 索引中不存在 / 条文未转录（未核验）. A decision is never reported as checked when it was not: an indexed article whose text has not been transcribed comes back as 未核验, and an article beyond an article ceiling that has itself not been verified also comes back as 未核验.',
  '- Pass the text whose citations you want checked (citations are extracted from it), or pass exact references. A reference that is not exactly one reference is a tool error, so a typo surfaces instead of being skipped.',
  '- Pass proposition when a citation is offered in support of a specific claim, so a cited article whose topics do not support that claim is reported as 与所引命题不符.',
  '- This checks citation form and index membership, not legal correctness of the actual text: the index carries transcribed text only after a person records the transcription source. An article that is 未核验 still has to be verified against an official source (patent_case_search / cnlaw / web_fetch on the official page) before it is relied on.',
  '',
  'Usage notes:',
  '  - Read-only, offline, and makes no network request.',
  '  - A result with no findings means no citation was recognized, not that the text is correct.',
].join('\n')

/**
 * Create the `law_verify` tool over a loaded index.
 * @param options - the loaded index and the citation policy.
 * @returns the tool definition.
 */
export function createLawVerifyTool(options: LawVerifyToolOptions): ToolDefinition {
  const { baselines, policies } = options
  return defineTool({
    name: 'law_verify',
    description: DESCRIPTION,
    parameters: {
      text: { type: 'string', description: 'Text whose citations are extracted and checked' },
      references: {
        type: 'array',
        items: { type: 'string' },
        description: 'References to check as written, e.g. 专利法第22条第3款 / 审查指南第二部分第四章3.2.1.1',
      },
      proposition: { type: 'string', description: 'What the citations are offered in support of' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          findings: { type: 'array', required: true, items: FINDING_SCHEMA },
          blocked: { type: 'boolean', required: true },
          counts: {
            type: 'object',
            required: true,
            additionalProperties: false,
            properties: {
              'valid': { type: 'number', required: true },
              'mismatch': { type: 'number', required: true },
              'out-of-range': { type: 'number', required: true },
              'not-indexed': { type: 'number', required: true },
              'unverified': { type: 'number', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderToolReport(value.findings, value.blocked),
      }],
    },
    execute(args) {
      return Promise.resolve(runVerify(args, baselines, policies))
    },
  })
}

const FINDING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    raw: { type: 'string', required: true },
    law: { type: 'string' },
    article: { type: 'number' },
    paragraph: { type: 'number' },
    sectionPath: { type: 'string' },
    decision: {
      type: 'string',
      required: true,
      enum: ['valid', 'mismatch', 'out-of-range', 'not-indexed', 'unverified'],
    },
    policy: { type: 'string', required: true, enum: ['block', 'warn', 'allow'] },
    reason: { type: 'string', required: true },
  },
} as const

/** Run the verification and project it into the tool's output value. */
function runVerify(
  args: LawVerifyInput,
  baselines: Map<LawName, LawBaseline>,
  policies: CitationPolicySet,
): LawVerifyOutput {
  const findings = collectFindings(args, baselines)
  const projected = findings.map(finding => toFinding(finding, policies))
  return {
    findings: projected,
    blocked: projected.some(finding => finding.policy === 'block'),
    counts: countDecisions(projected),
  }
}

/** Collect the findings for the requested text and references. */
function collectFindings(args: LawVerifyInput, baselines: Map<LawName, LawBaseline>): CitationFinding[] {
  const options = args.proposition === undefined ? {} : { proposition: args.proposition }
  const findings = args.text === undefined ? [] : verifyCitations(args.text, baselines, options)
  for (const raw of args.references ?? []) {
    const reference = parseLawReference(raw)
    if (reference === null) {
      throw new LawVerifyToolError('unparsable_reference', `无法把「${raw}」解析为单条法条引用：请给出条号（如 专利法第22条第3款）或指南节（如 审查指南第二部分第四章3.2.1.1）`)
    }
    findings.push(verifyCitation(reference, baselines, options))
  }
  if (findings.length === 0 && args.text === undefined && (args.references ?? []).length === 0) {
    throw new LawVerifyToolError('no_input', '至少要给出 text 或 references 之一')
  }
  return findings
}

/** Project one finding into the tool's serializable form. */
function toFinding(finding: CitationFinding, policies: CitationPolicySet): LawVerifyFinding {
  const reference = finding.reference
  return {
    raw: finding.raw,
    law: reference.law,
    ...(reference.kind === 'law-article' ? { article: reference.article } : {}),
    ...(reference.kind === 'law-article' && reference.paragraph !== undefined
      ? { paragraph: reference.paragraph }
      : {}),
    ...(reference.kind === 'guideline-section' ? { sectionPath: reference.path } : {}),
    decision: finding.decision,
    policy: resolveCitationPolicy(finding, policies),
    reason: finding.reason,
  }
}

/** Count the findings by decision. */
function countDecisions(findings: LawVerifyFinding[]): Record<CitationDecision, number> {
  const counts: Record<CitationDecision, number> = {
    'valid': 0,
    'mismatch': 0,
    'out-of-range': 0,
    'not-indexed': 0,
    'unverified': 0,
  }
  for (const finding of findings) counts[finding.decision] += 1
  return counts
}

/** Render the tool report: the decision table plus what a block or a gap means. */
function renderToolReport(findings: LawVerifyFinding[], blocked: boolean): string {
  const lines = [renderCitationRows(findings.map(finding => ({
    label: finding.raw,
    decision: finding.decision,
    policy: finding.policy,
    reason: finding.reason,
  })))]
  if (blocked) {
    lines.push('', '**存在被拦截的引用**：先补证或改写该断言，再交付。')
  }
  if (findings.some(finding => finding.decision === 'unverified')) {
    lines.push('', '存在未核验引用：本索引只登记"有哪些条"，条文文本须由人工按官方来源补录；在此之前该引用必须另找来源核验。')
  }
  return lines.join('\n')
}
