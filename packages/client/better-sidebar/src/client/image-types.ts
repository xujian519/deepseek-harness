/** Image extension dispatch, separate from React for unit testing. */
export const IMAGE_EXTENSIONS = [
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif',
] as readonly string[]

/** Image extension dispatch, separate from React for unit testing.
 * @param ext - file extension including the leading dot.
 * @returns true when the extension names a renderable image.
 */
export function isImageExt(ext: string): boolean {
  return IMAGE_EXTENSIONS.includes(ext)
}
