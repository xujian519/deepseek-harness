/**
 * 专利文书渲染核心：模板 HTML + 品牌注入 + 按 id 替换内容 + HTML/PDF 落盘。
 * @module @deepseek-ai/dsh-patent-document/document/renderPatentDocument
 */

import { existsSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { caseOutputsDir } from '@deepseek-ai/dsh-patent-core'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { buildBrandStyle, loadBrandFromPath, mergeBrand } from './brandInjector.ts'
import { DocumentRenderError } from './errors.ts'
import { renderPdf } from './pdfRenderer.ts'
import { readTemplateHtml } from './templateResolver.ts'
import type { DocumentRenderInput, DocumentRenderResult, RenderFormat } from './types.ts'

/** 缺省输出目录（相对 cwd，取代 Sati 的 .sati/documents）。 */
export const DEFAULT_OUTPUT_DIR = '.dsh/documents'

/** 安全文件名：字母、数字、下划线、连字符、点；禁止路径分隔符。 */
const SAFE_NAME_PATTERN = /^[A-Za-z0-9._-]+$/

/** 安全案卷号：同上，允许中文，且不含 `..` 段（防路径穿越）。 */
const SAFE_CASE_ID_PATTERN = /^(?!.*\.\.)[A-Za-z0-9._\-\u4e00-\u9fa5]{1,120}$/

/**
 * 渲染专利文书所需的运行期依赖与缺省目录。
 */
export interface RenderPatentDocumentOptions {
  /** 注入的 subprocess 服务（ctx.subprocess），用于 headless Chrome 打印 PDF。 */
  subprocess: SubprocessRuntime
  /** Chrome 可执行文件覆盖；缺省时按 DSH_CHROME_PATH/CHROME_PATH/内置候选探测。 */
  chromePath?: string
  /** 既无 outputDir 也无 caseId 时的缺省输出目录（相对 cwd）。 */
  defaultOutputDir?: string
  /** 调用方取消信号；触发后终止 headless Chrome 进程树。 */
  signal?: AbortSignal
}

/**
 * 校验输入字符串匹配安全模式，否则抛出 DocumentRenderError。
 * @param value - 待校验字符串。
 * @param pattern - 安全模式。
 * @param label - 错误消息中的字段名（输出文件名 / 案卷号）。
 * @returns 通过校验的字符串。
 */
function assertSafe(value: string, pattern: RegExp, label: string): string {
  if (!pattern.test(value)) {
    throw new DocumentRenderError(`非法${label}: ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * 解析输出目录：显式 outputDir > caseId 约定目录 > 缺省目录。
 * @param input - 渲染输入。
 * @param cwd - 相对路径基准目录。
 * @param defaultOutputDir - 缺省输出目录。
 * @returns 输出目录绝对路径。
 */
function resolveOutputDir(input: DocumentRenderInput, cwd: string, defaultOutputDir: string): string {
  if (input.outputDir !== undefined) {
    return isAbsolute(input.outputDir) ? input.outputDir : resolve(cwd, input.outputDir)
  }
  if (input.caseId !== undefined) {
    return resolve(cwd, caseOutputsDir(assertSafe(input.caseId, SAFE_CASE_ID_PATTERN, '案卷号')))
  }
  return resolve(cwd, defaultOutputDir)
}

/**
 * 解析品牌配置路径；本包不随包分发默认 theme.json。
 * @param input - 渲染输入。
 * @param cwd - 相对路径基准目录。
 * @returns 品牌配置绝对路径，未提供时 undefined。
 */
function resolveBrandPath(input: DocumentRenderInput, cwd: string): string | undefined {
  if (input.brandPath === undefined) return undefined
  return isAbsolute(input.brandPath) ? input.brandPath : resolve(cwd, input.brandPath)
}

/**
 * 原子写文件（先 tmp 再 rename；Windows 上 rename 不覆盖已存在文件，先清理目标）。
 * 任一步失败都清理 tmp，避免遗留垃圾文件。
 * @param file - 目标文件路径。
 * @param content - 文件文本内容。
 */
async function atomicWriteFile(file: string, content: string): Promise<void> {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  try {
    await writeFile(tmp, content, 'utf8')
    await rm(file, { force: true })
    await rename(tmp, file)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

/**
 * 将品牌 CSS 注入到 HTML 的 <head>（放在现有 <style> 之前，确保覆盖默认变量）。
 * @param html - 模板 HTML。
 * @param brandCss - 品牌 CSS 文本。
 * @returns 注入后的 HTML。
 */
function injectBrandCss(html: string, brandCss: string): string {
  const style = `<style>\n${brandCss}\n</style>`
  const headMatch = html.match(/<head[^>]*>/i)
  if (headMatch?.index !== undefined) {
    const insertAt = headMatch.index + headMatch[0].length
    return html.slice(0, insertAt) + '\n' + style + '\n' + html.slice(insertAt)
  }
  return style + '\n' + html
}

/** HTML void 元素（无闭合标签），标签配平扫描时跳过。 */
const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

/**
 * 从开标签结束位置向后扫描，找到与之配对的闭合标签起始下标。
 * 用全标签深度计数处理嵌套内容（模板为受控的良构 HTML）。
 * @param html - HTML 文本。
 * @param openEnd - 开标签结束位置。
 * @returns 配对闭合标签起始下标，未找到时 undefined。
 */
function findMatchingCloseTag(html: string, openEnd: number): number | undefined {
  const tagRe = /<\/?[A-Za-z][^>]*>/g
  tagRe.lastIndex = openEnd
  let depth = 1
  let match: RegExpExecArray | null
  while ((match = tagRe.exec(html)) !== null) {
    const token = match[0] ?? ''
    const isClose = token.startsWith('</')
    const nameMatch = token.match(/^<\/?([A-Za-z][A-Za-z0-9]*)/)
    const name = (nameMatch?.[1] ?? '').toLowerCase()
    if (isClose) {
      depth -= 1
      if (depth === 0) return match.index
    } else {
      if (VOID_TAGS.has(name) || /\/>$/.test(token)) continue
      depth += 1
    }
  }
  return undefined
}

/**
 * 将 sections 按元素 id 替换为 innerHTML。
 * @param html - 模板 HTML。
 * @param sections - id → 内容映射。
 * @returns 替换后的 HTML 与被跳过（未命中/非法）的 id 列表。
 */
function injectSections(html: string, sections: Record<string, string>): { html: string; skippedIds: string[] } {
  let result = html
  const skippedIds: string[] = []
  for (const [id, content] of Object.entries(sections)) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      skippedIds.push(id)
      continue
    }
    const openPattern = new RegExp(`<([A-Za-z][A-Za-z0-9]*)[^>]*id=["']${id}["'][^>]*>`, 'i')
    const openMatch = openPattern.exec(result)
    if (openMatch === null) {
      skippedIds.push(id)
      continue
    }
    const openTag = openMatch[0] ?? ''
    const closeStart = findMatchingCloseTag(result, openMatch.index + openTag.length)
    if (closeStart === undefined) {
      skippedIds.push(id)
      continue
    }
    result = result.slice(0, openMatch.index) + openTag + content + result.slice(closeStart)
  }
  return { html: result, skippedIds }
}

/**
 * 渲染并落盘专利文书（HTML，可选 PDF）。
 * @param input - 渲染输入。
 * @param cwd - 相对路径基准目录。
 * @param options - 注入的 subprocess 服务与 Chrome/目录覆盖。
 * @returns 生成的 HTML/PDF 路径、PDF 错误与告警。
 */
export async function renderPatentDocument(
  input: DocumentRenderInput,
  cwd: string,
  options: RenderPatentDocumentOptions,
): Promise<DocumentRenderResult> {
  const warnings: string[] = []

  const outputDir = resolveOutputDir(input, cwd, options.defaultOutputDir ?? DEFAULT_OUTPUT_DIR)
  await mkdir(outputDir, { recursive: true })

  const name = assertSafe(input.outputName, SAFE_NAME_PATTERN, '输出文件名')
  const htmlPath = join(outputDir, `${name}.html`)
  const pdfPath = join(outputDir, `${name}.pdf`)

  const brandPath = resolveBrandPath(input, cwd)
  if (brandPath !== undefined && !existsSync(brandPath)) {
    warnings.push(`品牌配置文件不存在，已回退默认: ${brandPath}`)
  }
  const fromConfig = loadBrandFromPath(brandPath)
  const brand = mergeBrand(input.brand, fromConfig)

  let html = readTemplateHtml(input.template)
  html = injectBrandCss(html, buildBrandStyle(brand))
  const injected = injectSections(html, input.sections ?? {})
  html = injected.html
  if (injected.skippedIds.length > 0) {
    warnings.push(`以下 section id 未命中模板，内容已忽略: ${injected.skippedIds.join(', ')}`)
  }

  await atomicWriteFile(htmlPath, html)

  const format: RenderFormat = input.format ?? 'both'
  let renderedPdfPath: string | undefined
  let pdfError: string | undefined
  if (format === 'pdf' || format === 'both') {
    const pdfResult = await renderPdf(
      options.subprocess,
      htmlPath,
      pdfPath,
      {
        ...(options.chromePath !== undefined ? { chromePath: options.chromePath } : {}),
        ...(options.signal !== undefined ? { signal: options.signal } : {}),
      },
    )
    if (pdfResult.ok) {
      renderedPdfPath = pdfResult.path
    } else {
      pdfError = pdfResult.error
    }
  }

  const result: DocumentRenderResult = { htmlPath, warnings }
  if (renderedPdfPath !== undefined) result.pdfPath = renderedPdfPath
  if (pdfError !== undefined) result.pdfError = pdfError
  return result
}
