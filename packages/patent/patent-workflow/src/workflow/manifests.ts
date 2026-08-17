/**
 * src/patent/workflow — 内置 manifest 数据（7 个 + 目录）。
 *
 * 纯数据常量，零执行依赖。类型契约（WorkflowManifest）来自 dsh-patent-core。
 */

import type { WorkflowManifest } from '@deepseek-ai/dsh-patent-core'

/**
 * 内置：专利新颖性分析五阶段 manifest（镜像 Mady patent_novelty.yaml 与 novelty_chain 模板）。
 */
export const patentNoveltyManifest: WorkflowManifest = {
  id: 'patent_novelty_v1',
  name: '专利新颖性分析',
  caseType: 'novelty_search',
  stages: [
    { id: 'parse', strategy: 'chain', description: '解析技术交底书，提取技术特征' },
    { id: 'search', strategy: 'react', description: '检索现有技术文献' },
    { id: 'compare', strategy: 'chain', description: '逐项对比技术特征与现有技术（单独对比原则）' },
    { id: 'conclude', strategy: 'chain', description: '生成新颖性分析结论（附置信度）' },
    { id: 'approval', strategy: 'chain', description: '人工确认分析结论' },
  ],
  validation: { requireAllSteps: true, maxRetries: 2 },
}

/**
 * 内置：技术交底书披露分析 manifest（移植 Mady disclosure/graph.go 的 PFE 管线）。
 */
export const patentDisclosureManifest: WorkflowManifest = {
  id: 'patent_disclosure_v1',
  name: '技术交底书披露分析',
  caseType: 'disclosure_analysis',
  stages: [
    { id: 'preprocess', strategy: 'chain', description: '预处理技术交底书，分段与去噪' },
    {
      id: 'extract_problem',
      strategy: 'sub_agent',
      description: '提取待解决的技术问题',
      atom: 'extract',
      params: { extraction_type: '提取待解决的技术问题（严格输出 problems 数组）', output_key: 'problems' },
    },
    {
      id: 'extract_features',
      strategy: 'sub_agent',
      description: '提取技术特征',
      atom: 'extract',
      params: { extraction_type: '提取技术特征（严格输出 features 数组）', output_key: 'features' },
    },
    {
      id: 'extract_effects',
      strategy: 'sub_agent',
      description: '提取技术效果',
      atom: 'extract',
      params: { extraction_type: '提取技术效果（严格输出 effects 数组）', output_key: 'effects' },
    },
    { id: 'merge', strategy: 'chain', description: '融合 PFE 三元组（问题↔特征↔效果交叉引用）', atom: 'merge' },
    {
      id: 'groundedness',
      strategy: 'chain',
      description: '评估提取特征在原文中的依据（低分特征反馈）',
      atom: 'groundedness',
    },
    {
      id: 'consistency',
      strategy: 'chain',
      description: 'PFE 一致性检查（特征-效果因果链闭合、无孤立特征）',
      retry: {
        whenOutputMatches: '不一致|矛盾|缺少|孤立',
        rewindTo: 'extract_problem',
        maxRetries: 1,
      },
    },
    { id: 'generate_keywords', strategy: 'chain', description: '生成检索关键词（上位/下位/同义词）', atom: 'keywords' },
    { id: 'search', strategy: 'react', description: '检索现有技术文献（证据片段注入新颖性评估）', atom: 'search' },
    {
      id: 'novelty',
      strategy: 'chain',
      description: '逐特征新颖性初判（单独对比原则 + 证据引用）',
      atom: 'novelty',
    },
    { id: 'report', strategy: 'chain', description: '生成披露分析报告（创新点/保护建议）' },
    {
      id: 'review_gate',
      strategy: 'chain',
      description: '人工复核披露分析报告（中断等待确认）',
      atom: 'approval-gate',
      params: { review_context: '披露分析报告需人工复核后方可继续' },
    },
    {
      id: 'draft_claims',
      strategy: 'chain',
      description: '基于 PFE 与新颖性结果直出权利要求草稿（独立+从属）',
      atom: 'draft-claims',
    },
  ],
  validation: { requireAllSteps: true, maxRetries: 2 },
}

/**
 * 内置：专利创造性分析八阶段 manifest（专利法 A22.3，三步法）。
 */
export const patentInventivenessManifest: WorkflowManifest = {
  id: 'patent_inventiveness_v1',
  name: '专利创造性分析',
  caseType: 'inventiveness_analysis',
  stages: [
    {
      id: 'parse',
      strategy: 'chain',
      description: '解析权利要求/技术方案，构建所属领域技术人员画像，确定申请日/优先权日时间基准',
    },
    {
      id: 'search',
      strategy: 'react',
      description: '检索现有技术文献，筛选最接近现有技术候选（技术领域→技术问题→发明构思）',
    },
    { id: 'closest', strategy: 'chain', description: '三步法 Step1：确定最接近的现有技术（候选多时逐个试判）' },
    {
      id: 'diff',
      strategy: 'chain',
      description: '三步法 Step2：实质对比确定区别技术特征，客观确定实际解决的技术问题（不得包含解决手段）',
    },
    {
      id: 'hint',
      strategy: 'chain',
      description: '三步法 Step3：技术启示判断（改进动机/结合启示/公知常识/发明构思/逻辑推理与有限试验）',
    },
    {
      id: 'secondary',
      strategy: 'chain',
      description: '辅助判断因素复核（预料不到的技术效果/长期渴望难题/克服技术偏见/商业成功）',
    },
    { id: 'conclude', strategy: 'chain', description: '生成创造性结论（高/中/低/无，附置信度）+ 反事后诸葛亮自检' },
    { id: 'approval', strategy: 'chain', description: '人工确认分析结论（HITL）' },
  ],
  validation: { requireAllSteps: true, maxRetries: 2 },
}

