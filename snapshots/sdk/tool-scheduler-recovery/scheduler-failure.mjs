/**
 * Reject one scheduler preparation to exercise the terminal internal-failure path.
 *
 * The scheduler handshake is reached through the shared `TOOL_RUNTIME_SCHEDULER`
 * key; the fork carries it as a namespaced string so a profile that hoists a
 * second copy of the tools package still resolves the same property.
 */
export const inject = ['tools']

/** The `TOOL_RUNTIME_SCHEDULER` key exported by `@deepseek-ai/dsh-tools`. */
const TOOL_RUNTIME_SCHEDULER = '@deepseek-ai/dsh-tools:runtime-scheduler'

/** @param {import('@deepseek-ai/cordis').Context} ctx - Scenario-owned runtime. */
export function apply(ctx) {
  const scheduler = ctx.tools[TOOL_RUNTIME_SCHEDULER]
  if (scheduler === undefined) throw new Error('Scheduler failure fixture requires the active tool scheduler')
  const prepare = scheduler.prepare
  ctx.effect(() => {
    scheduler.prepare = async input => {
      if (input.callId === 'scheduler-fail') {
        scheduler.prepare = prepare
        throw new Error('Snapshot scheduler preparation failed')
      }
      return prepare.call(scheduler, input)
    }
    return () => { scheduler.prepare = prepare }
  }, 'scheduler failure fixture')
}
