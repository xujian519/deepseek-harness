/**
 * Delivered-session detection for the studio auto-switch.
 *
 * The studio may only take the screen when it has something to show, and the
 * apply world (where `conversation.setActiveView` lives) has no read path to
 * the conversation view target. The smallest logged signal that means "this
 * session now has a deliverable" is a successful `document_deliver`
 * registration: the call names the tool and the append-surface result settles
 * its outcome, so one pass over the event window answers the question without
 * rebuilding the studio's own fold.
 */
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import { DOCUMENT_DELIVER_TOOL } from './document-deliverables.ts'

/** The agent-preset id whose sessions the studio follows. */
export const DOCUMENT_PRESET_ID = 'document'

/**
 * Whether one session event window records a successful deliverable registration.
 * @param entries - the contiguous event window of the current session.
 * @returns true once a `document_deliver` call has a non-error append-surface result.
 */
export function hasDeliverRegistration(entries: readonly SessionEventLikeEntry[]): boolean {
  const registrations = new Set<string>()
  for (const entry of entries) {
    if (entry.type !== 'event') continue
    const event = entry.event
    if (event.type === 'tool/call') {
      if (event.data.name === DOCUMENT_DELIVER_TOOL) registrations.add(String(event.data.callId))
      continue
    }
    if (event.type !== 'tool/result' || !isAppendSurfaceEvent(event)) continue
    if (event.data.message.isError === true) continue
    if (registrations.has(String(event.data.message.source.callId))) return true
  }
  return false
}
