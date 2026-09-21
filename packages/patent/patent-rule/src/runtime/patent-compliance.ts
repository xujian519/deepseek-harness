/**
 * 宪法规则引擎 — 内置资产加载（专利合规规则）。
 *
 * 资产路径定位（dsh 适配）：包内 assets/rules/patent/，可经 `rulesDir`
 * 覆盖项替换基础资产根（布局镜像 assets/rules/）。全部失败时返回空规则集 +
 * 警告（不抛错，门禁降级为放行）。
 * @module @deepseek-ai/dsh-patent-rule/runtime/patent-compliance
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import type { RuleSet, RuleSetValidationIssue } from '@deepseek-ai/dsh-patent-core'
import {
  ACTIVATION_PATCH_KEYS,
  applyRuleOverrides,
  asRecord,
  asStringArray,
  hasNonEmptyWord,
  isRuleAction,
  loadRuleSetFromFile,
  mergeRuleSets,
  type ActivationRulePatch,
} from './RuleLoader.ts'
import { candidateRuleDirs } from '../asset-location.ts'

const COMPLIANCE_FILE = 'compliance.yaml'
const ELECTRICAL_FILE = 'electrical-section-h.yaml'
const ACTIVATION_OVERRIDES_FILE = 'activation-overrides.yaml'

/**
 * nuo 专利规则文件清单（Sati 侧 `port-nuo-rules.ts` 生成物的逐字镜像；该脚本与其读取的
 * `assets/patent-rules/` 原始资产未随移植带入本仓，故各文件头部注释描述的生成流程在本仓不适用）。
 * 显式列出而非扫目录：rules/patent/ 还含 evidence-rules.yaml（证据引擎自有格式）、
 * synonyms.yaml（同义词资产）等非宪法规则文件，扫目录会误加载产生噪音。
 */
const NUO_RULE_FILES = [
  'nuo-compliance-enforceable.yaml',
  'nuo-patent-core-rules.yaml',
  'nuo-patent-examination-rules.yaml',
  'nuo-patent-ipc-rules.yaml',
  'nuo-patent-judgment-rules.yaml',
  'nuo-patent-law.yaml',
  'nuo-patent-practice-rules.yaml',
] as const

/**
 * 手写并入资产清单（非 nuo 生成物镜像）：`current-law.yaml` 是现行法条口径禁令，
 * `mady-gap-rules.yaml` 是上游未镜像且可确定性执行规则的转换子集。与 nuo 清单分开列出，
 * 因为两者来源不同——nuo 文件名对应 Sati 侧生成流程，本清单由本仓手工维护。
 * 两类都参与 activation-overrides 补丁（同一合并结果集），故评审补丁可同时作用于两者。
 */
const MERGED_RULE_FILES = ['current-law.yaml', 'mady-gap-rules.yaml'] as const

/** 专利合规规则集加载结果（规则集、来源、警告）。 */
export type PatentComplianceLoadResult = {
  ruleSet: RuleSet
  source: string | null
  warnings: string[]
}

function loadFirstExistingRuleSet(fileName: string, rulesDir?: string): PatentComplianceLoadResult {
  const warnings: string[] = []
  for (const dir of candidateRuleDirs(rulesDir)) {
    const path = join(dir, fileName)
    if (!existsSync(path)) continue
    try {
      const loaded = loadRuleSetFromFile(path)
      return {
        ruleSet: loaded.ruleSet,
        source: loaded.source,
        warnings: [...warnings, ...loaded.warnings.map(w => w.message)],
      }
    } catch (error) {
      warnings.push(`规则资产加载失败 ${path}: ${(error as Error).message}`)
    }
  }
  return { ruleSet: { rules: [] }, source: null, warnings }
}

/**
 * 加载基础合规规则集，并在资产缺失时追加"门禁降级为放行"警告。
 * @param rulesDir - 可选的规则根目录覆盖。
 * @returns 加载结果（规则集、来源、警告）。
 */
function loadBaseCompliance(rulesDir?: string): PatentComplianceLoadResult {
  const result = loadFirstExistingRuleSet(COMPLIANCE_FILE, rulesDir)
  if (result.source === null) {
    result.warnings.push('未找到专利合规规则资产（assets/rules/patent/compliance.yaml），门禁降级为放行')
  }
  return result
}

