/**
 * 两个 PDF 下载工具（`patent_pdf_download` 与 `paper_download`）共同遵守的两项约定：
 * 「响应体是不是一份 PDF」的三检，与默认落盘目录的日期分目录规则。
 *
 * 三检必须在两个工具间逐条一致——Content-Type 为 HTML、体小于下限、缺少魔数，
 * 是同一份判定被两处复述，任何一处放宽都会让另一处放过错误页；默认目录同理，
 * `<cwd>/<中文目录>/YYYY-MM-DD`（本地日期）只有目录名随工具不同。失败文案与投递方式
 * 留在调用方：专利工具返回 `failed(...)`，论文工具抛 `Error`。
 *
 * @module @deepseek-ai/dsh-patent-core/pdf-download
 */

import { join } from 'node:path'

/** PDF 魔数（%PDF-，5 字节）。 */
export const PDF_MAGIC = '%PDF-'

/** 错误页判定下限：小于该字节数的响应视为错误页不落盘。 */
export const MIN_PDF_BYTES = 500

/** 三检不通过的事实（文案由调用方按各自风格包裹）。 */
export type PdfBodyFault =
  | { readonly code: 'too-small'; readonly bytes: number }
  | { readonly code: 'magic'; readonly prefix: string }

/**
 * Content-Type 是否声明 HTML（错误页最常见的形态）。
 * @param contentType - 响应头 `content-type` 原文。
 * @returns 声明为 HTML 时为 true。
 */
export function isHtmlContentType(contentType: string): boolean {
  return contentType.toLowerCase().includes('text/html')
}

/**
 * 对已读到的响应体做最小字节与魔数两检。Content-Type 单独判定，因为它必须在读体之前
 * 就能拒绝，两个工具都靠这一点避免为错误页读满响应体。
 * @param body - 完整响应体。
 * @returns 首个不通过的事实；两检都通过为 undefined。
 */
export function inspectPdfBody(body: Buffer): PdfBodyFault | undefined {
  if (body.length < MIN_PDF_BYTES) return { code: 'too-small', bytes: body.length }
  const prefix = body.subarray(0, PDF_MAGIC.length).toString()
  return prefix === PDF_MAGIC ? undefined : { code: 'magic', prefix }
}

/**
 * 默认落盘目录：`<cwd>/<folder>/YYYY-MM-DD`（本地日期）。
 * @param cwd - 进程工作目录。
 * @param folder - 调用方自己的落盘目录名。
 * @param now - 取日期的时钟，默认当前时间。
 * @returns 当天输出目录的绝对路径。
 */
export function datedOutputDir(cwd: string, folder: string, now: Date = new Date()): string {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  return join(cwd, folder, date)
}
