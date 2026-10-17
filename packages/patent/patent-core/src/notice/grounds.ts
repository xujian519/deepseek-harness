/**
 * src/patent/notice — 无效、复审、外观设计三类程序的法定理由识别。
 *
 * 输入程序文书正文（无效宣告请求书、驳回决定、复审请求、外观设计无效请求），按各程序
 * 自己的关键词表识别文中援引的法定理由，输出理由、法条依据、中文标签与命中的原文片段。
 * 全部由关键词表完成，不调用模型，不判断理由是否成立。命中片段随结果一并输出，供人工
 * 核对命中处是否被实质论证——关键词表只能回答"文中提到了该条款"。
 *
 * 与上游 Mady `domains/workflows/patent/{invalidation_parse,reexamination}.go` 与
 * `domains/workflows/design/design_invalidation.go` 的差异：
 * - 未匹配到理由时返回空数组。上游在无命中时造一条"新颖性（默认分析维度）"，等于把
 *   文书中不存在的理由当成已提出；本模块不兜底，由调用方按"未识别到具体法条依据"呈现。
 * - 实用新型不删除创造性理由。上游复审在实用新型下剔除创造性理由，但未给出该删除的
 *   依据；本模块保留全部命中项，并把专利权类型作为独立结果输出。
 * - 公开不充分的表述补齐。上游两张表的公开不充分理由只收"公开充分""充分公开""能够
 *   实现"，正文里最常见的"公开不充分"因此漏检，只有同时写出条款号才命中；本模块补入
 *   该写法。反过来说"能够实现"描述的是公开充分，作为公开不充分缺陷的关键词是反向命中，
 *   本模块改收其否定写法（"不能实现""无法实现"）。
 * - 无效理由表补齐客体与其他条款。上游只收 5 项；本模块按《专利权评价报告》表格 220701
 *   的选项表补齐客体（第 2 条、第 5 条、第 25 条）、实用性（第 22 条第 4 款）、必要技术
 *   特征（细则第 23 条第 2 款）、分案超范围（细则第 49 条）与重复授权（第 9 条）。
 *   单一性（第 31 条第 1 款）不在其列，故不收。
 * - 宽词收窄。上游沿用"清楚""支持""客体"这类无边界词，正文里"证据不能支持其主张"
 *   "权利要求的修改超出原有记载"都会命中；本模块把这些词换成有边界的形式（"不清楚"
 *   "得不到说明书支持"等），代价是必须成短语出现，收益是命中即可信。
 *
 * 已知限制：收紧后的表仍可能同时命中语义相邻的两条（如 A5 与 A25 都属客体缺陷）；命中
 * 表示**文书提到了该条款**，不等于该理由在文中被实质论证；用于生成核查清单与实际作业前
 * 须按 `matched` 逐条人工核对。
 */

/** 一类理由及其识别依据。 */
export type GroundPattern<Ground extends string> = {
  /** 理由标识。 */
  ground: Ground
  /** 法条依据，如 `专利法第22条第3款`。 */
  article: string
  /** 中文标签，直接进报告。 */
  label: string
  /** 命中文书任一即算该理由存在（大小写不敏感，按字面匹配）。 */
  patterns: readonly string[]
}

/** 识别到的理由。 */
export type GroundFinding<Ground extends string> = {
  ground: Ground
  article: string
  label: string
  /** 首处命中的原文片段（命中词前后各截一段，空白折叠，截断处加省略号），供人工核对。 */
  matched: string
}

/** 无效宣告的法定理由。 */
export type InvalidationGround =
  | 'novelty'
  | 'inventiveness'
  | 'disclosure'
  | 'claim-clarity'
  | 'amendment'
  | 'subject-matter-art2'
  | 'subject-matter-art5'
  | 'subject-matter-art25'
  | 'utility'
  | 'necessary-features'
  | 'divisional-amendment'
  | 'double-patenting'

/** 无效理由中与驳回决定共有者（复审理由表的取值域不随无效理由表扩充而变）。 */
export type SharedGround = 'novelty' | 'inventiveness' | 'disclosure' | 'claim-clarity' | 'amendment'

/** 复审理由：与驳回决定相关者，另加实用新型客体缺陷。 */
export type ReexaminationGround = SharedGround | 'utility-model-subject-matter'

/** 外观设计无效理由（专利法第23条三款）。 */
export type DesignInvalidationGround =
  | 'not-prior-design'
  | 'conflicting-application'
  | 'prior-right-conflict'

/** 专利权类型；正文未指明且无客体理由时为 `undetermined`。 */
export type PatentSubject = 'invention' | 'utility-model' | 'undetermined'

