/** Fixed synthetic history workload for the Session history-read gate. */

/** Session id of the synthetic history log. */
export const HISTORY_READ_SESSION_ID = 'bench-history'
/** Stable logical working directory encoded in the log header. */
export const HISTORY_READ_CWD = '/bench'
/**
 * Turns written into the synthetic log; each turn appends one user message.
 *
 * The whole log sits inside one open turn: the released-format relationship
 * validator accepts `turn/start` only while no turn is open and only for the
 * next turn, so per-turn `turn/start` events without matching `turn/end` are
 * rejected as a corrupt log (`session-format-v3-to-v4/src/relationships.ts`).
 * `turn/start` and `turn/end` are structural, not surface events, so the
 * measured log size and surface stay what the recorded calibration describes.
 */
export const HISTORY_READ_TURNS = 45_000
/** Events one turn contributes: its user surface message. */
export const HISTORY_READ_EVENTS_PER_TURN = 1
/** Total logical events in one synthetic log: one `turn/start` plus every turn's message. */
export const HISTORY_READ_EVENTS = HISTORY_READ_TURNS * HISTORY_READ_EVENTS_PER_TURN + 1
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
