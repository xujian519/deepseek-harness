/**
 * src/patent/analysis-report/feature-extract — 权利要求技术特征的确定性抽取。
 *
 * v1 以权利要求为粒度：抽取每个权利要求为一个技术特征，type 由技术领域关键词
 * 启发式判定，importance 由权利要求位置与实质限定长度启发式判定。更细粒度的
 * 要素级拆分由 claim-chart 引擎承担（其 element-validator 保证要素是权利要求
 * 原文的连续子串），本模块与之互补。
 */

import type {
  AnalysisFeatureType,
  ExtractedFeature,
  FeatureImportance,
  FeatureStatistics,
} from './types.ts'

/** 类型判定关键词表：按优先级顺序匹配（先命中先得；"控制/处理/特征"等歧义词不参与）。 */
const TYPE_KEYWORDS: ReadonlyArray<{ type: AnalysisFeatureType; keywords: readonly string[] }> = [
  { type: 'method', keywords: ['方法', '步骤', '工艺', '流程', '检测', '制造', '制备', '判断', '加工'] },
  { type: 'material', keywords: ['材料', '组合物', '配方', '合金', '涂料', '化合物', '聚合物', '混合物', '制剂', '溶液', '助剂'] },
  { type: 'data', keywords: ['数据', '信号', '信息', '算法', '模型', '神经网络', '图像', '指令', '参数'] },
  { type: 'system', keywords: ['系统', '平台', '装置', '设备', '整机'] },
  { type: 'device', keywords: ['部件', '组件', '机构', '构件', '支架', '齿轮', '传感器', '阀', '泵', '壳体'] },
]

/** 类型命中置信度：非 other 命中 0.9，other 回退 0.5。 */
const TYPE_HIT_CONFIDENCE = 0.9
const TYPE_FALLBACK_CONFIDENCE = 0.5
/** 独立权利要求（权 1）之外视为从属，从属需足够实质限定（≥ 该字数）才 medium。 */
const DEPENDENT_SUBSTANTIAL_MIN = 20

/** 依据技术关键词判定特征类型。 */
export function determineFeatureType(text: string): AnalysisFeatureType {
  for (const { type, keywords } of TYPE_KEYWORDS) {
    if (keywords.some(kw => text.includes(kw))) return type
  }
  return 'other'
}

/** 依据权利要求位置与实质限定长度判定重要性。 */
export function determineImportance(claimNo: number, text: string): FeatureImportance {
  if (claimNo === 1) return 'high'
  return text.length >= DEPENDENT_SUBSTANTIAL_MIN ? 'medium' : 'low'
}

/**
 * 从权利要求列表抽取技术特征。
 * @param claims - 权利要求文本数组（1 起 index 对应 claimNo）。
 * @returns 按 claimNo 升序的特征列表。
 */
export function extractTechnicalFeatures(claims: readonly string[]): ExtractedFeature[] {
  return claims.map((text, index) => {
    const claimNo = index + 1
    const type = determineFeatureType(text)
    const importance = determineImportance(claimNo, text)
    const confidence = type === 'other' ? TYPE_FALLBACK_CONFIDENCE : TYPE_HIT_CONFIDENCE
    return { claimNo, text, type, importance, confidence }
  })
}

/**
 * 统计特征分布（byType / byImportance 含全枚举键，0 值也出现）。
 * @param features - 已抽取特征。
 * @returns 分布统计。
 */
export function computeFeatureStatistics(features: readonly ExtractedFeature[]): FeatureStatistics {
  const byType: Record<AnalysisFeatureType, number> = {
    device: 0,
    method: 0,
    material: 0,
    system: 0,
    data: 0,
    other: 0,
  }
  const byImportance: Record<FeatureImportance, number> = { high: 0, medium: 0, low: 0 }

  for (const feature of features) {
    byType[feature.type] += 1
    byImportance[feature.importance] += 1
  }

  return { byType, byImportance, total: features.length }
}