/** 无效宣告理由表：先列实务最高频的新颖性、创造性，其余按法条顺序。表序即结果顺序。 */
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
    patterns: ['26条第3款', '26.3', '公开不充分', '充分公开', '不能实现', '无法实现'],
  },
  {
    ground: 'claim-clarity',
    article: '专利法第26条第4款',
    label: '权利要求不清楚/得不到支持无效',
    patterns: ['26条第4款', '26.4', '不清楚', '得不到说明书支持', '未得到说明书支持', '缺乏说明书支持'],
  },
  {
    ground: 'amendment',
    article: '专利法第33条',
    label: '修改超范围无效',
    patterns: ['第33条', 'A33', '修改超范围', '超出原说明书', '超出了原说明书', '超出原权利要求', '超范围'],
  },
  {
    ground: 'subject-matter-art2',
    article: '专利法第2条',
    label: '不属于专利法第2条规定客体的无效',
    patterns: ['专利法第2条', '第2条第2款', '第2条第3款', '不属于专利法第2条'],
  },
  {
    ground: 'subject-matter-art5',
    article: '专利法第5条',
    label: '违反法律、社会公德或妨害公共利益无效',
    patterns: ['专利法第5条', '第5条', '社会公德', '妨害公共利益'],
  },
  {
    ground: 'subject-matter-art25',
    article: '专利法第25条',
    label: '属于不授予专利权的范围无效',
    patterns: ['专利法第25条', '第25条', '智力活动的规则和方法', '疾病的诊断和治疗方法', '动物和植物品种'],
  },
  {
    ground: 'utility',
    article: '专利法第22条第4款',
    label: '实用性无效（不具备实用性）',
    patterns: ['22条第4款', '22.4', '实用性', '不具备实用'],
  },
  {
    ground: 'necessary-features',
    article: '专利法实施细则第23条第2款',
    label: '缺少必要技术特征无效',
    patterns: ['细则第23条第2款', '实施细则第23条第2款', '细则第20条第2款', '第20条第2款', '必要技术特征', '缺少必要技术'],
  },
  {
    ground: 'divisional-amendment',
    article: '专利法实施细则第49条',
    label: '分案申请超范围无效',
    patterns: ['细则第49条', '实施细则第49条', '细则第43条第1款', '第43条第1款', '分案申请超', '分案超出'],
  },
  {
    ground: 'double-patenting',
    article: '专利法第9条',
    label: '同样的发明创造重复授权无效',
    patterns: ['专利法第9条', '第9条', '同样的发明创造', '重复授权'],
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
    patterns: ['26条第3款', '26.3', '公开不充分', '充分公开', '不能实现', '无法实现'],
  },
  {
    ground: 'claim-clarity',
    article: '专利法第26条第4款',
    label: '权利要求不清楚/不支持',
    patterns: ['26条第4款', '26.4', '不清楚', '得不到说明书支持', '未得到说明书支持', '缺乏说明书支持'],
  },
  {
    ground: 'amendment',
    article: '专利法第33条',
    label: '修改超范围',
    patterns: ['第33条', 'A33', '修改超范围', '超出原说明书', '超出了原说明书', '超出原权利要求', '超范围'],
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

/** 命中片段向前截取的字数。 */
const MATCH_CONTEXT_BEFORE = 30

/** 命中片段向后截取的字数（自命中词末尾起算）。 */
const MATCH_CONTEXT_AFTER = 40

/** 只写条号、不写法律名的模式；前文若出现另一部法律名，不算命中。 */
const NUMBER_ONLY_PATTERN = /^(?:第)?\d+(?:\.\d+)?(?:条|款)?/

/** 条号前出现另一部法律名的情形（`专利法实施细则第5条` 不是专利法第5条）。 */
const OTHER_LAW_BEFORE = /(?:实施)?细则/

/** 关键词按字面匹配（元字符转义）且不区分大小写。 */
function literalPattern(keyword: string, flags = 'i'): RegExp {
  return new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags)
}

/**
 * 取首处命中及其上下文片段。
 * @param text - 程序文书正文。
 * @param patterns - 该类理由的关键词，按声明顺序取首个命中者。
 * @returns 命中下标与命中词长度；无命中时为 null。
 */
function firstMatch(text: string, patterns: readonly string[]): { index: number; length: number } | null {
  for (const pattern of patterns) {
    if (pattern.length === 0) continue
    const matcher = literalPattern(pattern, 'gi')
    let found = matcher.exec(text)
    while (found !== null) {
      const before = text.slice(Math.max(0, found.index - 20), found.index)
      if (!NUMBER_ONLY_PATTERN.test(pattern) || !OTHER_LAW_BEFORE.test(before)) {
        return { index: found.index, length: found[0].length }
      }
      found = matcher.exec(text)
    }
  }
  return null
}

/**
 * 截取命中处上下文并折叠空白；两端被截断时加省略号。
 * @param text - 原文。
 * @param hit - 命中下标与长度。
 * @returns 供人工核对的原文片段。
 */
function matchContext(text: string, hit: { index: number; length: number }): string {
  const start = Math.max(0, hit.index - MATCH_CONTEXT_BEFORE)
  const end = Math.min(text.length, hit.index + hit.length + MATCH_CONTEXT_AFTER)
  const window = text.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${window}${end < text.length ? '…' : ''}`
}

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
  const findings: GroundFinding<Ground>[] = []
  for (const entry of patterns) {
    const hit = firstMatch(text, entry.patterns)
    if (hit === null) continue
    findings.push({
      ground: entry.ground,
      article: entry.article,
      label: entry.label,
      matched: matchContext(text, hit),
    })
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
