/**
 * Listener dispatch for the session publication events. Both the append path
 * and the store's lifecycle emissions resolve one listener snapshot and invoke
 * it with per-listener containment, so the two share this module.
 *
 * @module @deepseek-ai/dsh-session/observers
 */

import type { Context } from '@deepseek-ai/cordis'
import { invokeContained } from '@deepseek-ai/dsh-contained-emit'
import { errorMessage } from '@deepseek-ai/dsh-value'
import type { SessionId } from './types.ts'

/** One resolved listener from a `session/*` dispatch. */
export type SessionCallback = (...args: unknown[]) => unknown

/**
 * Resolve one listener snapshot, including Cordis's internal dispatch checks.
 * @param ctx - the context whose `session/*` listeners are resolved.
 * @param args - the dispatch arguments (`this`, event name, payload).
 * @returns the resolved callbacks, in registration order.
 */
export function collectSessionCallbacks(ctx: Context, args: unknown[]): SessionCallback[] {
  return [...ctx.events.dispatch('emit', args)] as SessionCallback[]
}

/**
 * Invoke one resolved observe-only listener snapshot with per-listener
 * containment.
 * @param ctx - the context whose logger receives contained listener failures.
 * @param name - the event being dispatched, for the failure label.
 * @param id - the session the event belongs to, for the failure label.
 * @param args - the dispatch arguments every callback receives.
 * @param callbacks - the snapshot resolved by {@link collectSessionCallbacks}.
 */
export function invokeContainedSessionObservers(
  ctx: Context,
  name: 'session/event' | 'session/disposed',
  id: SessionId,
  args: unknown[],
  callbacks: SessionCallback[],
): void {
  invokeContained(ctx, `session "${id}": ${name}`, callbacks, args, errorMessage)
}
