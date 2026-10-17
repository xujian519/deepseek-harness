/**
 * src/document/draftSchema/generic — 十个通用文档模板的受控草案注册表。
 *
 * 与表单模板（data-slot 机制）不同，通用模板的槽位是模板骨架上的元素 id：
 * fields 填充叶级元素的文本内容（meta、footer 等系列），sections blocks 替换
 * 内容容器的 innerHTML（paragraph/list/table 块，表题全文档连续编号），
 * sections rows 以占位行为模板生成表单数据行。含嵌套槽位或骨架标题的包装
 * 元素不是槽位，登记在 staticElements 并逐条给出理由。
 * 槽位集合由 draft-schema-conformance 测试对照 template.html 机械提取结果
 * 双向锁定；rows 列数与各 tbody 占位行的单元格数逐条锁定。
 * @module @deepseek-ai/dsh-patent-document/document/draftSchema/generic
 */

import type { DocumentTemplateId } from '../types.ts'
import type { TemplateSlotRegistry } from './index.ts'

/** 已接入受控草案的通用文档模板 id（claims-spec 与两个表单模板之外的十个）。 */
export const GENERIC_TEMPLATE_IDS = [
  'patentability-opinion',
  'search-report',
  'oa-response',
  'invalidation-opinion',
  'invalidation-analysis',
  'invalidation-defense',
  'rectification-response',
  're-examination-request',
  'infringement-opinion',
  'litigation-pleading',
] as const

/** 通用文档模板 id。 */
export type GenericTemplateId = (typeof GENERIC_TEMPLATE_IDS)[number]

/** 判断模板 id 是否为通用文档模板（类型守卫）。
 * @param id - 模板 id。
 * @returns 该 id 是否为通用文档模板 id。
 */
export function isGenericTemplateId(id: DocumentTemplateId): id is GenericTemplateId {
  return (GENERIC_TEMPLATE_IDS as readonly string[]).includes(id)
}

const req = { required: true } as const
const opt = { required: false } as const
const BLOCKS = { kind: 'blocks' as const }
/** rows 槽位：columns 与各模板 tbody 占位行单元格数一致（一致性测试锁定）。 */
const rows = (columns: number) => ({ kind: 'rows' as const, columns })

/** patentability-opinion 的草案注册表。 */
const PATENTABILITY_OPINION: TemplateSlotRegistry = {
  fields: {
    'meta-client': req,
    'meta-title': req,
    'meta-case': req,
    'meta-basis': req,
    'meta-date': req,
    'sum-title': req,
    'sum-conclusion': req,
    'footer-case': req,
    'footer-date': req,
    'firm-name': opt,
  },
  sections: {
    'doc-number': { ...BLOCKS, ...req },
    'basis-body': { ...BLOCKS, ...req },
    'claim-decomposition-body': { ...BLOCKS, ...req },
    'feature-comparison-body': { ...BLOCKS, ...req },
    'inventiveness-step-1': { ...BLOCKS, ...req },
    'inventiveness-step-2': { ...BLOCKS, ...req },
    'inventiveness-step-3': { ...BLOCKS, ...req },
    'other-requirements-body': { ...BLOCKS, ...req },
    'evidence-body': { ...BLOCKS, ...req },
    'citation-log-body': { ...BLOCKS, ...req },
    'assumptions-body': { ...BLOCKS, ...opt },
  },
  staticElements: [
    { marker: 'id="executive-summary"', reason: '执行摘要骨架包装：含分区标题与 sum-title/sum-conclusion 两个子槽位' },
    { marker: 'id="basis"', reason: '分析依据骨架包装：含分区标题与 basis-body 槽位' },
    { marker: 'id="claim-decomposition"', reason: '技术方案解析骨架包装：含分区标题与 claim-decomposition-body 槽位' },
    { marker: 'id="feature-comparison"', reason: '逐特征比对骨架包装：含分区标题与 feature-comparison-body 槽位' },
    { marker: 'id="inventiveness"', reason: '创造性判断骨架包装：含分区标题、5.1–5.3 小节标题与 inventiveness-step-1/2/3 槽位' },
    { marker: 'id="other-requirements"', reason: '其他授权要件骨架包装：含分区标题与 other-requirements-body 槽位' },
    { marker: 'id="evidence"', reason: '证据清单骨架包装：含分区标题与 evidence-body 槽位' },
    { marker: 'id="citation-log"', reason: '引用日志骨架包装：含分区标题与 citation-log-body 槽位' },
    { marker: 'id="assumptions"', reason: '假设与局限骨架包装：含分区标题、assumptions-body 槽位与固定假设说明' },
  ],
}

