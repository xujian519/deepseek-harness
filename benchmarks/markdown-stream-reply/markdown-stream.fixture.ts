/** Synthetic history and one long single-block reply for the browser measurement. */
import { createAssistantMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { AssistantStreamAccumulator } from '@deepseek-ai/dsh-llm/assistant-stream'
import { Session, SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import { BLOCK_CHUNKS, CHUNK_TEXT, DONE, FIRST, SESSION_ID, TITLE } from './markdown-stream.constants.ts'

/** One closed turn, so the Web surface opens onto a Session with a composer. */
export function streamingHistory(): string {
  const session = Session.create(SessionId(SESSION_ID))
  session.append('turn/start', { turn: 1 })
  session.append('step/start', { turn: 1, step: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Stream one long block and keep it open.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', { title: TITLE, messageSeqs: [user.seq], source: { kind: 'fallback' } })
  const earlier = 'Earlier synthetic answer.'
  const stream = new AssistantStreamAccumulator()
  stream.push({ time: 1700000000000, chunk: { type: 'block-start', index: 0, blockType: 'text' } })
  stream.push({ time: 1700000000001, chunk: { type: 'text-delta', index: 0, text: earlier } })
  stream.push({ time: 1700000000002, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: earlier } } })
  stream.push({ time: 1700000000003, chunk: { type: 'usage', usage: { inputTokens: 20, outputTokens: 5 } } })
  stream.push({ time: 1700000000004, chunk: { type: 'finish', reason: { kind: 'stop' } } })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    stream: [...stream.snapshot()],
    message: createAssistantMessage({
      source: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      content: [{ type: 'text', text: earlier }],
    }),
    usage: { inputTokens: 20, outputTokens: 5 },
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  return [
    JSON.stringify({ type: 'session', version: SESSION_FORMAT_VERSION, id: '{{sessionId}}', createdAt: 1700000000000, cwd: '{{cwd}}', isSeeded: false, delegationDepth: 0 }),
    ...session.snapshotEvents().map(event => JSON.stringify(event)),
    '',
  ].join('\n')
}

/** The reply's complete text, which the transcript must show when the stream ends. */
export function blockReplyText(): string {
  return `${FIRST} ${CHUNK_TEXT.repeat(BLOCK_CHUNKS)}${DONE}`
}

/** One paragraph delivered as paced chunks: the last chunk closes nothing, so the block never freezes. */
export function blockReply(): StreamChunk[] {
  const text = blockReplyText()
  const body = text.slice(FIRST.length + 1, text.length - DONE.length)
  const chunks = [`${FIRST} `]
  for (let offset = 0; offset < body.length; offset += CHUNK_TEXT.length) {
    chunks.push(body.slice(offset, offset + CHUNK_TEXT.length))
  }
  chunks.push(DONE)
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...chunks.map(chunk => ({ type: 'text-delta' as const, index: 0, text: chunk })),
    { type: 'block-end', index: 0, block: { type: 'text', text } },
    { type: 'usage', usage: { inputTokens: 4000, outputTokens: 800 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}
