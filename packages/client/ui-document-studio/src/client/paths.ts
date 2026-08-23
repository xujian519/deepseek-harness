/**
 * Workspace-relative path helpers for the studio's inject wiring.
 * @module @deepseek-ai/dsh-client-ui-document-studio/client/paths
 */

/**
 * The workspace-relative directory containing one produced file ('' at the workspace root).
 * @param path - Workspace-relative file path, using `/` or `\` separators.
 * @returns The path's parent directory, or '' when the file sits at the workspace root.
 */
export function parentDir(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index === -1 ? '' : path.slice(0, index)
}
