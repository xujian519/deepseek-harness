/**
 * 品牌注入：读取 theme.json 并映射为 CSS 变量。
 *
 * assets/templates/patent/*.html 使用 :root 上的 --sati-doc-* 变量；
 * 事务所/白标产品通过 theme.json 的 documents.patent 命名空间覆盖。
 * @module @deepseek-ai/dsh-patent-document/document/brandInjector
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { DocumentBrand } from './types.ts'

/** theme.json -> documents.patent 的已知键到 CSS 变量名的映射。 */
export const BRAND_KEY_TO_CSS_VAR: Record<string, string> = {
  firm: '--sati-doc-firm',
  confidential: '--sati-doc-confidential',
  disclaimer: '--sati-doc-disclaimer',
  accent: '--sati-doc-accent',
  accentStrong: '--sati-doc-accent-strong',
  body: '--sati-doc-body',
  muted: '--sati-doc-muted',
  border: '--sati-doc-border',
  headerBg: '--sati-doc-header-bg',
  surface: '--sati-doc-surface',
  zebra: '--sati-doc-zebra',
  danger: '--sati-doc-danger',
  warning: '--sati-doc-warning',
  success: '--sati-doc-success',
  evidence: '--sati-doc-evidence',
  client: '--sati-doc-client',
  model: '--sati-doc-model',
  assumption: '--sati-doc-assumption',
  fontSerif: '--sati-doc-font-serif',
  fontSans: '--sati-doc-font-sans',
  fontMono: '--sati-doc-font-mono',
}

/** 纯字符串值是否需要 CSS 引号（颜色/字体以外的文案类变量）。 */
const QUOTED_VARS = new Set(['--sati-doc-firm', '--sati-doc-confidential', '--sati-doc-disclaimer'])

/**
 * 从任意路径读取 theme.json 并提取 documents.patent 品牌覆盖。
 * @param path - theme.json 路径；缺省或缺失时返回空覆盖。
 * @returns documents.patent 命名空间下的品牌键值。
 */
export function loadBrandFromPath(path?: string): DocumentBrand {
  if (path === undefined) return {}
  const abs = resolve(path)
  if (!existsSync(abs)) return {}
  try {
    const raw = readFileSync(abs, 'utf8')
    const parsed = JSON.parse(raw) as { documents?: { patent?: DocumentBrand } }
    return parsed.documents?.patent ?? {}
  } catch {
    return {}
  }
}

/**
 * 合并多层品牌覆盖：配置文件 < 显式传入。
 * @param explicit - 显式传入的内联品牌覆盖。
 * @param fromConfig - 从 theme.json 读取的品牌覆盖。
 * @returns 合并后的品牌对象（显式值胜出）。
 */
export function mergeBrand(explicit?: DocumentBrand, fromConfig?: DocumentBrand): DocumentBrand {
  return { ...(fromConfig ?? {}), ...(explicit ?? {}) }
}

/**
 * 将品牌对象编译为一段可注入 HTML <style> 的 CSS 文本。
 * @param brand - 品牌键值对象。
 * @returns :root 作用域的 CSS 规则文本。
 */
export function buildBrandStyle(brand: DocumentBrand): string {
  const lines: string[] = [':root {']
  for (const [key, value] of Object.entries(brand)) {
    const cssVar = BRAND_KEY_TO_CSS_VAR[key]
    // 跳过未知键与空值（空串/纯空白会生成 `--x: ;` 无效声明）。
    if (cssVar === undefined || value === undefined || value.trim() === '') continue
    const formatted = QUOTED_VARS.has(cssVar) ? `"${cssValueEscape(value)}"` : cssValueEscape(value)
    lines.push(`  ${cssVar}: ${formatted};`)
  }
  lines.push('}')
  return lines.join('\n')
}

/**
 * 对 CSS 值做最小转义：未引号值（颜色/字体等）剔除会破坏 CSS 结构的
 * 分号与花括号，并转义反斜杠；引号值额外转义双引号与换行。
 * @param value - 原始 CSS 值。
 * @returns 转义后的安全 CSS 值。
 */
function cssValueEscape(value: string): string {
  const withoutBraces = value.replace(/[{};]/g, '').replace(/\\/g, '\\\\').replace(/\n/g, '\\A ')
  return withoutBraces.replace(/"/g, '\\"')
}
