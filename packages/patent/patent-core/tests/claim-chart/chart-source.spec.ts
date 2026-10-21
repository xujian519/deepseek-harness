import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  readChartSource,
  resolveChartSourcePolicy,
  type ChartSourcePolicy,
} from '../../src/atoms/handlers/builtin/chart-source.ts'

const fsMock = vi.hoisted(() => ({ oversizedRead: false }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: (async (path: string, encoding: BufferEncoding) => {
      if (fsMock.oversizedRead) return 'x'.repeat(20)
      return actual.readFile(path, encoding)
    }) as typeof actual.readFile,
  }
})

async function inTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'chart-source-'))
  try {
    await run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function policyFor(dir: string, maxBytes = 1024): Promise<ChartSourcePolicy> {
  const result = await resolveChartSourcePolicy([dir], maxBytes, dir)
  if (!result.ok) throw new Error(result.reason)
  return result.policy
}

describe('resolveChartSourcePolicy', () => {
  it('未配置根时只允许 cwd 的真实路径', async () => {
    await inTempDir(async (dir) => {
      const result = await resolveChartSourcePolicy(undefined, 100, dir)
      expect(result).toEqual({
        ok: true,
        policy: { roots: [realpathSync(dir)], maxBytes: 100, cwd: dir },
      })
    })
  })

  it('显式根替换默认值、去重并解析符号链接', async () => {
    await inTempDir(async (dir) => {
      const sub = join(dir, 'sub')
      mkdirSync(sub)
      const link = join(dir, 'root-link')
      symlinkSync(sub, link, 'dir')
      const result = await resolveChartSourcePolicy([sub, link], 100, dir)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.policy.roots).toEqual([realpathSync(sub)])
    })
  })

  it('空根列表不添加任何允许根', async () => {
    await inTempDir(async (dir) => {
      const result = await resolveChartSourcePolicy([], 100, dir)
      expect(result).toEqual({ ok: true, policy: { roots: [], maxBytes: 100, cwd: dir } })
    })
  })

  it('根不存在或不是目录 → 失败', async () => {
    await inTempDir(async (dir) => {
      const missing = await resolveChartSourcePolicy([join(dir, 'missing')], 100, dir)
      expect(missing.ok).toBe(false)
      if (!missing.ok) expect(missing.reason).toMatch(/无法解析/)

      const file = join(dir, 'root.txt')
      writeFileSync(file, 'x', 'utf8')
      const notDirectory = await resolveChartSourcePolicy([file], 100, dir)
      expect(notDirectory.ok).toBe(false)
      if (!notDirectory.ok) expect(notDirectory.reason).toMatch(/不是目录/)
    })
  })
})

describe('readChartSource', () => {
  it('允许根内的相对路径与大小写扩展名可读', async () => {
    await inTempDir(async (dir) => {
      writeFileSync(join(dir, 'D1.TXT'), '对比文件正文', 'utf8')
      const result = await readChartSource('D1.TXT', await policyFor(dir))
      expect(result).toEqual({ ok: true, text: '对比文件正文' })
    })
  })

  it('无扩展名按纯文本读取', async () => {
    await inTempDir(async (dir) => {
      writeFileSync(join(dir, 'D1'), '正文', 'utf8')
      const result = await readChartSource(join(dir, 'D1'), await policyFor(dir))
      expect(result).toEqual({ ok: true, text: '正文' })
    })
  })

  it('根外绝对路径与 ../ 穿越 → 不在允许目录', async () => {
    await inTempDir(async (dir) => {
      const root = join(dir, 'allowed')
      mkdirSync(root)
      const outside = join(dir, 'outside.txt')
      writeFileSync(outside, '机密', 'utf8')
      const policy = await policyFor(root)
      expect(await readChartSource(outside, policy)).toEqual({ ok: false, reason: '不在允许目录' })
      expect(await readChartSource('../outside.txt', policy)).toEqual({
        ok: false,
        reason: '不在允许目录',
      })
    })
  })

  it('符号链接指向根外 → 拒绝；指向根内 → 可读', async () => {
    await inTempDir(async (dir) => {
      const root = join(dir, 'root')
      mkdirSync(root)
      writeFileSync(join(root, 'real.txt'), '根内正文', 'utf8')
      const outside = join(dir, 'outside.txt')
      writeFileSync(outside, '根外正文', 'utf8')
      symlinkSync(outside, join(root, 'escape.txt'))
      symlinkSync(join(root, 'real.txt'), join(root, 'alias.txt'))
      const policy = await policyFor(root)
      expect(await readChartSource(join(root, 'escape.txt'), policy)).toEqual({
        ok: false,
        reason: '不在允许目录',
      })
      expect(await readChartSource(join(root, 'alias.txt'), policy)).toEqual({
        ok: true,
        text: '根内正文',
      })
    })
  })

  it('目录 → 不是普通文件', async () => {
    await inTempDir(async (dir) => {
      const sub = join(dir, 'sub')
      mkdirSync(sub)
      expect(await readChartSource(sub, await policyFor(dir))).toEqual({
        ok: false,
        reason: '不是普通文件',
      })
    })
  })

  it('非文本扩展名 → 拒绝', async () => {
    await inTempDir(async (dir) => {
      const file = join(dir, 'D1.pdf')
      writeFileSync(file, '伪装成文本', 'utf8')
      expect(await readChartSource(file, await policyFor(dir))).toEqual({
        ok: false,
        reason: '不是文本扩展名（.pdf）',
      })
    })
  })

  it('磁盘大小超过上限 → 读取前拒绝', async () => {
    await inTempDir(async (dir) => {
      const file = join(dir, 'D1.txt')
      writeFileSync(file, 'x'.repeat(20), 'utf8')
      expect(await readChartSource(file, await policyFor(dir, 10))).toEqual({
        ok: false,
        reason: '超过大小上限（10 字节）',
      })
    })
  })

  it('读取后字节数超过上限 → 拒绝（防 stat 与 read 之间替换）', async () => {
    await inTempDir(async (dir) => {
      const file = join(dir, 'D1.txt')
      writeFileSync(file, 'short', 'utf8')
      fsMock.oversizedRead = true
      try {
        expect(await readChartSource(file, await policyFor(dir, 10))).toEqual({
          ok: false,
          reason: '超过大小上限（10 字节）',
        })
      } finally {
        fsMock.oversizedRead = false
      }
    })
  })

  it('文件不存在 → 不可读', async () => {
    await inTempDir(async (dir) => {
      const result = await readChartSource(join(dir, 'missing.txt'), await policyFor(dir))
      expect(result).toEqual({ ok: false, reason: '文件不存在或无法读取' })
    })
  })

  it('根内名称以 .. 开头的目录不算根外', async () => {
    await inTempDir(async (dir) => {
      const root = join(dir, 'root')
      const sibling = join(root, '..notes')
      mkdirSync(sibling, { recursive: true })
      const file = join(sibling, 'note.txt')
      writeFileSync(file, '笔记', 'utf8')
      expect(await readChartSource(file, await policyFor(root))).toEqual({ ok: true, text: '笔记' })
    })
  })
})
