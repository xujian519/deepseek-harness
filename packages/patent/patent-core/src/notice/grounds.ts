/**
 * src/patent/notice — 无效、复审、外观设计三类程序的法定理由识别。
 *
 * 输入程序文书正文（无效宣告请求书、驳回决定、复审请求、外观设计无效请求），按各程序
 * 自己的关键词表识别文中援引的法定理由，输出理由、法条依据与中文标签。全部由关键词表
 * 完成，不调用模型，不判断理由是否成立。
 *
 * 与上游 Mady `domains/workflows/patent/{invalidation_parse,reexamination}.go` 与
 * `domains/workflows/design/design_invalidation.go` 的差异：
 * - 未匹配到理由时返回空数组。上游在无命中时造一条"新颖性（默认分析维度）"，等于把
 *   文书中不存在的理由当成已提出；本模块不兜底，由调用方按"未识别到具体法条依据"呈现。
 * - 实用新型不删除创造性理由。上游复审在实用新型下剔除创造性理由，但未给出该删除的
 *   依据；本模块保留全部命中项，并把专利权类型作为独立结果输出。
 * - 公开不充分的表述补齐。上游两张表的公开不充分理由只收"公开充分""充分公开""能够
 *   实现"，正文里最常见的"公开不充分"因此漏检，只有同时写出条款号才命中；本模块
 *   补入该写法。
 *
 * 已知限制：各表沿用上游的关键词（含"清楚""支持"这类宽词），命中表示**文书提到了该
 * 条款**，不等于该理由在文中被实质论证；用于生成核查清单与实际作业前须人工核对。
 */

/** 一类理由及其识别依据。 */
export type GroundPattern<Ground extends string> = {
  /** 理由标识。 */
  ground: Ground
  /** 法条依据，如 `专利法第22条第3款`。 */
  article: string
  /** 中文标签，直接进报告。 */
  label: string
  /** 命中文书任一即算该理由存在（大小写不敏感）。 */
  patterns: readonly string[]
}

/** 识别到的理由。 */
export type GroundFinding<Ground extends string> = {
  ground: Ground
  article: string
  label: string
}

/** 无效宣告的法定理由（专利法第22条第2款/第3款、第26条第3款/第4款、第33条）。 */
export type InvalidationGround =
  | 'novelty'
  | 'inventiveness'
  | 'disclosure'
  | 'claim-clarity'
  | 'amendment'

/** 复审理由：无效理由中与驳回决定相关者，另加实用新型客体缺陷。 */
export type ReexaminationGround = InvalidationGround | 'utility-model-subject-matter'

/** 外观设计无效理由（专利法第23条三款）。 */
export type DesignInvalidationGround =
  | 'not-prior-design'
  | 'conflicting-application'
  | 'prior-right-conflict'

/** 专利权类型；正文未指明且无客体理由时为 `undetermined`。 */
export type PatentSubject = 'invention' | 'utility-model' | 'undetermined'

/** 无效宣告理由表，表序即结果顺序。 */
const INVALIDATION_GROUND_PATTERNS: readonly GroundPattern<InvalidationGround>[] = [
  {
    ground: 'novelty',
    article: '专利法第22条第2款',
    label: '新颖性无效（不具备新颖性）',
    patterns: ['22条第2款', '22.2', '新颖性', '不具备新颖'],
  },
  {
    ground: 'inventiveness',
    article: '专利法第22条第3款',
    label: '创造性无效（不具备创造性）',
    patterns: ['22条第3款', '22.3', '创造性', '不具备创造'],
  },
  {
    ground: 'disclosure',
    article: '专利法第26条第3款',
    label: '公开不充分无效',
    patterns: ['26条第3款', '26.3', '公开不充分', '公开充分', '充分公开', '能够实现'],
  },
  {
    ground: 'claim-clarity',
    article: '专利法第26条第4款',
    label: '权利要求不清楚/得不到支持无效',
    patterns: ['26条第4款', '26.4', '清楚', '支持'],
  },
  {
    ground: 'amendment',
    article: '专利法第33条',
    label: '修改超范围无效',
    patterns: ['第33条', 'A33', '修改超范围', '超出原'],
  },
]

