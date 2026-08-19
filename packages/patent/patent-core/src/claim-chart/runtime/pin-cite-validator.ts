/**
 * pin-cite 校验（纯函数）：引用必须能在源文中定位 —— 防幻觉引用
 * （claude-for-legal "Every cell pin-cited" 护栏的落地）。
 */

import { normalizeWhitespace, stripWhitespace } from './element-validator.ts'

/** pin-cite 校验结果：成功或失败原因。 */
export type PinCiteCheckResult = { ok: true } | { ok: false; reason: string }

/** "[D1 段[0032] 图3]" / "[D1 段[0032]]"。 */
const PIN_CITE_RE = /^\[(\S+)\s+段\[(\d+)\](?:\s+图(\d+))?\]$/

/** 解析 pin-cite 字符串，格式不匹配时返回 null。 */
function parsePinCite(pinCite: string): RegExpExecArray | null {
  return PIN_CITE_RE.exec(pinCite.trim())
}

/**
 * 纯格式校验（不依赖源文，无条件执行）："[D1 段[0032] 图3]" / "[D1 段[0032]]"。
 * @param pinCite - 待校验的 pin-cite 字符串。
 * @returns 格式校验结果。
 */
export function validatePinCiteFormat(pinCite: string): PinCiteCheckResult {
  if (!parsePinCite(pinCite)) {
    return { ok: false, reason: `pin-cite 格式非法（应为 [文档 段[xxxx] 图n]）: ${pinCite}` }
  }
  return { ok: true }
}

/**
 * 校验 pin-cite 格式并确认段号在源文中存在。
 * @param pinCite - 待校验的 pin-cite 字符串。
 * @param sourceText - 源文全文。
 * @returns 校验结果。
 */
export function validatePinCite(pinCite: string, sourceText: string): PinCiteCheckResult {
  const m = parsePinCite(pinCite)
  const paragraph = m?.[2]
  if (paragraph === undefined) {
    return { ok: false, reason: `pin-cite 格式非法（应为 [文档 段[xxxx] 图n]）: ${pinCite}` }
  }
  if (!normalizeWhitespace(sourceText).includes(`[${paragraph}]`)) {
    return { ok: false, reason: `段号 [${paragraph}] 在源文中不存在` }
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
