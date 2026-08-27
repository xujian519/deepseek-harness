/**
 * src/patent/analysis-report — barrel。
 *
 * 导出分析产物契约、确定性特征抽取与聚合器，供工具层（dsh-patent-tools）组装
 * pid/model-facing 分析报告。
 */

export type {
  AnalysisFeatureType,
  CheckerFailureSummary,
  ExtractedFeature,
  FeatureImportance,
  FeatureStatistics,
  GraphConclusionSummary,
  IpcSummary,
  KgAnalysisSummary,
  PatentAnalysisReport,
  QualityDomain,
  QualityScore,
  ScoreBasis,
  SearchStrategy,
} from './types.ts'
export type { AnalysisReportInputs, ModelScoreEntry } from './build.ts'
export {
  computeFeatureStatistics,
  determineFeatureType,
  determineImportance,
  extractTechnicalFeatures,
} from './feature-extract.ts'
export {
  buildAnalysisReport,
  computeClarityScore,
  computeCompletenessScore,
  mergeScores,
  toIpcSummary,
} from './build.ts'
