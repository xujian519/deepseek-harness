/**
 * Durable stores beside the project document: journal and ledger round-trips,
 * ordering, replacement, deduplication, path derivation, and rejection of
 * malformed files.
 */

import { mkdir, mkdtemp, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import {
  BUDGET_LEDGER_FILE,
  TASK_JOURNAL_FILE,
  appendLedgerEntry,
  findTaskRecord,
  forgetTask,
  ledgerCost,
  readLedger,
  readTaskRecords,
  recordTask,
  requestOfTask,
  storePathOf,
  taskRequestOf,
  writeTaskRecords,
  type MediaLedgerEntry,
  type MediaTaskRecord,
} from '../src/index.ts'

let root: string
let ctx: Context
let projectPath: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-video-store-')))
  ctx = new Context()
  await ctx.plugin(LocalFileSystem, { cwd: root }).await()
  projectPath = join(root, 'video', 'one', 'project.json')
  await mkdir(dirname(projectPath), { recursive: true })
})

afterEach(async () => {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

/** One in-flight video record. */
function record(overrides: Partial<MediaTaskRecord> = {}): MediaTaskRecord {
  return {
    task: {
      id: 'minimax-video-1',
      provider: 'minimax',
      model: 'MiniMax-H3',
      kind: 'video',
      status: 'running',
    },
    submittedAt: 1_000,
    request: { kind: 'video', model: 'MiniMax-H3', prompt: 'a lantern', durationSec: 4 },
    outputPath: 'shots/s01.mp4',
    ...overrides,
  }
}

/** One ledger entry. */
function entry(overrides: Partial<MediaLedgerEntry> = {}): MediaLedgerEntry {
  return {
    taskId: 'minimax-video-1',
    kind: 'video',
    model: 'MiniMax-H3',
    costCny: 2,
    at: '2026-10-31T00:00:00.000Z',
    ...overrides,
  }
}

describe('store paths', () => {
  it('places both stores beside the project document', () => {
    expect(storePathOf(projectPath, TASK_JOURNAL_FILE)).toBe(join(dirname(projectPath), 'tasks.json'))
    expect(storePathOf('video/one/project.json', BUDGET_LEDGER_FILE)).toBe('video/one/budget.json')
  })

  it('projects the persisted request without empty fields', () => {
    const persisted = taskRequestOf({ kind: 'video', prompt: 'x' }, 'm')
    expect(persisted).toEqual({ kind: 'video', model: 'm', prompt: 'x' })
    expect(requestOfTask({ ...persisted, durationSec: undefined, aspectRatio: undefined, resolution: undefined }))
      .toEqual({ kind: 'video', model: 'm', prompt: 'x' })
    expect(taskRequestOf(
      { kind: 'video', prompt: 'x', durationSec: 4, aspectRatio: '9:16', resolution: '768P' },
      'm',
    )).toEqual({ kind: 'video', model: 'm', prompt: 'x', durationSec: 4, aspectRatio: '9:16', resolution: '768P' })
  })
})

describe('task journal', () => {
  it('treats a missing journal as empty', async () => {
    expect(await readTaskRecords(ctx, projectPath, root)).toEqual([])
    expect(await findTaskRecord(ctx, projectPath, 'none', root)).toBeUndefined()
  })

  it('orders records by submission time and replaces one by task id', async () => {
    await recordTask(ctx, projectPath, record({ submittedAt: 2_000, task: { ...record().task, id: 'b' } }), root)
    await recordTask(ctx, projectPath, record({ submittedAt: 1_000 }), root)
    expect((await readTaskRecords(ctx, projectPath, root)).map(item => item.task.id)).toEqual([
      'minimax-video-1',
      'b',
    ])

    await recordTask(ctx, projectPath, record({ submittedAt: 3_000, task: { ...record().task, status: 'submitted' } }), root)
    const updated = await readTaskRecords(ctx, projectPath, root)
    expect(updated).toHaveLength(2)
    expect(updated.at(-1)?.task.status).toBe('submitted')
    expect((await findTaskRecord(ctx, projectPath, 'b', root))?.submittedAt).toBe(2_000)
  })

  it('forgets a task without creating the file when it is absent', async () => {
    await forgetTask(ctx, projectPath, 'none', root)
    await expect(stat(storePathOf(projectPath, TASK_JOURNAL_FILE))).rejects.toMatchObject({ code: 'ENOENT' })

    await recordTask(ctx, projectPath, record(), root)
    await forgetTask(ctx, projectPath, 'minimax-video-1', root)
    expect(await readTaskRecords(ctx, projectPath, root)).toEqual([])
  })

  it('propagates a transport failure that is not a missing file', async () => {
    const original = ctx.fs.readText.bind(ctx.fs)
    ctx.fs.readText = async () => { throw new Error('transport down') }
    await expect(readTaskRecords(ctx, projectPath, root)).rejects.toThrow('transport down')
    ctx.fs.readText = original
  })

  it('rejects malformed JSON, a wrong version, and mismatched task fields', async () => {
    const path = storePathOf(projectPath, TASK_JOURNAL_FILE)
    await writeFile(path, '{', 'utf8')
    await expect(readTaskRecords(ctx, projectPath, root)).rejects.toMatchObject({ code: 'MEDIA_STORE_INVALID' })

    await writeFile(path, JSON.stringify({ schemaVersion: 2, tasks: [] }), 'utf8')
    await expect(readTaskRecords(ctx, projectPath, root)).rejects.toMatchObject({ code: 'MEDIA_STORE_INVALID' })

    await writeFile(path, JSON.stringify({ schemaVersion: 1, tasks: [{ ...record(), request: { ...record().request, kind: 'image' } }] }), 'utf8')
    await expect(readTaskRecords(ctx, projectPath, root)).rejects.toMatchObject({ code: 'MEDIA_STORE_INVALID' })

    await writeFile(path, JSON.stringify({ schemaVersion: 1, tasks: [{ ...record(), request: { ...record().request, model: 'other' } }] }), 'utf8')
    await expect(readTaskRecords(ctx, projectPath, root)).rejects.toMatchObject({ code: 'MEDIA_STORE_INVALID' })
  })

  it('refuses to write a terminal or malformed record', async () => {
    await expect(writeTaskRecords(ctx, projectPath, [record({ task: { ...record().task, status: 'succeeded' } })], root))
      .rejects.toMatchObject({ code: 'MEDIA_STORE_INVALID' })
    await expect(recordTask(ctx, projectPath, record({ outputPath: '' }), root))
      .rejects.toMatchObject({ code: 'MEDIA_STORE_INVALID' })
  })
})

describe('budget ledger', () => {
  it('treats a missing ledger as empty and sums charges', async () => {
    expect(await readLedger(ctx, projectPath, root)).toEqual([])
    expect(ledgerCost([])).toBe(0)
    expect(await appendLedgerEntry(ctx, projectPath, entry(), root)).toBe(true)
    expect(await appendLedgerEntry(ctx, projectPath, entry({ taskId: 'other', costCny: 0.5 }), root)).toBe(true)
    expect(ledgerCost(await readLedger(ctx, projectPath, root))).toBe(2.5)
  })

  it('sums repeated charges in fen without float drift', () => {
    expect(ledgerCost([
      entry({ taskId: 'a', costCny: 0.1 }),
      entry({ taskId: 'b', costCny: 0.2 }),
    ])).toBe(0.3)
  })

  it('ignores a repeated charge for the same task', async () => {
    await appendLedgerEntry(ctx, projectPath, entry(), root)
    expect(await appendLedgerEntry(ctx, projectPath, entry({ costCny: 9 }), root)).toBe(false)
    expect(ledgerCost(await readLedger(ctx, projectPath, root))).toBe(2)
  })

  it('rejects malformed files and invalid new charges', async () => {
    const path = storePathOf(projectPath, BUDGET_LEDGER_FILE)
    await writeFile(path, '[]', 'utf8')
    await expect(readLedger(ctx, projectPath, root)).rejects.toMatchObject({ code: 'MEDIA_STORE_INVALID' })

    await writeFile(path, JSON.stringify({ schemaVersion: 1, entries: [entry({ costCny: -1 })] }), 'utf8')
    await expect(readLedger(ctx, projectPath, root)).rejects.toMatchObject({ code: 'MEDIA_STORE_INVALID' })

    await rm(path)
    await expect(appendLedgerEntry(ctx, projectPath, entry({ costCny: Number.NaN }), root))
      .rejects.toMatchObject({ code: 'MEDIA_STORE_INVALID' })
  })
})
