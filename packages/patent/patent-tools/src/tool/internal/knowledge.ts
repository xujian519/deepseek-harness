/**
 * Shared setup guidance and snippet truncation for the knowledge-backed tools.
 * @module @deepseek-ai/dsh-patent-tools/tool/internal/knowledge
 */

/**
 * Build the setup-required message for a knowledge database that is missing or
 * has the wrong version.
 * @param subject - the corpus name the call needed (for example `判例库`).
 * @param configureHint - extra configuration hint appended after the directory sentence.
 * @returns the model-facing guidance.
 */
export function knowledgeInstallGuidance(subject: string, configureHint = ''): string {
  return `${subject}不可用：knowledge.db 缺失或版本不符。请先运行 patent-knowledge-install 准备本地 knowledge.db，或配置知识库目录${configureHint}。`
}

/**
 * Truncate an over-long hit snippet so one result cannot consume the context.
 * @param content - the full snippet.
 * @param maxChars - characters kept before the truncation marker.
 * @returns the original text, or its prefix plus a marker naming the full length.
 */
export function truncateSnippet(content: string, maxChars = 800): string {
  if (content.length <= maxChars) return content
  return `${content.slice(0, maxChars)}\n…（截断，共 ${content.length} 字）`
}
