/**
 * src/draft/tableCaption — 受控草案的表题格式（patent 域共享）。
 *
 * HTML 通道（dsh-patent-document 的 draftConverter）与 docx 通道
 * （dsh-patent-filing 的 fromDraft）消费同一份草案，表题必须同形；两处各写一份
 * 字面量时，任何一侧的改动都会让同一草案产出两种表题。序号自增仍由各自计数器
 * 负责，本模块只固定格式。
 * @module @deepseek-ai/dsh-patent-core/draft/tableCaption
 */

/**
 * 表题文本：`表 N · 名称`。
 * @param index - 从 1 起的表序号。
 * @param name - 表格名称（草案已校验不含「表+数字」前缀）。
 * @returns 未转义的「表 N · 名称」文本；HTML 通道自行对其做转义。
 */
export function formatTableCaption(index: number, name: string): string {
  return `表 ${index} · ${name}`
}