/**
 * 加载内置专利合规规则集；找不到资产时返回空规则集并附警告。
 * @param rulesDir - 可选的规则根目录覆盖。
 * @returns 加载结果（规则集、来源、警告）。
 */
export function loadPatentComplianceRuleSet(rulesDir?: string): PatentComplianceLoadResult {
  return loadBaseCompliance(rulesDir)
}

/**
 * 加载电学案件增强规则集（compliance.yaml + electrical-section-h.yaml 合并）。
 * 用于 H 部电学案件的额外审查/撰写约束；找不到电学增强资产时回退到通用合规规则。
 * @param rulesDir - 可选的规则根目录覆盖。
 * @returns 加载结果（规则集、来源、警告）。
 */
export function loadPatentElectricalRuleSet(rulesDir?: string): PatentComplianceLoadResult {
  const base = loadBaseCompliance(rulesDir)
  if (base.source === null) {
    return base
  }
  const extra = loadFirstExistingRuleSet(ELECTRICAL_FILE, rulesDir)
  const merged: RuleSet = {
    version: base.ruleSet.version ?? extra.ruleSet.version ?? '1.0',
    rules: [...base.ruleSet.rules, ...extra.ruleSet.rules],
  }
  return {
    ruleSet: merged,
    source: extra.source ? `${base.source},${extra.source}` : base.source,
    warnings: [...base.warnings, ...extra.warnings],
  }
}

/** 激活评审覆盖补丁：id → 字段级补丁（action 整替换 + check 级增补，见 ActivationRulePatch）。 */
export type ActivationOverrides = {
  byId: Map<string, ActivationRulePatch>
  source: string | null
  warnings: string[]
}

/** 解析单条补丁对象；无可识别字段时返回 null（并已写入 warnings）。 */
function parseActivationPatch(
  id: string,
  record: Record<string, unknown>,
  warnings: string[],
): ActivationRulePatch | null {
  const patch: ActivationRulePatch = {}

  if (record.action !== undefined) {
    if (!isRuleAction(record.action)) {
      warnings.push(`激活覆盖 ${id}: 非法 action ${JSON.stringify(record.action)}，已跳过`)
      return null
    }
    patch.action = record.action
  }

  for (const key of ['addKeywords', 'additionalNegationWords'] as const) {
    const raw = record[key]
    if (raw === undefined) continue
    const list = asStringArray(raw)
    // 与资产解析器（RuleLoader.parseCheck）同一判据：空表、非法类型与全空串元素都整条跳过
    // ——三者都让表在消费侧恒不生效。带首尾空白的元素保留：两条消费路径都会让它参与匹配。
    if (list === null || !hasNonEmptyWord(list)) {
      warnings.push(`激活覆盖 ${id}: ${key} 必须是非空字符串数组，已跳过`)
      return null
    }
    patch[key] = list
  }

  if (record.negationContext !== undefined) {
    if (typeof record.negationContext !== 'boolean') {
      warnings.push(`激活覆盖 ${id}: negationContext 必须是布尔值，已跳过`)
      return null
    }
    patch.negationContext = record.negationContext
  }

  for (const key of Object.keys(record)) {
    if (!ACTIVATION_PATCH_KEYS.includes(key)) {
      warnings.push(`激活覆盖 ${id}: 未知键 "${key}"（允许：${ACTIVATION_PATCH_KEYS.join(' / ')}），已忽略`)
    }
  }

  if (Object.keys(patch).length === 0) {
    warnings.push(`激活覆盖 ${id}: 无有效字段，已跳过`)
    return null
  }
  return patch
}

/**
 * 加载 nuo 规则激活评审覆盖（activation-overrides.yaml）。
 * 轻量补丁格式：`overrides: { <id>: { action?, addKeywords?, negationContext?,
 * additionalNegationWords?, reason? } }`（非标准 RuleSet 形态，由本函数专门解析；
 * 字段语义见 `ActivationRulePatch`）。任一字段非法即跳过该条并告警
 * （fail-safe：不应用半截补丁）。文件不存在时返回空补丁 + 警告（不阻塞专利全量规则加载）。
 * @param rulesDir - 可选的规则根目录覆盖。
 * @returns 激活覆盖（byId 映射、来源、警告）。
 */
