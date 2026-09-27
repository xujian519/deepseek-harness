/**
 * src/patent — LLM JSON 容错解析（patent 域共享）。
 *
 * 收敛 atoms（llm.ts）与 figure（analyze.ts）两处重复的 JSON 解析逻辑：
 * 直接解析 → 去 ```json 代码围栏后解析。新增 LLM 结构化输出消费方时复用本模块，
 * 不要复制实现。
 */

/**
 * 去掉 ```json ... ``` 围栏（LLM 输出格式漂移兜底）。
 * @param raw - 待处理的原始 LLM 输出文本。
 * @returns 去除代码围栏后的文本；未命中围栏时原样返回 raw。
 */
export function stripCodeFence(raw: string): string {
  const match = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  const body = match?.[1]
  return body !== undefined ? body.trim() : raw
}

/**
 * JSON 容错解析：直接解析 → 去代码围栏解析；失败返回 undefined。
 * @param raw - 待解析的原始文本。
 * @returns 解析出的对象；解析失败或结果不是对象时返回 undefined。
 */
export function tryParseJson(raw: string): Record<string, unknown> | undefined {
  const candidates = [raw, stripCodeFence(raw)]
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value as Record<string, unknown>
      }
    } catch {
      // 尝试下一个候选
    }
  }
  return undefined
}

/**
 * 读取一个 JSON 对象；其它形状返回 undefined。
 * @param value - 待窄化的值（LLM 输出或工具输出的 JSON 值）。
 * @returns 对象形状的值，或 undefined。
 */
export function asJsonRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * 读取一个 JSON 数组；其它形状返回空数组。
 * @param value - 待窄化的值。
 * @returns 数组形状的值，或空数组。
 */
export function asJsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/**
 * 读取非空字符串（去首尾空白后非空）；其它形状返回 undefined。
 * @param value - 待窄化的值。
 * @returns 去空白后的字符串，或 undefined。
 */
export function readJsonString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/**
 * 读取 JSON 数字；其它形状返回 undefined。
 * @param value - 待窄化的值。
 * @returns 数字，或 undefined。
 */
export function readJsonNumber(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

/**
 * 读取字符串数组，逐项去空丢弃。
 * @param value - 待窄化的值。
 * @returns 非空字符串数组（非数组或非字符串项被丢弃）。
 */
export function readJsonStringArray(value: unknown): string[] {
  return asJsonArray(value).map(readJsonString).filter((entry): entry is string => entry !== undefined)
}
