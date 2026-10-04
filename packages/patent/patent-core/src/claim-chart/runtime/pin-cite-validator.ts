/**
 * pin-cite 校验（纯函数）：引用必须能在源文中定位 —— 防幻觉引用
 * （claude-for-legal "Every cell pin-cited" 护栏的落地）。
 */

import { normalizeWhitespace, stripWhitespace } from './element-validator.ts'

/** pin-cite 校验结果；`ok: false` 携带失败原因。 */
export type PinCiteCheckResult = { ok: true } | { ok: false; reason: string }

/**
 * 合法的 pin-cite 写法（纯格式，不依赖源文）。接受模型的实际产出：
 * 文档 id 可含空格（`产品 A`）；段号可写范围（`[0032]-[0034]`，也接受 `–`/`~`）；
 * "图" 前后空白任选；多图用 `、`/`,`/`，` 分隔。`[D1 段[0032] 图3]` 仍是最窄写法。
 * 组 1=文档 id，组 2=起始段号，组 3=范围结束段号（无范围时为 undefined）。
 */
const PIN_CITE_RE =
  /^\[([^[\]]+?)\s+段\s*\[(\d+)\](?:\s*[-–~]\s*\[(\d+)\])?(?:\s*图\s*\d+(?:\s*[、,，]\s*图?\s*\d+)*)?\]$/

/**
 * 源文使用 `[xxxx]`（3–4 位）形式的段号标记。Google Patents 一类的转存文本没有
 * 这种标记，此时段号存在性核对无从执行。
 *
 * 判定是启发式的，两个方向都会误判：源文出现任何同形文本（如年份 `[2024]`）就进入
 * 核对，把"核对不了"变成"核对不通过"；段号写成 5 位的源文则退化为跳过核对。引用
 * 本身仍由 {@link verifyQuoteInSource} 逐字兜底。
 */
const PARAGRAPH_MARKER_RE = /\[\d{3,4}\]/

/** 解析 pin-cite 字符串，格式不匹配时返回 null。 */
function parsePinCite(pinCite: string): RegExpExecArray | null {
  return PIN_CITE_RE.exec(pinCite.trim())
}

/** 格式非法时的失败原因：附正确写法示例，让产出方无需另查文档即可纠正。 */
function formatReason(pinCite: string): string {
  return `pin-cite 格式非法: ${pinCite}（应为 [文档id 段[xxxx] 图n]，例如 [D1 段[0032] 图3]；文档 id 可含空格如 [产品 A 段[0001]]，段号可写范围如 [D1 段[0032]-[0034]]，多图写作 [D1 段[0032] 图3、图4]）`
}

/**
 * 纯格式校验（不依赖源文，无条件执行）："[D1 段[0032] 图3]" / "[D1 段[0032]]" /
 * "[产品 A 段[0001]]" / "[D1 段[0032]-[0034]]" / "[D1 段[0032] 图3、图4]"。
 * 只判写法，不核对段号是否存在（没有源文可核对）。
 * @param pinCite - 待校验的 pin-cite 字符串。
 * @returns 格式校验结果。
 */
export function validatePinCiteFormat(pinCite: string): PinCiteCheckResult {
  if (!parsePinCite(pinCite)) {
    return { ok: false, reason: formatReason(pinCite) }
  }
  return { ok: true }
}

/**
 * 校验 pin-cite 格式，并在源文按 `[xxxx]` 标记段号时核对这些段号存在。
 *
 * 存在性核对是条件性的：源文（如 Google Patents 转存文本）没有 `[xxxx]` 标记时，
 * 任何段号都无从核对，此时跳过核对并返回通过，而不是判失败 —— 把"核对不了"
 * 当成"核对不通过"会让护栏本身变成失败源。引用是否落在源文里，由同行的
 * {@link verifyQuoteInSource} 逐字引用核对兜底。
 * @param pinCite - 待校验的 pin-cite 字符串。
 * @param sourceText - 源文全文。
 * @returns 校验结果；跳过存在性核对时与核对通过同为 `{ ok: true }`。
 */
export function validatePinCite(pinCite: string, sourceText: string): PinCiteCheckResult {
  const m = parsePinCite(pinCite)
  const paragraph = m?.[2]
  if (paragraph === undefined) {
    return { ok: false, reason: formatReason(pinCite) }
  }
  const normalized = normalizeWhitespace(sourceText)
  if (!PARAGRAPH_MARKER_RE.test(normalized)) {
    return { ok: true }
  }
  const rangeEnd = m?.[3]
  const cited = rangeEnd === undefined ? [paragraph] : [paragraph, rangeEnd]
  const missing = cited.find(p => !normalized.includes(`[${p}]`))
  if (missing !== undefined) {
    return { ok: false, reason: `段号 [${missing}] 在源文中不存在` }
  }
  return { ok: true }
}

/**
 * quote 剥离全部空白后必须是源文子串（空引用放行；容忍 PDF 提取的换行/多空格折行）。
 * @param quote - 引用文本。
 * @param sourceText - 源文全文。
 * @returns 校验结果：ok 与失败原因。
 */
export function verifyQuoteInSource(quote: string, sourceText: string): { ok: boolean; reason: string } {
  const q = stripWhitespace(quote)
  if (q.length === 0) return { ok: true, reason: '' }
  const ok = stripWhitespace(sourceText).includes(q)
  return { ok, reason: ok ? '' : `引用文本在源文中不存在: "${q.slice(0, 50)}…"` }
}
