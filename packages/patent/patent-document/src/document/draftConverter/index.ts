/**
 * src/document/draftConverter — 受控草案 → 模板槽位 HTML 的确定性转换。
 *
 * 模型提交结构化草案（patent-core 的 SpecDraft/TemplateDraft），本模块生成
 * 标题、权项编号与表题（by construction），渲染层不再接受模型可控标签。
 * @module @deepseek-ai/dsh-patent-document/document/draftConverter
 */

export { escapeHtmlText } from './escape.ts'
export { renderBlocks, type TableCaptionCounter } from './blocks.ts'
export { renderSpecDraftSections, type SpecDraftSectionMap } from './specDraft.ts'
export { injectTemplateDraft } from './templateDraft.ts'
export { renderGenericTemplateSections } from './genericDraft.ts'
