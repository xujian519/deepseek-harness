import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WikiCardLoader } from '@deepseek-ai/dsh-patent-knowledge'

/**
 * WikiCardLoader tests: real on-disk wiki fixtures covering the scan, the
 * .wiki-meta.json scan cache (valid/invalid), card-index.json merging, lazy
 * content reads with cache eviction, and the failure/degradation paths.
 */

const cleanups: Array<() => void> = []
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!()
})

function makeDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  cleanups.push(() => { rmSync(dir, { recursive: true, force: true }) })
  return dir
}

/** Standard wiki fixture: patent-cards with metadata, a guide dir, and card-index.json. */
function makeWiki(dir: string): void {
  mkdirSync(join(dir, 'patent-cards'), { recursive: true })
  mkdirSync(join(dir, '专利实务/说明书'), { recursive: true })
  mkdirSync(join(dir, 'guide'), { recursive: true })
  writeFileSync(join(dir, 'patent-cards', 'bolar.md'), [
    '- 概念: Bolar例外',
    '- 领域: 侵权抗辩',
    '- 质量分: 8',
    '',
    'Bolar 例外允许为行政审批目的实施专利。',
  ].join('\n'))
  writeFileSync(join(dir, 'patent-cards', 'creative.md'), '- 概念：创造性\n\n创造性判断标准正文。')
  writeFileSync(join(dir, 'patent-cards', 'no-meta.md'), '无元数据卡片正文。')
  writeFileSync(join(dir, 'guide', 'double-check.md'), '# 双重检查\n\n指南正文。')
  writeFileSync(join(dir, 'guide', '.hidden.md'), '隐藏文件不应被扫描。')
  writeFileSync(join(dir, 'guide', 'notes.txt'), '不是 markdown。')
  writeFileSync(join(dir, '专利实务/说明书', 'claims.md'), '# 权利要求书\n\n权利要求正文。')
  writeFileSync(join(dir, 'patent-cards', 'card-index.json'), JSON.stringify({
    totalCards: 4,
    lastUpdated: '2026-01-01',
    cards: [
      { id: 'bolar', title: 'Bolar 例外审查', concept: 'Bolar例外', domain: '侵权抗辩', quality: 9, relatedConcepts: ['药品专利'] },
      { id: 'creative', title: '创造性审查', concept: '未分类', domain: '其他', quality: 7 },
      { id: 'no-meta', concept: '补充概念', domain: '补充领域' },
      { title: '无 id 条目' },
      { id: 'ghost-card', title: '幽灵卡片' },
      { id: 'double-check', title: '指南卡片' },
    ],
  }))
}

function makeLoader(dir: string, warns: string[] = []): WikiCardLoader {
  return new WikiCardLoader(dir, { logger: { warn: (...args: unknown[]) => warns.push(String(args)) } })
}

