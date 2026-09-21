/**
 * Loading of the template assets from directories, rewritten from
 * `LoadDocTemplates` in `domains/doctmpl/loader.go` of the Go project Mady.
 *
 * One directory is one asset root: a duplicate template name inside it is a
 * defect and fails the load, while a name repeated across directories is the
 * documented override path, which the store applies.
 * @module @deepseek-ai/dsh-doc-template/loader
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseTemplate } from './frontmatter.ts'
import { DocTemplateError, type DocTemplate } from './types.ts'

/** Suffix of the template assets this package loads. */
export const TEMPLATE_FILE_SUFFIX = '.md'

/**
 * Read one template asset from a file.
 * @param path - absolute path of the asset.
 * @returns the parsed template.
 * @throws DocTemplateError when the file cannot be read or violates the template contract.
 */
export function loadTemplateFile(path: string): DocTemplate {
  let source: string
  try {
    source = readFileSync(path, 'utf8')
  } catch (error) {
    throw new DocTemplateError('asset-invalid', `模板资产 ${path} 无法读取：${String(error)}`)
  }
  return parseTemplate(source, path)
}

/**
 * Load every template asset below one directory, recursively. Templates whose
 * bodies are read in code-unit order of their relative path, so a directory
 * loads deterministically.
 * @param directory - the asset root; it must exist.
 * @returns the templates in path order.
 * @throws DocTemplateError when the directory is unavailable, an asset is invalid, or a name repeats.
 */
export function loadTemplateDirectory(directory: string): readonly DocTemplate[] {
  requireDirectory(directory)
  const templates: DocTemplate[] = []
  const seen = new Set<string>()
  for (const relativePath of templateFileNames(directory)) {
    const template = loadTemplateFile(join(directory, relativePath))
    if (seen.has(template.name)) {
      throw new DocTemplateError(
        'duplicate-template',
        `模板资产 ${relative(directory, template.filePath)} 与同目录下更早的资产同名 ${JSON.stringify(template.name)}。`,
      )
    }
    seen.add(template.name)
    templates.push(template)
  }
  return templates
}

/**
 * Assert that an asset root exists.
 * @param directory - the directory to check.
 * @throws DocTemplateError when the path does not exist or is not a directory.
 */
function requireDirectory(directory: string): void {
  let isDirectory: boolean
  try {
    isDirectory = statSync(directory).isDirectory()
  } catch (error) {
    throw new DocTemplateError('asset-invalid', `模板目录 ${directory} 不可用：${String(error)}`)
  }
  if (!isDirectory) throw new DocTemplateError('asset-invalid', `模板目录 ${directory} 不是目录。`)
}

/**
 * List the template asset paths of one directory, relative to it.
 * @param directory - an existing asset root.
 * @returns the relative paths of the `.md` assets, in code-unit order.
 */
function templateFileNames(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true, recursive: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(TEMPLATE_FILE_SUFFIX))
    .map(entry => relative(directory, join(entry.parentPath, entry.name)))
    .sort()
}
