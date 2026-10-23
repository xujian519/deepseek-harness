/**
 * Section-path containment for the guideline index.
 *
 * A citation to a section covers that section and every subsection under it.
 * Both the verifier and the validity citator decide coverage, so the predicate
 * lives here and nowhere else.
 * @module @deepseek-ai/dsh-patent-law/section-path
 */

/**
 * Whether one section path names the cited section or a section under it.
 * @param cited - the cited normalized section path.
 * @param path - the path to test.
 * @returns true when the path is the cited one or below it.
 */
export function coversSection(cited: string, path: string): boolean {
  if (path === cited) return true
  if (!path.startsWith(cited)) return false
  const rest = path.slice(cited.length)
  // A level inside a section number follows a dot, so 2.10 is not under 2.1. A
  // part or a chapter states the next part, chapter or section number directly,
  // as 第二部分第二章 and 第一部分第一章4.2 do.
  return /\d$/u.test(cited) ? rest.startsWith('.') : /^[第0-9]/u.test(rest)
}
