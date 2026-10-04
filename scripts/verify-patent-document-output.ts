/**
 * Keep rendered patent documents inside the mechanical rules that 对外文书 must satisfy:
 * section numbering unique and ascending, and no internal working sections.
 *
 * The `invalidation-opinion` template's `references/conventions.md` and `references/checklist.md`
 * state both rules; this gate gives them an executable entry point, and applies the checks to every
 * template's examples, so a template whose references do not state the rules still has to ship a
 * compliant example. The render pipeline reports the same checks as warnings (the
 * `documentCompliance` module), so a produced artifact and the shipped template examples can be
 * rechecked offline without rendering again.
 *
 * With no arguments it checks every template's `example.html`, which keeps the shipped examples
 * honest. With path arguments it checks those files, which is how a produced document is rechecked.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkDocumentCompliance } from '@deepseek-ai/dsh-patent-document'

const root = resolve(import.meta.dirname, '..')

/** Shipped patent template root, relative to the repository root. */
export const TEMPLATE_ROOT = 'packages/patent/patent-document/assets/templates/patent'

/**
 * Collect each template directory's `example.html`, the default check targets.
 * @param templateRoot - absolute path of the shipped template root.
 * @returns absolute paths of the example documents, ordered by template directory name.
 */
export function collectTemplateExamples(templateRoot: string): string[] {
  if (!existsSync(templateRoot)) return []
  return readdirSync(templateRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => join(templateRoot, entry.name, 'example.html'))
    .filter(file => existsSync(file))
    .sort()
}

/**
 * Check the given documents for compliance problems.
 * @param files - absolute paths of the documents to check.
 * @returns one message per problem; empty when every document passes.
 */
export function documentOutputProblems(files: readonly string[]): string[] {
  const problems: string[] = []
  for (const file of files) {
    if (!existsSync(file)) {
      problems.push(`文件不存在: ${file}`)
      continue
    }
    for (const issue of checkDocumentCompliance(readFileSync(file, 'utf8'))) {
      problems.push(`${file}: [${issue.rule}] ${issue.message}`)
    }
  }
  return problems
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const files = args.length > 0
    ? args.map(arg => resolve(arg))
    : collectTemplateExamples(resolve(root, TEMPLATE_ROOT))
  const problems = documentOutputProblems(files)
  if (problems.length > 0) {
    console.error('verify-patent-document-output failed:\n')
    for (const problem of problems) console.error(`  ${problem}`)
    console.error('\n章节标题随节内容一起给出：传给的节会替换骨架的整个内层（含章节标题本身）。内部工作记录写入案卷内部文件。')
    process.exit(1)
  }
  console.log(`verify-patent-document-output: ${files.length} 份文书通过章节编号与内部章节检查。`)
}
