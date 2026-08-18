/**
 * 模板解析：定位 assets/templates/patent/<template>/assets/template.html。
 *
 * 资产随包分发在包根 assets/ 下；本模块在源码（src/document/）与打包产物
 * （lib/index.js）两种执行位置下用 import.meta.url 探测两个相对深度，
 * 返回持有 manifest.json 的那个目录。
 * @module @deepseek-ai/dsh-patent-document/document/templateResolver
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DocumentRenderError } from './errors.ts'
import type { DocumentTemplateId } from './types.ts'

/**
 * 定位模板系统根目录（随包分发的 assets/templates/patent）。
 * @returns 持有 manifest.json 的绝对目录路径。
 */
export function getTemplateRoot(): string {
  // 源码执行位置（src/document/）与打包执行位置（lib/）到包根的深度不同，
  // 逐一探测并取第一个存在 manifest.json 的候选。
  const candidates = [
    new URL('../../assets/templates/patent', import.meta.url),
    new URL('../assets/templates/patent', import.meta.url),
  ] as const
  for (const candidate of candidates) {
    const resolved = fileURLToPath(candidate)
    if (existsSync(join(resolved, 'manifest.json'))) return resolved
  }
  // 数组字面量恒有两个候选，缺省取第一个。
  return fileURLToPath(candidates[0])
}

/** manifest.json 结构。 */
type TemplateManifest = {
  templates?: string[]
  renders?: { default?: string; supported?: string[] }
  page?: { size?: string; margins?: Record<string, string> }
}

let manifestCache: TemplateManifest | undefined
let manifestCachePath: string | undefined

/**
 * 读取并缓存模板系统 manifest.json。
 * @returns 解析后的 manifest 对象。
 */
export function readTemplateManifest(): TemplateManifest {
  const root = getTemplateRoot()
  const path = join(root, 'manifest.json')
  if (manifestCache !== undefined && manifestCachePath === path) return manifestCache
  const raw = readFileSync(path, 'utf8')
  manifestCache = JSON.parse(raw) as TemplateManifest
  manifestCachePath = path
  return manifestCache
}

/**
 * 验证模板 id 并定位其 HTML 文件。
 * @param template - 受支持的模板 id。
 * @returns 模板根目录与模板 HTML 绝对路径。
 */
export function resolveTemplate(template: DocumentTemplateId): { root: string; htmlPath: string } {
  const root = getTemplateRoot()
  const manifest = readTemplateManifest()
  const available = manifest.templates ?? []
  if (!available.includes(template)) {
    throw new DocumentRenderError(`未知模板 "${template}"（可用: ${available.join(', ') || '无'}）`)
  }
  const htmlPath = join(root, template, 'assets', 'template.html')
  if (!existsSync(htmlPath)) {
    throw new Error(`模板 HTML 缺失: ${htmlPath}`)
  }
  return { root, htmlPath }
}

/**
 * 读取模板原始 HTML。
 * @param template - 受支持的模板 id。
 * @returns 模板 HTML 文本。
 */
export function readTemplateHtml(template: DocumentTemplateId): string {
  const { htmlPath } = resolveTemplate(template)
  return readFileSync(htmlPath, 'utf8')
}