/**
 * 内置：可专利性检索与布局 manifest（撰写场景）。
 */
export const patentPatentabilityManifest: WorkflowManifest = {
  id: 'patent_patentability_v1',
  name: '可专利性检索与权利要求布局',
  caseType: 'novelty_search',
  stages: [
    { id: 'parse', strategy: 'chain', description: '解析技术方案与权利要求' },
    {
      id: 'claim-chart',
      strategy: 'chain',
      description: '权利要求要素级映射到最接近现有技术（mode=patentability）',
      atom: 'claim-chart',
      params: { chart_mode: 'patentability' },
    },
    { id: 'draft', strategy: 'chain', description: '基于区别特征布局权利要求（规避 D1）（原子路径不支持，收口模式）' },
    { id: 'approval', strategy: 'chain', description: '人工确认权利要求布局' },
  ],
  validation: { requireAllSteps: true, maxRetries: 2 },
}

/**
 * 内置：审查意见答复 manifest（OA 答复场景）。
 */
export const patentOaResponseManifest: WorkflowManifest = {
  id: 'patent_oa_response_v1',
  name: '审查意见答复',
  caseType: 'oa_response',
  stages: [
    { id: 'parse', strategy: 'chain', description: '解析审查意见与权利要求' },
    {
      id: 'claim-chart',
      strategy: 'chain',
      description: '权利要求要素级映射到审查员引用对比文件（mode=oa-response）',
      atom: 'claim-chart',
      params: { chart_mode: 'oa-response' },
    },
    { id: 'draft', strategy: 'chain', description: '撰写意见陈述书（新颖性陈述 + 三步法，消费 claim-chart）' },
    { id: 'approval', strategy: 'chain', description: '人工确认答复书' },
  ],
  validation: { requireAllSteps: true, maxRetries: 2 },
}

/**
 * 内置：无效宣告/复审答复 manifest（无效/复审双场景）。
 */
export const patentInvalidationManifest: WorkflowManifest = {
  id: 'patent_invalidation_v1',
  name: '无效/复审答复',
  caseType: 'invalidation_analysis',
  stages: [
    { id: 'parse', strategy: 'chain', description: '解析无效请求/驳回决定与权利要求' },
    {
      id: 'claim-chart',
      strategy: 'chain',
      description: '权利要求要素级映射到证据组合（mode=invalidity/reexamination）',
      atom: 'claim-chart',
      params: { chart_mode: 'invalidity' },
    },
    { id: 'novelty', strategy: 'chain', description: '新颖性单独对比（单篇全覆盖）（原子路径不支持，收口模式）' },
    { id: 'inventiveness', strategy: 'chain', description: '三步法创造性分析（原子路径不支持，收口模式）' },
    { id: 'approval', strategy: 'chain', description: '人工确认分析结论' },
  ],
  validation: { requireAllSteps: true, maxRetries: 2 },
}

/**
 * 内置：侵权比对 manifest（侵权场景）。
 */
export const patentInfringementManifest: WorkflowManifest = {
  id: 'patent_infringement_v1',
  name: '侵权比对分析',
  caseType: 'infringement_analysis',
  stages: [
    { id: 'parse', strategy: 'chain', description: '解析权利要求与被控产品材料' },
    {
      id: 'claim-chart',
      strategy: 'chain',
      description: '权利要求要素级映射到被控产品（mode=infringement，支持等同 doe 行）',
      atom: 'claim-chart',
      params: { chart_mode: 'infringement' },
    },
    { id: 'report', strategy: 'chain', description: '生成侵权比对报告（全面覆盖 + 等同 + 现有技术抗辩）' },
    { id: 'approval', strategy: 'chain', description: '人工确认比对结论' },
  ],
  validation: { requireAllSteps: true, maxRetries: 2 },
}

/**
 * 内置 manifest 目录（单一数据源）。
 */
export type BuiltinPatentManifest = {
  manifest: WorkflowManifest
  /** 收口时确定性规则门检查域（caseType 推导的默认值）。 */
  checkDomains: readonly string[]
}

/** 内置 patent workflow manifest 实例清单。 */
export const builtinPatentManifests: readonly BuiltinPatentManifest[] = [
  { manifest: patentNoveltyManifest, checkDomains: ['patent_novelty'] },
  { manifest: patentDisclosureManifest, checkDomains: ['patent_disclosure', 'patent_claims'] },
  { manifest: patentInventivenessManifest, checkDomains: ['patent_inventiveness'] },
  { manifest: patentPatentabilityManifest, checkDomains: ['patent_novelty'] },
  { manifest: patentOaResponseManifest, checkDomains: ['patent_claims', 'patent_inventiveness'] },
  {
    manifest: patentInvalidationManifest,
    checkDomains: ['patent_invalidation', 'patent_novelty', 'patent_inventiveness'],
  },
  { manifest: patentInfringementManifest, checkDomains: ['patent_infringement'] },
]