describe('WikiCardLoader scan and lookup', () => {
  it('scans markdown files, merges card-index metadata, and serves lookups', () => {
    const dir = makeDir('wiki-basic-')
    makeWiki(dir)
    const warns: string[] = []
    const loader = makeLoader(dir, warns)

    expect(loader.count()).toBe(5) // bolar, creative, no-meta, double-check, claims
    expect(warns).toEqual([])

    const bolar = loader.getById('patent-cards/bolar')
    expect(bolar?.title).toBe('Bolar 例外审查')
    expect(bolar?.concept).toBe('Bolar例外')
    expect(bolar?.domain).toBe('侵权抗辩')
    expect(bolar?.quality).toBe(9)
    expect(bolar?.relatedConcepts).toEqual(['药品专利'])
    expect(loader.getById('nope')).toBeUndefined()

    // '未分类'/'其他' keep the scanned header values.
    const creative = loader.getById('patent-cards/creative')
    expect(creative?.title).toBe('创造性审查')
    expect(creative?.concept).toBe('创造性')
    expect(creative?.domain).toBeUndefined()
    // A scanned card without card-index overrides keeps its file-derived title.
    const noMeta = loader.getById('patent-cards/no-meta')
    expect(noMeta?.title).toBe('patent cards/no meta')
    // card-index entries outside patent-cards/ (or unknown ids) are skipped.
    expect(loader.getById('guide/double-check')?.title).toBe('guide/double check')
    expect(loader.getById('patent-cards/ghost-card')).toBeUndefined()

    expect(loader.list()).toHaveLength(5)
    expect(loader.list(2)).toHaveLength(2)
  })

  it('searches by keyword across title, concept, and domain', () => {
    const dir = makeDir('wiki-search-')
    makeWiki(dir)
    const loader = makeLoader(dir)
    expect(loader.search('bolar').map(c => c.id)).toContain('patent-cards/bolar')
    expect(loader.search('侵权').map(c => c.id)).toContain('patent-cards/bolar')
    expect(loader.search('创造').map(c => c.id)).toContain('patent-cards/creative')
    // Concept-only match: the no-meta card's concept is absent from its title.
    expect(loader.search('补充概念').map(c => c.id)).toContain('patent-cards/no-meta')
    expect(loader.search('   ')).toEqual([])
    expect(loader.search('无匹配词汇')).toEqual([])
    expect(loader.search('bolar', 1)).toHaveLength(1)
  })

  it('searches within a directory prefix with optional keyword', () => {
    const dir = makeDir('wiki-searchin-')
    makeWiki(dir)
    const loader = makeLoader(dir)
    const byDir = loader.searchIn('专利实务/说明书', '')
    expect(byDir.map(c => c.id)).toEqual(['专利实务/说明书/claims'])
    expect(loader.searchIn('专利实务/说明书', 'claims').map(c => c.id)).toEqual(['专利实务/说明书/claims'])
    expect(loader.searchIn('', 'bolar').map(c => c.id)).toEqual(['patent-cards/bolar'])
    // Sibling prefix must not match on a partial path segment.
    expect(loader.searchIn('专利实务/说明书附图', '')).toEqual([])
    expect(loader.listDir('patent-cards', 1)).toHaveLength(1)
    expect(loader.listDir('guide')).toHaveLength(1)
  })

  it('matches by concept and domain case-insensitively', () => {
    const dir = makeDir('wiki-concept-')
    makeWiki(dir)
    const loader = makeLoader(dir)
    expect(loader.byConcept('bolar例外').map(c => c.id)).toEqual(['patent-cards/bolar'])
    expect(loader.byConcept('不存在')).toEqual([])
    expect(loader.byDomain('侵权抗辩').map(c => c.id)).toEqual(['patent-cards/bolar'])
    expect(loader.byDomain('不存在')).toEqual([])
  })

  it('reads card content lazily with metadata extraction and caches it', () => {
    const dir = makeDir('wiki-read-')
    makeWiki(dir)
    const loader = makeLoader(dir)
    const first = loader.readCard('patent-cards/bolar')
    expect(first?.content).toContain('Bolar 例外允许')
    expect(first?.metadata['概念']).toBe('Bolar例外')
    expect(first?.metadata['质量分']).toBe('8')
    expect(loader.readCard('patent-cards/bolar')?.content).toBe(first!.content) // cache hit
    expect(loader.readCard('missing')).toBeNull()

    // A card file removed after the scan reports null on read.
    rmSync(join(dir, 'patent-cards', 'no-meta.md'))
    expect(loader.readCard('patent-cards/no-meta')).toBeNull()
  })

  it('evicts the content cache beyond 64 entries', () => {
    const dir = makeDir('wiki-evict-')
    makeWiki(dir)
    const mass = join(dir, 'mass')
    mkdirSync(mass, { recursive: true })
    for (let i = 0; i < 70; i += 1) {
      writeFileSync(join(mass, `card-${i.toString().padStart(2, '0')}.md`), `第 ${i} 张卡片正文。`)
    }
    const loader = makeLoader(dir)
    expect(loader.count()).toBe(75)
    for (let i = 0; i < 70; i += 1) {
      const card = loader.readCard(`mass/card-${i.toString().padStart(2, '0')}`)
      expect(card?.content).toContain('正文')
    }
    // Eviction keeps the map bounded: re-reading an early card still works.
    expect(loader.readCard('mass/card-00')?.content).toContain('正文')
  })

  it('formats cards as context and truncates long bodies', () => {
    const dir = makeDir('wiki-format-')
    makeWiki(dir)
    const loader = makeLoader(dir)
    const full = loader.formatAsContext('patent-cards/bolar')
    expect(full).toContain('### Bolar 例外审查')
    expect(full).toContain('Bolar 例外允许')
    expect(full).not.toContain('（截断）')
    const truncated = loader.formatAsContext('patent-cards/bolar', 10)
    expect(truncated).toContain('（截断）')
    expect(loader.formatAsContext('missing')).toBe('')
  })

  it('skips hidden files and scans symlinked directories', () => {
    const dir = makeDir('wiki-symlink-')
    mkdirSync(join(dir, 'mass'), { recursive: true })
    writeFileSync(join(dir, 'mass', 'card.md'), '正文')
    writeFileSync(join(dir, '.hidden.md'), '隐藏')
    symlinkSync('mass', join(dir, 'link'), 'dir')
    const loader = makeLoader(dir)
    // The symlinked directory is traversed under its own relative path.
    expect(loader.list().map(c => c.id).sort()).toEqual(['link/card', 'mass/card'])
  })

  it('recovers from a scan failure (broken symlink) on retry', () => {
    const dir = makeDir('wiki-broken-')
    makeWiki(dir)
    symlinkSync(join(dir, 'does-not-exist'), join(dir, 'patent-cards', 'broken.md'))
    const warns: string[] = []
    const loader = makeLoader(dir, warns)
    expect(loader.count()).toBe(0)
    expect(warns.some(w => w.includes('扫描 wiki 目录失败'))).toBe(true)
    // rmSync leaves a dangling symlink in place on macOS; unlink the link itself.
    unlinkSync(join(dir, 'patent-cards', 'broken.md'))
    expect(loader.count()).toBe(5)
  })

  it('keeps a file-derived title when a patent-cards header cannot be read', () => {
    const dir = makeDir('wiki-unreadable-')
    mkdirSync(join(dir, 'patent-cards'), { recursive: true })
    writeFileSync(join(dir, 'patent-cards', 'locked.md'), '- 概念: 测试\n\n正文')
    chmodSync(join(dir, 'patent-cards', 'locked.md'), 0o000)
    const warns: string[] = []
    const loader = makeLoader(dir, warns)
    expect(loader.count()).toBe(1)
    expect(warns.some(w => w.includes('读取卡片头部元数据失败'))).toBe(true)
    expect(loader.getById('patent-cards/locked')?.title).toBe('patent cards/locked')
  })

  it('falls back to scan-only results when card-index.json is broken', () => {
    const dir = makeDir('wiki-badindex-')
    mkdirSync(join(dir, 'patent-cards'), { recursive: true })
    writeFileSync(join(dir, 'patent-cards', 'bolar.md'), '正文')
    writeFileSync(join(dir, 'patent-cards', 'card-index.json'), '*nope')
    const warns: string[] = []
    const loader = makeLoader(dir, warns)
    expect(loader.count()).toBe(1)
    expect(warns.some(w => w.includes('card-index.json 解析失败'))).toBe(true)
  })

  it('handles a card-index.json without a cards array', () => {
    const dir = makeDir('wiki-no-cards-index-')
    makeWiki(dir)
    writeFileSync(join(dir, 'patent-cards', 'card-index.json'), '{}')
    const warns: string[] = []
    const loader = makeLoader(dir, warns)
    expect(loader.count()).toBe(5)
    expect(warns).toEqual([])
  })
})

