/**
 * 期望 vs 识图：把出图时的标号清单与 `analyze_patent_figure` 的识别结果做确定性
 * 比对，报告缺标、多标、名称不符与图型不符。
 *
 * 纯函数、无模型依赖。闭环由调用方按 `generate → analyze → compare` 串起：生成阶段
 * 的期望是声明值，识图阶段的结果是模型读数，本模块只回答两者是否一致。连接关系
 * 暂不比对：出图输入的边与识图输出的连接在粒度上不对齐，先只对齐标号与图型。
 * @module @deepseek-ai/dsh-patent-tools/figure/figure-comparison
 */

/** 参与比对的一个标号。 */
export type FigureMark = {
  /** 附图标记号（与图面一致）；空串不参与比对。 */
  refNumber: string
  /** 该标号的部件名称。 */
  name: string
}

/** 比对的一侧（期望或识图结果）。 */
export type FigureComparisonSide = {
  /** 图型名称（如 `flowchart`）；两侧都给出时比对。 */
  figureType?: string | undefined
  /** 该侧的标号清单。 */
  components: readonly FigureMark[]
}

/** 比对参数。 */
export type FigureComparisonInput = {
  /** 出图时声明的期望。 */
  expected: FigureComparisonSide
  /** 识图结果。 */
  actual: FigureComparisonSide
}

/** 一条比对发现。 */
export type FigureComparisonFinding = {
  /** 发现类型。 */
  check: 'figure-type-mismatch' | 'missing-mark' | 'unexpected-mark' | 'name-mismatch'
  /** 涉及的标号；图型不符时为空串。 */
  ref: string
  /** 人类可读说明。 */
  message: string
}

/** 比对报告。 */
export type FigureComparisonReport = {
  /** 期望侧的标号数（去重后）。 */
  expectedCount: number
  /** 识图侧的标号数（去重后）。 */
  actualCount: number
  /** 逐条发现，按图型、缺标、多标、名称的顺序排列。 */
  findings: FigureComparisonFinding[]
  /** 文本摘要。 */
  summary: string
  /** 无任何发现。 */
  consistent: boolean
}

/**
 * 按标号归并一侧的标记；同一标号重复出现时保留第一个非空名称。
 * @param side - 期望或识图结果。
 * @returns 标号到名称的映射，按标号排序。
 */
function indexMarks(side: FigureComparisonSide): Map<string, string> {
  const marks = new Map<string, string>()
  for (const component of side.components) {
    const ref = component.refNumber.trim()
    if (ref === '') continue
    const name = component.name.trim()
    const existing = marks.get(ref)
    if (existing === undefined || (existing === '' && name !== '')) marks.set(ref, name)
  }
  return new Map([...marks].sort(([left], [right]) => left.localeCompare(right, 'en', { numeric: true })))
}

/** 两侧图型是否不符：两侧都非空且忽略大小写后不同。输入已 trim。 */
function figureTypeMismatch(expected: string, actual: string): boolean {
  if (expected === '' || actual === '') return false
  return expected.toLowerCase() !== actual.toLowerCase()
}

/**
 * 比对期望与识图结果。
 * @param input - 期望与识图两侧。
 * @returns 逐条发现与摘要；名称只在两侧都非空且不同时算不符。
 */
export function compareFigureAnalysis(input: FigureComparisonInput): FigureComparisonReport {
  const expected = indexMarks(input.expected)
  const actual = indexMarks(input.actual)
  const findings: FigureComparisonFinding[] = []

  const expectedType = input.expected.figureType?.trim() ?? ''
  const actualType = input.actual.figureType?.trim() ?? ''
  if (figureTypeMismatch(expectedType, actualType)) {
    findings.push({
      check: 'figure-type-mismatch',
      ref: '',
      message: `图型不符：期望 ${expectedType}，识图为 ${actualType}`,
    })
  }

  for (const [ref, name] of expected) {
    const recognized = actual.get(ref)
    if (recognized === undefined) {
      findings.push({
        check: 'missing-mark',
        ref,
        message: `标号 ${ref}${name === '' ? '' : `（${name}）`} 在期望中出现，但识图未识别到`,
      })
      continue
    }
    if (name !== '' && recognized !== '' && name !== recognized) {
      findings.push({
        check: 'name-mismatch',
        ref,
        message: `标号 ${ref} 名称不符：期望「${name}」，识图为「${recognized}」`,
      })
    }
  }

  for (const ref of actual.keys()) {
    if (expected.has(ref)) continue
    findings.push({
      check: 'unexpected-mark',
      ref,
      message: `标号 ${ref} 只出现在识图结果中，期望清单里没有`,
    })
  }

  const missing = findings.filter(finding => finding.check === 'missing-mark').length
  const unexpected = findings.filter(finding => finding.check === 'unexpected-mark').length
  const renamed = findings.filter(finding => finding.check === 'name-mismatch').length
  const summary = buildSummary({
    expectedCount: expected.size,
    actualCount: actual.size,
    missing,
    unexpected,
    renamed,
    typeMismatch: findings.length > missing + unexpected + renamed,
  })

  return {
    expectedCount: expected.size,
    actualCount: actual.size,
    findings,
    summary,
    consistent: findings.length === 0,
  }
}

/** 摘要：只报出发生过的事，通过时明说通过。 */
function buildSummary(stats: {
  expectedCount: number
  actualCount: number
  missing: number
  unexpected: number
  renamed: number
  typeMismatch: boolean
}): string {
  const parts = [`期望 ${String(stats.expectedCount)} 个标号，识图 ${String(stats.actualCount)} 个。`]
  if (stats.typeMismatch) parts.push('图型不符。')
  if (stats.missing > 0) parts.push(`缺标 ${String(stats.missing)} 个。`)
  if (stats.unexpected > 0) parts.push(`多标 ${String(stats.unexpected)} 个。`)
  if (stats.renamed > 0) parts.push(`名称不符 ${String(stats.renamed)} 个。`)
  if (!stats.typeMismatch && stats.missing + stats.unexpected + stats.renamed === 0) parts.push('图文比对通过。')
  return parts.join('')
}
