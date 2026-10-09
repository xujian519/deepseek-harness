/**
 * src/draft/validate — 受控草案校验。
 *
 * 草案来自模型工具参数（tool JSON 边界），入口一律为 unknown：校验即窄化，
 * 通过时返回按已校验分量重新组装的草案对象，失败时聚合全部违规一次抛出
 * {@link DraftValidationError}。违规消息面向模型可读：未知键一律列出可用项。
 */

import { asJsonRecord } from '../llm-json.ts'
import {
  SPEC_PART_HEADINGS,
  type DraftBlock,
  type SpecDraft,
  type SpecDraftMeta,
  type SpecPartId,
  type TemplateDraft,
  type TemplateDraftSchema,
} from './types.ts'

/** 草案校验失败：聚合全部违规，消息面向模型可读。 */
export class DraftValidationError extends Error {
  /** 逐条违规（路径 + 原因）。 */
  readonly violations: string[]

  constructor(violations: string[]) {
    super(`草案校验失败（${violations.length} 项）：\n- ${violations.join('\n- ')}`)
    this.name = 'DraftValidationError'
    this.violations = violations
  }
}

/** claims-spec 草案的顶层可用键。 */
const SPEC_DRAFT_KEYS = ['meta', 'claims', 'abstract', 'abstractFigure', 'figureFiles', 'drawingDescriptions', 'sections'] as const

/** 模板草案的顶层可用键。 */
const TEMPLATE_DRAFT_KEYS = ['fields', 'sections'] as const

/** meta 的必填键。 */
const META_KEYS = ['title', 'applicant', 'inventor', 'agent', 'date'] as const

/** 块类型可用项。 */
const BLOCK_KINDS = ['paragraph', 'list', 'table'] as const

/** paragraph 块可用键。 */
const PARAGRAPH_KEYS = ['kind', 'text'] as const

/** list 块可用键。 */
const LIST_KEYS = ['kind', 'items', 'ordered'] as const

/** table 块可用键。 */
const TABLE_KEYS = ['kind', 'name', 'header', 'rows'] as const

/** 权利要求自带项号的行首形态：`1.`、`3、`、`12．`。 */
const CLAIM_NUMBER_PREFIX = /^\s*\d+\s*[.、．]/

/** 表名禁止的行首形态：`表1`、`表 2`。 */
const TABLE_NUMBER_PREFIX = /^\s*表\s*\d/

const SPEC_PART_IDS = Object.keys(SPEC_PART_HEADINGS) as SpecPartId[]

function available(parts: readonly string[]): string {
  return parts.join('、')
}

/** 记录未知键；返回是否有未知键。 */
function reportUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], path: string, violations: string[]): boolean {
  let unknown = false
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      violations.push(`${path}${path === '' ? '' : '.'}${key} 未知（可用项：${available(allowed)}）`)
      unknown = true
    }
  }
  return unknown
}

/** 非空字符串校验：非字符串或空（含纯空白）返回 undefined 并记违规。 */
function requireNonEmptyString(value: unknown, path: string, violations: string[]): string | undefined {
  if (typeof value !== 'string') {
    violations.push(`${path} 必须是字符串`)
    return undefined
  }
  if (value.trim() === '') {
    violations.push(`${path} 为空`)
    return undefined
  }
  return value
}

/** 读取对象中一个必填非空字符串字段。 */
function readRequiredString(record: Record<string, unknown>, key: string, path: string, violations: string[]): string | undefined {
  if (!Object.hasOwn(record, key)) {
    violations.push(`${path}.${key} 缺失`)
    return undefined
  }
  return requireNonEmptyString(record[key], `${path}.${key}`, violations)
}

/** 读取非空数组：缺失、非数组、空数组均记违规。 */
function readNonEmptyArray(value: unknown, path: string, violations: string[], emptyMessage: string): unknown[] | undefined {
  if (value === undefined) {
    violations.push(`${path} 缺失`)
    return undefined
  }
  if (!Array.isArray(value)) {
    violations.push(`${path} 必须是数组`)
    return undefined
  }
  if (value.length === 0) {
    violations.push(`${path} ${emptyMessage}`)
    return undefined
  }
  return value as unknown[]
}

