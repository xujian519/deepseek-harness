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
    {
      id: 'approval',
      strategy: 'chain',
      description: '人工确认分析结论',
      atom: 'approval-gate',
      params: { review_context: '新颖性分析结论需人工确认后方可交付' },
    },
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
    {
      id: 'slop_clean',
      strategy: 'chain',
      description: '反套话评分门（未通过自动带证据提示回退权利要求修订）',
      atom: 'slop-gate',
      retry: {
        whenOutputMatches: '需修订',
        rewindTo: 'draft_claims',
        maxRetries: 1,
      },
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
    {
      id: 'closest',
      strategy: 'chain',
      description: '三步法 Step1：确定最接近的现有技术（候选多时逐个试判）',
      guidance:
        '边界条件：现有技术证据缺失时，基于技术领域与权利要求主题推断合理的最接近现有技术作为对比基准，并明示其公开了哪些特征；不得仅凭方案复杂或参数特殊直接断定具备创造性——已知手段的简单变体且无预料不到效果时，倾向不具备创造性。',
    },
    {
      id: 'diff',
      strategy: 'chain',
      description: '三步法 Step2：实质对比确定区别技术特征，客观确定实际解决的技术问题（不得包含解决手段）',
      guidance:
        '实际解决的技术问题基于区别特征的客观作用重新确定，区别于说明书记载的发明目的；技术问题不得是区别特征本身，也不得包含对该特征的指引。',
    },
    {
      id: 'hint',
      strategy: 'chain',
      description: '三步法 Step3：技术启示判断（改进动机/结合启示/公知常识/发明构思/逻辑推理与有限试验）',
      guidance:
        '边界条件：①软件/算法/网络方案——区别特征仅为已知逻辑或流程的简单重组且无显著技术效果，或对标准协议的非标准修改但未克服技术障碍时，倾向不具备创造性；不得把非标准或看似复杂的配置误认为创造性特征。②组合方案——依次判断：区别特征是否属于公知常识、本领域技术人员是否有动机将其结合到最接近现有技术、是否存在阻止结合的相反教导；存在相反教导或结合并非显而易见时，倾向具备创造性。',
    },
    {
      id: 'secondary',
      strategy: 'chain',
      description: '辅助判断因素复核（预料不到的技术效果/长期渴望难题/克服技术偏见/商业成功）',
    },
    { id: 'conclude', strategy: 'chain', description: '生成创造性结论（高/中/低/无，附置信度）+ 反事后诸葛亮自检' },
    {
      id: 'approval',
      strategy: 'chain',
      description: '人工确认分析结论（HITL）',
      atom: 'approval-gate',
      params: { review_context: '创造性分析结论需人工确认后方可交付' },
    },
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
    {
      id: 'approval',
      strategy: 'chain',
      description: '人工确认权利要求布局',
      atom: 'approval-gate',
      params: { review_context: '权利要求布局需人工确认后方可交付' },
    },
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
    {
      id: 'parse',
      strategy: 'chain',
      description: '解析审查意见与权利要求',
      guidance: [
        '先解析驳回理由类型，再定主策略。类型对照表：',
        '- A-充分公开（专利法26.3）：说明书未清楚完整说明 → 举证实施例、实验数据与本领域可实现性',
        '- B-不清楚/不支持（26.4）：权利要求不清楚或得不到说明书支持 → 从说明书中找对应记载做支持性论证',
        '- C-新颖性（22.2）：被单篇对比文件公开 → 找出未公开的区别特征，坚持单篇单独对比',
        '- D-创造性（22.3）：现有技术组合显而易见 → 走三步法论证非显而易见性',
        '- E-实用性（22.4）：不能制造或使用 → 举证工业化实施可能性',
        '- F-客体（25条/第5条）：不授权客体 → 论证构成技术方案且产生技术效果',
        '多种类型并存时，以最核心的驳回理由确定主策略，其余逐条处理。',
      ].join('\n'),
    },
    {
      id: 'claim-chart',
      strategy: 'chain',
      description: '权利要求要素级映射到审查员引用对比文件（mode=oa-response）',
      atom: 'claim-chart',
      params: { chart_mode: 'oa-response' },
    },
    {
      id: 'draft',
      strategy: 'chain',
      description: '撰写意见陈述书（新颖性陈述 + 三步法，消费 claim-chart）',
      guidance: [
        '答复方向四选一并说明理由：①纯争辩（不修改）——事实认定有误/结合无技术启示/区别特征认定错误；②修改+争辩——将从属特征并入独权即可克服；③混合策略——重写权利要求（增补区别特征/重新划界）并争辩剩余争议；④放弃答复——缺陷无法克服（如公开不充分涉及全部实施例），须明示当事人。',
        '三步法争辩：第一步锁定最接近现有技术；第二步逐条列出区别特征，按其客观作用确定实际解决的技术问题（不得包含区别特征自身的指引）；第三步反驳结合启示与公知常识认定，强调预料不到的技术效果。',
        '撰写规范：逐条答复每项被驳权利要求；引用对比文件具体段落指出区别；修改时在答复书中列出修改后权利要求全文且不得超出原记载范围（A33）；禁止编造实验数据，禁止无逻辑链的空泛断言。',
        '输出小节按序：驳回类型 → 答复策略 → 逐条答复 → 修改对照（如有）→ 结论。',
      ].join('\n'),
    },
    {
      id: 'approval',
      strategy: 'chain',
      description: '人工确认答复书',
      atom: 'approval-gate',
      params: { review_context: '答复书需人工确认后方可交付' },
    },
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
    {
      id: 'approval',
      strategy: 'chain',
      description: '人工确认分析结论',
      atom: 'approval-gate',
      params: { review_context: '无效/复审分析结论需人工确认后方可交付' },
    },
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
    {
      id: 'report',
      strategy: 'chain',
      description: '生成侵权比对报告（全面覆盖 + 等同 + 现有技术抗辩）',
      guidance: [
        '报告结构：权利要求解释与保护范围界定 → 逐项特征比对表 → 全面覆盖判断 → 等同分析（仅在有差异特征时）→ 结论。',
        '等同按手段-功能-效果三要素逐项检验，并核查三项限制：①禁止反悔——审查历史中放弃的内容不得以等同重新纳入；②捐献规则——说明书有记载但未写入权利要求的方案视为捐献；③现有技术抗辩成立时不构成侵权。',
        '方法专利从严：步骤顺序变化或触发条件不同往往导致手段或效果实质不同；省略特征致技术效果实质变化的不认定等同。',
        '结论必须包含风险等级（高/中/低）与置信度。',
      ].join('\n'),
    },
    {
      id: 'approval',
      strategy: 'chain',
      description: '人工确认比对结论',
      atom: 'approval-gate',
      params: { review_context: '侵权比对结论需人工确认后方可交付' },
    },
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
