/**
 * 内容模型的交叉约束校验。
 *
 * 参数 schema 已经保证了字段类型、必填项与 `kind` 取值；本模块只补 schema 表达不了的
 * 约束：非空、表格行列齐整、以及"哪类节点必须带哪个字段"的跨字段规则。校验不做修补——
 * 内容有问题就报错，不静默丢弃或改写。
 *
 * 通过校验后，`h3`/`h4`/`p` 节点必定带 `text`，`table` 节点必定带等宽的 `rows`。
 * @module @deepseek-ai/dsh-patent-filing/filing/content
 */

import { PatentFilingError } from '../types.ts'
import type { FilingContent, SpecificationNode } from '../types.ts'

/** 要求非空字符串。 */
function nonEmpty(value: string | undefined, where: string): void {
  if (value === undefined || value.trim() === '') {
    throw new PatentFilingError(`${where} 不能为空`)
  }
}

/** 要求非空字符串数组。 */
function nonEmptyList(values: readonly string[], where: string): void {
  if (values.length === 0) {
    throw new PatentFilingError(`${where} 至少要有 1 项`)
  }
  values.forEach((value, index) => { nonEmpty(value, `${where}[${index}]`) })
}

/** 校验表格：至少 1 行、每行至少 1 列、各行等宽、单元格非空。 */
function checkTable(rows: readonly (readonly string[])[] | undefined, where: string): void {
  if (rows === undefined || rows.length === 0) {
    throw new PatentFilingError(`${where} 至少要有 1 行`)
  }
  let width = 0
  rows.forEach((row, rowIndex) => {
    if (rowIndex === 0) {
      if (row.length === 0) throw new PatentFilingError(`${where} 每行至少要有 1 列`)
      width = row.length
    } else if (row.length !== width) {
      throw new PatentFilingError(
        `${where} 第 ${rowIndex + 1} 行有 ${row.length} 列，与首行的 ${width} 列不一致`,
      )
    }
    row.forEach((cell, columnIndex) => {
      nonEmpty(cell, `${where} 第 ${rowIndex + 1} 行第 ${columnIndex + 1} 列`)
    })
  })
}

/** 校验一个说明书节点。 */
function checkNode(node: SpecificationNode, where: string): void {
  if (node.kind === 'table') {
    checkTable(node.rows, where)
    return
  }
  nonEmpty(node.text, where)
}

/**
 * 校验内容模型的交叉约束。
 * @param content - 待校验的内容模型。
 * @returns 同一内容模型（不修补、不改写）。
 */
export function validateContent(content: FilingContent): FilingContent {
  nonEmptyList(content.abstract, 'abstract 说明书摘要')
  nonEmptyList(content.claims, 'claims 权利要求')
  if (content.specification.length === 0) {
    throw new PatentFilingError('specification 说明书至少要有 1 个节点')
  }
  nonEmptyList(content.figures, 'figures 附图（第 1 张即摘要附图，不能为空）')
  content.specification.forEach((node, index) => {
    checkNode(node, `specification[${index}]（${node.kind}）`)
  })
  return content
}