/** 读取字符串数组：缺失、非数组、空数组、非字符串项、空项均记违规。 */
function readStringList(value: unknown, path: string, violations: string[], emptyMessage = '至少一项'): string[] | undefined {
  const array = readNonEmptyArray(value, path, violations, emptyMessage)
  if (array === undefined) return undefined
  const items: string[] = []
  array.forEach((item, index) => {
    const text = requireNonEmptyString(item, `${path}[${index}]`, violations)
    if (text !== undefined) {
      items.push(text)
    }
  })
  return items.length === array.length ? items : undefined
}

/**
 * 校验块数组；返回窄化后的块数组。
 * @param value - 待校验的块数组（unknown）。
 * @param path - 违规消息中的位置前缀。
 * @param violations - 违规收集器。
 * @returns 窄化后的块数组；存在违规返回 undefined。
 */
function validateBlocks(value: unknown, path: string, violations: string[]): DraftBlock[] | undefined {
  const array = readNonEmptyArray(value, path, violations, '至少一个块')
  if (array === undefined) return undefined
  const blocks: DraftBlock[] = []
  array.forEach((item, index) => {
    const block = validateBlock(item, `${path}[${index}]`, violations)
    if (block !== undefined) {
      blocks.push(block)
    }
  })
  return blocks.length === array.length ? blocks : undefined
}

/**
 * 校验单个块；返回窄化后的块。
 * @param value - 待校验的块（unknown）。
 * @param path - 违规消息中的位置前缀。
 * @param violations - 违规收集器。
 * @returns 窄化后的块；存在违规返回 undefined。
 */
function validateBlock(value: unknown, path: string, violations: string[]): DraftBlock | undefined {
  const record = asJsonRecord(value)
  if (record === undefined) {
    violations.push(`${path} 必须是对象`)
    return undefined
  }
  const kind = record.kind
  if (kind !== 'paragraph' && kind !== 'list' && kind !== 'table') {
    violations.push(`${path} 未知块类型 ${JSON.stringify(kind)}（可用项：${available(BLOCK_KINDS)}）`)
    return undefined
  }
  const hasUnknownKeys = reportUnknownKeys(record, kind === 'paragraph' ? PARAGRAPH_KEYS : kind === 'list' ? LIST_KEYS : TABLE_KEYS, path, violations)
  if (kind === 'paragraph') {
    const text = readRequiredString(record, 'text', path, violations)
    if (text === undefined) return undefined
    return hasUnknownKeys ? undefined : { kind, text }
  }
  if (kind === 'list') {
    const items = readStringList(record.items, `${path}.items`, violations)
    if (items === undefined) return undefined
    const ordered = record.ordered
    if (ordered !== undefined && typeof ordered !== 'boolean') {
      violations.push(`${path}.ordered 必须是布尔值`)
      return undefined
    }
    if (hasUnknownKeys) return undefined
    return ordered === undefined ? { kind, items } : { kind, items, ordered }
  }
  return validateTable(record, path, violations, hasUnknownKeys)
}

/**
 * 校验 table 块（kind 已确认）。
 * @param record - 块的 JSON 对象。
 * @param path - 违规消息中的位置前缀。
 * @param violations - 违规收集器。
 * @param unknownKeys - 是否已记录未知键违规。
 * @returns 窄化后的块；存在违规返回 undefined。
 */
function validateTable(record: Record<string, unknown>, path: string, violations: string[], unknownKeys: boolean): DraftBlock | undefined {
  const name = readRequiredString(record, 'name', path, violations)
  const header = readStringList(record.header, `${path}.header`, violations, '至少一列')
  const rowsArray = readNonEmptyArray(record.rows, `${path}.rows`, violations, '至少一行')
  let valid = !unknownKeys
  if (name !== undefined && TABLE_NUMBER_PREFIX.test(name)) {
    violations.push(`${path}.name 不得以「表+数字」开头（编号由渲染器自动生成）：${JSON.stringify(name)}`)
    valid = false
  }
  const rows: string[][] = []
  if (rowsArray !== undefined && header !== undefined) {
    rowsArray.forEach((rowValue, rowIndex) => {
      const row = readStringList(rowValue, `${path}.rows[${rowIndex}]`, violations)
      if (row === undefined) {
        valid = false
        return
      }
      if (row.length !== header.length) {
        violations.push(`${path}.rows[${rowIndex}] 行宽 ${row.length} 与表头 ${header.length} 列不一致`)
        valid = false
        return
      }
      rows.push(row)
    })
  } else if (rowsArray === undefined) {
    valid = false
  }
  if (name === undefined || header === undefined || !valid) return undefined
  return { kind: 'table', name, header, rows }
}

