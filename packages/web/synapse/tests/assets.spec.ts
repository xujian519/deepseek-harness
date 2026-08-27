/**
 * The map UI ships as a static browser script (assets/app.js) inside an
 * iframe; its pure layout/render helpers are exercised here through the vm
 * slices the upstream plugin used, so the ported behavior stays pinned.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const APP_PATH = new URL('../assets/app.js', import.meta.url)

async function loadSource(): Promise<string> {
  return readFile(APP_PATH, 'utf8')
}

async function loadRenderer(): Promise<(text: string) => string> {
  const source = await loadSource()
  const start = source.indexOf('const escapeHtml')
  const end = source.indexOf('function canvasConnectors')
  const context = { globalThis: {} }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)};globalThis.renderMarkdown = renderMarkdown`, context)
  return (context as unknown as { globalThis: { renderMarkdown: (text: string) => string } }).globalThis.renderMarkdown
}

async function loadConversationCards(): Promise<(threads: never[]) => unknown[]> {
  const source = await loadSource()
  const start = source.indexOf('function overlapsCard')
  const end = source.indexOf('function canvasConnectors')
  const context = {
    globalThis: {},
    CARD_WIDTH: 310,
    CARD_HEIGHT: 276,
    CARD_GAP_Y: 42,
    CAMERA_INSET_X: 56,
    CAMERA_INSET_Y: 56,
    messagesFor: (thread: { messages: unknown[] }) => thread.messages,
    state: { branchAnchors: new Map(), cardPositions: new Map(), liveReplies: new Map(), collapsedCardIds: new Set() },
  }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)};globalThis.conversationCards = conversationCards`, context)
  return (context as unknown as { globalThis: { conversationCards: (threads: never[]) => unknown[] } }).globalThis.conversationCards
}

async function loadMessagesFromEvents(): Promise<(events: never[]) => unknown[]> {
  const source = await loadSource()
  const start = source.indexOf('function messagesFromEvents')
  const end = source.indexOf('async function loadThreadHistory')
  const context = { globalThis: {} }
  vm.createContext(context)
  vm.runInContext(`${source.slice(start, end)};globalThis.messagesFromEvents = messagesFromEvents`, context)
  return (context as unknown as { globalThis: { messagesFromEvents: (events: never[]) => unknown[] } }).globalThis.messagesFromEvents
}

describe('assets/app.js render helpers', () => {
  it('renders PowerShell marker-only diagnostic lines without stalling', async () => {
    const renderMarkdown = await loadRenderer()
    const input = 'cmd : Access is denied.\nAt line:1 char:1\n+ \n+ ~~~\n    + CategoryInfo : PermissionDenied'
    const result = renderMarkdown(input)
    expect(result).toMatch(/cmd : Access is denied/)
    expect(result).toMatch(/CategoryInfo/)
  })

  it('projects each user question as a connected card and the latest answer wins', async () => {
    const conversationCards = await loadConversationCards()
    const cards = conversationCards([{
      id: 'session-1', parentId: null, position: { x: 86, y: 82 },
      messages: [
        { kind: 'user', text: '第一个问题', sourceSeq: 1 },
        { kind: 'assistant', text: '第一个回答草稿', sourceSeq: 2 },
        { kind: 'assistant', text: '第一个最终回答', sourceSeq: 3 },
        { kind: 'user', text: '第二个问题', sourceSeq: 4 },
        { kind: 'assistant', text: '第二个最终回答', sourceSeq: 5 },
      ],
    }] as never[])
    expect(cards).toHaveLength(2)
    expect((cards[0] as { question: string }).question).toBe('第一个问题')
    expect(((cards[0] as { answer: { text: string } }).answer).text).toBe('第一个最终回答')
    expect((cards[1] as { parentId: string }).parentId).toBe((cards[0] as { id: string }).id)
    expect((cards[1] as { canContinue: boolean }).canContinue).toBe(true)
    expect((cards[0] as { canContinue?: boolean }).canContinue).toBeUndefined()
  })

  it('connects a restored fork to its DSH seed boundary, not its canvas position', async () => {
    const conversationCards = await loadConversationCards()
    const cards = conversationCards([
      {
        id: 'parent', parentId: null, position: { x: 86, y: 82 },
        messages: [
          { kind: 'user', text: '第一轮', sourceSeq: 1 },
          { kind: 'assistant', text: '第一答', sourceSeq: 2 },
          { kind: 'user', text: '第二轮', sourceSeq: 3 },
          { kind: 'assistant', text: '第二答', sourceSeq: 4 },
        ],
      },
      {
        id: 'child', parentId: 'parent', sourceParentSessionId: 'parent', sourceSeedLength: 2,
        messages: [
          { kind: 'user', text: '子问题', sourceSeq: 5 },
          { kind: 'assistant', text: '子答', sourceSeq: 6 },
        ],
      },
    ] as never[])
    const childCards = cards.filter(card => (card as { dshThreadId: string }).dshThreadId === 'child')
    expect((childCards[0] as { parentId: string }).parentId).toBe((cards[0] as { id: string }).id)
  })

  it('does not turn the DSH runtime context into a question card', async () => {
    const messagesFromEvents = await loadMessagesFromEvents()
    const messages = messagesFromEvents([
      { type: 'user/message', seq: 1, time: 1, data: { content: [{ type: 'text', text: 'Current runtime context. This snapshot supersedes earlier runtime-context snapshots.\nPolicy details.' }] } },
      { type: 'user/message', seq: 2, time: 2, data: { content: [{ type: 'text', text: '你是谁' }] } },
    ] as never[])
    expect(messages.map(message => (message as { text: string }).text)).toEqual(['你是谁'])
  })

  it('keeps one camera transform and preserves card scroll across re-renders', async () => {
    const source = await loadSource()
    expect(source).toMatch(/canvasCamera: \{ x: 0, y: 0 \}/)
    expect(source).toMatch(/translate\(\$\{state\.canvasCamera\.x\}px, \$\{state\.canvasCamera\.y\}px\) scale\(\$\{state\.zoom\}\)/)
    expect(source).not.toMatch(/canvasScroll|canvasPadding|canvasDomShift|canvasMetrics|viewport\.scrollLeft|viewport\.scrollTop/)
    expect(source).toMatch(/cardScrollTops/)
    const wheel = source.slice(source.indexOf("app.addEventListener('wheel'"), source.indexOf("app.addEventListener('click'"))
    expect(wheel).not.toMatch(/scrollTop\s*\+=/)
  })

  it('bounds concurrent thread-history loads instead of an unbounded Promise.all', async () => {
    const source = await loadSource()
    // Many threads in one workspace used to fire every history request in a
    // single Promise.all, exhausting the renderer request budget
    // (net::ERR_INSUFFICIENT_RESOURCES, "Failed to fetch") and blanking the
    // canvas. The loads are now folded in batches of five; keep it that way.
    expect(source).not.toMatch(/Promise\.all\(state\.workspace\.threads\.map\(thread => loadThreadHistory\(thread, false\)\)\)/)
    expect(source).toMatch(/index < state\.workspace\.threads\.length; index \+= 5/)
  })
})
