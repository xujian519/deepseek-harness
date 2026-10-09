/**
 * src/document/draftConverter/escape — 草案文本的 HTML 转义。
 *
 * 草案文本来自模型输入，是唯一进入渲染结果的模型可控字符串；转义后模型无法注入
 * 标签、属性或占位符，标题与表格结构由转换器独占生成。
 * @module @deepseek-ai/dsh-patent-document/document/draftConverter/escape
 */

/** 转义文本中的五个 HTML 特殊字符。 */
const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * 将模型文本转义为可安全嵌入 HTML 的文本节点内容。
 * @param text - 模型提供的字符串（已校验非空）。
 * @returns 转义后的字符串。
 */
export function escapeHtmlText(text: string): string {
  return text.replace(/[&<>"']/g, char => ESCAPES[char] as string)
}
