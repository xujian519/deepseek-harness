/**
 * 化学式识别索引（持久化）。
 *
 * 识别结果（ChemicalStructureResult）以 JSON 文件形式落盘（默认
 * `.sati/chemistry-index.json`，工作区根目录下），供后续检索/校验管线消费。
 * 写入走原子写 + 进程内串行化（见 internal/index-store），与 figure/index-store
 * 同构。当前 dsh 未安装 RDKit，识别引擎不可用，条目只在 usable 时写入——
 * 存储层先就位，RDKit 接入后自动生效。
 * @module @deepseek-ai/dsh-patent-tools/chemistry/index-store
 */

import { createIndexStore } from '../internal/index-store.ts'
import type { ChemicalStructureResult } from '../tool/recognize-chemical-structure.ts'

/** 索引文件版本（结构不兼容时升版，旧文件按空索引处理）。 */
export const CHEMISTRY_INDEX_VERSION = 1 as const

/** 索引文件默认位置（工作区根相对路径，与 Sati 一致）。 */
export const DEFAULT_CHEMISTRY_INDEX_RELATIVE_PATH = '.sati/chemistry-index.json'

/**
 * 索引条目：一次化学式识别结果。
 * sourceKey 为来源标识：图片模式为工作区相对图片路径，文本模式为 `text:<hash>`。
 */
export type ChemistryIndexEntry = {
  /** 来源标识（图片相对路径或 text 哈希）。 */
  sourceKey: string
  /** 识别时间（ISO 8601）。 */
  analyzedAt: string
  /** 识别结果。 */
  analysis: ChemicalStructureResult
}

function isChemistryIndexEntry(value: unknown): value is ChemistryIndexEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Partial<ChemistryIndexEntry>
  // 校验对象来自磁盘 JSON：analysis 显式含 null，使运行时空值检查保持有效（TS 对纯对象类型会窄化掉 null）。
  const analysis = entry.analysis as Partial<ChemicalStructureResult> | null | undefined
  return (
    typeof entry.sourceKey === 'string' &&
    typeof entry.analyzedAt === 'string' &&
    typeof analysis === 'object' &&
    analysis !== null &&
    typeof analysis.kind === 'string' &&
    typeof analysis.chosenIndex === 'number' &&
    // 数组字段必须为数组：否则下游消费方（map/filter 等）会以裸 TypeError 崩溃
    Array.isArray(analysis.candidates) &&
    Array.isArray(analysis.names) &&
    Array.isArray(analysis.warnings)
  )
}

/** 化学索引存储实例（集成器接线 recognize 写入）。 */
export const chemistryIndexStore = createIndexStore<ChemistryIndexEntry>({
  version: CHEMISTRY_INDEX_VERSION,
  validateEntry: isChemistryIndexEntry,
  entryKey: entry => entry.sourceKey,
  compare: (a, b) => a.sourceKey.localeCompare(b.sourceKey),
  kindLabel: '化学',
})
