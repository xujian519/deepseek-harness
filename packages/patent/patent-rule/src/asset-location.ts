/**
 * 宪法规则引擎 — 规则资产目录定位（dsh 适配）。
 *
 * 与 Sati 的 asset-location.js 不同，本实现放弃 SATI_RULES_DIR 环境变量与
 * cwd/仓库根向上 walk 语义：规则资产随包分发（assets/rules/），以
 * `new URL('../assets/rules/', import.meta.url)` 相对本模块解析，源（src/）
 * 与构建产物（lib/index.js）运行均命中同一目录；可选的 `rulesDir` 覆盖项
 * 取代包内基础资产目录（布局镜像 assets/rules/：patent/、base/、domains/）。
 *
 * 分层规则包语义（base + domains + overrides 经清单装配）保持不变；默认
 * （无清单）仅加载打包的 base 包。
 * @module @deepseek-ai/dsh-patent-rule/asset-location
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 打包规则资产根（assets/rules/）。 */
const ASSETS_RULES_URL = new URL('../assets/rules/', import.meta.url)

/**
 * 规则资产根目录：显式 rulesDir 覆盖时用其（相对 cwd 解析），否则用打包资产。
 * @param rulesDir - 可选的规则根目录覆盖（布局镜像 assets/rules/）。
 * @returns 规则根目录绝对路径。
 */
export function assetRulesRoot(rulesDir?: string): string {
  return rulesDir !== undefined && rulesDir.trim() !== '' ? resolve(rulesDir) : fileURLToPath(ASSETS_RULES_URL)
}

/**
 * 平铺专利规则资产目录（compliance.yaml / synonyms.yaml / evidence-rules.yaml 等所在目录）。
 * @param rulesDir - 可选的规则根目录覆盖。
 * @returns 专利规则资产目录绝对路径。
 */
export function patentAssetDir(rulesDir?: string): string {
  return join(assetRulesRoot(rulesDir), 'patent')
}

/**
 * 平铺规则资产候选目录（最具体到最通用；当前仅打包/覆盖的 patent 目录）。
 * @param rulesDir - 可选的规则根目录覆盖。
 * @returns 候选目录路径列表。
 */
export function candidateRuleDirs(rulesDir?: string): string[] {
  return [patentAssetDir(rulesDir)]
}

/**
 * 内置规则包候选目录：<root>/<name> 与 <root>/domains/<name>。
 * @param name - 规则包名。
 * @param rulesDir - 可选的规则根目录覆盖。
 * @returns 候选包目录路径列表。
 */
export function candidatePackDirs(name: string, rulesDir?: string): string[] {
  const root = assetRulesRoot(rulesDir)
  return [join(root, name), join(root, 'domains', name)]
}

/**
 * 在候选规则目录中定位指定资产文件；未找到返回 null。
 * @param fileName - 要定位的资产文件名。
 * @param rulesDir - 可选的规则根目录覆盖。
 * @returns 命中的资产文件绝对路径，未找到为 null。
 */
export function resolveRuleAsset(fileName: string, rulesDir?: string): string | null {
  for (const dir of candidateRuleDirs(rulesDir)) {
    const path = join(dir, fileName)
    if (existsSync(path)) return path
  }
  return null
}
