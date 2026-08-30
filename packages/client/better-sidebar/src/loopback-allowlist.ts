/**
 * The sidebar browser's loopback allowlist matcher, shared by the host
 * (the `browser.probe` route in index.ts) and the client (the address-bar
 * policy in src/client/browser.ts). Entries are comma-separated and matched
 * case-insensitively: bare hosts (`localhost`, `127.0.0.1`) match every
 * port; `host:port` entries match exactly that authority.
 */

/**
 * Parse the loopback allowlist into a matcher predicate over host:port.
 * @param allowlist - comma-separated entries; bare hosts allow every port, `host:port` allows exactly that authority.
 * @returns predicate answering whether one host and port satisfy the allowlist.
 */
export function parseLoopbackAllowlist(allowlist: string): (host: string, port: string) => boolean {
  const entries = allowlist.split(',').map(entry => entry.trim().toLowerCase()).filter(entry => entry !== '')
  const exact = new Set(entries)
  const hosts = new Set<string>()
  for (const entry of entries) {
    if (!entry.includes(':')) hosts.add(entry.replace(/^\[|\]$/g, ''))
  }
  return (host, port) => {
    const key = `${host}:${port}`
    if (exact.has(key) || exact.has(host)) return true
    return port !== '' && hosts.has(host)
  }
}
