/**
 * TRIZ data access: loads the shipped 39x39 contradiction matrix and the 40
 * inventive principles, and exposes the 39 engineering-parameter labels used
 * for deterministic cell lookup.
 *
 * The JSON assets ship at the package root (assets/) and resolve relative to
 * this module via import.meta.url, so both source (src/data.ts) and built
 * (lib/index.js) execution find them without a build-time copy step.
 * @module @deepseek-ai/dsh-methodology/data
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { TrizPrinciple, TrizParameter } from './types.ts'

const MATRIX_URL = new URL('../assets/triz-matrix.json', import.meta.url)
const PRINCIPLES_URL = new URL('../assets/triz-principles.json', import.meta.url)

/**
 * Load and memoize a shipped JSON asset resolved relative to this module.
 * @param url - the asset URL resolved relative to import.meta.url.
 * @param cache - the memoization slot holding the parsed value.
 * @returns the parsed JSON value.
 */
function loadJsonAsset<T>(url: URL, cache: { current: T | null }): T {
  const cached = cache.current
  if (cached !== null) return cached
  const parsed = JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as T
  cache.current = parsed
  return parsed
}

const matrixCache: { current: number[][][] | null } = { current: null }

/**
 * Load the 39x39 contradiction matrix, indexed [worsening-1][improving-1].
 * @returns the full matrix of recommended principle numbers.
 */
export function loadMatrix(): number[][][] {
  return loadJsonAsset(MATRIX_URL, matrixCache)
}

/**
 * Deterministic cell lookup: improving parameter x worsening parameter.
 * @param paramImproving - improving engineering parameter number, 1-39.
 * @param paramWorsening - worsening engineering parameter number, 1-39.
 * @returns recommended inventive principle numbers for that cell (empty for the
 * diagonal, which is a physical contradiction and has no classical entry).
 */
export function lookupMatrixCell(paramImproving: number, paramWorsening: number): number[] {
  const row = loadMatrix()[paramWorsening - 1] ?? []
  return row[paramImproving - 1] ?? []
}

const principlesCache: { current: TrizPrinciple[] | null } = { current: null }

/**
 * Load the 40 inventive principles from the shipped asset.
 * @returns the principles in number order.
 */
export function loadPrinciples(): TrizPrinciple[] {
  return loadJsonAsset(PRINCIPLES_URL, principlesCache)
}

let principlesByIdCache: Map<number, TrizPrinciple> | null = null

/**
 * Resolve an inventive principle number to its full principle entry.
 * @param no - inventive principle number, 1-40.
 * @returns the principle, or undefined when the number is unknown.
 */
export function principleById(no: number): TrizPrinciple | undefined {
  if (principlesByIdCache === null) {
    principlesByIdCache = new Map(loadPrinciples().map(principle => [principle.no, principle]))
  }
  return principlesByIdCache.get(no)
}

/**
 * The 39 classic engineering parameters (row/column names). match is the
 * lowercase core word recognized in a goal (moving/stationary pairs share one
 * core word; the model resolves the direction), label is the display name.
 */
export const ENGINEERING_PARAMS: readonly TrizParameter[] = [
  { no: 1, match: '重量', label: '运动物体重量' },
  { no: 2, match: '重量', label: '静止物体重量' },
  { no: 3, match: '长度', label: '运动物体长度' },
  { no: 4, match: '长度', label: '静止物体长度' },
  { no: 5, match: '面积', label: '运动物体面积' },
  { no: 6, match: '面积', label: '静止物体面积' },
  { no: 7, match: '体积', label: '运动物体体积' },
  { no: 8, match: '体积', label: '静止物体体积' },
  { no: 9, match: '速度', label: '速度' },
  { no: 10, match: '力', label: '力' },
  { no: 11, match: '应力', label: '应力' },
  { no: 12, match: '形状', label: '形状' },
  { no: 13, match: '稳定性', label: '结构稳定性' },
  { no: 14, match: '强度', label: '强度' },
  { no: 15, match: '作用时间', label: '运动物体作用时间' },
  { no: 16, match: '作用时间', label: '静止物体作用时间' },
  { no: 17, match: '温度', label: '温度' },
  { no: 18, match: '光照', label: '光照度' },
  { no: 19, match: '能量', label: '运动物体能量' },
  { no: 20, match: '能量', label: '静止物体能量' },
  { no: 21, match: '功率', label: '功率' },
  { no: 22, match: '能量损失', label: '能量损失' },
  { no: 23, match: '物质损失', label: '物质损失' },
  { no: 24, match: '信息损失', label: '信息损失' },
  { no: 25, match: '时间损失', label: '时间损失' },
  { no: 26, match: '数量', label: '物质数量' },
  { no: 27, match: '可靠性', label: '可靠性' },
  { no: 28, match: '测量精度', label: '测量精度' },
  { no: 29, match: '制造精度', label: '制造精度' },
  { no: 30, match: '有害因素', label: '作用于物体的有害因素' },
  { no: 31, match: '有害因素', label: '物体产生的有害因素' },
  { no: 32, match: '可制造性', label: '可制造性' },
  { no: 33, match: '可操作性', label: '可操作性' },
  { no: 34, match: '可维修性', label: '可维修性' },
  { no: 35, match: '适应性', label: '适应性' },
  { no: 36, match: '复杂性', label: '装置复杂性' },
  { no: 37, match: '复杂性', label: '检测复杂性' },
  { no: 38, match: '自动化', label: '自动化程度' },
  { no: 39, match: '生产率', label: '生产率' },
]

/**
 * Detect engineering-parameter numbers named in a goal by substring match.
 * @param goal - the task/goal text to scan.
 * @returns the matching parameter numbers, in definition order, deduplicated.
 */
export function detectParamNumbers(goal: string): number[] {
  const text = goal.toLowerCase()
  const found = new Set<number>()
  for (const param of ENGINEERING_PARAMS) {
    if (text.includes(param.match)) found.add(param.no)
  }
  return [...found]
}

/**
 * Resolve a parameter number to its human-facing label.
 * @param no - engineering parameter number, 1-39.
 * @returns the label, or the number as a string when unknown.
 */
export function paramLabel(no: number): string {
  const param = ENGINEERING_PARAMS.find(entry => entry.no === no)
  return param?.label ?? String(no)
}

/**
 * Render principle numbers as "N name" entries for prompt text.
 * @param ids - inventive principle numbers, 1-40.
 * @returns a comma-joined, ordered list.
 */
export function principleNames(ids: readonly number[]): string {
  return ids.map((id) => {
    const name = principleById(id)?.name ?? ''
    return `${id} ${name}`.trim()
  }).join(', ')
}
