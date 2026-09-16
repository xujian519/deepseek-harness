/** Fixed synthetic history workload for the Session history-read gate. */

/** Session id of the synthetic history log. */
export const HISTORY_READ_SESSION_ID = 'bench-history'
/** Stable logical working directory encoded in the log header. */
export const HISTORY_READ_CWD = '/bench'
/** Turns written into the synthetic log; each turn appends two events. */
export const HISTORY_READ_TURNS = 45_000
/** Events one turn contributes: `turn/start` and the user surface message. */
export const HISTORY_READ_EVENTS_PER_TURN = 2
/** Total logical events in one synthetic log. */
export const HISTORY_READ_EVENTS = HISTORY_READ_TURNS * HISTORY_READ_EVENTS_PER_TURN
/** Events appended per durable batch while the fixture is written. */
export const HISTORY_READ_APPEND_BATCH = 2_000
/**
 * UTF-8 bytes of the user text carried by each turn; every turn carries distinct
 * text. The gate's recorded reference medians and budgets are calibrated at this
 * size, so changing it re-records every timing and heap expectation.
 */
export const HISTORY_READ_TEXT_BYTES = 745
/** Zero-padded digits that prefix each turn's text, keeping every event's string distinct. */
const TURN_DIGITS = 8

/**
 * Reviewed filler for the per-turn user text; no recorded Session material is
 * used. Longer than one turn's text, so the slice in {@link historyReadText} is
 * what holds every turn to {@link HISTORY_READ_TEXT_BYTES}.
 */
const FILLER = Array.from(
  { length: 20 },
  (_, line) => `line ${String(line).padStart(2, '0')} carries fixed synthetic history text. `,
).join('')

/**
 * Build one turn's user text.
 *
 * Each turn gets its own string so the stored log occupies real memory and an
 * event-by-event copy of the log costs what the log costs.
 * @param turn - one-based turn number.
 * @returns exactly {@link HISTORY_READ_TEXT_BYTES} UTF-8 bytes: the fixed-width
 * padded prefix, one separator space, and the filler cut to the remainder.
 */
export function historyReadText(turn: number): string {
  const prefix = String(turn).padStart(TURN_DIGITS, '0')
  return `${prefix} ${FILLER.slice(0, HISTORY_READ_TEXT_BYTES - prefix.length - 1)}`
}
