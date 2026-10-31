/**
 * `patent-oas` 交付物的篇幅观测:进记录、不进分数。
 *
 * 为什么要单独一层:rubric 第 5 维现在只查「答复结构完整」,写得再长也不掉分,于是「精简」
 * 在回归读数里没有代价。先把篇幅落成数字(正文可见字符、段落、小节、空节、重复句),跑一轮
 * 看分布,再决定怎么折算进分数——先有读数、后有判据,免得拍一个阈值就把两条基线一起作废。
 *
 * 口径:正文字符数与 `slop-gate`、`tighten` 同一实现(`visibleChars`)。2026-10-31 起 `visibleChars`
 * 自己就剔除载体块(表格与修改后权项全文),本模块的 `proseOnly` 预处理因此不再是「另一套口径」,
 * 只用于把结构统计(空节、表格)与字数统计分开算。此前它得先剔表,否则三张对照表的字会被算进
 * 4000,任何合规答复都被判超预算——那个缺口已在度量实现一侧补上。
 *
 * @module
 */

import { visibleChars } from '@deepseek-ai/dsh-patent-tools'
import { OA_RESPONSE_DRAFT_BUDGET } from '@deepseek-ai/dsh-patent-workflow'

/**
 * 各任务交付物的篇幅预算(正文可见字符,不含表格)。
 *
 * 只登记**有预算**的任务:其余任务的交付物照样计量,只是不判超——给它们编一个预算会让
 * 「超预算」变成与任务无关的常数,读数不再说明任何事。
 */
export const DELIVERABLE_BUDGETS: Readonly<Record<string, number>> = {
  'oa-answer': OA_RESPONSE_DRAFT_BUDGET.total,
}

/**
 * 取某个任务交付物的篇幅预算。
 *
 * @param caseId - 金标 case id。
 * @returns 预算字符数;该任务没有预算时为 `undefined`。
 */
export function budgetOf(caseId: string): number | undefined {
  return DELIVERABLE_BUDGETS[caseId]
}

/** 一次运行交付物的篇幅观测。 */
export interface ConcisionObservation {
  /** 正文可见字符数:剔除 Markdown/HTML 标记、空白与表格后按码点计。 */
  proseChars: number
  /** 该任务的篇幅预算;无预算的任务省略。 */
  budget?: number
  /** 超出预算的字数;未超为 0,无预算时省略。 */
  overBudget?: number
  /** 正文段落数(空行分段,只含纯标题的块不计)。 */
  paragraphs: number
  /** 小节数(一至六级标题)。 */
  sections: number
  /** 空节数:标题之后到下一个标题之前没有任何非空行。 */
  emptySections: number
  /** 重复句数:在正文中出现两次以上的句子个数(去重后按句计,不含表格与标题)。 */
  repeatedSentences: number
}

