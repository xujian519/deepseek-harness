/**
 * src/patent/analysis-report — 专利分析产物契约（从 Athena patent_analysis_api 的分析响应借鉴）。
 *
 * 定位：把域内各引擎的"判断型结论"（checker 裁决 / graph 三性 / claim-chart 特征 /
 * evidence 收据）汇总为一个模型可见、可审计的标准化产物。本模块是纯库：只定义
 * 契约与确定性聚合器，不持有 ctx，LLM 打分由工具层经 ModelPort 填充后接入。
 */

import type { Severity, Verdict } from '../checker/types.ts'

/** 技术特征类型（启发式判定，见 feature-extract）。 */
export type AnalysisFeatureType = 'device' | 'method' | 'material' | 'system' | 'data' | 'other'

/** 技术特征重要性等级（主张保护范围权重）。 */
export type FeatureImportance = 'high' | 'medium' | 'low'

/** 多维质量评分维度。 */
export type QualityDomain = 'novelty' | 'clarity' | 'completeness' | 'technical_strength'

/** 评分来源：deterministic（规则推导）或 model（LLM 补分）。 */
export type ScoreBasis = 'deterministic' | 'model'

/**
 * 单个已抽取的技术特征。
 * v1 以权利要求为粒度抽取（claimNo 即权利要求序号）；更细粒度的要素拆分由
 * claim-chart 引擎承担，二者互补而非重复。
 */
export interface ExtractedFeature {
  /** 所属权利要求序号（1 起）。 */
  claimNo: number
  /** 特征原文（权利要求文本）。 */
  text: string
  /** 特征类型。 */
  type: AnalysisFeatureType
  /** 重要性等级。 */
  importance: FeatureImportance
  /** 抽取置信度 0..1。 */
  confidence: number
}

/** 特征分布统计。 */
export interface FeatureStatistics {
  /** 按类型计数。 */
  byType: Record<AnalysisFeatureType, number>
  /** 按重要性计数。 */
  byImportance: Record<FeatureImportance, number>
  /** 特征总数。 */
  total: number
}

/** 单维质量评分（0..100）。 */
export interface QualityScore {
  domain: QualityDomain
  score: number
  basis: ScoreBasis
  /** 评分依据说明。 */
  rationale: string
}

/** 标准化检索策略记录（供检索/分析/评估工具共用，承载"检索策略契约"意识）。 */
export interface SearchStrategy {
  /** 本次检索的查询串。 */
  query: string
  /** IPC 分类号（检索范围），如 ["G06"]。 */
  ipc?: string[]
  /** 检索关键词。 */
  keywords?: string[]
  /** 结构化过滤条件。 */
  filters?: { docType?: string; court?: string }
  /** 命中数。 */
  hits?: number
}

/** IPC 分类在报告中的摘要形态（name 自 IPC_DOMAINS 解析）。 */
export interface IpcSummary {
  section: string
  domainName: string
  confidence: number
  /** 命中的高频大类，如 "A61"；未命中大类时缺省。 */
  detail?: string
  matchedKeywords: string[]
  /** 该 IPC 领域的创造性审查要点（自 IPC_DOMAINS.inventivenessFocus）。 */
  noveltyImplications?: string[]
}

/** 单条检查失败摘要。 */
export interface CheckerFailureSummary {
  ruleId: string
  message: string
  severity: Severity
}

/** graph 三性结论摘要（由工具层提取后注入；可选）。 */
export interface GraphConclusionSummary {
  novelty?: string
  inventiveness?: string
  enablement?: string
  citationsOk?: boolean
}

/** 知识图谱增强统计（由知识层/工具层注入；可选）。 */
export interface KgAnalysisSummary {
  matchedEntities: number
  relatedEntities: number
  confidence: number
}

/** 专利分析产物（统一契约）。 */
export interface PatentAnalysisReport {
  patentId?: string
  title?: string
  /** IPC 分类摘要（按置信度降序）。 */
  ipc: IpcSummary[]
  /** 已抽取技术特征。 */
  technicalFeatures: ExtractedFeature[]
  featureStatistics: FeatureStatistics
  /** 多维质量评分（含确定性 + LLM 补分）。 */
  scores: QualityScore[]
  /** checker 聚合判级（缺省表示未运行 checker）。 */
  checkerVerdict?: Verdict
  /** checker 失败明细。 */
  checkerFailures: CheckerFailureSummary[]
  /** graph 三性结论摘要。 */
  graphConclusions?: GraphConclusionSummary
  /** evidence 收据数（可选）。 */
  evidenceReceiptCount?: number
  /** 知识图谱增强统计。 */
  kgAnalysis?: KgAnalysisSummary
  /** 创新性洞察（规则推导的确定性列表）。 */
  innovationInsights: string[]
  /** 专家考虑因素（规则推导的确定性列表）。 */
  expertConsiderations: string[]
  /** 本次检索策略记录（标准契约，可选）。 */
  searchStrategy?: SearchStrategy
}
