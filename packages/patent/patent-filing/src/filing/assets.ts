/**
 * 随包资产的定位：模板（体例真相源）、spec（结构与断言）、引擎脚本目录。
 *
 * 三个资产都随包分发在包根 `assets/` 下；本模块在源码（`src/filing/`）与打包产物
 * （`lib/index.js`）两种执行位置下用 `import.meta.url` 探测两个相对深度，返回持有
 * `template/TEMPLATE-IDENTITY.md` 的那个目录。
 * @module @deepseek-ai/dsh-patent-filing/filing/assets
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PatentFilingError } from '../types.ts'

/** 随包模板文件名。 */
export const TEMPLATE_FILENAME = '申请文件模板.docx'

/** 随包 spec 文件名。 */
export const SPEC_FILENAME = '申请文件.json'

/**
 * 在候选目录中挑出资产根目录：第一个持有 `template/TEMPLATE-IDENTITY.md` 的目录。
 * @param candidates - 候选资产根目录，按优先顺序。
 * @returns 命中的绝对目录路径。
 */
export function resolveAssetRoot(candidates: readonly string[]): string {
  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'template', 'TEMPLATE-IDENTITY.md'))) return candidate
  }
  throw new PatentFilingError(
    `未找到随包资产目录（期待 template/TEMPLATE-IDENTITY.md），已探测：${candidates.join('、') || '无候选'}`,
  )
}

/**
 * 定位资产根目录（随包分发的 `assets/`）。
 * @returns 持有 `template/TEMPLATE-IDENTITY.md` 的绝对目录路径。
 */
export function getAssetRoot(): string {
  // 源码执行位置（src/filing/）与打包执行位置（lib/index.js）到包根的深度不同，逐一探测。
  return resolveAssetRoot([
    fileURLToPath(new URL('../../assets', import.meta.url)),
    fileURLToPath(new URL('../assets', import.meta.url)),
  ])
}

/**
 * 引擎脚本目录（`build.py` / `verify.py` / `render_figures.py`）。
 * @returns 引擎脚本所在绝对目录。
 */
export function getEngineDir(): string {
  return join(getAssetRoot(), 'engine')
}

/**
 * 随包 spec 路径。
 * @returns `assets/spec/申请文件.json` 的绝对路径。
 */
export function defaultSpecPath(): string {
  return join(getAssetRoot(), 'spec', SPEC_FILENAME)
}

/**
 * 随包模板路径（体例真相源）。
 * @returns `assets/template/申请文件模板.docx` 的绝对路径。
 */
export function defaultTemplatePath(): string {
  return join(getAssetRoot(), 'template', TEMPLATE_FILENAME)
}