export function loadActivationOverrides(rulesDir?: string): ActivationOverrides {
  const warnings: string[] = []
  for (const dir of candidateRuleDirs(rulesDir)) {
    const path = join(dir, ACTIVATION_OVERRIDES_FILE)
    if (!existsSync(path)) continue
    try {
      const doc = parseDocument(readFileSync(path, 'utf8'))
      if (doc.errors.length > 0) {
        /* v8 ignore next -- yaml parse errors always carry a message. */
        warnings.push(`激活覆盖文件解析失败 ${path}: ${doc.errors[0]?.message ?? 'unknown'}`)
        continue
      }
      const raw = asRecord(asRecord(doc.toJS())?.overrides) ?? {}
      const byId = new Map<string, ActivationRulePatch>()
      for (const [id, value] of Object.entries(raw)) {
        const record = asRecord(value)
        if (record === null) {
          warnings.push(`激活覆盖 ${id}: 覆盖值必须是对象，已跳过`)
          continue
        }
        const patch = parseActivationPatch(id, record, warnings)
        if (patch !== null) byId.set(id, patch)
      }
      return { byId, source: path, warnings }
    } catch (error) {
      warnings.push(`激活覆盖文件加载失败 ${path}: ${(error as Error).message}`)
    }
  }
  return { byId: new Map(), source: null, warnings }
}

/**
 * 输出门禁规则子集：只保留「出现即违规」的 keyword_blocklist 规则，且排除 compliance
 * 规则（id 以 PAT- 开头）。
 *
 * - structural_analysis（缺失即违规 = 完整性期望）对任意 assistant 输出会海量误报
 *   （普通文本天然「缺失」几十个期望要素），只适用 rule_check 显式自检（A 链）；
 * - compliance 的 keyword/citation 规则已由关键词门禁（quality-gate 镜像词表）处理，
 *   规则门禁若重复接入会产生双重提示，故排除 PAT-* 前缀。
 *
 * 结果 = nuo 的 keyword_blocklist 规则（占位符/商业宣传/公序良俗/清楚性/事后诸葛亮/
 * 编造对比文件等），即 B 链规则门禁的「新增」能力。
 * @param ruleSet - 待筛选的规则集。
 * @returns 门禁规则子集。
 */
export function selectGateRules(ruleSet: RuleSet): RuleSet {
  return {
    ...(ruleSet.version !== undefined ? { version: ruleSet.version } : {}),
    rules: ruleSet.rules.filter(rule => rule.check.type === 'keyword_blocklist' && !rule.id.startsWith('PAT-')),
  }
}

/**
 * 加载专利全量规则集（compliance.yaml + nuo-*.yaml + 手写并入资产，经
 * activation-overrides 降级）。
 * 供 rule_check scope=patent-full 与规则驱动输出门禁（B 链）使用。
 * 任一并入文件缺失/损坏均跳过并告警（不拖垮整个规则集）；compliance 缺失时
 * 沿用既有「门禁降级为放行」语义。
 * @param rulesDir - 可选的规则根目录覆盖。
 * @returns 加载结果（规则集、来源、警告）。
 */
export function loadPatentFullRuleSet(rulesDir?: string): PatentComplianceLoadResult {
  const base = loadBaseCompliance(rulesDir)
  if (base.source === null) {
    return base
  }
  const mergedSets: RuleSet[] = []
  const warnings = [...base.warnings]
  for (const file of [...NUO_RULE_FILES, ...MERGED_RULE_FILES]) {
    const loaded = loadFirstExistingRuleSet(file, rulesDir)
    if (loaded.source === null) {
      warnings.push(`规则文件未找到: ${file}`)
      continue
    }
    mergedSets.push(loaded.ruleSet)
    warnings.push(...loaded.warnings)
  }
  const mergedRuleSet = mergeRuleSets(mergedSets)
  const { byId, source: overrideSource, warnings: overrideWarnings } = loadActivationOverrides(rulesDir)
  warnings.push(...overrideWarnings)
  const patchIssues: RuleSetValidationIssue[] = []
  const patched = applyRuleOverrides(mergedRuleSet, byId, patchIssues)
  warnings.push(...patchIssues.map(issue => issue.message))
  const merged: RuleSet = {
    version: base.ruleSet.version ?? patched.version ?? '1.0',
    rules: [...base.ruleSet.rules, ...patched.rules],
  }
  return {
    ruleSet: merged,
    source: overrideSource ? `${base.source}+${overrideSource}` : base.source,
    warnings,
  }
}

/** 每一作业 scope 都并入的通用域：compliance 基础规则（`patent`）与通用实务规则（`patent_general`）。 */
const COMMON_CASE_DOMAINS = ['patent', 'patent_general'] as const