function validateMeta(value: unknown, violations: string[]): SpecDraftMeta | undefined {
  if (value === undefined) {
    violations.push(`meta 缺失（可用项：${available(META_KEYS)}）`)
    return undefined
  }
  const record = asJsonRecord(value)
  if (record === undefined) {
    violations.push('meta 必须是对象')
    return undefined
  }
  let valid = !reportUnknownKeys(record, META_KEYS, 'meta', violations)
  const meta: SpecDraftMeta = { title: '', applicant: '', inventor: '', agent: '', date: '' }
  for (const key of META_KEYS) {
    const text = readRequiredString(record, key, 'meta', violations)
    if (text === undefined) {
      valid = false
    } else {
      meta[key] = text
    }
  }
  return valid ? meta : undefined
}

function validateSpecSections(value: unknown, violations: string[]): Record<SpecPartId, DraftBlock[]> | undefined {
  if (value === undefined) {
    violations.push('sections 缺失')
    return undefined
  }
  const record = asJsonRecord(value)
  if (record === undefined) {
    violations.push('sections 必须是对象')
    return undefined
  }
  let valid = !reportUnknownKeys(record, SPEC_PART_IDS, 'sections', violations)
  const sections: Partial<Record<SpecPartId, DraftBlock[]>> = {}
  for (const partId of SPEC_PART_IDS) {
    const heading = SPEC_PART_HEADINGS[partId]
    if (!Object.hasOwn(record, partId)) {
      violations.push(`sections.${partId} 缺失（${heading}）`)
      valid = false
      continue
    }
    const blocks = validateBlocks(record[partId], `sections.${partId}`, violations)
    if (blocks === undefined) {
      valid = false
      continue
    }
    if (partId !== 'embodiment') {
      blocks.forEach((block, index) => {
        if (block.kind === 'table') {
          violations.push(`sections.${partId}[${index}] 表格仅允许出现在具体实施方式（embodiment）`)
          valid = false
        }
      })
    }
    sections[partId] = blocks
  }
  return valid ? sections as Record<SpecPartId, DraftBlock[]> : undefined
}

/**
 * 校验 claims-spec 申请文件草案。
 * @param input - 模型提交的工具参数（unknown，tool JSON 边界）。
 * @returns 按已校验分量组装的 {@link SpecDraft}。
 * @throws {DraftValidationError} 存在任何违规时抛出，聚合全部违规。
 */
export function validateSpecDraft(input: unknown): SpecDraft {
  const violations: string[] = []
  const root = asJsonRecord(input)
  if (root === undefined) {
    throw new DraftValidationError([`草案必须是对象（可用项：${available(SPEC_DRAFT_KEYS)}）`])
  }
  reportUnknownKeys(root, SPEC_DRAFT_KEYS, '', violations)

  const meta = validateMeta(root.meta, violations)
  const claims = readStringList(root.claims, 'claims', violations)
  if (claims !== undefined) {
    claims.forEach((claim, index) => {
      if (CLAIM_NUMBER_PREFIX.test(claim)) {
        violations.push(`claims[${index}] 自带项号（${JSON.stringify(claim.slice(0, 12))}…）：请去掉项号，由渲染器自动编号`)
      }
    })
  }
  const abstractParagraphs = readStringList(root.abstract, 'abstract', violations, '至少一段')
  const abstractFigure = root.abstractFigure === undefined
    ? undefined
    : requireNonEmptyString(root.abstractFigure, 'abstractFigure', violations)
  const figureFiles = readStringList(root.figureFiles, 'figureFiles', violations)
  const drawingDescriptions = readStringList(root.drawingDescriptions, 'drawingDescriptions', violations)
  const sections = validateSpecSections(root.sections, violations)

  if (violations.length > 0) throw new DraftValidationError(violations)
  return {
    meta: meta as SpecDraftMeta,
    claims: claims as string[],
    abstract: abstractParagraphs as string[],
    ...(abstractFigure !== undefined ? { abstractFigure } : {}),
    figureFiles: figureFiles as string[],
    drawingDescriptions: drawingDescriptions as string[],
    sections: sections as Record<SpecPartId, DraftBlock[]>,
  }
}

