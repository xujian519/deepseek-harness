// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {
  ConversationNodeDefinition, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { AssistantBlock, ChatSnapshot } from '../src/client/contract/snapshot.ts'
import type { AssistantChatData, ChatConversationViewNode } from '../src/client/contract/chat-nodes.ts'
import { assistantDefinition } from '../src/client/conversation-nodes/assistant.ts'
import { chatViewDefinition } from '../src/client/conversation-nodes/chat-snapshot-builder.ts'
import { unknownFallbackDefinition } from '../src/client/conversation-nodes/fallback.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { zh } from '../src/client/locale.ts'

const DEFINITIONS: readonly ConversationNodeDefinition[] = [assistantDefinition]

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return DEFINITIONS
  }

  fallbackEntry(): ConversationNodeDefinition {
    return unknownFallbackDefinition
  }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] {
    return [chatViewDefinition]
  }
}

function at(seq: number, type: string, data: unknown, extra: Record<string, unknown> = {}): SessionEventLikeEntry {
  return {
    type: 'event',
    event: {
      seq,
      time: 1_700_000_000_000 + seq,
      type,
      data,
      ...extra,
    } as unknown as SessionEvent,
  }
}

function assembler(entries: readonly SessionEventLikeEntry[] = []): ConversationNodeAssembler {
  const views = new TestViewDefinitions()
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), views)
  // Snapshot building is lazy: activate every view before the first flush.
  for (const view of views.entries()) value.activateTarget(view.target)
  value.replaceWindow(entries, false)
  value.flush()
  return value
}

function snapshot(value: ConversationNodeAssembler): ChatSnapshot {
  const current = value.snapshot('chat') as ChatSnapshot | undefined
  if (current === undefined) throw new Error('chat view was not registered')
  return current
}

let nextAnimationFrameId = 1
let animationFrames = new Map<number, FrameRequestCallback>()

beforeEach(() => {
  nextAnimationFrameId = 1
  animationFrames = new Map()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextAnimationFrameId
    nextAnimationFrameId += 1
    animationFrames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    animationFrames.delete(id)
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('stream-chunk resilience', () => {
  it('projects malformed / extreme assistant chunks without crashing the conversation tree', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      // Malformed block indexes: negative, fractional, missing, and absurdly large.
      at(3, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: -1, blockType: 'text' } }),
      at(4, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 1.5, blockType: 'text' } }),
      at(5, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: undefined, blockType: 'text' } }),
      at(6, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 1_000_000, blockType: 'text' } }),
      // A valid block, then malformed deltas (non-string text / missing index).
      at(7, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } }),
      at(8, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 123 } }),
      at(9, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: undefined, text: 'lost-index' } }),
      // Valid deltas accumulate a string, and an extreme length still lands as a string.
      at(10, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '好' } }),
      at(11, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '内容'.repeat(5_000) } }),
      // block-end with a null / non-object block must fold away, not throw.
      at(12, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-end', index: 0, block: null } }),
      at(13, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-end', index: 1, block: 'text' } }),
    ])
    const result = snapshot(value)
    const assistant = result.nodes.values().find((candidate): candidate is ChatConversationViewNode & { kind: 'assistant-step' } => candidate.kind === 'assistant-step')
    expect(assistant).toBeDefined()
    if (assistant === undefined) throw new Error('missing assistant-step node')
    const blocks = (assistant.data as AssistantChatData).blocks
    // Every text / reasoning body projected to the renderer must be a real string.
    for (const block of blocks) {
      if (block.kind === 'text' || block.kind === 'reasoning') expect(typeof block.text).toBe('string')
    }
    const text = blocks.find((block): block is Extract<AssistantBlock, { kind: 'text' }> => block.kind === 'text')
    expect(text?.text).toBe('好' + '内容'.repeat(5_000))
  })

  it('renders malformed assistant blocks without throwing', () => {
    const t = makeTranslate(zh, commonZh)
    const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null
    const blocks = [
      { kind: 'text', text: undefined },
      { kind: 'reasoning', text: undefined },
      { kind: 'text', text: '正文' },
      { kind: 'image', attachment: undefined },
      { kind: 'other', block: null },
    ] as unknown as AssistantBlock[]
    expect(() =>
      render(
        <AssistantMarkdown
          blocks={blocks}
          streaming={false}
          renderMessageImages={renderMessageImages}
          t={t}
        />,
      ),
    ).not.toThrow()
  })
})
