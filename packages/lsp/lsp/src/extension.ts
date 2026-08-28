/**
 * Internal route-key derivation for the LSP seam: file path → normalized extension.
 * @module Internal route-key derivation for the LSP seam
 */

/**
 * Extract a file's final extension as a normalized, lowercase, leading-dot key (e.g. `Foo.TS` →
 * `.ts`, `foo.d.ts` → `.ts`). Returns `''` for a name with no extension or a leading-dot dotfile
 * (`.bashrc`), which no route ever matches. Splits on both `/` and `\` so a caller's path separator
 * does not change the result.
 * @param filePath - the source path to inspect.
 * @returns the normalized extension, or `''` when there is none.
 */
export function finalExtension(filePath: string): string {
  const lastSlash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  const base = lastSlash >= 0 ? filePath.slice(lastSlash + 1) : filePath
  const dot = base.lastIndexOf('.')
  // dot <= 0 covers both "no dot" (-1) and a leading-dot dotfile (0): neither has an extension.
  if (dot <= 0) return ''
  return base.slice(dot).toLowerCase()
}