function validateTemplateFields(
  value: unknown,
  schema: TemplateDraftSchema | undefined,
  violations: string[],
): Record<string, string> | undefined {
  if (value === undefined) {
    if (schema?.fields !== undefined) {
      for (const [id, slot] of Object.entries(schema.fields)) {
        if (slot.required === true) violations.push(`fields.${id} 缺失`)
      }
    }
    return undefined
  }
  const record = asJsonRecord(value)
  if (record === undefined) {
    violations.push('fields 必须是对象')
    return undefined
  }
  let valid = true
  const fields: Record<string, string> = {}
  for (const [id, fieldValue] of Object.entries(record)) {
    if (schema !== undefined && (schema.fields === undefined || !Object.hasOwn(schema.fields, id))) {
      violations.push(`fields.${id} 未知槽位（可用项：${available(Object.keys(schema.fields ?? {}))}）`)
      valid = false
      continue
    }
    const text = requireNonEmptyString(fieldValue, `fields.${id}`, violations)
    if (text === undefined) {
      valid = false
    } else {
      fields[id] = text
    }
  }
  if (schema?.fields !== undefined) {
    for (const [id, slot] of Object.entries(schema.fields)) {
      if (slot.required === true && !Object.hasOwn(fields, id)) {
        violations.push(`fields.${id} 缺失`)
        valid = false
      }
    }
  }
  return valid ? fields : undefined
}

function validateTemplateSections(
  value: unknown,
  schema: TemplateDraftSchema | undefined,
  violations: string[],
): TemplateDraft['sections'] | undefined {
  if (value === undefined) {
    violations.push('sections 缺失')
    return undefined
  }
  if (!Array.isArray(value)) {
    violations.push('sections 必须是数组')
    return undefined
  }
  const sections: TemplateDraft['sections'] = []
  const seen = new Set<string>()
  let valid = true
  value.forEach((item, index) => {
    const record = asJsonRecord(item)
    if (record === undefined) {
      violations.push(`sections[${index}] 必须是对象`)
      valid = false
      return
    }
    const id = readRequiredString(record, 'id', `sections[${index}]`, violations)
    if (id !== undefined) {
      if (seen.has(id)) {
        violations.push(`sections[${index}] 重复槽位 ${JSON.stringify(id)}（可用项：${available([...new Set([...seen, ...Object.keys(schema?.sections ?? {})])])}）`)
        valid = false
      } else {
        seen.add(id)
      }
      if (schema?.sections !== undefined && !Object.hasOwn(schema.sections, id)) {
        violations.push(`sections.${id} 未知槽位（可用项：${available(Object.keys(schema.sections))}）`)
        valid = false
      }
    }
    const blocks = validateBlocks(record.blocks, `sections[${index}].blocks`, violations)
    if (id === undefined || blocks === undefined) {
      valid = false
    } else {
      sections.push({ id, blocks })
    }
  })
  if (schema?.sections !== undefined) {
    for (const [id, slot] of Object.entries(schema.sections)) {
      if (slot.required === true && !seen.has(id)) {
        violations.push(`sections.${id} 缺失`)
        valid = false
      }
    }
  }
  return valid ? sections : undefined
}

/**
 * 校验文书模板草案；提供 schema 时按槽位集合校验未知键与必填槽位。
 * @param input - 模型提交的工具参数（unknown，tool JSON 边界）。
 * @param schema - 槽位 schema（来自 patent-document 注册表）；缺省时只做结构校验。
 * @returns 按已校验分量组装的 {@link TemplateDraft}。
 * @throws {DraftValidationError} 存在任何违规时抛出，聚合全部违规。
 */
export function validateTemplateDraft(input: unknown, schema?: TemplateDraftSchema): TemplateDraft {
  const violations: string[] = []
  const root = asJsonRecord(input)
  if (root === undefined) {
    throw new DraftValidationError([`草案必须是对象（可用项：${available(TEMPLATE_DRAFT_KEYS)}）`])
  }
  reportUnknownKeys(root, TEMPLATE_DRAFT_KEYS, '', violations)
  const fields = validateTemplateFields(root.fields, schema, violations)
  const sections = validateTemplateSections(root.sections, schema, violations)
  if (violations.length > 0) throw new DraftValidationError(violations)
  return {
    ...(fields !== undefined ? { fields } : {}),
    sections: sections as TemplateDraft['sections'],
  }
}
