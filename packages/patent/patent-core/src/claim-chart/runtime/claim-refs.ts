/**
 * 权利要求引用关系（纯函数）：从权利要求书原文推出逐权项的独立／从属类型与所引用的
 * 权项号。
 *
 * 引用关系是法律判断的输入，不是模型可填报的字段：从属权利要求的技术方案是所引用权利
 * 要求的全部技术特征与附加技术特征的组合，新颖性、创造性的比对对象都是这个组合。由原文
 * 推出、并由调用方逐条核对，比让模型自己声明"这是从属权项、引用权 1"更可靠。
 *
 * 判定口径：
 * - 带前缀的引用语（`根据权利要求 1 所述`、`如权利要求 2 所述`、`按照权利要求 1-3 所述`）
 *   在权项正文任意位置生效：实践中引言可以很长，引用语也可能落在特征部分。
 * - 不带前缀的 `权利要求 N 所述` 只在该权项的引言部分生效（特征部分之前，或第一句以内），
 *   避免把正文中“装配权利要求 1 所述的装置”这类转述误判为本权项的引用关系。
 * - 概括引用（`前述权利要求中任一项`、`上述权利要求之一`）展开为全部在前权项。
 * - 引用语编号可写为多值或区间（`1或2`、`1、2`、`1-3`、`1至3`）；区间按升序展开为
 *   逐项，供覆盖判定取并集。
 * - 无引用语即独立权利要求。权利要求书无行首编号（单条权项、无编号输入）时返回空数组，
 *   调用方按"引用关系未知"处理，不得据空数组断言全部权项均为独立权利要求。
 */

import type { ClaimRef, ClaimRefIssue } from '../protocol/types.ts'
import { splitClaimSegments } from './element-validator.ts'

/** 区间引用展开的上限：跨度大于它的写法不当作权项区间展开。 */
const RANGE_EXPANSION_LIMIT = 30

/** 行首权项编号前缀（与 element-validator 的切分口径一致）。 */
const CLAIM_NUMBER_PREFIX_RE = /^\s*\d+[.、．]\s*/

/** 编号表达式：多个编号以并列或区间分隔符相连。 */
const REFERENCE_NUMBERS = '[0-9]+(?:\\s*(?:或|和|至|到|、|,|，|～|~|-|－|—)\\s*[0-9]+)*'

/**
 * 带前缀的引用语，在权项正文任意位置生效。捕获组 1 为编号表达式。
 * `按` 不在此列：`按权利要求 1 所述进行装配` 是对方法的转述，不是引用关系。
 */
const PREFIXED_REFERENCE_RE = new RegExp(
  `(?:根据|如|按照|依)\\s*权利要求\\s*(${REFERENCE_NUMBERS})\\s*(?:中任(?:意)?一项|之一)?\\s*所述`,
)

/** 不带前缀的引用语，只在引言部分生效。捕获组 1 为编号表达式。 */
const BARE_REFERENCE_RE = new RegExp(
  `权利要求\\s*(${REFERENCE_NUMBERS})\\s*(?:中任(?:意)?一项|之一)?\\s*所述`,
)

/**
 * 概括引用：`前述权利要求中任一项`、`上述权利要求之一`、`权利要求中任一项`。
 * 不捕获编号：所指范围为调用方给出的全部在前权项。
 */
const CATCH_ALL_REFERENCE_RE =
  /(?:根据|如|按照|依)?\s*(?:(?:前述|上述|在前|前面|以上)(?:的)?)?权利要求\s*(?:中\s*)?(?:任(?:意)?一项|之一)\s*所述/

/** 特征部分起点；在此之前是引言部分。 */
const CHARACTERIZING_MARKER_RE = /其特征在[于於]|其特征是/

/** 无特征部分标记时引言的结束：第一条句末标点。 */
const SENTENCE_END_RE = /[。；]/

/** 编号表达式里的并列分隔符（区间符不在其中，区间要整段识别）。 */
const DISJUNCTION_RE = /\s*[或和、,，]\s*/

/** 区间写法：`1-3`、`1至3`、`1～3`。 */
const RANGE_RE = /^(\d+)\s*(?:至|到|[-－—~～])\s*(\d+)$/

