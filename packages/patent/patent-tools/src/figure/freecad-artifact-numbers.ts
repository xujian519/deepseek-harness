/**
 * 读 FreeCAD 脚本产物时的数值校验与诊断文案格式化。
 *
 * 剖切几何与剖面线几何两个解析器各自的产物字段不同，但校验与报错的做法必须一致：都要把
 * （`noUncheckedIndexedAccess` 下的）`number | undefined` 收窄成有限数，都要在报错文案里用
 * 同一种数值写法。做法一致才让两个模块的报错可读，故这一处是两者的共同归属。
 * @module @deepseek-ai/dsh-patent-tools/figure/freecad-artifact-numbers
 */

/**
 * 有限数判定：同时把 `number | undefined` 收窄为 `number`。
 * @param value - 待判定值。
 * @returns 是有限数时为 true（类型谓词，供调用点收窄）。
 */
export function isFiniteNumber(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

/**
 * 报错文案里的数值格式（最多 6 位小数，去尾零）。
 * @param value - 待格式化的数值（调用方保证是有限数）。
 * @returns 十进制文本。
 */
export function fmtNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
}