/**
 * 答复类文书（审查意见答复、复审请求）的域集合，两个作业 scope 共用。
 *
 * 构成：通用域 + 答复实践域（逐点回应、答复期限、修改超范围检查）+ 需答复的实体条款域
 * （新颖性 22.2 / 创造性 22.3 / 实用性 22.4 / 充分公开 26.3 / 权利要求 26.4）
 * + 审查程序域（A33 修改不超范围、程序与证据规则）。
 */
const ANSWER_BRIEF_DOMAINS = [
  ...COMMON_CASE_DOMAINS,
  'patent_oa_response',
  'patent_novelty',
  'patent_inventiveness',
  'patent_utility',
  'patent_disclosure',
  'patent_claims',
  'patent_procedure',
] as const

/** 作业类别 scope（`rule_check` 的 scope 取值，与四类作业 manifest 一一对应）。 */
export type PatentCaseScope =
  | 'patent-oa-response'
  | 'patent-invalidation'
  | 'patent-reexamination'
  | 'patent-infringement'

/**
 * 作业 scope → 评估域（`ConstitutionalRule.domain` 的闭集，见 `assets/rules/patent/**`）。
 *
 * 一个 scope 的域 = 通用域 + **本作业交付文书的格式/程序域** + **本作业必须答复或论证的理由条款域**。
 * 域取值全部取自规则资产：资产中没有 `patent_invalidation` / `patent_reexamination` / `patent_amendment`
 * 三个域，无效与复审的实体理由（22.2 / 22.3 / 22.4 / 26.3 / 26.4 / 33 条）在资产里分别落在新颖性、
 * 创造性、实用性、充分公开、权利要求、程序六个域上，故各 scope 的域按其理由来源推导：
 *
 * | scope | 对应 manifest | 理由来源 |
 * | --- | --- | --- |
 * | `patent-oa-response` | `patent_oa_response_v1` | 驳回类型表（7 类） |
 * | `patent-invalidation` | `patent_invalidation_v1` | 无效理由表（5 项） |
 * | `patent-reexamination` | `patent_reexamination_v1` | 复审理由表（6 项） |
 * | `patent-infringement` | `patent_infringement_v1` | 侵权比对与抗辩 |
 *
 * 四个 scope 的并集覆盖 `patent-full` 里的全部域（测试断言）：任一域的规则都至少有一个作业入口，
 * 新增资产域若不属于任何作业，构建期就会失败而不是只能靠 `patent-full` 触及。
 *
 * 答复与复审今日域集合相同：复审理由表 = 无效理由表 + 实用新型客体缺陷（客体规则在通用域），且复审
 * 请求书与答复文书同构（逐点回应、A33 限制）。两者仍分列——模型按作业选入口，不必知道域表；任一作业
 * 的资产域分化时（例如上游带来 `patent_invalidation` 域的规则）在此处拆开，scope 名称不变。
 * 无效 scope 不含答复实践域：该域规则的语义是答复审查意见（逐点回应审查意见、答复期限），对无效请求书
 * 会误报。侵权 scope 只含侵权域：撰写与审查域的结构完整性规则对侵权意见书会误报。
 */
export const PATENT_CASE_DOMAINS: Record<PatentCaseScope, readonly string[]> = {
  'patent-oa-response': ANSWER_BRIEF_DOMAINS,
  'patent-reexamination': ANSWER_BRIEF_DOMAINS,
  'patent-invalidation': [
    ...COMMON_CASE_DOMAINS,
    'patent_novelty',
    'patent_inventiveness',
    'patent_utility',
    'patent_disclosure',
    'patent_claims',
    'patent_procedure',
  ],
  'patent-infringement': [...COMMON_CASE_DOMAINS, 'patent_infringement'],
}

/**
 * 解析作业 scope 的评估域；非作业 scope 返回 undefined（调用方据此走全量评估）。
 * @param scope - `rule_check` 的 scope 取值（模型输入，须按自有键判断，不能落到原型链上）。
 * @returns 该作业的域列表；非作业 scope 时为 undefined。
 */
export function patentCaseDomains(scope: string): readonly string[] | undefined {
  return Object.hasOwn(PATENT_CASE_DOMAINS, scope) ? PATENT_CASE_DOMAINS[scope as PatentCaseScope] : undefined
}
