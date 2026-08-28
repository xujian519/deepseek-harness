/**
 * Tool-layer tests for the eight agent-terminal tools: registration shape,
 * the combined disposer, canonical-output contract (validated against each
 * tool's declared output schema exactly like the registry's
 * `createSuccessResult` does), per-session ownership, and the UTF-8
 * truncation boundary. The pty registry is stubbed (no real spawn): the
 * wiring of the tools themselves is the subject here — pty behavior is
 * covered by agent-pty.spec.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import { validateJsonSchemaValue, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { boundBytes, registerTools } from '../src/tools.ts'
import type { AgentPtyRegistry } from '../src/agent-pty.ts'
import type { Context } from '../src/context-types.ts'

/** One registration captured by the fake tools service. */
interface CapturedTool {
  definition: ToolDefinition
}

/** Stub registry: uuid-keyed rows without a real pty. */
class FakeRegistry {
  readonly terminals = new Map<string, { sessionId: string; title: string; command: string; exited: boolean }>()

  create(sessionId: string, title: string, command: string): string {
    const uuid = `uuid-${this.terminals.size + 1}`
    this.terminals.set(uuid, { sessionId, title, command, exited: false })
    return uuid
  }

  list(sessionId: string): Array<{ uuid: string; title: string; command: string; exited: boolean }> {
    return [...this.terminals.entries()]
      .filter(([, row]) => row.sessionId === sessionId)
      .map(([uuid, row]) => ({ uuid, title: row.title, command: row.command, exited: row.exited }))
  }

  assertOwned(uuid: string, sessionId: string): void {
    const row = this.terminals.get(uuid)
    if (row === undefined || row.sessionId !== sessionId) {
      throw new Error(`agent terminal "${uuid}" not found`)
    }
  }

  send(): void {}

  read(): { text: string; totalLines: number; lineBegin: number; lineEnd: number } {
    // A page larger than the tool's 256 KiB read cap, to exercise boundBytes.
    return { text: 'x'.repeat(300 * 1024), totalLines: 1, lineBegin: 0, lineEnd: 1 }
  }

  resize(_uuid: string, cols: number, rows: number): { cols: number; rows: number } {
    return { cols, rows }
  }

  signal(): void {}

  close(): boolean {
    return true
  }

  waitFor(_uuid: string, needle: string): Promise<{ kind: 'found'; needle: string; line: number; column: number; elapsedMs: number }> {
    // Mirrors the registry's empty-needle rejection (the tool layer no
    // longer duplicates this check).
    if (needle === '') return Promise.reject(new Error('needle must be a non-empty string'))
    return Promise.resolve({ kind: 'found', needle, line: 0, column: 0, elapsedMs: 1 })
  }
}

/** A minimal ToolRunContext for one calling session (only the slices the tools touch). */
function exec(sessionId: string): ToolRunContext {
  return {
    signal: { throwIfAborted: () => {}, aborted: false },
    agent: { session: { id: sessionId } },
  } as unknown as ToolRunContext
}

/** Register the eight tools against a fake service; the tools bind to `registry`. */
function mount(): { captured: CapturedTool[]; registry: FakeRegistry; dispose: () => number } {
  const captured: CapturedTool[] = []
  let disposeCount = 0
  const ctx = {
    tools: {
      register: (tool: unknown): (() => void) => {
        captured.push({ definition: tool as ToolDefinition })
        return () => { disposeCount += 1 }
      },
    },
  } as unknown as Context
  const registry = new FakeRegistry()
  const dispose = registerTools(ctx, registry as unknown as AgentPtyRegistry, async () => '/cwd', () => ({}))
  return { captured, registry, dispose: () => { dispose(); return disposeCount } }
}

/** The captured definition for one tool name. */
function toolOf(captured: CapturedTool[], name: string): ToolDefinition {
  const found = captured.find(candidate => candidate.definition.name === name)
  if (found === undefined) throw new Error(`tool "${name}" was not registered`)
  return found.definition
}

