/**
 * Coverage round for the composer-draft append helper: the shared path
 * behind the explorer's @-reference button and the viewer selection popup.
 * Pins the lazy service resolution, the space-joined draft merge, and the
 * logged no-op degradations (missing scope, missing service, throwing scope).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendToDraft } from '../src/client/conversation-draft.ts'
import type { Context, SidebarConversation } from '../src/context-types.ts'

/** A conversation service fake with one input machine per session context. */
function conversationFake(initialDraft = ''): SidebarConversation & { drafts: Map<Context, string> } {
  const drafts = new Map<Context, string>()
  return {
    drafts,
    input: {
      for(actx: Context) {
        if (!drafts.has(actx)) drafts.set(actx, initialDraft)
        return {
          state: { getSnapshot: () => ({ draft: drafts.get(actx) ?? '' }) },
          setDraft: (text: string) => { drafts.set(actx, text) },
        }
      },
    },
  }
}

/** A context fake: scoping, the lazy service read, nothing else. */
function ctxFake(over: {
  scoped?: Context | undefined
  conversation?: SidebarConversation | undefined
  scopeThrows?: boolean
} = {}): Context {
  const scoped = over.scoped ?? ({} as Context)
  return {
    sessions: {
      scope: (id: string) => {
        if (over.scopeThrows === true) throw new Error('scope exploded')
        return id === 's1' ? scoped : undefined
      },
    },
    get: (name: string) => name === 'conversation' ? over.conversation : undefined,
  } as unknown as Context
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('appendToDraft', () => {
  it('replaces an empty draft with the appended text', () => {
    const conversation = conversationFake('')
    const scoped = {} as Context
    const ctx = ctxFake({ scoped, conversation })
    expect(appendToDraft(ctx, 's1', './src/a.ts')).toBe(true)
    expect(conversation.drafts.get(scoped)).toBe('./src/a.ts')
  })

  it('space-joins onto an existing draft (the stored text is kept as-is)', () => {
    const conversation = conversationFake('  existing prompt  ')
    const scoped = {} as Context
    const ctx = ctxFake({ scoped, conversation })
    expect(appendToDraft(ctx, 's1', './b.ts')).toBe(true)
    // Only the emptiness check trims; the stored draft passes through whole.
    expect(conversation.drafts.get(scoped)).toBe('  existing prompt   ./b.ts')
  })

  it('returns false when the session cannot be scoped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(appendToDraft(ctxFake({}), 'other', './b.ts')).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('returns false when the conversation service is absent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(appendToDraft(ctxFake({ conversation: undefined }), 's1', './b.ts')).toBe(false)
    expect(warn).not.toHaveBeenCalled()
  })

  it('degrades a throwing scope to a logged false', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(appendToDraft(ctxFake({ scopeThrows: true }), 's1', './b.ts')).toBe(false)
    expect(warn).toHaveBeenCalledWith('[dsh-better-sidebar] draft insert failed:', expect.any(Error))
  })
})