/** search-report 的草案注册表。 */
const SEARCH_REPORT: TemplateSlotRegistry = {
  fields: {
    'meta-client': req,
    'meta-title': req,
    'meta-case': req,
    'meta-searcher': req,
    'meta-date': req,
    'meta-databases': req,
    'task-title': req,
    'task-scope': req,
    'task-deadline': req,
    'task-goal': req,
    'preliminary-suggestion': req,
    'footer-case': req,
    'footer-date': req,
  },
  sections: {
    'doc-number': { ...BLOCKS, ...req },
    'strategy-elements': { ...rows(3), ...req },
    'strategy-runs': { ...rows(5), ...req },
    'feature-table': { ...rows(3), ...req },
    'prior-art-table': { ...rows(7), ...req },
    'matrix-table': { ...rows(4), ...req },
    'preliminary-table': { ...rows(4), ...req },
    'citation-table': { ...rows(6), ...req },
    'assumptions-body': { ...BLOCKS, ...opt },
  },
  staticElements: [
    { marker: 'id="task"', reason: '任务概述骨架包装：含分区标题与 task-* 字段槽位' },
    { marker: 'id="strategy"', reason: '检索策略骨架包装：含分区标题与 strategy-* 数据行槽位' },
    { marker: 'id="features"', reason: '特征分解骨架包装：含分区标题与 feature-table 数据行槽位' },
    { marker: 'id="prior-art"', reason: '对比文件骨架包装：含分区标题与 prior-art-table 数据行槽位' },
    { marker: 'id="matrix"', reason: '比对矩阵骨架包装：含分区标题与 matrix-table 数据行槽位' },
    { marker: 'id="preliminary"', reason: '初步结论骨架包装：含分区标题与 preliminary-table/preliminary-suggestion 槽位' },
    { marker: 'id="citation-log"', reason: '引用日志骨架包装：含分区标题与 citation-table 数据行槽位' },
    { marker: 'id="assumptions"', reason: '假设与局限骨架包装：含分区标题、assumptions-body 槽位与固定假设说明' },
  ],
}

/**
 * oa-response 的草案注册表。
 *
 * 论证骨架按「事实 → 规则 → 论证」组织：facts-* 只承载可核验的事实，
 * rules-body 承载据以论证的规则，argument-* 按争点承载论证并回指事实与规则。
 * 审查意见项号不作为小节标题，只作定位括注。
 */
const OA_RESPONSE: TemplateSlotRegistry = {
  fields: {
    'meta-appno': req,
    'meta-title': req,
    'meta-oa-no': req,
    'meta-oa-date': req,
    'meta-response-date': req,
    'meta-agent': req,
    'position-summary': req,
    'conclusion-text': req,
    'footer-case': req,
    'footer-date': req,
  },
  sections: {
    'doc-number': { ...BLOCKS, ...req },
    'position-points': { ...BLOCKS, ...req },
    'amendment-table': { ...rows(4), ...req },
    'amended-claim-1': { ...BLOCKS, ...req },
    'facts-application': { ...BLOCKS, ...req },
    'facts-prior-art': { ...BLOCKS, ...req },
    'rules-body': { ...BLOCKS, ...req },
    'argument-novelty': { ...BLOCKS, ...req },
    'argument-inventiveness': { ...BLOCKS, ...req },
    'argument-other': { ...BLOCKS, ...opt },
    'formalities-body': { ...BLOCKS, ...opt },
    'evidence-table': { ...rows(6), ...req },
    'citation-table': { ...rows(6), ...req },
  },
  staticElements: [
    { marker: 'id="position"', reason: '总体立场骨架包装：含分区标题与 position-summary/position-points 槽位' },
    { marker: 'id="amendments"', reason: '本次修改骨架包装：含分区标题与 amendment-table/amended-claim-1 槽位' },
    { marker: 'id="facts"', reason: '本案事实骨架包装：含分区标题与 facts-application/facts-prior-art 槽位' },
    { marker: 'id="rules"', reason: '适用规则骨架包装：含分区标题与 rules-body 槽位' },
    { marker: 'id="arguments"', reason: '意见陈述骨架包装：含分区标题与 argument-* 槽位' },
    { marker: 'id="formalities"', reason: '其他缺陷处理骨架包装：含分区标题与 formalities-body 槽位' },
    { marker: 'id="evidence"', reason: '证据与引用骨架包装：含分区标题与 evidence-table/citation-table 槽位' },
    { marker: 'id="conclusion"', reason: '结论请求骨架包装：含分区标题与 conclusion-text 槽位' },
  ],
}