describe('agent terminal tools', () => {
  it('registers all eight tools and the combined disposer unregisters them all', () => {
    const { captured, dispose } = mount()
    expect(captured.map(candidate => candidate.definition.name)).toEqual([
      'terminal_create',
      'terminal_list',
      'terminal_send',
      'terminal_read',
      'terminal_wait_for',
      'terminal_resize',
      'terminal_signal',
      'terminal_close',
    ])
    expect(dispose()).toBe(8)
    // Disposing twice must not throw (each registry disposer is idempotent).
    expect(() => mount().dispose()).not.toThrow()
  })

  it('terminal_create returns the uuid and echoed title (schema-valid)', async () => {
    const { captured, registry } = mount()
    const tool = toolOf(captured, 'terminal_create')
    const value = await tool.execute({ title: 'dev server', command: 'npm run dev' }, exec('s1'))
    expect(value).toMatchObject({ title: 'dev server' })
    expect(typeof (value as { uuid: unknown }).uuid).toBe('string')
    expect(registry.terminals.size).toBe(1)
    expect(validateJsonSchemaValue(tool.output.schema, value, 'value')).toEqual([])
  })

  it('terminal_list output matches the declared schema — no sessionId leaks', async () => {
    const { captured, registry } = mount()
    const tool = toolOf(captured, 'terminal_list')
    const uuid = registry.create('s1', 'dev server', 'npm run dev')
    registry.create('s2', 'other session', 'top secret')
    const value = await tool.execute({}, exec('s1'))
    const list = value as Array<Record<string, unknown>>
    expect(list).toHaveLength(1)
    expect(list[0]!.uuid).toBe(uuid)
    // The session id is registry-internal ownership, never serialized.
    expect('sessionId' in list[0]!).toBe(false)
    // And the whole value validates against the declared output schema —
    // this is the contract the registry enforces at runtime (additionalProperties: false).
    expect(validateJsonSchemaValue(tool.output.schema, value, 'value')).toEqual([])
  })

  it('rejects a uuid owned by another session (send/read/resize/signal/close/wait_for)', async () => {
    const { captured, registry } = mount()
    const mine = registry.create('s1', 'mine', '')
    const foreign = registry.create('s2', 'theirs', '')
    for (const name of ['terminal_send', 'terminal_read', 'terminal_resize', 'terminal_signal', 'terminal_close', 'terminal_wait_for']) {
      const tool = toolOf(captured, name)
      const args = name === 'terminal_send' ? { uuid: foreign, text: 'ls' }
        : name === 'terminal_read' ? { uuid: foreign }
          : name === 'terminal_resize' ? { uuid: foreign, cols: 80, rows: 24 }
            : name === 'terminal_signal' ? { uuid: foreign, signal: 'SIGINT' }
              : name === 'terminal_close' ? { uuid: foreign }
                : { uuid: foreign, needle: 'x', timeout_ms: 100 }
      // A foreign uuid is indistinguishable from an unknown one.
      await expect(tool.execute(args, exec('s1'))).rejects.toThrow(/not found/)
    }
    // Own-session uuids still work.
    const sendTool = toolOf(captured, 'terminal_send')
    await expect(sendTool.execute({ uuid: mine, text: 'ls' }, exec('s1'))).resolves.toBeDefined()
    const closeTool = toolOf(captured, 'terminal_close')
    await expect(closeTool.execute({ uuid: mine }, exec('s1'))).resolves.toMatchObject({ closed: true })
  })

  it('terminal_read truncates at the byte cap and reports it (schema-valid)', async () => {
    const { captured, registry } = mount()
    const tool = toolOf(captured, 'terminal_read')
    const uuid = registry.create('s1', 'reader', '')
    const value = await tool.execute({ uuid }, exec('s1'))
    const result = value as { text: string; truncated: boolean }
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(result.text, 'utf8')).toBeLessThanOrEqual(256 * 1024)
    expect(validateJsonSchemaValue(tool.output.schema, value, 'value')).toEqual([])
  })

  it('terminal_resize echoes the registry-applied dimensions (schema-valid)', async () => {
    const { captured, registry } = mount()
    const tool = toolOf(captured, 'terminal_resize')
    const uuid = registry.create('s1', 'resizer', '')
    const value = await tool.execute({ uuid, cols: 120, rows: 40 }, exec('s1'))
    expect(value).toEqual({ uuid, cols: 120, rows: 40 })
    expect(validateJsonSchemaValue(tool.output.schema, value, 'value')).toEqual([])
  })

  it('terminal_wait_for returns the registry result in camelCase (schema-valid, no projection)', async () => {
    const { captured, registry } = mount()
    const tool = toolOf(captured, 'terminal_wait_for')
    const uuid = registry.create('s1', 'waiter', '')
    const value = await tool.execute({ uuid, needle: 'done' }, exec('s1'))
    expect(value).toEqual({ kind: 'found', needle: 'done', line: 0, column: 0, elapsedMs: 1 })
    expect(validateJsonSchemaValue(tool.output.schema, value, 'value')).toEqual([])
  })

  it('terminal_wait_for rejects an empty needle through the registry (no duplicate check)', async () => {
    const { captured, registry } = mount()
    const tool = toolOf(captured, 'terminal_wait_for')
    const uuid = registry.create('s1', 'waiter', '')
    await expect(tool.execute({ uuid, needle: '' }, exec('s1'))).rejects.toThrow(/non-empty/)
  })
})

