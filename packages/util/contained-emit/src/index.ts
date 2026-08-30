/**
 * Contained observe-only event dispatch over Cordis. Cordis' own `emit` walks
 * listeners through `Array.map`, so one synchronous throw starves every later
 * listener and returned promises are discarded as unhandled rejections.
 * Non-vetoing notifications need the opposite: every listener runs, and every
 * failure — synchronous or asynchronous — becomes one log line. Each caller
 * owns its log label and its error renderer, so this package stays
 * dependency-free and format-neutral.
 * @module @deepseek-ai/dsh-contained-emit
 */

import type { Context } from '@deepseek-ai/cordis'

/** A resolved listener callback ready for direct invocation. */
export type ContainedListener = (...args: unknown[]) => unknown

/**
 * Invoke one listener snapshot with per-listener containment. Every callback
 * runs even after an earlier one fails; a synchronous throw and a rejected
 * returned promise each log one `listener threw` / `listener rejected` line
 * through `ctx.logger.warn` and never escape this function.
 *
 * @param ctx - the context owning the logger; typically also the dispatch owner.
 * @param label - the log prefix for both failure kinds, e.g. `` `session "${id}": ${name}` ``.
 * @param callbacks - the listeners to run, in order (a snapshot, or any callback set).
 * @param args - the payload passed to every callback.
 * @param render - renders a caught value into the log line; callers inject their
 *   own (`errorMessage`, `errorChain`, a class-name renderer, …).
 */
export function invokeContained(
  ctx: Context,
  label: string,
  callbacks: Iterable<ContainedListener>,
  args: unknown[],
  render: (value: unknown) => string,
): void {
  for (const callback of callbacks) {
    try {
      const returned: unknown = callback(...args)
      void Promise.resolve(returned).catch((error: unknown) => {
        ctx.logger.warn(`${label} listener rejected: ${render(error)}`)
      })
    } catch (error: unknown) {
      ctx.logger.warn(`${label} listener threw: ${render(error)}`)
    }
  }
}

/**
 * Dispatch one `emit`-mode event through Cordis and contain every listener.
 * This is `ctx.events.dispatch('emit', args)` plus {@link invokeContained}.
 *
 * Cordis' `dispatch` mutates `args`: it shifts off the optional scoped carrier
 * and the event name, so what remains — and what each callback receives — is
 * exactly the declared listener payload. Pass `args` the same way `ctx.emit`
 * would receive them.
 *
 * @param ctx - the context to dispatch through and log against.
 * @param label - the log prefix for both failure kinds.
 * @param args - optional scoped carrier, the event name, then the payload.
 * @param render - renders a caught value into the log line.
 */
export function emitContained(
  ctx: Context,
  label: string,
  args: unknown[],
  render: (value: unknown) => string,
): void {
  invokeContained(ctx, label, ctx.events.dispatch('emit', args), args, render)
}