/** 标题行;捕获组是级别。 */
const HEADING = /^(#{1,6})\s+\S/u

/** 表格行:Markdown 管道行与 HTML 表格标签行。 */
const TABLE_LINE = /^\s*(?:\||<\/?t(?:able|r|d|h)\b)/iu

/** 句子分隔符:中英文句末与分号、换行。 */
const SENTENCE_BREAK = /[。！？!?；;\n]+/u

/** 计入「重复句」的最短长度:太短的句子(「是的」「如上」)重复是正常行文,不算啰嗦。 */
const MIN_REPEATED_SENTENCE = 12

/**
 * 取内容行:剔除围栏代码块,表格保留。
 *
 * 表格是内容(小节里有表格就不是空节),只是不计入篇幅预算——两件事分开,所以这里先只去
 * 代码块,表格的取舍交给调用方。
 *
 * @param text - 交付物原文。
 * @returns 去掉代码块后的行。
 */
function contentLines(text: string): string[] {
  const lines: string[] = []
  let inFence = false
  for (const line of text.split('\n')) {
    if (/^\s*```/u.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    lines.push(line)
  }
  return lines
}

/**
 * 从内容行里再剔除表格行,得到计入篇幅的正文行。
 *
 * 表格行按「以 `|` 开头」或「HTML 表格标签」两种形态识别;交付物是 Markdown 或 HTML 都能走
 * 同一条路径,不必为两种形态各写一份。
 *
 * @param lines - 内容行。
 * @returns 正文行。
 */
function proseOnly(lines: readonly string[]): string[] {
  return lines.filter(line => !TABLE_LINE.test(line))
}

/**
 * 统计标题之外的正文句子,返回出现两次以上的句子个数。
 *
 * 只按去重后的句子个数计,不按「多余次数」计:一句被重复三遍与两句各重复一遍,在「读起来
 * 啰嗦」这件事上是同一档,分开计只会让读数对措辞细节过敏。
 *
 * @param lines - 正文行(已剔除表格)。
 * @returns 重复句个数。
 */
function countRepeatedSentences(lines: readonly string[]): number {
  const seen = new Map<string, number>()
  for (const line of lines) {
    if (HEADING.test(line.trim())) continue
    for (const raw of line.split(SENTENCE_BREAK)) {
      const sentence = raw.replace(/[*_`#>|~\s]/gu, '')
      // 阈值判定用 UTF-16 长度:这里只判「够不够长」,差一两个码元不影响结论,
      // 展开成码点反而会触发 no-misused-spread(那正是把 emoji 拆坏的那种写法)。
      if (sentence.length < MIN_REPEATED_SENTENCE) continue
      seen.set(sentence, (seen.get(sentence) ?? 0) + 1)
    }
  }
  let repeated = 0
  for (const count of seen.values()) if (count > 1) repeated += 1
  return repeated
}

/**
 * 统计段落数。
 *
 * 只数正文段落:表格本身不算段落(它是表格),而一份只有表格的小节也不该让段落数虚增。
 *
 * @param lines - 正文行(已剔除表格)。
 * @returns 段落数。
 */
function countParagraphs(lines: readonly string[]): number {
  let paragraphs = 0
  let blockHasProse = false
  for (const line of lines) {
    if (line.trim().length === 0) {
      if (blockHasProse) paragraphs += 1
      blockHasProse = false
      continue
    }
    if (HEADING.test(line.trim())) continue
    blockHasProse = true
  }
  if (blockHasProse) paragraphs += 1
  return paragraphs
}

/**
 * 统计小节结构与空节数。
 *
 * 一级标题当作文书标题而不是小节:答复书的第一行永远是「# 意见陈述书」,把它算成小节会让
 * 每份交付物都凭空多一个「空节」——标题下面直接接小节标题是正常版式,不是空话。
 *
 * 「空节」按**同层之后**判:标题与下一个同级或更高级标题之间没有任何内容才算空。两处判据
 * 都是被真实交付物纠正出来的:只看到「下一个标题」就判空,会把「父节只有子节」(「## 三、
 * 关于 A33」下直接排 3.1–3.5)整片误判成空节;只看正文行就判空,会把「小节里只有一张对照
 * 表」也判成空节,而那张表就是这一节的结论。
 *
 * @param lines - 内容行(保留表格)。
 * @returns 小节数与空节数。
 */
function countStructure(lines: readonly string[]): { sections: number; emptySections: number } {
  let sections = 0
  let emptySections = 0
  const open: { level: number; hasContent: boolean }[] = []
  const closeDownTo = (level: number): void => {
    while (open.length > 0 && (open.at(-1)?.level ?? 0) >= level) {
      const frame = open.pop()
      if (frame !== undefined && !frame.hasContent) emptySections += 1
    }
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const heading = HEADING.exec(trimmed)
    if (heading !== null) {
      const level = heading[1]?.length ?? 1
      closeDownTo(level)
      if (level > 1) {
        sections += 1
        open.push({ level, hasContent: false })
      }
      continue
    }
    // 内容归它所在的那一节,也归所有上层节:子节有内容,父节就不算空。
    for (const frame of open) frame.hasContent = true
  }
  closeDownTo(1)
  return { sections, emptySections }
}

/**
 * 观测一份交付物的篇幅。
 *
 * 只做计量,不做判定:超没超预算记成 `overBudget`,要不要因此扣分是 rubric 的事。
 *
 * @param text - 交付物原文。
 * @param budget - 该任务的篇幅预算;省略表示只计量不判超。
 * @returns 一条篇幅观测。
 */
export function observeConcision(text: string, budget?: number): ConcisionObservation {
  const content = contentLines(text)
  const prose = proseOnly(content)
  const proseChars = visibleChars(prose.join('\n'))
  const structure = countStructure(content)
  return {
    proseChars,
    ...budget === undefined ? {} : { budget, overBudget: Math.max(0, proseChars - budget) },
    paragraphs: countParagraphs(prose),
    ...structure,
    repeatedSentences: countRepeatedSentences(prose),
  }
}

/** 汇总篇幅观测所需的记录切片:只读 case id 与逐轮观测,不依赖门禁的记录类型。 */
export interface ConcisionSource {
  cases: readonly {
    caseId: string
    rounds?: readonly { round: number; concision?: readonly ConcisionObservation[] }[]
    concision?: readonly ConcisionObservation[]
  }[]
}

/**
 * 把一条记录里的篇幅观测汇成一行,供采集器打印。
 *
 * 只看**终局轮**:rubric 门禁也只判最后一轮,拿第 1 轮的字数去读「这份答复有多长」会读到
 * 一份已被修改过的初稿。单轮 case 没有逐轮观测,读数记在 case 上,取法相同。
 *
 * @param record - run 记录(或其切片)。
 * @returns 一行摘要;记录里没有任何篇幅观测时为 `undefined`。
 */
export function formatConcision(record: ConcisionSource): string | undefined {
  const chunks: string[] = []
  for (const runCase of record.cases) {
    const observations = runCase.rounds?.at(-1)?.concision ?? runCase.concision ?? []
    if (observations.length === 0) continue
    const chars = observations.map(observation => observation.proseChars).join('／')
    const paragraphs = observations.map(observation => observation.paragraphs).join('／')
    const emptySections = observations.map(observation => observation.emptySections).join('／')
    const repeated = observations.map(observation => observation.repeatedSentences).join('／')
    const budget = observations[0]?.budget
    const over = observations.filter(observation => (observation.overBudget ?? 0) > 0).length
    const budgetNote = budget === undefined
      ? '无预算'
      : `预算 ${budget}${over > 0 ? `,超 ${over}/${observations.length} 次` : ',未超'}`
    chunks.push(`${runCase.caseId} 终局 正文 ${chars} 字｜段落 ${paragraphs}｜空节 ${emptySections}｜重复句 ${repeated}(${budgetNote})`)
  }
  if (chunks.length === 0) return undefined
  return `篇幅观测（只记录、不计分）: ${chunks.join('; ')}`
}
