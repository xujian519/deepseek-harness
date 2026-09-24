/**
 * Loading of the style assets, rewritten from `style_embed.go` of the Go project
 * Mady. Directories are layered: a later directory replaces an earlier style of
 * the same name, which is how a deployment overrides a shipped style without
 * recompiling.
 *
 * Two upstream behaviors are deliberately changed, both toward failing loud: a
 * listed directory that does not exist is an error rather than a silent skip,
 * and a malformed asset aborts the load rather than being dropped while the rest
 * load. A typo in a configured directory or a broken override must not leave the
 * deployment on the shipped defaults unnoticed.
 * @module @deepseek-ai/dsh-doc-style/load
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { stylesDirectory } from './asset-location.ts'
import { parseStyleAsset } from './parse.ts'
import { DocumentStyleError, STYLE_FILE_SUFFIX, type DocumentStyle } from './types.ts'

/**
 * Style directories a deployment loads: the packaged root, then every configured
 * override in ascending precedence.
 *
 * Configured entries resolve against the process working directory here rather
 * than at each read, so a relative override and the directory named by a load
 * failure are the same absolute path — a plugin that passed them through
 * unresolved reported the same misconfiguration two different ways.
 * @param configured - deployment-configured style directories.
 * @returns the directory list for {@link loadStyles}.
 */
export function styleDirectories(configured: readonly string[] = []): readonly string[] {
  return [stylesDirectory(), ...configured.map(directory => resolve(directory))]
}

/**
 * Read one style asset from a file.
 * @param path - absolute path of the asset.
 * @returns the parsed style.
 * @throws DocumentStyleError when the file cannot be read or is invalid.
 */
export function loadStyleFile(path: string): DocumentStyle {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new DocumentStyleError(`样式资产 ${path} 无法读取：${String(error)}`)
  }
  return parseStyleAsset(text, path)
}

/**
 * Load and layer the style assets of the given directories.
 * @param directories - style directories in ascending precedence; each must exist.
 * @returns the styles, each name appearing once, in first-load order.
 * @throws DocumentStyleError when a directory is missing, an asset is invalid, or no style loaded.
 */
export function loadStyles(directories: readonly string[]): readonly DocumentStyle[] {
  if (directories.length === 0) throw new DocumentStyleError('未提供样式目录：无法加载任何样式资产。')
  const styles: DocumentStyle[] = []
  const indexByName = new Map<string, number>()
  for (const directory of directories) {
    requireDirectory(directory)
    for (const fileName of styleFileNames(directory)) {
      const style = loadStyleFile(join(directory, fileName))
      const existing = indexByName.get(style.name)
      if (existing === undefined) {
        indexByName.set(style.name, styles.length)
        styles.push(style)
      } else {
        styles[existing] = style
      }
    }
  }
  if (styles.length === 0) {
    throw new DocumentStyleError(`样式目录 ${directories.join('、')} 中没有 ${STYLE_FILE_SUFFIX} 样式资产。`)
  }
  return styles
}

/**
 * Assert that a listed style directory exists.
 * @param directory - the directory to check.
 * @throws DocumentStyleError when the path does not exist or is not a directory.
 */
function requireDirectory(directory: string): void {
  let isDirectory: boolean
  try {
    isDirectory = statSync(directory).isDirectory()
  } catch (error) {
    throw new DocumentStyleError(`样式目录 ${directory} 不可用：${String(error)}`)
  }
  if (!isDirectory) throw new DocumentStyleError(`样式目录 ${directory} 不是目录。`)
}

/**
 * List the style asset file names of one directory.
 * @param directory - an existing style directory.
 * @returns the file names ending in the style suffix, in code-unit order.
 */
function styleFileNames(directory: string): readonly string[] {
  return readdirSync(directory).filter(fileName => fileName.endsWith(STYLE_FILE_SUFFIX)).sort()
}
