/**
 * src/patent/checker — 推理模式规则：创造性组（7 条）。
 *
 * 移植自 Mady domains/workflows/patent/reasoning_patterns.go；按组拆分自
 * reasoning-rules.ts（对齐 core-rules.ts 的按域拆函数范式）。
 */

import type { CheckRule } from './types.ts'
import { LevelMust, LevelQuality, LevelShould } from './types.ts'
import {
  TERM_CLOSEST_PRIOR_ART,
  TERM_COMMON_KNOWLEDGE,
  TERM_DIFF_FEATURES,
  TERM_DISTINGUISHING_FEATURES,
  TERM_INVENTIVENESS,
  TERM_OBVIOUS,
  TERM_PERSON_SKILLED,
  TERM_TECH_EFFECT,
  TERM_TECH_HINT,
  TERM_USE_LIMIT,
  DOMAIN_INVENTIVENESS,
} from './constants.ts'
import { matchKeyword } from './engine.ts'

/** 公知常识性证据的表述（教科书/工具书为审查指南列举的常见形式）。 */
const COMMON_KNOWLEDGE_EVIDENCE = ['证据', '依据', '证明', '教科书', '工具书', '文献', '调研']

/**
 * 条件式判据：援引公知常识时须同时给出证据或充分论述。
 *
 * 关键词引擎只能做可见性判定，因此本判据只在文本肯定提及公知常识时才要求证据；
 * 未援引公知常识的创造性分析直接通过（缺失「公知常识」这一步由 REASON-CREATIVITY-01A
 * 的三步法路径把守，不在此重复惩罚）。
 * @param text - 待评估的创造性分析文本。
 * @returns 通过返回 `{ passed: true }`，援引而无证据返回带 detail 的失败。
 */
function commonKnowledgeEvidenceCheck(text: string): { passed: boolean; detail: string } {
  if (!matchKeyword(text, TERM_COMMON_KNOWLEDGE) && !matchKeyword(text, '本领域常规')) {
    return { passed: true, detail: '' }
  }
  return COMMON_KNOWLEDGE_EVIDENCE.some(term => matchKeyword(text, term))
    ? { passed: true, detail: '' }
    : { passed: false, detail: '以公知常识为论据，但未给出证据或充分论述' }
}

/**
 * 创造性推理模式规则（7 条）。
 * @returns 创造性推理模式检查规则集。
 */
