/** Reviewed constants for the long single-block streaming browser case. */
export const SESSION_ID = 'benchmark-markdown-stream'
export const TITLE = 'SYNTHETIC_MARKDOWN_STREAM'

/** First streamed text marker. */
export const FIRST = 'SYNTHETIC_BLOCK_FIRST'
/** Last streamed text marker. */
export const DONE = 'SYNTHETIC_BLOCK_DONE'

/**
 * Body chunks in the reply. The whole reply is one paragraph with no blank
 * line, so the renderer can freeze none of it: every frame re-parses all of it.
 */
export const BLOCK_CHUNKS = 1_200

/** Replay delay per stream chunk, in milliseconds — half a 60 Hz frame, so arrivals outpace frames. */
export const PACE_MS = 2

/** Text of one body chunk; each is long enough that the reply outgrows a frame budget well before it ends. */
export const CHUNK_TEXT = 'Sentence of the single growing paragraph that keeps the reply open. '.repeat(5)
