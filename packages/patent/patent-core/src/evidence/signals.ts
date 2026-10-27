/**
 * 证据评分的共用原语：档位映射、字段非空判断与三性评分基线。
 * @module @deepseek-ai/dsh-patent-core/evidence/signals
 */

/** 评分档位：高。 */
export const LEVEL_HIGH = 'high'
/** 评分档位：较高。 */
export const LEVEL_MEDIUM_HIGH = 'medium_high'
/** 评分档位：中。 */
export const LEVEL_MEDIUM = 'medium'
/** 评分档位：低。 */
export const LEVEL_LOW = 'low'

/**
 * 按阈值表把分数映射到档位。
 * @param score - 0–1 的评分。
 * @param thresholds - 由高到低排列的阈值表。
 * @param fallback - 全部阈值未命中时的档位。
 * @returns 命中的档位。
 */
export function levelFor(score: number, thresholds: Array<{ min: number; level: string }>, fallback: string): string {
  for (const t of thresholds) {
    if (score >= t.min) return t.level
  }
  return fallback
}

/**
 * 字段是否填写了非空白内容。
 * @param value - 待检查的字段值。
 * @returns 非空且非空白时为 true。
 */
export function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== ''
}

/** 三性评分基线：证据记录本身的完备度起点，不含任何加分。 */
export const TRIPLE_ATTRIBUTE_BASE = 0.5
