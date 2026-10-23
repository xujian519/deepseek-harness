/**
 * Tests for the legal knowledge import pipeline.
 *
 * Covers:
 * - Markdown parsing (law files + case files)
 * - Chinese numeral conversion
 * - Multi-version deduplication
 * - SQLite schema creation
 * - FTS5 full-text search
 * - Case metadata extraction
 * @vitest-environment node
 */

import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import {
  parseLawMarkdown,
  parseFilename,
} from '../parse-law-md.ts'
import { deduplicateVersions, groupVersions } from '../version-resolver.ts'
import { createSchema, importRegulations, resolveLevel } from '../import-to-sqlite.ts'
import { parseCaseMd, importCases } from '../import-cases.ts'
import type { ParsedLaw } from '../parse-law-md.ts'

// ─── parseFilename ──────────────────────────────────────────────

describe('parseFilename', () => {
  it('extracts stem and date from filename with date', () => {
    const result = parseFilename('/path/to/中华人民共和国宪法(2018-03-11).md')
    expect(result.stem).toBe('中华人民共和国宪法')
    expect(result.date).toBe('2018-03-11')
  })

  it('handles filename without date', () => {
    const result = parseFilename('/path/to/法律名称.md')
    expect(result.stem).toBe('法律名称')
    expect(result.date).toBe('')
  })
})

// ─── resolveLevel ───────────────────────────────────────────────

describe('resolveLevel', () => {
  it('maps known folders to legal levels', () => {
    expect(resolveLevel('宪法')).toBe('法律')
    expect(resolveLevel('民法典')).toBe('法律')
    expect(resolveLevel('司法解释')).toBe('司法解释')
    expect(resolveLevel('行政法规')).toBe('行政法规')
    expect(resolveLevel('地方性法规')).toBe('地方性法规')
    expect(resolveLevel('部门规章')).toBe('部门规章')
  })

  it('maps unknown folders to 其他', () => {
    expect(resolveLevel('未知分类')).toBe('其他')
  })
})

// ─── parseLawMarkdown ───────────────────────────────────────────

describe('parseLawMarkdown', () => {
  it('parses a complete law file', () => {
    const content = `# 中华人民共和国测试法

2020年5月28日 第十三届全国人民代表大会第三次会议通过

2021年1月1日 施行

<!-- INFO END -->

## 第一章 总则

第一条 为了测试，制定本法。

第二条 适用于测试场景。
`
    const result = parseLawMarkdown(content, '/path/to/测试法(2020-05-28).md')
    expect(result.name).toBe('中华人民共和国测试法')
    expect(result.adoptDate).toBe('2020-05-28')
    expect(result.effectiveDate).toBe('2021-01-01')
    expect(result.articles).toHaveLength(2)
    expect(result.articles[0]!.number).toBe(1)
    expect(result.articles[0]!.text).toContain('测试')
    expect(result.articles[0]!.chapter).toBe(1)
    expect(result.chapters).toHaveLength(1)
    expect(result.chapters[0]!.title).toBe('总则')
  })

  it('handles files without INFO END marker', () => {
    const content = `# 简单法律

第一条 内容。
`
    const result = parseLawMarkdown(content, '/path/to/简单法律.md')
    expect(result.articles.length).toBeGreaterThanOrEqual(1)
  })

  it('parses multi-chapter laws', () => {
    const content = `# 测试法典

2020年1月1日 通过

<!-- INFO END -->

## 第一章 总则

第一条 总则条文。

## 第二章 分则

第二条 分则条文。
`
    const result = parseLawMarkdown(content, '/path/to/测试法典.md')
    expect(result.chapters).toHaveLength(2)
    expect(result.articles).toHaveLength(2)
    expect(result.articles[0]!.chapter).toBe(1)
    expect(result.articles[1]!.chapter).toBe(2)
  })

  it('returns empty articles for non-law files', () => {
    const content = `# 索引

这是一个索引文件。
`
    const result = parseLawMarkdown(content, '/path/to/_index.md')
    expect(result.articles).toHaveLength(0)
  })
})

// ─── deduplicateVersions ────────────────────────────────────────

