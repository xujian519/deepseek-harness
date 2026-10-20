/**
 * legal 域的关键词提取入口。
 *
 * 实现位于 shared/keywords.ts（检索阶梯在 shared 层共用），此处再导出以保持
 * `legal/keywords.ts` 这一公开入口与深层导入路径不变。
 *
 * @module @deepseek-ai/dsh-patent-knowledge/legal/keywords
 */

export { extractLawKeywords } from '../shared/keywords.ts'