/** invalidation-opinion（对外无效宣告请求书）的草案注册表。 */
const INVALIDATION_OPINION: TemplateSlotRegistry = {
  fields: {
    'meta-patent-no': req,
    'meta-patent-title': req,
    'meta-grant-date': req,
    'meta-patentee': req,
    'meta-requester': req,
    'meta-date': req,
    'position-summary': req,
    'conclusion-text': req,
    'footer-case': req,
    'footer-date': req,
  },
  sections: {
    'doc-number': { ...BLOCKS, ...req },
    'position-points': { ...BLOCKS, ...req },
    'claim-feature-table': { ...rows(4), ...req },
    'evidence-table': { ...rows(6), ...req },
    // 无效理由节由结构与法条生成节标题与四段式正文（节序前缀 4 = 「四、无效理由」）；
    // 写死小节标题会让只主张其他理由的请求书被迫编造一段不存在的主张。
    'grounds-body': { kind: 'grounds', groundsPrefix: '4', ...req },
    'claim-conclusion-table': { ...rows(4), ...req },
  },
  staticElements: [
    { marker: 'id="position"', reason: '立论骨架包装：含分区标题与 position-summary/position-points 槽位' },
    { marker: 'id="claim-analysis"', reason: '权利要求分析骨架包装：含分区标题与 claim-feature-table 槽位' },
    { marker: 'id="grounds"', reason: '无效理由骨架包装：含分区标题与 grounds-body 槽位' },
    { marker: 'id="claim-by-claim"', reason: '逐条分析骨架包装：含分区标题与 claim-conclusion-table 槽位' },
    { marker: 'id="evidence"', reason: '证据清单骨架包装：含分区标题与 evidence-table 槽位' },
    { marker: 'id="conclusion"', reason: '结论骨架包装：含分区标题与 conclusion-text 槽位' },
  ],
}

/**
 * invalidation-analysis（内部无效宣告分析意见）的草案注册表。
 *
 * 与对外的 invalidation-opinion 分开：内部件的章节集合不同——它承载引用日志、逐权项结论
 * 分档与缺口披露，这三类内部工作记录不得出现在对外的请求书里，故两个产物各自登记槽位，
 * 而不是让一个模板按模式增减章节。
 */
