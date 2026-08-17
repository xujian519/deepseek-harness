/**
 * `draft_claims` tool: deterministic claim-drafting (five-step: feature
 * classification → technical field → essential features → independent claim →
 * dependent claims) with formal validation. Ported from Sati's draftClaims.ts.
 * @module @deepseek-ai/dsh-patent-tools/tool/draft-claims
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** Patent technical domain (mechanical / electrical / chemical / software / general). */
export type TechDomain = 'mechanical' | 'electrical' | 'chemical' | 'software' | 'general'
/** Patent type (invention or utility model). */
export type PatentType = 'invention' | 'utility_model'

/** Input for the draft_claims tool. */
export type DraftClaimsInput = {
  /** Invention title. */
  invention_name: string
  /** Technical domain (auto-detected when empty). */
  tech_domain?: TechDomain
  /** Patent type: invention or utility model (default invention). */
  patent_type?: PatentType
  /** Essential technical features (for the independent claim). */
  technical_features: string[]
  /** Optional/additional technical features (for the dependent claims). */
  optional_features?: string[]
  /** Closest prior-art description (optional, for the preamble). */
  prior_art?: string
}

/** One drafted claim (independent or dependent). */
export type DraftedClaim = {
  number: number
  type: 'independent' | 'dependent'
  text: string
  refersTo?: number
}

/** One formal-validity violation found in drafted claims. */
export type ClaimViolation = {
  rule: string
  severity: 'error' | 'warning'
  claimNumber?: number
  message: string
  suggestion?: string
}

/** Output of the draft_claims tool. */
export type DraftClaimsOutput = {
  invention_name: string
  tech_domain: TechDomain
  claims: DraftedClaim[]
  violations: ClaimViolation[]
  warnings: string[]
}

/** Vague qualifiers (clarity rule). */
const VAGUE_TERMS = ['约', '大致', '可能', '优选', '例如', '大约', '左右']

/** Domain → claim-structure templates. */
const DOMAIN_STRUCT: Record<
  TechDomain,
  { head: (name: string) => string; connector: string; withPriorConnector: string; priorConnector: string }
> = {
  mechanical: { head: name => `一种${name}，`, connector: '其特征在于，包括：', withPriorConnector: '其特征在于，还包括：', priorConnector: '包括：' },
  electrical: { head: name => `一种${name}，`, connector: '其特征在于，包括：', withPriorConnector: '其特征在于，还包括：', priorConnector: '包括：' },
  chemical: { head: name => `一种${name}，`, connector: '其特征在于，包含：', withPriorConnector: '其特征在于，还包含：', priorConnector: '包含：' },
  software: { head: name => `一种${name}的实现方法，`, connector: '其特征在于，包括以下步骤：', withPriorConnector: '其特征在于，还包括以下步骤：', priorConnector: '包括以下步骤：' },
  general: { head: name => `一种${name}，`, connector: '其特征在于，包括：', withPriorConnector: '其特征在于，还包括：', priorConnector: '包括：' },
}

/** Domain keywords → auto-detected technical domain (shared with draft_specification). */
export const DOMAIN_KEYWORDS: Array<{ domain: TechDomain; keywords: string[] }> = [
  { domain: 'chemical', keywords: ['组分', '化合物', '合成', '催化剂', '溶液', '材料组合物', '重量份'] },
  { domain: 'software', keywords: ['步骤', '算法', '数据', '模块', '接口', '处理器执行', '电子设备'] },
  { domain: 'electrical', keywords: ['电路', '电源', '信号', '传感器', '控制器', '芯片', '电压'] },
  { domain: 'mechanical', keywords: ['壳体', '齿轮', '轴承', '支架', '轴', '弹簧', '连接件', '传动'] },
]

const DESCRIPTION = '根据技术交底书或技术方案撰写权利要求书草案（机械/电学/化学/软件四领域）。当用户要求撰写权利要求、写权利要求书时使用，避免自行手写权利要求文本。输出独立权利要求 + 从属权利要求 + 形式校验报告。'

/** Render the canonical draft into model-facing Markdown. */
function renderDraftClaims(value: DraftClaimsOutput): string {
  const lines = [
    `# 权利要求书草案（${value.invention_name}）`,
    `技术领域: ${value.tech_domain}`,
    '',
    ...value.claims.map(c => `${c.number}. [${c.type}]${c.refersTo !== undefined ? `（引用 ${c.refersTo}）` : ''} ${c.text}`),
  ]
  if (value.violations.length > 0) {
    lines.push('', '## 形式校验违规', ...value.violations.map(v => `- [${v.severity}] ${v.rule}${v.claimNumber !== undefined ? `（权${v.claimNumber}）` : ''}: ${v.message}${v.suggestion ? ` → ${v.suggestion}` : ''}`))
  }
  if (value.warnings.length > 0) {
    lines.push('', '## 警告', ...value.warnings.map(w => `- ${w}`))
  }
  return lines.join('\n')
}

function buildIndependentClaim(name: string, domain: TechDomain, features: string[], priorArt: string): string {
  const struct = DOMAIN_STRUCT[domain]
  if (features.length === 0) {
    return `${struct.head(name)}${struct.connector}（缺少必要技术特征）`
  }
  const featurePart = features.join('；')
  if (priorArt && priorArt.length > 0) {
    const normalized = normalizePriorArt(priorArt)
    return `${struct.head(name)}${struct.priorConnector}${normalized}；${struct.withPriorConnector}${featurePart}。`
  }
  if (domain === 'software') {
    return `${struct.head(name)}${struct.connector}${features.join('；')}。`
  }
  return `${struct.head(name)}${struct.connector}${featurePart}。`
}

/** Strip trailing punctuation from prior_art to avoid "。；" concatenation. */
function normalizePriorArt(priorArt: string): string {
  return priorArt.replace(/[。；;，,]+$/, '')
}

