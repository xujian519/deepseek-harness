/**
 * Serialized-JSON byte accounting shared by the fd-3 runtime's output paths: the cost
 * model that prices a string in the form it takes on the wire, the truncation marker both
 * sides of the pipe use, and the receive-side cap on a diagnostic message. The outer
 * output ledger, the log-frame handler, and the done-frame handler all bill against these,
 * so the pricing lives here rather than in any one caller.
 * @module @deepseek-ai/dsh-experimental-code-runtime-python/src/cost
 */

/** The marker appended when a diagnostic message is byte-capped host-side. */
const TRUNCATION_MARKER = '… [truncated]'

/**
 * The marker's own UTF-8 byte length, reserved out of the budget so a capped
 * message stays WITHIN `maxValueBytes` rather than exceeding it by the marker.
 * The ellipsis is 3 bytes, so this is 15, not the string's 13 code units.
 */
const TRUNCATION_MARKER_BYTES = Buffer.byteLength(TRUNCATION_MARKER, 'utf8')

/**
 * Serialized JSON byte width of one character, given its code point and the
 * one-character string. Control characters below 0x20 escape to `\uXXXX` (6)
 * except the five with short forms `\b \t \n \f \r` (2); `"` and `\` escape to
 * 2; a LONE surrogate escapes to `\uXXXX` (6) under ES2019 well-formed
 * `JSON.stringify`; everything else rides at its raw UTF-8 width.
 * @param code - the character's code point.
 * @param character - the one-character (or one-code-point) string.
 * @returns the character's serialized JSON byte width.
 */
function serializedCharCost(code: number, character: string): number {
  if (code < 0x20) return code === 0x08 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d ? 2 : 6
  if (code === 0x22 || code === 0x5c) return 2
  if (code >= 0xd800 && code <= 0xdfff) return 6
  return Buffer.byteLength(character, 'utf8')
}

/**
 * Serialized JSON-string cost of `text` (the two quotes plus each character's
 * escaped byte width), measured WITHOUT materializing the escaped copy, and
 * abandoned the instant it exceeds `maxBytes`. `JSON.stringify(text)` would
 * allocate the whole escaped form first — up to sixfold a control-char-dense
 * string — so a near-budget line under a large `maxLogBytes` could momentarily
 * allocate over a gigabyte just to measure it. This walks code point by code
 * point (a matched surrogate pair yields its combined code point ≥ 0x10000; a
 * lone surrogate yields a value in 0xD800–0xDFFF that {@link serializedCharCost}
 * charges the full six escaped bytes) and stops at the cap, allocating nothing.
 * @param text - the candidate string.
 * @param maxBytes - the largest serialized size the caller can admit.
 * @returns the exact serialized byte cost, or `undefined` once it exceeds `maxBytes`.
 */
export function jsonStringCostUpTo(text: string, maxBytes: number): number | undefined {
  if (maxBytes < 2) return undefined
  let bytes = 2 // the enclosing quotes
  for (const character of text) {
    bytes += serializedCharCost(character.codePointAt(0) as number, character)
    if (bytes > maxBytes) return undefined
  }
  return bytes
}

/**
 * Cap a done-frame `error.message` to `maxValueBytes` host-side: a forged done
 * frame can carry an arbitrarily long message, so truncate by RAW UTF-8 byte
 * length and append the shared marker on overflow. Completion VALUES are never
 * truncated — the seam forbids substitution, so an oversized value fails the run
 * as `output-limit` instead (see the done case in `execute`).
 *
 * This is the RECEIVE-side backstop, and it bills by raw bytes on purpose,
 * unlike the producing-side `_cap_message` in `py/bootstrap.py`, which bills by
 * SERIALIZED (JSON-escaped) cost. The split is deliberate: `_cap_message`'s
 * output has to cross fd 3 as a JSON string, so its escaped width is what the
 * frame ceiling bounds; this function's output goes straight into
 * `CodeRunResult.error.message` and never re-crosses a frame-bounded channel, so
 * the honest measure of what it retains is the raw length. An honest child has
 * already capped the diagnostic by serialized cost, and raw length ≤ serialized
 * cost, so a well-formed message passes through unchanged. A forged message with
 * control characters could serialize to roughly six times its raw length, but it
 * is not travelling any capped channel, so the raw-byte bound is the right one:
 * the value it protects is the model-visible size of `error.message`, not a wire
 * width.
 *
 * The marker's bytes are RESERVED from the budget, not added on top: the whole
 * returned string, marker included, is at most `maxValueBytes` bytes. Appending
 * the marker after retaining a full budget's worth of text would overrun the
 * very cap this function exists to enforce. The one exception is a configured
 * cap SMALLER than the marker itself, which leaves no room for message text at
 * all; the marker alone is returned there, so the bound is
 * `max(maxValueBytes, 15)`. Reporting the truncation is worth those 15 bytes,
 * and the default cap is 32 KiB.
 * @param message - the error message from an inbound (possibly forged) done frame.
 * @param maxValueBytes - the configured completion-value budget, reused here.
 * @returns the message unchanged, or its byte-capped form on overflow.
 */
export function capMessage(message: string, maxValueBytes: number): string {
  // Code-unit bounds BEFORE any encode, so a forged done frame carrying a
  // message anywhere below the 64 MiB fd-3 frame parse cap cannot force a
  // full-length UTF-8 copy under a 32 KiB cap. One UTF-16 code unit encodes to
  // at least one UTF-8 byte and at most three: three for a non-ASCII BMP
  // character, two apiece for the pair halves sharing an astral code point's
  // four bytes, and three for a LONE surrogate, which `Buffer.from` renders as
  // U+FFFD. So at most maxValueBytes/3 code units cannot overflow the cap and
  // need no encode at all...
  if (message.length * 3 <= maxValueBytes) return message
  // ...and nothing past the first maxValueBytes code units can fit inside it,
  // so only that prefix is ever encoded — at most 3 * maxValueBytes bytes.
  const keep = Math.min(message.length, maxValueBytes)
  const whole = keep === message.length
  const bytes = Buffer.from(whole ? message : message.slice(0, keep), 'utf8')
  // A message that fits is measured against the WHOLE cap: it gets no marker,
  // so reserving marker bytes here would truncate text that was within budget.
  if (whole && bytes.length <= maxValueBytes) return message
  // Past this point the message IS being truncated, so the marker WILL be
  // appended and its bytes come out of the cap instead of sitting on top of it.
  const budget = Math.max(0, maxValueBytes - TRUNCATION_MARKER_BYTES)
  // Trim back to the last complete UTF-8 sequence: a cut through a multibyte
  // character would decode as U+FFFD — corrupting the diagnostic AND
  // exceeding the byte cap, since the replacement character itself encodes
  // to three bytes. Continuation bytes are 0b10xxxxxx; at most three of them
  // precede a lead byte.
  //
  // This also covers a code-unit prefix ending on a HIGH SURROGATE whose low
  // half sits outside it, which `Buffer.from` encodes as U+FFFD: that orphan
  // occupies the last three bytes of `bytes`, and `bytes` is at least
  // `maxValueBytes + 2` long here (one byte per retained unit, three for the
  // orphan), so it starts past `budget` and is always cut. Reserving the
  // marker is what makes that hold; cutting at `maxValueBytes` itself did not,
  // and needed an explicit surrogate check.
  let end = Math.min(budget, bytes.length)
  while (end > 0 && ((bytes[end] as number) & 0b1100_0000) === 0b1000_0000) end--
  return `${bytes.subarray(0, end).toString('utf8')}${TRUNCATION_MARKER}`
}