/** 复审理由表，表序即结果顺序。 */
const REEXAMINATION_GROUND_PATTERNS: readonly GroundPattern<ReexaminationGround>[] = [
  {
    ground: 'novelty',
    article: '专利法第22条第2款',
    label: '新颖性缺陷',
    patterns: ['22条第2款', '22.2', '新颖性', '不具备新颖'],
  },
  {
    ground: 'inventiveness',
    article: '专利法第22条第3款',
    label: '创造性缺陷',
    patterns: ['22条第3款', '22.3', '创造性', '不具备创造', '显而易见'],
  },
  {
    ground: 'disclosure',
    article: '专利法第26条第3款',
    label: '公开不充分',
    patterns: ['26条第3款', '26.3', '公开不充分', '公开充分', '充分公开', '能够实现'],
  },
  {
    ground: 'claim-clarity',
    article: '专利法第26条第4款',
    label: '权利要求不清楚/不支持',
    patterns: ['26条第4款', '26.4', '清楚', '不支持'],
  },
  {
    ground: 'amendment',
    article: '专利法第33条',
    label: '修改超范围',
    patterns: ['第33条', 'A33', '修改超范围', '超出原'],
  },
  {
    ground: 'utility-model-subject-matter',
    article: '专利法第2条第3款',
    label: '实用新型客体缺陷',
    patterns: ['第2条第3款', '2.3', '客体', '不属于实用新型'],
  },
]

/** 外观设计无效理由表，表序即结果顺序。 */
const DESIGN_GROUND_PATTERNS: readonly GroundPattern<DesignInvalidationGround>[] = [
  {
    ground: 'not-prior-design',
    article: '专利法第23条第1款',
    label: '外观设计不属于现有设计',
    patterns: ['23条第1款', '23.1', '现有设计', '不属于现有设计'],
  },
  {
    ground: 'conflicting-application',
    article: '专利法第23条第2款',
    label: '外观设计抵触申请',
    patterns: ['23条第2款', '23.2', '抵触申请', '冲突申请'],
  },
  {
    ground: 'prior-right-conflict',
    article: '专利法第23条第3款',
    label: '外观设计与在先合法权利冲突',
    patterns: ['23条第3款', '23.3', '在先权利', '商标权', '著作权', '合法权利冲突'],
  },
]

/**
 * 按关键词表扫描文书，每条至多命中一次。
 * @param text - 程序文书正文。
 * @param patterns - 理由表。
 * @returns 命中的理由，按表序；无命中时为空数组。
 */
function scanGroundPatterns<Ground extends string>(
  text: string,
  patterns: readonly GroundPattern<Ground>[],
): GroundFinding<Ground>[] {
  const loweredText = text.toLowerCase()
  const findings: GroundFinding<Ground>[] = []
  for (const entry of patterns) {
    const hit = entry.patterns.some(pattern => loweredText.includes(pattern.toLowerCase()))
    if (hit) findings.push({ ground: entry.ground, article: entry.article, label: entry.label })
  }
  return findings
}

/**
 * 识别无效宣告请求援引的法定理由。
 * @param text - 无效宣告请求书或无效决定正文。
 * @returns 命中的理由，按 `INVALIDATION_GROUND_PATTERNS` 表序；无命中时为空数组。
 */
export function identifyInvalidationGrounds(text: string): GroundFinding<InvalidationGround>[] {
  return scanGroundPatterns(text, INVALIDATION_GROUND_PATTERNS)
}

/**
 * 识别驳回决定或复审请求援引的理由。
 * @param text - 驳回决定或复审请求正文。
 * @returns 命中的理由，按 `REEXAMINATION_GROUND_PATTERNS` 表序；无命中时为空数组。
 */
export function identifyReexaminationGrounds(text: string): GroundFinding<ReexaminationGround>[] {
  return scanGroundPatterns(text, REEXAMINATION_GROUND_PATTERNS)
}

/**
 * 识别外观设计无效请求援引的理由。
 * @param text - 外观设计无效请求书正文。
 * @returns 命中的理由，按 `DESIGN_GROUND_PATTERNS` 表序；无命中时为空数组。
 */
export function identifyDesignGrounds(text: string): GroundFinding<DesignInvalidationGround>[] {
  return scanGroundPatterns(text, DESIGN_GROUND_PATTERNS)
}

/**
 * 判定专利权类型。
 *
 * 判定顺序：正文出现"实用新型"即为实用新型；否则出现"发明"即为发明；否则若已识别到
 * 实用新型客体缺陷理由，按实用新型处理；都不满足时为 `undetermined`。上游在后两种
 * 情形以外一律按发明处理，等于替文书认定了一个它没有说明的事实。
 * @param text - 程序文书正文。
 * @param grounds - 已识别的复审理由，用于客体缺陷这一间接信号。
 * @returns 专利权类型。
 */
export function detectPatentSubject(
  text: string,
  grounds: readonly GroundFinding<ReexaminationGround>[] = [],
): PatentSubject {
  const loweredText = text.toLowerCase()
  if (loweredText.includes('实用新型')) return 'utility-model'
  if (loweredText.includes('发明')) return 'invention'
  if (grounds.some(ground => ground.ground === 'utility-model-subject-matter')) {
    return 'utility-model'
  }
  return 'undetermined'
}