export function creativityReasoningRules(): CheckRule[] {
  return [
    {
      id: 'REASON-CREATIVITY-01A',
      name: '单对比文件+公知常识审查',
      description: '区别特征属于公知常识的创造性否定路径：无需额外对比文件',
      level: LevelMust,
      severity: 'critical',
      message: '创造性分析未完整论证公知常识路径',
      checkType: 'patent_inventiveness',
      domain: DOMAIN_INVENTIVENESS,
      pathElements: [
        ['最接近的现有技术', TERM_CLOSEST_PRIOR_ART],
        [TERM_DISTINGUISHING_FEATURES, TERM_DIFF_FEATURES],
        [TERM_COMMON_KNOWLEDGE, '惯用技术手段', '常规设计', '本领域常规'],
        [TERM_OBVIOUS, '无需创造性劳动', '非显而易见'],
      ],
      fixSuggestion: '按三步法论证：最接近现有技术→区别特征→区别特征属于公知常识→无需创造性劳动',
    },
    {
      id: 'REASON-CREATIVITY-01B',
      name: '公知常识证据支撑',
      description: '公知常识主张应提供足以使本领域技术人员信服的论证或证据',
      level: LevelShould,
      severity: 'major',
      message: '公知常识的认定缺乏充分论证',
      checkType: 'patent_inventiveness',
      // 判据是「援引公知常识时须有证据支撑」，条件式语义，关键词可见性判定不了；
      // patent_inventiveness 分派也不读 requiredElements，故改由 customCheck 表达。
      customCheck: commonKnowledgeEvidenceCheck,
      domain: DOMAIN_INVENTIVENESS,
      fixSuggestion: '提供公知常识性证据（教科书/工具书）或充分论述该技术手段的普遍性',
    },
    {
      id: 'REASON-CREATIVITY-02',
      name: '多对比文件结合审查',
      description: '多篇对比文件结合时须论证结合动机/技术启示',
      level: LevelMust,
      severity: 'critical',
      message: '多对比文件结合缺少组合动机论证',
      checkType: 'patent_inventiveness',
      domain: DOMAIN_INVENTIVENESS,
      pathElements: [
        ['最接近的现有技术', TERM_CLOSEST_PRIOR_ART, '对比文件1'],
        [TERM_DISTINGUISHING_FEATURES, TERM_DIFF_FEATURES],
        [TERM_TECH_HINT, '组合动机', '结合动机', '结合启示'],
      ],
      fixSuggestion: '说明本领域技术人员有动机将多篇对比文件结合的技术原因和现有技术教导',
    },
    {
      id: 'REASON-CREATIVITY-03',
      name: '技术启示判断审查',
      description: '三步法第三步：技术启示的客观判断',
      level: LevelMust,
      severity: 'critical',
      message: '创造性分析未充分论证是否存在技术启示',
      checkType: 'patent_inventiveness',
      domain: DOMAIN_INVENTIVENESS,
      pathElements: [
        [TERM_TECH_HINT, 'teaching suggestion motivation'],
        [TERM_OBVIOUS, 'obvious', '显而易见性'],
        [TERM_PERSON_SKILLED, '所属领域技术人员', 'person skilled in the art'],
      ],
      fixSuggestion: '以三步法为基础，重点论证现有技术整体上是否存在使本领域技术人员获得该发明的技术启示',
    },
    {
      id: 'REASON-CREATIVITY-04',
      name: '惯用手段与常规选择审查',
      description: '惯用技术手段/常规选择可直接否定创造性',
      level: LevelShould,
      severity: 'major',
      message: '惯用技术手段认定缺乏充分论述',
      checkType: 'patent_inventiveness',
      domain: DOMAIN_INVENTIVENESS,
      pathElements: [
        ['惯用技术手段', '惯用手段', '常规设计', '本领域常规'],
        ['众所周知', '本领域通用', 'common general knowledge'],
      ],
      fixSuggestion: '明确该技术手段在本领域的普遍性和常规性，可引用教科书或工具书佐证',
    },
    {
      id: 'REASON-CREATIVITY-05',
      name: '用途限定的影响审查',
      description: '用途特征对创造性判断的影响分析',
      level: LevelShould,
      severity: 'major',
      message: '未分析用途特征对创造性的实际影响',
      checkType: 'patent_inventiveness',
      domain: DOMAIN_INVENTIVENESS,
      pathElements: [
        ['用途特征', TERM_USE_LIMIT, 'use limitation', '用途'],
        ['产品本身', '产品结构', '产品组成', '产品工艺'],
        [TERM_INVENTIVENESS, '非显而易见'],
      ],
      fixSuggestion: '分析用途特征是否隐含了产品的结构/组成/工艺变化，说明其对创造性判断的贡献',
    },
    {
      id: 'REASON-CREATIVITY-06',
      name: '预料不到的效果认定审查',
      description: '预料不到的技术效果作为创造性辅助判断因素',
      level: LevelQuality,
      severity: 'minor',
      message: '未分析是否存在预料不到的技术效果',
      checkType: 'patent_inventiveness',
      domain: DOMAIN_INVENTIVENESS,
      pathElements: [
        ['预料不到', '出乎意料', 'surprising', 'unexpected'],
        [TERM_TECH_EFFECT, '有益效果', '效果'],
        [TERM_INVENTIVENESS, '创造性的辅助判断'],
      ],
      fixSuggestion: '说明发明产生了哪些本领域技术人员无法合理预期的技术效果及其证据',
    },
  ]
}