describe('deduplicateVersions', () => {
  function makeLaw(name: string, adoptDate: string): ParsedLaw {
    return {
      name,
      shortName: name,
      adoptDate,
      effectiveDate: '',
      amendments: [],
      chapters: [],
      articles: [],
      sourceFile: '',
    }
  }

  it('keeps the latest version of each law', () => {
    const laws = [
      makeLaw('测试法', '2020-01-01'),
      makeLaw('测试法', '2023-06-15'),
      makeLaw('测试法', '2021-03-01'),
      makeLaw('其他法', '2019-01-01'),
    ]
    const deduped = deduplicateVersions(laws)
    expect(deduped).toHaveLength(2)
    const testLaw = deduped.find(l => l.name === '测试法')
    expect(testLaw?.adoptDate).toBe('2023-06-15')
  })

  it('handles laws without dates', () => {
    const laws = [
      makeLaw('无日期法', ''),
      makeLaw('有日期法', '2020-01-01'),
    ]
    const deduped = deduplicateVersions(laws)
    expect(deduped).toHaveLength(2)
  })

  it('groups versions correctly', () => {
    const laws = [
      makeLaw('A', '2020-01-01'),
      makeLaw('A', '2021-01-01'),
      makeLaw('B', '2019-01-01'),
    ]
    const groups = groupVersions(laws)
    expect(groups.get('A')).toHaveLength(2)
    expect(groups.get('B')).toHaveLength(1)
  })
})

// ─── SQLite schema + FTS5 ──────────────────────────────────────

describe('SQLite schema', () => {
  let db: DatabaseSync

  beforeAll(() => {
    db = new DatabaseSync(':memory:')
    createSchema(db)
  })

  afterAll(() => {
    db.close()
  })

  it('creates regulations table', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='regulations'",
    ).all() as Array<{ name: string }>
    expect(tables).toHaveLength(1)
  })

  it('creates FTS5 virtual table', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='regulations_fts'",
    ).all() as Array<{ name: string }>
    expect(tables).toHaveLength(1)
  })

  it('creates cases table', () => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='cases'",
    ).all() as Array<{ name: string }>
    expect(tables).toHaveLength(1)
  })

  it('inserts and retrieves a regulation', () => {
    db.prepare(`
      INSERT INTO regulations (id, name, level, article_number, article_text, chapter_title)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('test_1', '测试法', '法律', 1, '这是测试条文', '第一章 总则')

    const row = db.prepare('SELECT * FROM regulations WHERE id = ?').get('test_1') as Record<string, unknown>
    expect(row).toBeDefined()
    expect(row.name).toBe('测试法')
    expect(row.article_text).toBe('这是测试条文')
  })

  it('FTS5 search works with tokenized text', () => {
    // FTS5 default unicode61 tokenizer does not tokenize CJK characters as words.
    // Use English text to verify FTS5 functionality.
    db.prepare(`
      INSERT INTO regulations (id, name, level, article_number, article_text, chapter_title)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('test_fts', 'Test Law', 'legal', 99, 'This is a test article about contracts', 'Chapter 1')
    db.prepare(`
      INSERT INTO regulations_fts (rowid, name, article_text, chapter_title)
      VALUES ((SELECT rowid FROM regulations WHERE id = ?), ?, ?, ?)
    `).run('test_fts', 'Test Law', 'This is a test article about contracts', 'Chapter 1')

    const rows = db.prepare(`
      SELECT r.name, r.article_text, bm25(regulations_fts) AS score
      FROM regulations_fts f
      JOIN regulations r ON r.rowid = f.rowid
      WHERE regulations_fts MATCH ?
    `).all('contracts') as Array<{ name: string; article_text: string; score: number }>
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[0]!.name).toBe('Test Law')
  })
})

// ─── parseCaseMd ────────────────────────────────────────────────

