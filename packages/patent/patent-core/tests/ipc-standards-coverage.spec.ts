import { expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  formatStandardsAsContext,
  loadIpcStandards,
  queryByArticle,
  queryIpcDetail,
  queryIpcStandards,
  searchStandards,
} from '@deepseek-ai/dsh-patent-core'

it('loadIpcStandards：缺省资产路径经候选位置解析并缓存', () => {
  const index = loadIpcStandards()
  expect(index.all.length).toBeGreaterThan(100)
  // 二次调用命中模块级缓存
  expect(loadIpcStandards()).toBe(index)
  // 查询兜底分支
  expect(queryIpcStandards('Z')).toEqual([])
  expect(queryIpcDetail('ZZ99')).toEqual([])
  expect(queryByArticle('no-such-article')).toEqual([])
  expect(searchStandards('')).toEqual([])
  expect(searchStandards('  ')).toEqual([])
  expect(formatStandardsAsContext([])).toBe('')
})

it('loadIpcStandards：fixture 畸形卡片字段兜底（模块重置后走 overridePath）', async () => {
  vi.resetModules()
  const { loadIpcStandards: freshLoad, queryIpcStandards: freshQuery, formatStandardsAsContext: freshFormat } =
    await import('@deepseek-ai/dsh-patent-core')
  const dir = mkdtempSync(join(tmpdir(), 'ipc-fixture-'))
  writeFileSync(join(dir, 'standards.yaml'), [
    'standards:',
    '  - id: 42',
    '    article: 3',
    '    ipcSection: 1',
    '    name: 2',
    '    keyPoints: text',
    '    tips: 5',
    '    source: 6',
    '  -',
    '  - id: G01',
    '    article: art',
    '    ipcSection: G',
    '    name: 规则G',
    '    keyPoints: [要点A]',
    '    tips: []',
    '    source: src',
    '  - id: G02',
    '    ipcSection: G',
    '    article: art2',
    '    name: 无明细规则',
  ].join('\n'))
  try {
    const index = freshLoad(join(dir, 'standards.yaml'))
    expect(index.all.length).toBe(4)
    const first = index.all[0]!
    expect(first.id).toBe('standards-0') // 非字符串 id → 序号兜底
    expect(first.article).toBe('')
    expect(first.ipcSection).toBe('')
    expect(first.ipcDetail).toBeUndefined()
    expect(first.name).toBe('')
    expect(first.keyPoints).toEqual([])
    expect(first.tips).toEqual([])
    expect(first.source).toBe('')
    // null 条目 → 空卡片
    expect(index.all[1]!.id).toBe('standards-1')
    // 有效卡片保留字段
    expect(index.all[2]!.name).toBe('规则G')
    expect(index.all[2]!.keyPoints).toEqual(['要点A'])
    // 空 ipcSection/article 不入分组
    expect(freshQuery('G').map(c => c.id)).toEqual(['G01', 'G02'])
    // 无 ipcDetail 的格式化兜底
    const md = freshFormat(index.all.filter(c => c.id === 'G02'))
    expect(md).toContain('[G] 无明细规则')

    // 无 standards 键的 YAML → 空卡片列表（再次模块重置）
    vi.resetModules()
    const { loadIpcStandards: freshLoad2 } = await import('@deepseek-ai/dsh-patent-core')
    const bare = mkdtempSync(join(tmpdir(), 'ipc-bare-'))
    writeFileSync(join(bare, 'bare.yaml'), 'other: 1\n')
    try {
      expect(freshLoad2(join(bare, 'bare.yaml')).all).toEqual([])
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