describe('boundBytes', () => {
  it('never splits a multi-byte UTF-8 sequence at the cap', () => {
    // '€' is 3 bytes (E2 82 AC); the cap must retreat to a sequence boundary.
    expect(boundBytes('a€b', 2)).toEqual({ text: 'a', truncated: true })
    expect(boundBytes('a€b', 3)).toEqual({ text: 'a', truncated: true })
    expect(boundBytes('a€b', 4)).toEqual({ text: 'a€', truncated: true })
    expect(boundBytes('a€b', 5)).toEqual({ text: 'a€b', truncated: false })
    expect(boundBytes('€', 1)).toEqual({ text: '', truncated: true })
    // ASCII pages truncate at the byte cap directly.
    expect(boundBytes('hello', 3)).toEqual({ text: 'hel', truncated: true })
  })

  it('every retained prefix decodes without U+FFFD', () => {
    for (let n = 1; n <= 18; n += 1) {
      const { text } = boundBytes('中文字符串测试 123', n)
      expect(text.includes('\uFFFD')).toBe(false)
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(n)
    }
  })
})

describe('agent terminal tool renders and execution guards', () => {
  /** The render blocks for one tool's canonical value. */
  const renderOf = (name: string, value: unknown): Array<{ type: string; text: string }> => {
    const render = toolOf(mount().captured, name).output?.render
    if (render === undefined) throw new Error(`tool "${name}" has no render`)
    return render({}, value as never) as Array<{ type: string; text: string }>
  }

  it('terminal_create and terminal_send renders announce the handle and byte count', () => {
    expect(renderOf('terminal_create', { uuid: 'u-1', title: 'dev server' })).toEqual([
      { type: 'text', text: 'Opened terminal "dev server" (uuid: u-1). The sidebar tab appears automatically; use terminal_read to see output and terminal_send (with submit=true) to run more commands.' },
    ])
    expect(renderOf('terminal_send', { uuid: 'u-1', bytes: 3 })).toEqual([
      { type: 'text', text: 'Sent 3 byte(s) to terminal u-1.' },
    ])
  })

  it('terminal_list renders empty, running, and exited rows (exit code and signal fallbacks)', () => {
    expect(renderOf('terminal_list', [])).toEqual([
      { type: 'text', text: 'No agent terminals open in this session.' },
    ])
    const text = renderOf('terminal_list', [
      { uuid: 'u-live', title: 'live', command: 'top', exited: false },
      { uuid: 'u-dead', title: 'dead', command: 'exit', exited: true, exitCode: 0, exitSignal: null },
      { uuid: 'u-odd', title: 'odd', command: 'kill -9', exited: true },
    ])[0]!.text
    expect(text).toContain('Agent terminals in this session:')
    expect(text).toContain('u-live  "live"  [running]  $ top')
    expect(text).toContain('u-dead  "dead"  [exited (code 0, signal none)]  $ exit')
    // A dead row without recorded code/signal falls back to ?/none.
    expect(text).toContain('u-odd  "odd"  [exited (code ?, signal none)]  $ kill -9')
  })

  it('terminal_read renders the page header with and without the truncation marker', () => {
    expect(renderOf('terminal_read', { text: 'page', totalLines: 9, lineBegin: 2, lineEnd: 5, truncated: false })).toEqual([
      { type: 'text', text: '[lines 2..5 of 9]\npage' },
    ])
    expect(renderOf('terminal_read', { text: 'big', totalLines: 9, lineBegin: 0, lineEnd: 9, truncated: true })).toEqual([
      { type: 'text', text: '[lines 0..9 of 9; truncated to 256KiB]\nbig' },
    ])
  })

  it('terminal_wait_for renders all three outcomes with their details', () => {
    expect(renderOf('terminal_wait_for', { kind: 'found', needle: 'done', line: 3, column: 7, elapsedMs: 42 })).toEqual([
      { type: 'text', text: 'Found "done" at line 3, column 7 (after 42ms).' },
    ])
    expect(renderOf('terminal_wait_for', { kind: 'timeout', needle: 'done', timeoutMs: 5000, totalLines: 4 })).toEqual([
      { type: 'text', text: 'Timed out after 5000ms waiting for "done". Call terminal_read to inspect the transcript.' },
    ])
    expect(renderOf('terminal_wait_for', { kind: 'exited', needle: 'done', exitCode: 2, exitSignal: null })).toEqual([
      { type: 'text', text: 'Terminal exited before "done" appeared (exit code 2).' },
    ])
    // Without a recorded code the exited render carries no suffix.
    expect(renderOf('terminal_wait_for', { kind: 'exited', needle: 'done' })).toEqual([
      { type: 'text', text: 'Terminal exited before "done" appeared.' },
    ])
  })

  it('terminal_resize, terminal_signal, and terminal_close render their outcomes', () => {
    expect(renderOf('terminal_resize', { uuid: 'u-1', cols: 120, rows: 40 })).toEqual([
      { type: 'text', text: 'Resized terminal u-1 to 120×40.' },
    ])
    expect(renderOf('terminal_signal', { uuid: 'u-1', signal: 'SIGINT' })).toEqual([
      { type: 'text', text: 'Sent SIGINT to terminal u-1.' },
    ])
    expect(renderOf('terminal_close', { uuid: 'u-1', closed: true })).toEqual([
      { type: 'text', text: 'Closed terminal u-1.' },
    ])
    expect(renderOf('terminal_close', { uuid: 'u-1', closed: false })).toEqual([
      { type: 'text', text: 'Terminal u-1 was already closed.' },
    ])
  })

  it('the tools refuse to run without an initiating agent', async () => {
    const { captured } = mount()
    await expect(toolOf(captured, 'terminal_list').execute({}, { signal: { throwIfAborted: () => {} } } as unknown as ToolRunContext))
      .rejects.toThrow(/require an initiating agent/)
  })

  it('terminal_send appends the Enter key only when submit is set', async () => {
    const { captured, registry } = mount()
    const sendSpy = vi.spyOn(registry, 'send')
    const tool = toolOf(captured, 'terminal_send')
    const uuid = registry.create('s1', 'sender', '')
    await tool.execute({ uuid, text: 'ls' }, exec('s1'))
    await tool.execute({ uuid, text: 'ls -la', submit: true }, exec('s1'))
    expect(sendSpy).toHaveBeenNthCalledWith(1, uuid, 'ls')
    expect(sendSpy).toHaveBeenNthCalledWith(2, uuid, 'ls -la\r')
  })

  it('terminal_close reports an already-gone uuid through the registry', async () => {
    const { captured, registry } = mount()
    vi.spyOn(registry, 'close').mockReturnValue(false)
    const tool = toolOf(captured, 'terminal_close')
    const uuid = registry.create('s1', 'gone', '')
    await expect(tool.execute({ uuid }, exec('s1'))).resolves.toEqual({ uuid, closed: false })
  })
})