describe('parseCaseMd', () => {
  let tempDir: string

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'case-import-test-'))
  })

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('parses a case file with all sections', () => {
    const filePath = join(tempDir, 'test-case.md')
    writeFileSync(filePath, `# 劳动者超时加班发生工伤案

<!-- INFO END -->

## 基本案情

2017年8月，某服务公司与某传媒公司签订劳务派遣协议。

## 裁判结果

一审法院判决：赔偿工亡待遇。

## 案例分析

本案的争议焦点是超时加班工伤赔偿。

## 典型意义

本案系劳动者超时加班发生工伤而引发的纠纷。
`, 'utf-8')

    const result = parseCaseMd(filePath)
    expect(result.caseName).toBe('劳动者超时加班发生工伤案')
    expect(result.basicFacts).toContain('劳务派遣协议')
    expect(result.judgmentResult).toContain('赔偿工亡待遇')
    expect(result.analysis).toContain('争议焦点')
    expect(result.typicalSignificance).toContain('超时加班')
  })

  it('extracts case type from content', () => {
    const filePath = join(tempDir, 'civil-case.md')
    writeFileSync(filePath, `# 民事纠纷案例

<!-- INFO END -->

## 基本案情

这是一起民事合同纠纷案件。
`, 'utf-8')

    const result = parseCaseMd(filePath)
    expect(result.caseType).toBe('民事')
  })

  it('extracts case number in standard format', () => {
    const filePath = join(tempDir, 'case-number.md')
    writeFileSync(filePath, `# 张某诉李某合同纠纷案

<!-- INFO END -->

## 基本案情

本案案号为（2020）最高法民终123号，由最高人民法院审理。

## 裁判结果

驳回上诉，维持原判。
`, 'utf-8')

    const result = parseCaseMd(filePath)
    expect(result.caseNumber).toBe('（2020）最高法民终123号')
  })

  it('extracts case number with half-width parentheses', () => {
    const filePath = join(tempDir, 'case-number-half.md')
    writeFileSync(filePath, `# 案例

<!-- INFO END -->

## 基本案情

案号为(2019)京01民终5678号。
`, 'utf-8')

    const result = parseCaseMd(filePath)
    expect(result.caseNumber).toBe('(2019)京01民终5678号')
  })

  it('extracts court from judgment context', () => {
    const filePath = join(tempDir, 'court-judgment.md')
    writeFileSync(filePath, `# 案例

<!-- INFO END -->

## 裁判结果

北京市朝阳区人民法院一审判决被告赔偿原告损失。
`, 'utf-8')

    const result = parseCaseMd(filePath)
    expect(result.court).toBe('北京市朝阳区人民法院')
  })

  it('extracts court from byline', () => {
    const filePath = join(tempDir, 'court-byline.md')
    writeFileSync(filePath, `# 案例

<!-- INFO END -->

## 基本案情

案件详情。

## 法官解读

文/北京市通州区人民法院 法官助理 何娇
`, 'utf-8')

    const result = parseCaseMd(filePath)
    expect(result.court).toBe('北京市通州区人民法院')
  })

  it('extracts decision date from judgment context', () => {
    const filePath = join(tempDir, 'date-judgment.md')
    writeFileSync(filePath, `# 案例

<!-- INFO END -->

## 裁判结果

法院于2021年3月15日作出判决，驳回原告诉讼请求。
`, 'utf-8')

    const result = parseCaseMd(filePath)
    expect(result.decisionDate).toBe('2021-03-15')
  })

  it('extracts decision date with explicit label', () => {
    const filePath = join(tempDir, 'date-label.md')
    writeFileSync(filePath, `# 案例

<!-- INFO END -->

## 基本案情

裁判日期：2020-06-15
`, 'utf-8')

    const result = parseCaseMd(filePath)
    expect(result.decisionDate).toBe('2020-06-15')
  })

  it('detects labor dispute case type', () => {
    const filePath = join(tempDir, 'labor-case.md')
    writeFileSync(filePath, `# 劳动者加班费争议案

<!-- INFO END -->

## 基本案情

劳动者与用人单位因加班费发生争议，申请劳动仲裁。
`, 'utf-8')

    const result = parseCaseMd(filePath)
    expect(result.caseType).toBe('劳动争议')
  })

  it('detects administrative case type', () => {
    const filePath = join(tempDir, 'admin-case.md')
    writeFileSync(filePath, `# 行政协议纠纷案

<!-- INFO END -->

## 基本案情

行政机关与协议相对人因行政协议发生争议。
`, 'utf-8')

    const result = parseCaseMd(filePath)
    expect(result.caseType).toBe('行政')
  })

  it('detects consumer rights case type', () => {
    const filePath = join(tempDir, 'consumer-case.md')
    writeFileSync(filePath, `# 网络购物纠纷案

<!-- INFO END -->

## 基本案情

消费者在网络购物中遭遇销售欺诈，向法院起诉。
`, 'utf-8')

    const result = parseCaseMd(filePath)
    expect(result.caseType).toBe('消费维权')
  })

  it('handles missing metadata gracefully', () => {
    const filePath = join(tempDir, 'no-metadata.md')
    writeFileSync(filePath, `# 某案例

<!-- INFO END -->

## 基本案情

这是一个没有任何元数据的案例。
`, 'utf-8')

    const result = parseCaseMd(filePath)
    expect(result.court).toBe('')
    expect(result.caseNumber).toBe('')
    expect(result.decisionDate).toBe('')
  })

  it('extracts metadata from complex real-world case', () => {
    const filePath = join(tempDir, 'complex-case.md')
    writeFileSync(filePath, `# 陕西广电网络传媒（集团）股份有限公司诉吴小秦反垄断纠纷案

<!-- INFO END -->

## 基本案情

陕西省高级人民法院于2013年9月12日作出（2013）陕民三终字第38号民事判决。

## 裁判结果

最高人民法院于2016年作出再审判决。
`, 'utf-8')

    const result = parseCaseMd(filePath)
    expect(result.caseNumber).toBe('（2013）陕民三终字第38号')
    expect(result.court).toBe('陕西省高级人民法院')
    expect(result.decisionDate).toBe('2013-09-12')
  })
})

