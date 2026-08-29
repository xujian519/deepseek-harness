/** Pure PDF extension dispatch, separate from React for unit testing.
 * @param ext - file extension including the leading dot.
 * @returns true when the extension names a PDF file.
 */
export function isPdfExt(ext: string): boolean {
  return ext === '.pdf'
}