/**
 * 解析编号表达式为权项号集合：并列项逐个取，区间项按升序展开。
 * @param raw - 编号表达式（如 `1或2`、`1-3`）。
 * @returns 升序去重的权项号。
 */
export function parseReferenceNumbers(raw: string): number[] {
  const numbers = new Set<number>()
  for (const token of raw.split(DISJUNCTION_RE)) {
    const trimmed = token.trim()
    if (trimmed.length === 0) continue
    const range = RANGE_RE.exec(trimmed)
    if (range !== null) {
      const from = Number(range[1])
      const to = Number(range[2])
      if (from <= to && to - from <= RANGE_EXPANSION_LIMIT) {
        for (let n = from; n <= to; n += 1) numbers.add(n)
      }
      continue
    }
    if (/^\d+$/.test(trimmed)) numbers.add(Number(trimmed))
  }
  return [...numbers].sort((a, b) => a - b)
}

/**
 * 从权利要求书原文推出逐权项的引用关系。
 * @param claimText - 权利要求原文（可含行首编号，可多条）。
 * @returns 按权项号升序的引用关系；原文无行首编号时为空数组。
 */
export function deriveClaimRefs(claimText: string): ClaimRef[] {
  const segments = [...splitClaimSegments(claimText)].sort((a, b) => a[0] - b[0])
  const claimNos = segments.map(([claimNo]) => claimNo)
  const refs: ClaimRef[] = []
  for (const [claimNo, segment] of segments) {
    const body = segment.replace(CLAIM_NUMBER_PREFIX_RE, '')
    const earlierClaimNos = claimNos.filter(other => other < claimNo)
    const refersTo = findReference(body, earlierClaimNos)?.refersTo ?? []
    refs.push({
      claimNo,
      claimType: refersTo.length > 0 ? 'dependent' : 'independent',
      refersTo,
    })
  }
  return refs
}

/**
 * 在一条权项正文中找引用语：取最早出现的可识别写法。
 *
 * 三种写法同时参与并按出现位置排序，避免"引言里的无前缀引用"遮住后面真正的带前缀引用
 * （或反之）；位置相同即同一起点，取先加入者不影响结果。
 * @param body - 已剥离行首编号的权项正文。
 * @param earlierClaimNos - 编号更小的全部权项号，供概括引用展开。
 * @returns 引用语位置与所引权项号；无引用语时为 undefined。
 */
function findReference(
  body: string,
  earlierClaimNos: readonly number[],
): { index: number; refersTo: number[] } | undefined {
  const candidates: Array<{ index: number; refersTo: number[] }> = []
  const catchAll = CATCH_ALL_REFERENCE_RE.exec(body)
  if (catchAll !== null) candidates.push({ index: catchAll.index, refersTo: [...earlierClaimNos] })
  const prefixed = PREFIXED_REFERENCE_RE.exec(body)
  if (prefixed !== null) candidates.push({ index: prefixed.index, refersTo: parseMatchedNumbers(prefixed) })
  const bare = BARE_REFERENCE_RE.exec(preambleOf(body))
  if (bare !== null) candidates.push({ index: bare.index, refersTo: parseMatchedNumbers(bare) })
  candidates.sort((left, right) => left.index - right.index)
  return candidates[0]
}

/**
 * 提取权项的引言部分：特征部分标记之前，或（无标记时）第一句之内。
 * @param body - 已剥离行首编号的权项正文。
 * @returns 引言部分文本。
 */
function preambleOf(body: string): string {
  const marker = CHARACTERIZING_MARKER_RE.exec(body)
  const end = marker?.index ?? body.search(SENTENCE_END_RE)
  return end >= 0 ? body.slice(0, end) : body
}

/**
 * 读取引用语捕获的编号表达式。
 * @param match - 引用语匹配结果。
 * @returns 升序去重的权项号。
 */
function parseMatchedNumbers(match: RegExpExecArray): number[] {
  /* v8 ignore next -- both reference patterns always capture the number expression. */
  return parseReferenceNumbers(match[1] ?? '')
}

/** 引用关系缺陷（契约见协议层）。 */
export type { ClaimRefIssue } from '../protocol/types.ts'