const INVALIDATION_ANALYSIS: TemplateSlotRegistry = {
  fields: {
    'meta-patent-no': req,
    'meta-patent-title': req,
    'meta-grant-date': req,
    'meta-patentee': req,
    'meta-client': req,
    'meta-date': req,
    'scope-summary': req,
    'conclusion-text': req,
    'footer-case': req,
    'footer-date': req,
  },
  sections: {
    'doc-number': { ...BLOCKS, ...req },
    'scope-points': { ...BLOCKS, ...req },
    'claim-feature-table': { ...rows(4), ...req },
    'evidence-table': { ...rows(6), ...req },
    // 与对外件同一口径：理由节标题由结构生成（节序前缀 4 = 「四、无效理由逐条分析」）。
    'grounds-body': { kind: 'grounds', groundsPrefix: '4', ...req },
    'claim-outlook-table': { ...rows(4), ...req },
    'citation-table': { ...rows(6), ...req },
    'gaps-body': { ...BLOCKS, ...req },
  },
  staticElements: [
    { marker: 'id="scope"', reason: '分析范围骨架包装：含分区标题与 scope-summary/scope-points 槽位' },
    { marker: 'id="claim-analysis"', reason: '权利要求分析骨架包装：含分区标题与 claim-feature-table 槽位' },
    { marker: 'id="evidence"', reason: '证据清单骨架包装：含分区标题与 evidence-table 槽位' },
    { marker: 'id="grounds"', reason: '无效理由骨架包装：含分区标题与 grounds-body 槽位' },
    { marker: 'id="claim-outlook"', reason: '逐权项评估骨架包装：含分区标题与 claim-outlook-table 槽位' },
    { marker: 'id="citation-log"', reason: '引用日志骨架包装：含分区标题与 citation-table 槽位' },
    { marker: 'id="gaps"', reason: '缺口披露骨架包装：含分区标题与 gaps-body 槽位' },
    { marker: 'id="conclusion"', reason: '分析结论骨架包装：含分区标题与 conclusion-text 槽位' },
  ],
}

/**
 * invalidation-defense（专利权人侧的无效宣告程序意见陈述书）的草案注册表。
 *
 * 逐项答辩节与请求人侧的理由节共用 grounds 槽位：节骨架相同，关系词换成「的」，
 * 因此节标题仍是渲染器按草案结构生成的 `5.1 权利要求 1、3 的创造性（…）`，
 * 起草时同样不手写小节标题。
 */
const INVALIDATION_DEFENSE: TemplateSlotRegistry = {
  fields: {
    'meta-patent-no': req,
    'meta-patent-title': req,
    'meta-grant-date': req,
    'meta-patentee': req,
    'meta-requester': req,
    'meta-request-date': req,
    'meta-transfer-no': req,
    'meta-deadline': req,
    'meta-date': req,
    'position-summary': req,
    'conclusion-text': req,
    'footer-case': req,
    'footer-date': req,
  },
  sections: {
    'doc-number': { ...BLOCKS, ...req },
    'position-points': { ...BLOCKS, ...req },
    'procedural-body': { ...BLOCKS, ...req },
    'evidence-objection-body': { ...BLOCKS, ...req },
    'amendment-basis': { ...BLOCKS, ...req },
    'amendment-table': { ...rows(5), ...req },
    // 与请求人侧同一节骨架，关系词换成「的」：被请求人侧的小节按主题命名（节序前缀 5 = 「五、逐项答辩」）。
    'defense-body': { kind: 'grounds', groundsPrefix: '5', groundsRelation: '的', ...req },
    'evidence-table': { ...rows(6), ...req },
    'claim-conclusion-table': { ...rows(4), ...req },
  },
  staticElements: [
    { marker: 'id="position"', reason: '答辩意见概述骨架包装：含分区标题与 position-summary/position-points 槽位' },
    { marker: 'id="procedural"', reason: '程序性意见骨架包装：含分区标题与 procedural-body 槽位' },
    { marker: 'id="evidence-objection"', reason: '质证意见骨架包装：含分区标题与 evidence-objection-body 槽位' },
    { marker: 'id="amendment"', reason: '权利要求书修改骨架包装：含分区标题与 amendment-basis/amendment-table 槽位' },
    { marker: 'id="defense"', reason: '逐项答辩骨架包装：含分区标题与 defense-body 槽位' },
    { marker: 'id="evidence"', reason: '证据清单骨架包装：含分区标题与 evidence-table 槽位' },
    { marker: 'id="claim-by-claim"', reason: '逐权利要求结论骨架包装：含分区标题与 claim-conclusion-table 槽位' },
    { marker: 'id="conclusion"', reason: '结论与请求骨架包装：含分区标题与 conclusion-text 槽位' },
  ],
}

