import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readSvgInput } from '../src/tool/internal/svg-input.ts'

/** 下一次 readFile 的注入失败；null 时走真实文件系统。 */
const injected = vi.hoisted(() => ({ failure: undefined as (() => never) | undefined }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    readFile: async (...args: Parameters<typeof actual.readFile>) => {
      if (injected.failure !== undefined) return injected.failure()
      return actual.readFile(...args)
    },
  }
})

describe('readSvgInput', () => {
  it('returns the absolute path, workspace-relative path and text', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-svg-input-'))
    try {
      await writeFile(join(dir, 'fig.svg'), '<svg/>', 'utf8')
      const input = await readSvgInput('fig.svg', dir, 'verify_patent_figure')
      expect(input.path).toBe('fig.svg')
      expect(input.absolutePath).toBe(join(dir, 'fig.svg'))
      expect(input.svg).toBe('<svg/>')
      expect(await readFile(input.absolutePath, 'utf8')).toBe('<svg/>')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports a missing file as file_not_found', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-svg-input-'))
    try {
      await expect(readSvgInput('nope.svg', dir, 'verify_patent_figure')).rejects.toMatchObject({
        code: 'file_not_found',
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports an unreadable path with the system reason', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-svg-input-'))
    try {
      // 目录可读但读不出文本：真实 fs 的 EISDIR 带 code，走 invalid_tool_input。
      await expect(readSvgInput('.', dir, 'verify_patent_figure')).rejects.toThrow('SVG 文件不可读')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('treats an error without a code as unreadable input', async () => {
    injected.failure = () => {
      throw new Error('decoder exploded')
    }
    try {
      await expect(readSvgInput('fig.svg', '/tmp', 'verify_patent_figure'))
        .rejects.toThrow('SVG 文件不可读：fig.svg（decoder exploded）')
    } finally {
      injected.failure = undefined
    }
  })

  it('treats a non-Error failure as unreadable input', async () => {
    injected.failure = () => {
      throw 'decoder exploded'
    }
    try {
      await expect(readSvgInput('fig.svg', '/tmp', 'verify_patent_figure'))
        .rejects.toThrow('SVG 文件不可读：fig.svg（decoder exploded）')
    } finally {
      injected.failure = undefined
    }
  })
})
