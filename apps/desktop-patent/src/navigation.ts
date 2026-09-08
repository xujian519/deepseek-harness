/**
 * Renderer navigation policy for the desktop shell: the window may only
 * navigate within the backend origin, compared exactly rather than by prefix
 * so a look-alike host such as `127.0.0.1.evil.com` stays outside.
 * @module @deepseek-ai/dsh-desktop-electron/navigation
 */

/** Whether a URL belongs to the given origin (exact scheme, host, and port). */
export function isWithinBackendOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin
  } catch {
    // Unparseable URLs cannot belong to the backend origin and must not load.
    return false
  }
}