function resolveDomain(hint: TechDomain | undefined, name: string, features: string[]): TechDomain {
  if (hint && hint !== 'general') return hint
  const haystack = `${name} ${features.join(' ')}`
  for (const entry of DOMAIN_KEYWORDS) {
    if (entry.keywords.some(k => haystack.includes(k))) return entry.domain
  }
  return 'general'
}

/** Formal validation: numbering / trailing period / vague terms / illustration refs / circular refs. */
function validateClaims(claims: DraftedClaim[]): ClaimViolation[] {
  const violations: ClaimViolation[] = []
  claims.forEach((c, i) => {
    if (c.number !== i + 1) {
      violations.push({ rule: 'numbering', severity: 'error', claimNumber: c.number, message: `权利要求未按阿拉伯数字顺序编号（应为 ${i + 1} 号）`, suggestion: '请按 1, 2, 3, ... 的顺序重新编号权利要求' })
    }
  })
  for (const c of claims) {
    if (!c.text.endsWith('。')) {
      violations.push({ rule: 'period', severity: 'error', claimNumber: c.number, message: '权利要求未以句号结尾', suggestion: "在权利要求末尾添加'。'" })
    }
    const vagueHits = VAGUE_TERMS.filter(t => c.text.includes(t))
    if (vagueHits.length > 0) {
      violations.push({ rule: 'clarity', severity: 'warning', claimNumber: c.number, message: `权利要求包含模糊限定词: ${vagueHits.join('、')}`, suggestion: "删除'约/大致/可能/优选/例如'等模糊表述" })
    }
    if (/如图[一二三四五六七八九十\d]+所示|如附图/.test(c.text)) {
      violations.push({ rule: 'no_illustration', severity: 'error', claimNumber: c.number, message: "权利要求中不得包含'如图……所示'等引用附图的表述", suggestion: "删除'如图……所示'等表述，或将其替换为技术特征的直接描述" })
    }
    if (c.refersTo !== undefined && c.refersTo >= c.number && c.type === 'dependent') {
      violations.push({ rule: 'circular_reference', severity: 'error', claimNumber: c.number, message: `从属权利要求 ${c.number} 引用了 ${c.refersTo}，形成非法引用`, suggestion: '从属权利要求只能引用编号更小的权利要求' })
    }
  }
  return violations
}

/**
 * Pure entry point: generate a claim draft plus formal validation.
 * @param input - the claim-drafting request.
 * @returns the drafted claims and validation result.
 */
export function draftClaims(input: DraftClaimsInput): DraftClaimsOutput {
  const name = input.invention_name.trim()
  const domain = resolveDomain(input.tech_domain, name, input.technical_features)
  const essential = input.technical_features.map(f => f.trim()).filter(Boolean)
  const optional = (input.optional_features ?? []).map(f => f.trim()).filter(Boolean)
  const warnings: string[] = []
  if (essential.length === 0) warnings.push('未提供必要技术特征，独立权利要求无法生成完整技术方案')
  if (name.length > 25) warnings.push(`发明名称 ${name.length} 字，超过 25 字限制`)
  const independentText = buildIndependentClaim(name, domain, essential, input.prior_art?.trim() ?? '')
  const dependents: DraftedClaim[] = optional.map((feat, idx) => {
    const number = 2 + idx
    const refersTo = number - 1
    return { number, type: 'dependent', refersTo, text: `根据权利要求${refersTo}所述的${name}，其特征在于，还包括：${feat}。` }
  })
  const claims: DraftedClaim[] = [{ number: 1, type: 'independent', text: independentText }, ...dependents]
  const violations = validateClaims(claims)
  return { invention_name: name, tech_domain: domain, claims, violations, warnings }
}

const CLAIM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    number: { type: 'integer', required: true },
    type: { type: 'string', required: true, enum: ['independent', 'dependent'] },
    text: { type: 'string', required: true },
    refersTo: { type: 'integer' },
  },
} as const

const VIOLATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    rule: { type: 'string', required: true },
    severity: { type: 'string', required: true, enum: ['error', 'warning'] },
    claimNumber: { type: 'integer' },
    message: { type: 'string', required: true },
    suggestion: { type: 'string' },
  },
} as const

/**
 * Build the `draft_claims` tool (pure, no dependencies).
 * @returns a registry-ready tool definition.
 */
export function createDraftClaimsTool(): ToolDefinition {
  return defineTool({
    name: 'draft_claims',
    description: DESCRIPTION,
    parameters: {
      invention_name: { type: 'string', required: true, description: '发明名称' },
      tech_domain: { type: 'string', enum: ['mechanical', 'electrical', 'chemical', 'software', 'general'], description: '技术领域（为空时自动识别）' },
      patent_type: { type: 'string', enum: ['invention', 'utility_model'], description: '专利类型：发明或实用新型（默认 invention）' },
      technical_features: { type: 'array', required: true, items: { type: 'string' }, description: '必要技术特征列表（用于独立权利要求）' },
      optional_features: { type: 'array', items: { type: 'string' }, description: '附加/可选技术特征列表（用于从属权利要求）' },
      prior_art: { type: 'string', description: '最接近现有技术描述（可选，用于前序部分）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          invention_name: { type: 'string', required: true },
          tech_domain: { type: 'string', required: true, enum: ['mechanical', 'electrical', 'chemical', 'software', 'general'] },
          claims: { type: 'array', required: true, items: CLAIM_SCHEMA },
          violations: { type: 'array', required: true, items: VIOLATION_SCHEMA },
          warnings: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderDraftClaims(value as unknown as DraftClaimsOutput) }],
    },
    async execute(args) {
      return draftClaims(args)
    },
  })
}