/**
 * 校验引用关系本身：不得自引用、不得引用不存在的权项、不得引用编号不更小的权项
 * （从属权利要求只能引用在前的权利要求）、不得成环。
 * @param refs - `deriveClaimRefs` 的结果。
 * @returns 缺陷列表；全部合式时为空数组。
 */
export function validateClaimRefs(refs: readonly ClaimRef[]): ClaimRefIssue[] {
  const issues: ClaimRefIssue[] = []
  const known = new Set(refs.map(ref => ref.claimNo))
  for (const ref of refs) {
    if (ref.refersTo.includes(ref.claimNo)) {
      issues.push({ kind: 'self-reference', claimNo: ref.claimNo })
    }
    const missing = ref.refersTo.filter(target => !known.has(target))
    if (missing.length > 0) issues.push({ kind: 'missing-reference', claimNo: ref.claimNo, refersTo: missing })
    // 不存在的引用只报 missing-reference：同一处不再叠报一条编号问题（两类互斥、各自可处置）。
    const later = ref.refersTo.filter(target => known.has(target) && target >= ref.claimNo)
    if (later.length > 0) issues.push({ kind: 'later-reference', claimNo: ref.claimNo, refersTo: later })
  }
  const cycle = findCycle(refs)
  if (cycle !== undefined) issues.push({ kind: 'reference-cycle', claimNos: cycle })
  return issues
}

/**
 * 找出一条引用环（按权项号升序取首条）。自引用已由 `self-reference` 单列，此处不再报环。
 * @param refs - 引用关系。
 * @returns 参与环的权项号；无环时为 undefined。
 */
function findCycle(refs: readonly ClaimRef[]): number[] | undefined {
  const next = new Map<number, number[]>()
  for (const ref of refs) {
    const targets = ref.refersTo.filter(target => target !== ref.claimNo)
    if (targets.length > 0) next.set(ref.claimNo, [...new Set([...(next.get(ref.claimNo) ?? []), ...targets])])
  }
  const visited = new Set<number>()
  const stack: number[] = []
  const walk = (claimNo: number): number[] | undefined => {
    const revisited = stack.indexOf(claimNo)
    if (revisited >= 0) return stack.slice(revisited)
    if (visited.has(claimNo)) return undefined
    visited.add(claimNo)
    stack.push(claimNo)
    for (const target of next.get(claimNo) ?? []) {
      const cycle = walk(target)
      if (cycle !== undefined) return cycle
    }
    stack.pop()
    return undefined
  }
  for (const start of [...next.keys()].sort((a, b) => a - b)) {
    const cycle = walk(start)
    if (cycle !== undefined) return cycle
  }
  return undefined
}

/**
 * 取一条权利要求所引用权项的传递闭包（不含自身）。
 * @param refs - 引用关系。
 * @param claimNo - 起始权项号。
 * @returns 传递引用的权项号，升序去重。
 */
export function referencedClosure(refs: readonly ClaimRef[], claimNo: number): number[] {
  const byClaim = new Map(refs.map(ref => [ref.claimNo, ref.refersTo]))
  const seen = new Set<number>()
  const queue = [...(byClaim.get(claimNo) ?? [])]
  while (queue.length > 0) {
    const next = queue.shift() as number
    if (next === claimNo || seen.has(next)) continue
    seen.add(next)
    queue.push(...(byClaim.get(next) ?? []))
  }
  return [...seen].sort((a, b) => a - b)
}

/**
 * 一条权利要求的替代引用路径。
 *
 * 多项从属权利要求（「根据权利要求 1 或 2」）以择一方式引用在前权项，每个直接引用都是
 * 一个独立技术方案；单一引用只有一条路径。路径按引用闭包展开，因为从属权项包含所引用
 * 权项的全部技术特征。
 * @param refs - 引用关系。
 * @param claimNo - 起始权项号。
 * @returns 每个直接引用一条路径（以该引用开头）；独立权利要求为空数组。
 */
export function referenceAlternatives(refs: readonly ClaimRef[], claimNo: number): number[][] {
  const direct = refs.find(ref => ref.claimNo === claimNo)?.refersTo ?? []
  return direct.map(target => [target, ...referencedClosure(refs, target).filter(value => value !== target)])
}
