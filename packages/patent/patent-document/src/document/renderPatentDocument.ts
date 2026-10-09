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
import { checkDocumentCompliance } from './documentCompliance.ts'
import { DocumentRenderError } from './errors.ts'
import { findMatchingCloseTag } from './htmlScan.ts'
import { applyParagraphNumbering } from './paragraphNumbering.ts'
import { DEFAULT_PDF_TIMEOUT_MS, renderPdf } from './pdfRenderer.ts'
import { readTemplateHtml } from './templateResolver.ts'
import type { DocumentRenderInput, DocumentRenderResult, RenderFormat } from './types.ts'
import { FORM_TEMPLATE_IDS, isFormTemplateId } from './draftSchema/index.ts'
import { injectTemplateDraft, renderSpecDraftSections } from './draftConverter/index.ts'

/** 缺省输出目录（相对 cwd，取代 Sati 的 .sati/documents）。 */
export const DEFAULT_OUTPUT_DIR = '.dsh/documents'

/**
 * 安全文件名与案卷号允许的字符：ASCII 字母数字与 `.` `_` `-` `()`、中文汉字、
 * 圈码 ①–⑳（案卷常用「①件/②件」前缀），以及草稿名常用的中文标点
 * （、。《》「」【】（），：；！？·——…“”‘’）。空格不入列，落盘路径在 shell 与 URL 中仍可直接使用。
 */
const SAFE_NAME_CHARS = 'A-Za-z0-9._\\-()\\u4e00-\\u9fa5\\u2460-\\u2473\\u3001-\\u303F\\uFF01\\uFF08\\uFF09\\uFF0C\\uFF1A\\uFF1B\\uFF1F\\uFF5E\\u00B7\\u2013\\u2014\\u2018-\\u201D\\u2026'

/** 安全输出文件名：允许字符集内 1–120 字符，且不含 `..` 段。 */
const SAFE_NAME_PATTERN = new RegExp(`^(?!.*\\.\\.)[${SAFE_NAME_CHARS}]{1,120}$`, 'u')

/** 安全案卷号：与输出文件名同一字符集（案卷号同样来自模型输入，同样不得穿越目录）。 */
const SAFE_CASE_ID_PATTERN = new RegExp(`^(?!.*\\.\\.)[${SAFE_NAME_CHARS}]{1,120}$`, 'u')

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
  /** Chrome 无头打印超时（毫秒）；缺省取 pdfRenderer 的导出默认值。 */
  pdfTimeoutMs?: number
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
    // The step failure thrown below is the reported one; a failed tmp cleanup
    // must not replace it.
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

/**
 * 将 sections 按元素 id 替换为 innerHTML。
 *
 * 命中 `<section id="x">` 时替换的是该 section 的**全部**内层内容，模板里的骨架
 * 标题随之一并被替换 —— 需要保留章节标题的调用方必须在传入内容里自行给出。
 * @param html - 模板 HTML。
 * @param sections - id → 内容映射。
 * @returns 替换后的 HTML，以及被跳过（未命中/非法）的 id 列表。
 */
function injectSections(
  html: string,
  sections: Record<string, string>,
): { html: string; skippedIds: string[] } {
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
    const openTag = openMatch[0]
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
 * 解析本次渲染的槽位注入映射：claims-spec 走受控草案（转换器生成结构），
 * 其余模板暂走 sections；两者互斥，未迁移模板传 draft 明确报错。
 * @param input - 渲染输入。
 * @returns 元素 id → innerHTML 映射。
 */
function resolveSections(input: DocumentRenderInput): Record<string, string> {
  if (input.draft !== undefined) {
    if (input.template !== 'claims-spec') {
      throw new DocumentRenderError(`模板 ${input.template} 不接受 SpecDraft 草案：draft（claims-spec 结构）仅支持 claims-spec；right-evaluation-report 与 search-report-form 请用 draft 传表单草案（fields + sections 槽位）`)
    }
    if (Object.keys(input.sections).length > 0) {
      throw new DocumentRenderError('draft 与 sections 互斥：claims-spec 请只传 draft（结构化草案）')
    }
    return { ...renderSpecDraftSections(input.draft) }
  }
  if (input.template === 'claims-spec') {
    throw new DocumentRenderError('sections 已停用：claims-spec 请改用受控草案参数 draft（结构化块，不再传 innerHTML）')
  }
  if (isFormTemplateId(input.template)) {
    throw new DocumentRenderError(`sections 已停用：${input.template} 请改用受控草案参数 draft（fields 文本/选项槽位 + sections 章节/数据行槽位）`)
  }
  return input.sections
}

/**
 * 校验表单模板草案分支的互斥约束并执行注入。
 * @param html - 模板 HTML（品牌注入后）。
 * @param input - 渲染输入。
 * @returns 注入表单草案后的 HTML。
 */
function resolveTemplateDraft(html: string, input: DocumentRenderInput): string {
  if (input.templateDraft === undefined) return html
  if (input.draft !== undefined) {
    throw new DocumentRenderError('draft 与 templateDraft 互斥：一次渲染只传一份草案')
  }
  if (!isFormTemplateId(input.template)) {
    throw new DocumentRenderError(`模板 ${input.template} 尚未接入受控草案：表单草案目前仅支持 ${FORM_TEMPLATE_IDS.join('、')}`)
  }
  if (Object.keys(input.sections).length > 0) {
    throw new DocumentRenderError(`sections 已停用：${input.template} 请改用受控草案参数 draft（fields 文本/选项槽位 + sections 章节/数据行槽位）`)
  }
  return injectTemplateDraft(html, input.template, input.templateDraft)
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
  html = resolveTemplateDraft(html, input)
  if (input.templateDraft === undefined) {
    const injected = injectSections(html, resolveSections(input))
    html = injected.html
    if (injected.skippedIds.length > 0) {
      warnings.push(`以下 section id 未命中模板，内容已忽略: ${injected.skippedIds.join(', ')}`)
    }
  }
  // 段落编号由模板通过 data-paragraph-numbering 声明；引擎把编号写成字面文本，
  // 使 PDF 与下游 HTML→docx 转制读到同一串字符。
  html = applyParagraphNumbering(html).html
  for (const issue of checkDocumentCompliance(html)) {
    warnings.push(issue.message)
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
        pdfTimeoutMs: options.pdfTimeoutMs ?? DEFAULT_PDF_TIMEOUT_MS,
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
