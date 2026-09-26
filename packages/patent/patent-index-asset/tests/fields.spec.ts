import { describe, expect, it } from 'vitest'
import {
  IndexAssetError,
  parseYamlMapping,
  readCount,
  readEnum,
  readMapping,
  readOptionalBoolean,
  readOptionalCount,
  readOptionalDate,
  readOptionalString,
  readRecordedSource,
  readString,
  type AssetFail,
} from '../src/index.ts'

/** The error a fixture index raises, the way an index package binds its own. */
class FixtureIndexError extends IndexAssetError {
  constructor(message: string) {
    super(message, 'fixture.yaml')
    this.name = 'FixtureIndexError'
  }
}

const fail: AssetFail = (message: string) => new FixtureIndexError(message)

describe('the index asset error', () => {
  it('carries the origin and the package-specific name', () => {
    const error = new FixtureIndexError('字段 doc 必须是非空字符串')
    expect(error).toBeInstanceOf(IndexAssetError)
    expect(error.name).toBe('FixtureIndexError')
    expect(error.origin).toBe('fixture.yaml')
    expect(new IndexAssetError('boom', null).name).toBe('IndexAssetError')
  })
})

describe('reading an index asset', () => {
  it('parses a YAML document into its root mapping', () => {
    expect(parseYamlMapping('document: 收费标准\nitems: []\n', '费用索引', fail)).toEqual({
      document: '收费标准',
      items: [],
    })
  })

  it.each([
    ['YAML that does not parse', '{', /YAML 解析失败/],
    ['a sequence at the root', '- 1\n', /费用索引的根节点必须是映射/],
    ['a scalar at the root', '收费标准\n', /费用索引的根节点必须是映射/],
    ['an empty document', '', /费用索引的根节点必须是映射/],
  ])('rejects %s', (_case, source, message) => {
    expect(() => parseYamlMapping(source, '费用索引', fail)).toThrow(message)
  })

  it('reads the required and optional field kinds', () => {
    const root = { document: '收费标准', count: 3, on: false, day: '2026-01-01', note: '注' }
    expect(readString(root, 'document', fail)).toBe('收费标准')
    expect(readOptionalString(root, 'note', fail)).toBe('注')
    expect(readOptionalString(root, 'missing', fail)).toBeNull()
    expect(readOptionalDate(root, 'day', fail)).toBe('2026-01-01')
    expect(readOptionalDate(root, 'missing', fail)).toBeNull()
    expect(readCount(root['count'], '字段 count', fail)).toBe(3)
    expect(readOptionalCount(root, 'count', fail)).toBe(3)
    expect(readOptionalCount(root, 'missing', fail)).toBeNull()
    expect(readOptionalBoolean(root, 'on', fail)).toBe(false)
    expect(readOptionalBoolean(root, 'missing', fail)).toBeNull()
    expect(readEnum(root['note'], ['注', '其他'], 'note', fail)).toBe('注')
  })

  it.each([
    ['a missing required string', () => readString({}, 'document', fail), /字段 document 必须是非空字符串/],
    ['a blank required string', () => readString({ document: '  ' }, 'document', fail), /字段 document 必须是非空字符串/],
    ['a number where a string is required', () => readString({ document: 7 }, 'document', fail), /字段 document 必须是非空字符串/],
    ['a blank optional string', () => readOptionalString({ note: '' }, 'note', fail), /字段 note 必须是 null 或非空字符串/],
    ['a number for an optional string', () => readOptionalString({ note: 7 }, 'note', fail), /字段 note 必须是 null 或非空字符串/],
    ['a date that is not ISO', () => readOptionalDate({ day: '2026/01/01' }, 'day', fail), /字段 day 必须是 null 或 YYYY-MM-DD/],
    ['a non-string date', () => readOptionalDate({ day: 20260101 }, 'day', fail), /字段 day 必须是 null 或 YYYY-MM-DD/],
    ['a zero count', () => readCount(0, '字段 count', fail), /字段 count 必须是正整数/],
    ['a fractional count', () => readCount(1.5, '字段 count', fail), /字段 count 必须是正整数/],
    ['a textual count', () => readCount('3', '字段 count', fail), /字段 count 必须是正整数/],
    ['a textual optional count', () => readOptionalCount({ count: '3' }, 'count', fail), /字段 count 必须是正整数/],
    ['a non-boolean flag', () => readOptionalBoolean({ on: '是' }, 'on', fail), /字段 on 必须是 null 或布尔值/],
    ['an unknown enum value', () => readEnum('机关', ['个人', '企业'], 'kind', fail), /kind 必须是 个人 \/ 企业 之一，得到：机关/],
    ['a non-string enum value', () => readEnum(7, ['个人', '企业'], 'kind', fail), /kind 必须是 个人 \/ 企业 之一，得到：7/],
  ])('rejects %s', (_case, run, message) => {
    expect(run).toThrow(message)
  })

  it('reads a mapping only when the value is one', () => {
    expect(readMapping({ id: 'a' }, 'items 的每一项', fail)).toEqual({ id: 'a' })
    for (const rejected of [undefined, null, 'a', 1, ['a']]) {
      expect(() => readMapping(rejected, 'items 的每一项', fail)).toThrow(/items 的每一项 必须是映射/)
    }
  })

  it('reads the recorded source of an entry', () => {
    expect(readRecordedSource({}, fail)).toEqual({ sourceDoc: null, verifiedOn: null })
    expect(readRecordedSource({ sourceDoc: '公告第 1 号', verifiedOn: '2026-01-01' }, fail)).toEqual({
      sourceDoc: '公告第 1 号',
      verifiedOn: '2026-01-01',
    })
    expect(() => readRecordedSource({ verifiedOn: '2026-1-1' }, fail)).toThrow(/字段 verifiedOn 必须是 null 或 YYYY-MM-DD/)
  })
})