// ─── End-to-end import (small dataset) ──────────────────────────

describe('end-to-end import', () => {
  let tempDir: string
  let dbPath: string

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'e2e-import-test-'))
    dbPath = join(tempDir, 'test.db')

    // Create a minimal data directory structure.
    const lawDir = join(tempDir, '宪法相关法')
    const caseDir = join(tempDir, '案例', '民事')
    mkdirSync(lawDir, { recursive: true })
    mkdirSync(caseDir, { recursive: true })

    // Write a test law file.
    writeFileSync(join(lawDir, '测试法(2020-01-01).md'), `# 测试法

2020年1月1日 通过

2020年6月1日 施行

<!-- INFO END -->

## 第一章 总则

第一条 为了测试，制定本法。

第二条 本法适用于测试场景。
`, 'utf-8')

    // Write a duplicate older version (should be deduplicated away).
    writeFileSync(join(lawDir, '测试法(2019-01-01).md'), `# 测试法

2019年1月1日 通过

<!-- INFO END -->

第一条 旧版本条文。
`, 'utf-8')

    // Write a test case file.
    writeFileSync(join(caseDir, '测试案例.md'), `# 测试案例

<!-- INFO END -->

## 基本案情

这是一起民事纠纷案件。

## 裁判结果

法院判决被告赔偿原告损失。
`, 'utf-8')
  })

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('imports regulations into SQLite', () => {
    const result = importRegulations(tempDir, dbPath, { skipCases: true })
    expect(result.filesScanned).toBeGreaterThanOrEqual(2)
    expect(result.lawsAfterDedup).toBe(1) // deduplicated to 1
    expect(result.articlesInserted).toBeGreaterThanOrEqual(2)
    expect(result.parseErrors).toBe(0)

    // Verify database content.
    const db = new DatabaseSync(dbPath)
    try {
      const rows = db.prepare('SELECT COUNT(*) as cnt FROM regulations').get() as { cnt: number }
      expect(rows.cnt).toBeGreaterThanOrEqual(2)

      // Verify the latest version was kept.
      const law = db.prepare('SELECT DISTINCT name, publish_date FROM regulations LIMIT 1').get() as {
        name: string
        publish_date: string
      }
      expect(law.name).toBe('测试法')
      expect(law.publish_date).toBe('2020-01-01')
    } finally {
      db.close()
    }
  })

  it('imports cases into SQLite', () => {
    const result = importCases(tempDir, dbPath)
    expect(result.filesScanned).toBe(1)
    expect(result.casesImported).toBe(1)
    expect(result.parseErrors).toBe(0)

    // Verify case content.
    const db = new DatabaseSync(dbPath)
    try {
      const row = db.prepare('SELECT case_name, case_type FROM cases LIMIT 1').get() as {
        case_name: string
        case_type: string
      }
      expect(row.case_name).toBe('测试案例')
      expect(row.case_type).toBe('民事')
    } finally {
      db.close()
    }
  })

  it('FTS5 indexes are populated after import', () => {
    // FTS5 default unicode61 tokenizer does not tokenize CJK as words.
    // Verify the FTS table has rows (structural integrity).
    const db = new DatabaseSync(dbPath)
    try {
      const count = db.prepare('SELECT COUNT(*) as cnt FROM regulations_fts').get() as { cnt: number }
      expect(count.cnt).toBeGreaterThanOrEqual(1)
    } finally {
      db.close()
    }
  })
})
