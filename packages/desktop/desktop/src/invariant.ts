/**
 * Invariants and error helpers for the desktop shell seam.
 * @module @deepseek-ai/dsh-desktop/invariant
 */

import { DesktopError, type DesktopErrorCode } from './index.ts'

export { DesktopError, type DesktopErrorCode }

/**
 * Assert that a bridge operation is connected, throwing a typed error otherwise.
 * @param connected - whether the bridge socket is currently connected.
 * @param message - operator-facing description.
 * @throws {DesktopError} `bridge-disconnected` when `connected` is false.
 */
export function assertBridgeConnected(connected: boolean, message = 'desktop bridge is not connected'): void {
  if (!connected) throw new DesktopError('bridge-disconnected', message)
}
