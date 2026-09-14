// fx-alpha history script: the static session log the fixture ships, plus the
// tool-result samples only that log renders.

import { createSystemMessage } from '@deepseek-ai/dsh-llm/message'
import type { AssistantMessage, ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import {
  FIXTURE_IMAGE_REF,
  MARKDOWN_FIXTURE,
  assistantMessage,
  fixtureSettledStream,
  fixtureUsage,
  text,
  toolResultMessage,
  userMessage,
} from './fixture-messages.ts'

const USER_MARKDOWN_LITERAL = '用户字面量：# 不渲染 `code` [link](https://example.com)'

/**
 * SGR wrapper for the terminal output sample below: authoring the escapes as
 * `\u001b` keeps literal control bytes out of this source file.
 * @param code - the SGR parameter (an ANSI color or attribute number).
 * @param body - the text the attribute applies to.
 * @returns the body wrapped in the attribute and a reset.
 */
function sgr(code: number, body: string): string {
  return `\u001b[${code}m${body}\u001b[0m`
}

/**
 * Terminal output sample for fixture turn 66, authored to carry every feature
 * the terminal card draws that turn 60's two prompt rows cannot reach:
 * basic-16 SGR foreground runs (green, red, bright-black) that must resolve to
 * `--dsw-*` tokens, a bold run, column-aligned table rows that must scroll
 * rather than fold, more than DEFAULT_TERMINAL_MAX_LINES (16) lines so the
 * height cap collapses the middle. This constant is the visible body; the call
 * site appends the shell result's `[exit code: N]` marker so Client derivation
 * can consume it into the terminal status pill.
 */
const TERMINAL_OUTPUT_FIXTURE = [
  sgr(1, 'Running 4 checks'),
  `${sgr(32, '\u2713')} typecheck                                          1.82s`,
  `${sgr(32, '\u2713')} lint                                               0.94s`,
  `${sgr(32, '\u2713')} duplication                                        2.10s`,
  `${sgr(31, '\u2717')} unit                                               8.41s`,
  '',
  sgr(90, 'packages/client/ui-primitives/tests/terminal-block.client.spec.tsx'),
  `  ${sgr(31, 'FAIL')} caps output at the configured line budget`,
  '    expected 16 lines, received 24',
  '',
  'NAME                        LINES    BRANCHES    FUNCTIONS    UNCOVERED',
  'TerminalBlock.tsx           100%     100%        100%         -',
  'ansi.ts                     100%     100%        100%         -',
  'clipboard.ts                100%     100%        100%         -',
  'CodeBlock.tsx               98.4%    96.2%       100%         41-43',
  'highlight.ts                100%     100%        100%         -',
  'Pill.tsx                    100%     100%        100%         -',
  'StateDot.tsx                100%     100%        100%         -',
  'markdown/Markdown.tsx       100%     100%        100%         -',
  '',
  sgr(31, '1 of 4 checks failed'),
].join('\n')

/**
 * Structured grep metadata for the search sample (turn 67). `truncated` with a
 * larger `total` than the retained match count exercises the search card's
 * capped indicator; the file with more than CHAT_SEARCH_MAX_LINES rows
 * exercises its head/tail height cap.
 */
const SEARCH_MATCHES_FIXTURE: { path: string; matches: { lineNumber: number; line: string }[] }[] = [
  {
    path: 'packages/client/ui-primitives/src/SearchBlock.tsx',
    matches: [
      { lineNumber: 16, line: 'export const DEFAULT_SEARCH_MAX_LINES = 16' },
      { lineNumber: 138, line: 'export function SearchBlock(props: SearchBlockProps) {' },
      { lineNumber: 141, line: '  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(() => new Set())' },
    ],
  },
  {
    path: 'packages/client/ui-tool/src/client/tool/models/search-card-model.ts',
    matches: [
      { lineNumber: 45, line: 'export const CHAT_SEARCH_MAX_LINES = 8' },
      { lineNumber: 130, line: 'export function searchCardModel(block: ToolCallBlock): SearchCardModel | null {' },
    ],
  },
  {
    path: 'packages/client/ui-tool/src/client/tool/toolviews/search-row.tsx',
    matches: [
      { lineNumber: 34, line: 'export function SearchRow({ toolName, block, inspect, t }: SearchRowProps) {' },
      { lineNumber: 36, line: '  const search = searchCardModel(block)' },
      { lineNumber: 56, line: '      search={search}' },
      { lineNumber: 78, line: "      yield ctx.slots.register({ name: 'tool.call.toolview', key: 'grep', locale: NS }, SearchRow)" },
    ],
  },
]

const SEARCH_MATCHES_TEXT = [
  'Found 9 of 42 matches',
  '',
  ...SEARCH_MATCHES_FIXTURE.map(file =>
    [file.path, ...file.matches.map(m => `Line ${m.lineNumber}: ${m.line}`)].join('\n')),
  '',
  '(Full grep result stored at: fixture://spill/grep-66. Read it to see every match.)',
].join('\n')

const SEARCH_PATHS_FIXTURE = [
  'packages/client/ui-primitives/src/SearchBlock.tsx',
  'packages/client/ui-primitives/src/SearchBlock.module.css',
  'packages/client/ui-tool/src/client/tool/models/search-card-model.ts',
  'packages/client/ui-tool/src/client/tool/toolviews/search-row.tsx',
  'packages/client/ui-tool/tests/search-card.client.spec.tsx',
]

const SEARCH_PATHS_TEXT = [
  ...SEARCH_PATHS_FIXTURE,
  '',
  '(Showing 5 of 23 paths. Full sorted result stored at: fixture://spill/glob-67. Read it to see every path.)',
].join('\n')

const READ_SAMPLE_FIRST_LINE = 41
const READ_SAMPLE_SOURCE = [
  'export interface ReadBlockProps {',
  '  label?: string | undefined',
  '  lines: readonly ReadBlockLine[]',
  '  totalLines: number',
  '  lang?: string | undefined',
  '  maxLines?: number | undefined',
  '  className?: string | undefined',
  '}',
  '',
  '// A windowed read keeps the file line numbers in the gutter.',
  'const marker = "fixture read sample"',
]
const READ_SAMPLE_LINES = READ_SAMPLE_SOURCE.map((text, index) => ({ number: READ_SAMPLE_FIRST_LINE + index, text }))
const READ_SAMPLE_PATH = 'packages/client/ui-primitives/src/ReadBlock.tsx'
const READ_SAMPLE_TOTAL = 180
const READ_SAMPLE_LAST_LINE = READ_SAMPLE_FIRST_LINE + READ_SAMPLE_SOURCE.length - 1
const READ_SAMPLE_TEXT = [
  `<path>${READ_SAMPLE_PATH}</path>`,
  '<type>file</type>',
  '<content>',
  ...READ_SAMPLE_SOURCE.map((text, index) => `${READ_SAMPLE_FIRST_LINE + index}: ${text}`),
  '',
  `(Showing lines ${READ_SAMPLE_FIRST_LINE}-${READ_SAMPLE_LAST_LINE} of ${READ_SAMPLE_TOTAL}. Use offset=${READ_SAMPLE_LAST_LINE + 1} to continue.)`,
  '</content>',
].join('\n')

/**
 * The `web_search` result metadata for the web-search turn. The sources cover a
 * titled source with a snippet and date, a hostname-label fallback, and a
 * titled source without a snippet; `truncated` exercises the capped indicator.
 */
const WEB_SEARCH_META = {
  answer: 'DeepSeek Harness is a plugin-based agent harness on vendored Cordis where **every capability is a plugin**.',
  sources: [
    {
      url: 'https://github.com/deepseek-ai/deepseek-harness',
      title: 'DeepSeek Harness — plugin-based agent harness',
      snippet: 'Everything is a plugin: session, tools, agent-loop, and LLM adapters all mount on the same Cordis context.',
      publishedAt: '2026-07-01',
    },
    {
      url: 'https://www.deepseek.com/blog/harness-architecture',
      snippet: 'The capability-seam pattern splits each capability into interface, implementation, and consumer packages.',
    },
    {
      url: 'https://docs.deepseek.com/harness/plugins',
      title: 'Writing a harness plugin',
      publishedAt: '2026-06-15',
    },
  ],
  truncated: true,
} satisfies JsonValue

/** The `web_fetch` result metadata for the web-fetch turn. */
const WEB_FETCH_META = {
  url: 'https://www.deepseek.com/blog/harness-architecture',
  statusCode: 200,
  truncated: false,
} satisfies JsonValue

/** Rendered system prompt of the fx-alpha history: surface node 0. */
const FIXTURE_SYSTEM_PROMPT = '你是 DeepSeek Harness 的 fixture 助手。用简洁的中文回答，并在需要时调用工具。'

/**
 * fx-alpha history script: 75 turns (~150+ messages -> 4 pages at PAGE_MESSAGES=50),
 *  mixing reasoning blocks / tool call+result / context.
 * @returns the session events, renumbered so `seq` runs from 0.
 */
export function buildAlphaLog(): SessionEvent[] {
  const events: Record<string, unknown>[] = []
  let time = Date.now() - 3_600_000
  const push = (e: Record<string, unknown>): number => {
    const seq = events.length
    const data = e['data'] as Record<string, unknown> | undefined
    const nextTime = time + 800
    const authored = e['type'] === 'assistant/message' && data !== undefined
      ? {
        ...e,
        data: {
          ...data,
          usage: fixtureUsage(data['turn'] as number, data['step'] as number),
          stream: fixtureSettledStream(
            data['message'] as AssistantMessage,
            fixtureUsage(data['turn'] as number, data['step'] as number),
            nextTime,
          ),
        },
      }
      : e
    events.push({ seq, time: (time = nextTime), ...authored })
    return seq
  }
  // Completed fixture requests retain the route capacity recorded with them.
  push({
    type: 'request/context',
    data: { provider: 'deepseek-official', model: 'deepseek-v4-flash', contextWindow: 128_000 },
  })
  for (let turn = 0; turn < 60; turn++) {
    push({ type: 'turn/start', data: { turn } })
    // The rendered system prompt is surface node 0, ahead of the first user message.
    if (turn === 0) {
      push({
        type: 'system/message', surfaceOp: 'append',
        data: { turn, step: 0, message: createSystemMessage(FIXTURE_SYSTEM_PROMPT, '@deepseek-ai/dsh-system-prompt') },
      })
    }
    const userSeq = push({
      type: 'user/message', surfaceOp: 'append',
      data: userMessage(text(turn === 59 ? USER_MARKDOWN_LITERAL : `问题 ${turn}：fixture 历史消息，用于翻页与渲染验收。`)),
    })
    if (turn === 0) {
      push({
        type: 'session/title',
        data: { title: 'Fixture 历史会话', messageSeqs: [userSeq], source: { kind: 'fallback' } },
      })
    }
    if (turn % 9 === 4) {
      push({ type: 'user/message', surfaceOp: 'append', data: userMessage(text(`[fixture] 上下文注入（turn ${turn}）`), { kind: 'plugin', plugin: 'fixture' }) })
    }
    push({ type: 'step/start', data: { turn, step: 0 } })
    const withTool = turn % 5 === 2
    const withReasoning = turn % 3 === 1
    const blocks: ContentBlock[] = []
    if (withReasoning) blocks.push({ type: 'reasoning', text: `思考过程 ${turn}：这是一段可折叠的 reasoning 内容。` })
    blocks.push({ type: 'text', text: turn === 59 ? MARKDOWN_FIXTURE : `回答 ${turn}：这是 fixture 生成的历史回复正文。` })
    if (withTool) {
      const callId = `fx-call-${turn}`
      blocks.push({ type: 'tool-call', id: callId, name: 'echo', arguments: `{"text":"turn ${turn}"}` } as ContentBlock)
      push({ type: 'assistant/message', surfaceOp: 'append', data: { turn, step: 0, message: assistantMessage(blocks) } })
      push({ type: 'tool/call', data: { turn, step: 0, callId, name: 'echo', arguments: `{"text":"turn ${turn}"}` } })
      push({ type: 'tool/result', surfaceOp: 'append', data: { turn, step: 0, message: toolResultMessage(callId, text(`ECHO: TURN ${turn}`), turn % 25 === 12) } })
      push({ type: 'step/end', data: { turn, step: 0 } })
      push({ type: 'step/start', data: { turn, step: 1 } })
      push({ type: 'assistant/message', surfaceOp: 'append', data: { turn, step: 1, message: assistantMessage(text(`工具结果已消化（turn ${turn}）。`)) } })
      push({ type: 'step/end', data: { turn, step: 1 } })
    } else {
      push({ type: 'assistant/message', surfaceOp: 'append', data: { turn, step: 0, message: assistantMessage(blocks) } })
      push({ type: 'step/end', data: { turn, step: 0 } })
    }
    push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  // The structured samples use real first-party names and result metadata so
  // the fixture follows the same event-to-card path as a persisted Session.
  // `echo` above remains the unknown-tool fallback.
  const toolTurn = (
    turn: number,
    name: string,
    args: string,
    resultText: string,
    resultMeta?: JsonValue,
  ): void => {
    const callId = `fx-call-${turn}`
    push({ type: 'turn/start', data: { turn } })
    push({ type: 'user/message', surfaceOp: 'append', data: userMessage(text(`问题 ${turn}：${name} 样本。`)) })
    push({ type: 'step/start', data: { turn, step: 0 } })
    push({
      type: 'assistant/message', surfaceOp: 'append',
      data: { turn, step: 0, message: assistantMessage([{ type: 'tool-call', id: callId, name, arguments: args } as ContentBlock]) },
    })
    push({ type: 'tool/call', data: { turn, step: 0, callId, name, arguments: args } })
    push({
      type: 'tool/result',
      surfaceOp: 'append',
      data: {
        turn,
        step: 0,
        message: toolResultMessage(callId, text(resultText), false),
        ...resultMeta === undefined ? {} : { meta: resultMeta },
      },
    })
    push({ type: 'step/end', data: { turn, step: 0 } })
    push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  // A two-line command, so the fixture covers the terminal card's one-row-per-
  // command-line prompt (and that the card still marks the call exactly once).
  toolTurn(
    60,
    'bash',
    '{"command":"ls -la\\necho done","description":"fixture 终端样本","workdir":"/tmp/fixture"}',
    'total 2\ndrwxr-xr-x fixture\n-rw-r--r-- demo.txt',
  )
  toolTurn(
    61,
    'write',
    '{"file_path":"notes/demo.txt","content":"hello fixture\\n"}',
    'wrote notes/demo.txt',
    { diffs: [{ path: 'notes/demo.txt', oldText: null, newText: 'hello fixture\n' }] },
  )
  toolTurn(
    62,
    'edit',
    '{"file_path":"notes/demo.txt","old_string":"hello","new_string":"hello fixture"}',
    '已编辑',
    { diffs: [{ path: 'notes/demo.txt', oldText: 'hello', newText: 'hello fixture' }] },
  )
  toolTurn(
    63,
    'write',
    '{"file_path":"notes/new-demo.txt","content":"hello fixture\\n"}',
    '已写入',
    { diffs: [{ path: 'notes/new-demo.txt', oldText: null, newText: 'hello fixture\n' }] },
  )
  // Turn 64: a multi-hunk edit — two scattered replacements in one file. Named
  // `edit` so it lands on the keyed FileMutationRow (the resident diff card the
  // single-hunk turn 62 also uses). Its result metadata carries two scattered
  // hunks under one path header, so the card draws the first hunk, a `⋯` gap,
  // then the second (the same-file
  // second-hunk arm turns 62/63 cannot reach).
  toolTurn(
    64,
    'edit',
    '{"file_path":"src/config.ts","old_string":"const timeout = 30","new_string":"const timeout = 60"}',
    '已编辑',
    {
      diffs: [
        { path: 'src/config.ts', oldText: 'const timeout = 30', newText: 'const timeout = 60' },
        { path: 'src/config.ts', oldText: 'retries: 1', newText: 'retries: 3' },
      ],
    },
  )
  // Turn 65: one run_code turn with three logged sub-dispatches — the Code
  // Mode acceptance surface (parent code row + nested native-identical rows,
  // including an isError sub-call and a bash sub-call that must hit the same
  // keyed registration a top-level bash row uses).
  {
    const turn = 65
    const callId = `fx-call-${turn}`
    const program = 'const listing = await tools.bash({ command: "ls notes", description: "List notes" })\n'
      + 'const demo = await tools.read({ file_path: "notes/demo.txt" })\n'
      + 'await tools.read({ file_path: "notes/missing.txt" }).catch(() => "tolerated")\n'
      + 'return { listing, demo }'
    const args = JSON.stringify({ code: program, description: 'Read the notes files and summarize' })
    push({ type: 'turn/start', data: { turn } })
    push({ type: 'user/message', surfaceOp: 'append', data: userMessage(text(`问题 ${turn}：run_code 样本。`)) })
    push({ type: 'step/start', data: { turn, step: 0 } })
    push({
      type: 'assistant/message', surfaceOp: 'append',
      data: { turn, step: 0, message: assistantMessage([{ type: 'tool-call', id: callId, name: 'run_code', arguments: args } as ContentBlock]) },
    })
    push({ type: 'tool/call', data: { turn, step: 0, callId, name: 'run_code', arguments: args } })
    const dispatchPair = (n: number, name: string, dispatchArgs: Record<string, unknown>, resultText: string, isError = false): void => {
      push({
        type: 'tool/ptc-dispatch-start',
        data: { rootCallId: callId, parentCallId: callId, subCallId: `${callId}:ptc:${n}`, name, arguments: dispatchArgs },
      })
      push({
        type: 'tool/ptc-dispatch',
        data: {
          rootCallId: callId, parentCallId: callId, subCallId: `${callId}:ptc:${n}`, name,
          arguments: dispatchArgs, isError, content: [{ type: 'text', text: resultText }],
        },
      })
    }
    dispatchPair(1, 'bash', { command: 'ls notes', description: 'List notes' }, 'demo.txt\nnew-demo.txt')
    dispatchPair(2, 'read', { file_path: 'notes/demo.txt' }, 'hello fixture\n')
    dispatchPair(3, 'read', { file_path: 'notes/missing.txt' }, 'Error: ENOENT: notes/missing.txt not found', true)
    push({
      type: 'tool/result', surfaceOp: 'append',
      data: { turn, step: 0, message: toolResultMessage(callId, text('{"listing":"demo.txt\\nnew-demo.txt","demo":"hello fixture\\n"}'), false) },
    })
    push({ type: 'step/end', data: { turn, step: 0 } })
    push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  }
  // Turn 74: todo_write sample — the TodoRow toolview in the flow plus the
  // todo/write snapshot event feeding the TodoPanel plan strip. Two items are
  // in_progress: this fixture chooses the parallel policy, so both surfaces
  // must render a parallel plan rather than the first active item alone.
  // A tagged/untagged mix exercises the board's tag chips and filter bar.
  const fixtureTodos = [
    { content: '梳理需求', status: 'completed', tags: ['planning'] },
    { content: '实现 fixture 样本', status: 'in_progress', tags: ['demo'] },
    { content: '跑后台构建', status: 'in_progress' },
    { content: '浏览器验收', status: 'pending', tags: ['demo'] },
  ]
  // Turn 66: the terminal sample turn 60's two clean prompt rows cannot cover —
  // ANSI SGR coloring, output past the terminal card's height cap, a nested cwd
  // whose prompt label is its last segment, and a non-zero exit. The raw result
  // includes an `[exit code: N]` marker below; Client
  // derivation consumes it into the status pill before rendering the body.
  //
  // Ordered BEFORE the todo turn deliberately: the standing plan retires at the
  // next `turn/start`, so a turn appended after it would leave the dock's plan
  // strip empty and take the todo surfaces' own coverage with it.
  toolTurn(
    66,
    'bash',
    '{"command":"pnpm run check","description":"fixture 终端样本","workdir":"/tmp/fixture/deep/nested"}',
    `${TERMINAL_OUTPUT_FIXTURE}\n[exit code: 1]`,
  )

  // Turns 67-68 carry the search card's two metadata variants: grouped matches
  // and a flat path list, both truncated with a larger pre-cap total. Both use
  // the keyed SearchRow registration. They stay before the todo turn for the
  // same standing-plan reason as the bash turn.
  toolTurn(
    67,
    'grep',
    '{"pattern":"SEARCH_MAX_LINES","path":"packages/client"}',
    SEARCH_MATCHES_TEXT,
    { shape: 'matches', files: SEARCH_MATCHES_FIXTURE, truncated: true, total: 42 },
  )
  toolTurn(
    68,
    'glob',
    '{"pattern":"**/SearchBlock*","path":"packages/client"}',
    SEARCH_PATHS_TEXT,
    { shape: 'paths', paths: SEARCH_PATHS_FIXTURE, truncated: true, total: 23 },
  )

  // Turn 69: the read sample — a WINDOW past an offset so the card draws file
  // line numbers starting above 1 and a "showing N of M" note (the window is
  // shorter than READ_SAMPLE_TOTAL), with a `ts` language hint the shiki path
  // highlights. Named `read`, so it exercises the keyed ReadRow registration.
  // The run_code sub-dispatches above cover nested read calls without result
  // metadata; this top-level result carries the structured window.
  toolTurn(
    69,
    'read',
    `{"file_path":${JSON.stringify(READ_SAMPLE_PATH)},"offset":${READ_SAMPLE_FIRST_LINE}}`,
    READ_SAMPLE_TEXT,
    {
      path: READ_SAMPLE_PATH,
      offset: READ_SAMPLE_FIRST_LINE,
      lines: READ_SAMPLE_LINES,
      totalLines: READ_SAMPLE_TOTAL,
      lang: 'ts',
    },
  )

  // Turns 70-71 carry the web tools' result metadata. They stay before the todo
  // turn because a later turn/start retires the standing plan projection.
  toolTurn(
    70,
    'web_search',
    '{"queries":["deepseek harness architecture"]}',
    'Search results for deepseek harness architecture.',
    WEB_SEARCH_META,
  )
  toolTurn(
    71,
    'web_fetch',
    '{"url":"https://www.deepseek.com/blog/harness-architecture"}',
    '# Harness architecture\n\nEverything is a plugin.',
    WEB_FETCH_META,
  )

  // Turn 72: max-tokens sample — the provider ends the turn at its output cap
  // mid-sentence, so the chat flow must render the turn-max-tokens notice
  // instead of ending silently. Ordered before the todo turn for the same
  // standing-plan reason the bash turn is.
  push({ type: 'turn/start', data: { turn: 72 } })
  push({ type: 'user/message', surfaceOp: 'append', data: userMessage(text('问题 72：请完整列出全部一百条条目。')) })
  push({ type: 'step/start', data: { turn: 72, step: 0 } })
  push({
    type: 'assistant/message',
    surfaceOp: 'append',
    data: { turn: 72, step: 0, message: assistantMessage(text('条目 1：第一条。条目 2：第二条。条目 3：这一条写到一半被')) },
  })
  push({ type: 'step/end', data: { turn: 72, step: 0 } })
  push({ type: 'turn/end', data: { turn: 72, reason: { kind: 'max-tokens' } } })

  // Turn 73: user and assistant images share one durable fixture object.
  // The todo turn remains last so its standing projection stays visible.
  push({ type: 'turn/start', data: { turn: 73 } })
  push({
    type: 'user/message',
    surfaceOp: 'append',
    data: userMessage([{ type: 'image', attachment: FIXTURE_IMAGE_REF }, ...text('历史用户图片')]),
  })
  push({ type: 'step/start', data: { turn: 73, step: 0 } })
  push({
    type: 'assistant/message',
    surfaceOp: 'append',
    data: {
      turn: 73,
      step: 0,
      message: assistantMessage(
        [...text('结构化模型图片：'), { type: 'image', attachment: FIXTURE_IMAGE_REF }],
        'fx-vision',
      ),
    },
  })
  push({ type: 'step/end', data: { turn: 73, step: 0 } })
  push({ type: 'turn/end', data: { turn: 73, reason: { kind: 'completed' } } })

  const todoArgs = JSON.stringify({ todos: fixtureTodos })
  toolTurn(74, 'todo_write', todoArgs, 'Updated todo list: 1 pending, 2 in progress, 1 completed.')
  // The real tool appends the snapshot mid-execution — between tool/call and
  // tool/result — so the fixture reproduces that exact ordering (the last
  // toolTurn events run ... tool/call, tool/result, step/end, turn/end).
  const callIndex = events.length - 4
  const callTime = events[callIndex]?.time as number
  events.splice(callIndex + 1, 0, { type: 'todo/write', time: callTime + 400, data: { todos: fixtureTodos } })
  events.forEach((e, i) => { e.seq = i })
  return events as unknown as SessionEvent[]
}