/** rectification-response 的草案注册表。 */
const RECTIFICATION_RESPONSE: TemplateSlotRegistry = {
  fields: {
    'meta-application': req,
    'meta-title': req,
    'meta-applicant': req,
    'meta-notification': req,
    'meta-deadline': req,
    'meta-date': req,
    'rect-findings': req,
    'replacement-note': req,
    'rect-statement': req,
    'footer-case': req,
    'footer-date': req,
  },
  sections: {
    'doc-number': { ...BLOCKS, ...req },
    'rect-defects': { ...BLOCKS, ...req },
    'rect-table-body': { ...rows(5), ...req },
    'replacement-table-body': { ...rows(5), ...req },
  },
  staticElements: [
    { marker: 'id="findings"', reason: '缺陷认定骨架包装：含分区标题与 rect-findings/rect-defects 槽位' },
    { marker: 'id="amendments"', reason: '补正内容骨架包装：含分区标题与 rect-statement/rect-table-body 槽位' },
    { marker: 'id="replacement"', reason: '替换页骨架包装：含分区标题与 replacement-note/replacement-table-body 槽位' },
    { marker: 'id="declaration"', reason: '声明骨架包装：含分区标题与声明固定文字' },
  ],
}

/** re-examination-request 的草案注册表。 */
const RE_EXAMINATION_REQUEST: TemplateSlotRegistry = {
  fields: {
    'meta-application': req,
    'meta-title': req,
    'meta-applicant': req,
    'meta-rejection': req,
    'meta-rejection-date': req,
    'meta-deadline': req,
    'meta-date': req,
    'rejection-summary': req,
    'ground-1': req,
    'ground-2': opt,
    'procedure-note': opt,
    'request-date': req,
    'footer-case': req,
    'footer-date': req,
  },
  sections: {
    'doc-number': { ...BLOCKS, ...req },
    'ground-citations': { ...BLOCKS, ...req },
    'legal-basis': { ...BLOCKS, ...req },
    'amendment-table-body': { ...rows(5), ...req },
  },
  staticElements: [
    { marker: 'id="requests"', reason: '复审请求骨架包装：含分区标题与 request-date 槽位' },
    { marker: 'id="request-items"', reason: '请求事项骨架包装：含固定引导文字' },
    { marker: 'id="grounds"', reason: '复审理由骨架包装：含分区标题与 ground-1/ground-2 槽位' },
    { marker: 'id="legal"', reason: '法律依据骨架包装：含分区标题与 legal-basis 槽位' },
    { marker: 'id="amendments"', reason: '修改对照骨架包装：含分区标题与 amendment-table-body 槽位' },
  ],
}

/** infringement-opinion 的草案注册表。 */
const INFRINGEMENT_OPINION: TemplateSlotRegistry = {
  fields: {
    'meta-patent': req,
    'meta-title': req,
    'meta-owner': req,
    'meta-accused': req,
    'meta-side': req,
    'meta-date': req,
    'claim-text': req,
    'accused-summary': req,
    'coverage-conclusion': req,
    'conclusion-text': req,
    'footer-case': req,
    'footer-date': req,
  },
  sections: {
    'doc-number': { ...BLOCKS, ...req },
    'interpretation-notes': { ...BLOCKS, ...req },
    'equivalence-limits': { ...BLOCKS, ...req },
    'risk-items': { ...BLOCKS, ...req },
    'evidence-log': { ...BLOCKS, ...req },
    'accused-table-body': { ...rows(4), ...req },
    'comparison-table-body': { ...rows(5), ...req },
    'equivalence-table-body': { ...rows(6), ...req },
  },
  staticElements: [
    { marker: 'id="claim-interpretation"', reason: '权利要求解释骨架包装：含分区标题与 claim-text/interpretation-notes 槽位' },
    { marker: 'id="accused-decomposition"', reason: '被控方案分解骨架包装：含分区标题与 accused-summary/accused-table-body 槽位' },
    { marker: 'id="infringement-comparison"', reason: '侵权比对骨架包装：含分区标题与 comparison-table-body 槽位' },
    { marker: 'id="equivalence"', reason: '等同分析骨架包装：含分区标题与 equivalence-limits/equivalence-table-body 槽位' },
    { marker: 'id="conclusion"', reason: '结论骨架包装：含分区标题与 coverage-conclusion/conclusion-text 槽位' },
  ],
}