describe('WikiCardLoader scan cache (.wiki-meta.json)', () => {
  it('reuses a valid scan cache across loader instances', () => {
    const dir = makeDir('wiki-cache-valid-')
    makeWiki(dir)
    makeLoader(dir).count() // first load writes .wiki-meta.json
    const warns: string[] = []
    const second = makeLoader(dir, warns)
    expect(second.count()).toBe(5)
    expect(warns).toEqual([])
    expect(second.getById('patent-cards/bolar')?.title).toBe('Bolar 例外审查')
  })

  it('treats a cache-validation throw as a cache miss with a warning', () => {
    const dir = makeDir('wiki-cache-throw-')
    makeWiki(dir)
    writeFileSync(join(dir, '.wiki-meta.json'), 'null')
    const warns: string[] = []
    const loader = makeLoader(dir, warns)
    expect(loader.count()).toBe(5)
    expect(warns.some(w => w.includes('扫描缓存校验失败'))).toBe(true)
  })

  it('invalidates caches with a wrong version or malformed arrays', () => {
    const variants = [
      { version: 1, files: [], dirs: [] },
      { version: 2, files: 'x', dirs: [] },
      { version: 2, files: [], dirs: 'x' },
    ]
    for (const cache of variants) {
      const dir = makeDir('wiki-cache-bad-')
      makeWiki(dir)
      writeFileSync(join(dir, '.wiki-meta.json'), JSON.stringify(cache))
      const loader = makeLoader(dir)
      expect(loader.count()).toBe(5)
    }
  })

  it('invalidates caches whose directory summary diverges', () => {
    const dir = makeDir('wiki-cache-dirs-')
    makeWiki(dir)
    writeFileSync(join(dir, '.wiki-meta.json'), JSON.stringify({
      version: 2,
      files: [],
      dirs: [{ dir: '.', entries: ['patent-cards'] }],
    }))
    const loader = makeLoader(dir)
    expect(loader.count()).toBe(5)
  })

  it('invalidates caches whose summary directory cannot be read', () => {
    const dir = makeDir('wiki-cache-gone-dir-')
    makeWiki(dir)
    writeFileSync(join(dir, '.wiki-meta.json'), JSON.stringify({
      version: 2,
      files: [],
      dirs: [{ dir: 'deleted-dir', entries: [] }],
    }))
    const loader = makeLoader(dir)
    expect(loader.count()).toBe(5)
  })

  it('invalidates caches whose patent-cards mtime or file diverges', () => {
    const dir = makeDir('wiki-cache-mtime-')
    makeWiki(dir)
    writeFileSync(join(dir, '.wiki-meta.json'), JSON.stringify({
      version: 2,
      files: [{ path: 'patent-cards/bolar.md', meta: { id: 'x' }, mtimeMs: 1 }],
      dirs: [],
    }))
    const loader = makeLoader(dir)
    expect(loader.count()).toBe(5)

    const dir2 = makeDir('wiki-cache-stat-')
    makeWiki(dir2)
    writeFileSync(join(dir2, '.wiki-meta.json'), JSON.stringify({
      version: 2,
      files: [{ path: 'patent-cards/gone.md', meta: { id: 'x' }, mtimeMs: 1 }],
      dirs: [],
    }))
    const loader2 = makeLoader(dir2)
    expect(loader2.count()).toBe(5)
  })

  it('warns without failing when the scan cache cannot be written', () => {
    const dir = makeDir('wiki-cache-writefail-')
    makeWiki(dir)
    mkdirSync(join(dir, '.wiki-meta.json')) // a directory blocks writeFileSync
    const warns: string[] = []
    const loader = makeLoader(dir, warns)
    expect(loader.count()).toBe(5)
    expect(warns.some(w => w.includes('写入扫描缓存失败'))).toBe(true)
  })
})
