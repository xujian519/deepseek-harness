/**
 * 一致性回退信号判定（graph adapter 的 retry 条件边与 workflow 执行器的
 * 一致性重试循环共用）。
 */

/** 否定词窗口：命中位置前 12 字符内出现 [不未无没] 且无句界分隔 → 否定表述，不触发回退。
 * @param text - 待判定文本。
 * @param signal - 已编译的信号正则（带 g 标志）。
 * @returns 是否触发回退（命中且非否定语境）。
 */
export function signalMatches(text: string, signal: RegExp): boolean {
  let match: RegExpExecArray | null
  const RE = /[不未无没]/
  signal.lastIndex = 0 // 带 g 标志的正则跨调用保留 lastIndex：回退重入前必须重置，否则 exec 直接返回 null
  while ((match = signal.exec(text)) !== null) {
    const start = Math.max(0, match.index - 12)
    const before = text.slice(start, match.index)
    if (!before.includes('。') && !before.includes('；') && !before.includes(';') && !RE.test(before)) {
      return true
    }
    if (match[0].length === 0) signal.lastIndex += 1
  }
  return false
}

/**
 * 编译信号正则（g 标志必需：signalMatches 用 exec 遍历全部匹配位置，无 g 时 exec 每次从头匹配 → 死循环）。
 * @param pattern - 信号正则模式。
 * @returns 带 gi 标志的编译正则。
 */
export function compileSignal(pattern: string): RegExp {
  return new RegExp(pattern, 'gi')
}