/** litigation-pleading 的草案注册表。 */
const LITIGATION_PLEADING: TemplateSlotRegistry = {
  fields: {
    'meta-cause': req,
    'meta-court': req,
    'meta-case-no': opt,
    'meta-patent': req,
    'meta-date': req,
    'doc-type': req,
    'doc-kind': req,
    'party-plaintiff-label': req,
    'party-plaintiff-name': req,
    'party-plaintiff-addr': req,
    'party-plaintiff-rep': req,
    'party-plaintiff-contact': req,
    'party-defendant-label': req,
    'party-defendant-name': req,
    'party-defendant-addr': req,
    'party-defendant-rep': req,
    'party-defendant-contact': req,
    'relief-stoppage': req,
    'relief-amount': req,
    'facts-basic': req,
    'facts-patent': req,
    'facts-infringement': req,
    'facts-legal': req,
    'footer-case': req,
    'footer-date': req,
  },
  sections: {
    'doc-number': { ...BLOCKS, ...req },
    'defense-items': { ...BLOCKS, ...opt },
    'facts-rebuttal': { ...BLOCKS, ...opt },
    'sign-party': { ...BLOCKS, ...opt },
    'sign-date': { ...BLOCKS, ...opt },
    'evidence-table-body': { ...rows(5), ...req },
  },
  staticElements: [
    { marker: 'id="doc-title"', reason: '文书标题骨架包装：含 doc-type/doc-kind 字段槽位与固定标题文字' },
    { marker: 'id="party-table-body"', reason: '当事人表格骨架包装：内含 party-* 字段槽位' },
    { marker: 'id="claims"', reason: '诉讼请求/答辩骨架包装：含分区标题与 relief-*/defense-items 槽位' },
    { marker: 'id="relief-items"', reason: '请求事项骨架包装：含固定引导文字' },
    { marker: 'id="facts"', reason: '事实与理由骨架包装：含分区标题与 facts-* 槽位' },
    { marker: 'id="evidence"', reason: '证据清单骨架包装：含分区标题与 evidence-table-body 槽位' },
  ],
}

/** 十个通用文档模板的注册表。 */
export const GENERIC_TEMPLATE_SCHEMAS: Readonly<Record<GenericTemplateId, TemplateSlotRegistry>> = {
  'patentability-opinion': PATENTABILITY_OPINION,
  'search-report': SEARCH_REPORT,
  'oa-response': OA_RESPONSE,
  'invalidation-opinion': INVALIDATION_OPINION,
  'invalidation-analysis': INVALIDATION_ANALYSIS,
  'invalidation-defense': INVALIDATION_DEFENSE,
  'rectification-response': RECTIFICATION_RESPONSE,
  're-examination-request': RE_EXAMINATION_REQUEST,
  'infringement-opinion': INFRINGEMENT_OPINION,
  'litigation-pleading': LITIGATION_PLEADING,
}

/**
 * 一个 `grounds` 槽位的体例：节序前缀与关系词。
 *
 * 二者都是模板骨架的事实（前缀如 `4` 对应「四、无效理由」；关系词如请求人侧的「不具备」、
 * 被请求人侧按主题命名的「的」），登记在槽位声明里而不是转换器里，使节标题随模板体例走。
 */
export type GroundsSectionStyle = {
  /** 节序前缀；缺省空串，节标题只出序号。 */
  prefix: string
  /** 权项与理由名之间的关系词；未声明时渲染器用「不具备」。 */
  relation?: string
}

/**
 * 取模板 grounds 槽位的体例映射（槽位 id → 节序前缀与关系词）。
 * @param template - 通用文档模板 id。
 * @returns 槽位 id → 体例；没有 grounds 槽位时为空对象。
 */
export function groundsSectionStyles(template: GenericTemplateId): Record<string, GroundsSectionStyle> {
  const styles: Record<string, GroundsSectionStyle> = {}
  for (const [id, slot] of Object.entries(GENERIC_TEMPLATE_SCHEMAS[template].sections)) {
    if (slot.kind !== 'grounds') continue
    styles[id] = {
      prefix: slot.groundsPrefix,
      ...(slot.groundsRelation === undefined ? {} : { relation: slot.groundsRelation }),
    }
  }
  return styles
}
