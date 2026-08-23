/**
 * Patch-file helpers for the P1-10 offline campaign: derive the file list a
 * SWE-bench `test_patch` touches, so a prediction patch can exclude agent
 * edits to test files before verification.
 *
 * @module @deepseek-ai/dsh-self-evolve-eval/campaign/patch
 */

/**
 * Parse the file paths a SWE-bench `test_patch` touches. Every unified-diff
 * file starts with a `diff --git a/<path> b/<path>` header; the `b/` side is
 * the file in the test environment. Paths containing spaces are quoted by
 * git (`"a/my file.py"`); the header is unquoted and split at the last ` b/`
 * so spaced paths survive.
 *
 * @param testPatch - the raw test_patch text.
 * @returns unique file paths, in first-appearance order.
 */
export function parseTestPatchFiles(testPatch: string): string[] {
  const files: string[] = []
  for (const line of testPatch.split('\n')) {
    if (!line.startsWith('diff --git ')) continue
    const bare = line.slice('diff --git '.length).replaceAll('"', '')
    const splitAt = bare.lastIndexOf(' b/')
    if (splitAt <= 0) continue
    const path = bare.slice(splitAt + ' b/'.length)
    if (path.length === 0 || files.includes(path)) continue
    files.push(path)
  }
  return files
}
