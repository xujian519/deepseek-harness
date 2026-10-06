/**
 * IPC 审查标准卡片的回源核对门禁。
 *
 * 判定两件事:
 *   1. 每张卡片的 source 路径形如 `宝宸知识库/Wiki/复审无效/…`,可定位到源文件;
 *   2. 该卡片对应的源文件(主页面或任一拆分子页)仍带有可提取的实质内容。
 *
 * 第 2 条针对一次真实故障:21 张卡片的源主页面曾被拆分到子页而自身正文近乎
 * 清空,提取只读主页面,产出 keyPoints 与 tips 皆空的空壳。空壳在
 * <memory-context> 中只剩裸标题行,既占预算又让模型误读为该 IPC 部已提供审查
 * 标准。源库在本地演进,本门禁在回源核对时把该形态挡下。
 *
 * 源库根由 `DSH_IPC_STANDARDS_SOURCE_ROOT` 指定。未指定或目录不存在时只判定
 * 第 1 条,并如实报告「源库不可用」而不是静默通过;显式指定却指向无效路径时
 * 失败——那属于配置错误。
 *
 * 用法:
 *   tsx scripts/verify-ipc-standards-source.ts
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import yaml from 'js-yaml'

const ASSET_PATH = 'packages/patent/patent-core/assets/ipc-standards.yaml'

/** source 字段必须落在此前缀下;漏掉 Wiki/ 这一层时按注释字面定位会 404。 */
const SOURCE_PREFIX = '宝宸知识库/Wiki/'

/** 拆分子页的命名片段,与源库的组织方式一致。 */
const SPLIT_MARKER = '-拆分-'

/** 卡片在资产中的最小字段集:回源核对只需要 id 与 source。 */
export type IpcStandardsCard = {
  id: string
  source: string
}

/** 一张卡片在回源核对中判定出的问题。 */
export type SourceProblem = {
  cardId: string
  kind: 'malformed-source' | 'missing-source' | 'empty-payload'
  detail: string
}

/**
 * 源文件是否仍可提取出实质内容。
 *
 * 判定依据是源库实际使用的两种载荷形态:决定要点的三级标题,以及核算装置等
 * 文件在要点下给出的解读段。只有核心标准段而无要点的主页面,提取不出任何
 * keyPoints 或 tips。
 *
 * @param text - 源文件正文。
 * @returns 存在可提取载荷时为 true。
 */
export function hasExtractablePayload(text: string): boolean {
  return /^###\s+\S/mu.test(text) || /^\*\*解读\*\*/mu.test(text)
}

/**
 * 对全部卡片做回源核对。
 *
 * @param cards - 资产中的卡片列表。
 * @param readVariants - 给定 source 相对路径,返回该卡片全部候选文件(主页面与
 *   拆分子页)的正文;文件不存在时不出现在结果中。
 * @returns 问题列表,空数组表示核对通过。
 */
export function verifyCardSources(
  cards: readonly IpcStandardsCard[],
  readVariants: (source: string) => readonly string[],
): SourceProblem[] {
  const problems: SourceProblem[] = []
  for (const card of cards) {
    if (!card.source.startsWith(SOURCE_PREFIX)) {
      problems.push({
        cardId: card.id,
        kind: 'malformed-source',
        detail: `source 未以 ${SOURCE_PREFIX} 开头: ${card.source || '(空)'}`,
      })
      continue
    }
    const variants = readVariants(card.source)
    if (variants.length === 0) {
      problems.push({
        cardId: card.id,
        kind: 'missing-source',
        detail: `主页面与拆分子页均不存在: ${card.source}`,
      })
      continue
    }
    if (!variants.some(hasExtractablePayload)) {
      problems.push({
        cardId: card.id,
        kind: 'empty-payload',
        detail: `${variants.length} 个源文件均无可提取的要点或解读段: ${card.source}`,
      })
    }
  }
  return problems
}

/** 读取资产中的卡片 id 与 source。 */
function loadCards(assetPath: string): IpcStandardsCard[] {
  const root = yaml.load(readFileSync(assetPath, 'utf8')) as { standards?: unknown[] } | null
  return (root?.standards ?? []).map((raw, i) => {
    const card = (raw ?? {}) as Record<string, unknown>
    return {
      id: typeof card.id === 'string' ? card.id : `standards-${i}`,
      source: typeof card.source === 'string' ? card.source : '',
    }
  })
}

/**
 * 构造读取函数:主页面与同前缀的拆分子页都算该卡片的候选载荷。
 *
 * @param sourceRoot - 源库根目录;source 是相对该根的路径。
 * @returns 返回候选文件正文的读取函数。
 */
function makeVariantReader(sourceRoot: string): (source: string) => readonly string[] {
  return (source: string) => {
    const mainPath = resolve(sourceRoot, source)
    if (!existsSync(mainPath)) return []
    const dir = dirname(mainPath)
    const stem = basename(mainPath, '.md')
    const splitPaths = existsSync(dir)
      ? readdirSync(dir)
        .filter(name => name.startsWith(`${stem}${SPLIT_MARKER}`) && name.endsWith('.md'))
        .map(name => join(dir, name))
      : []
    return [mainPath, ...splitPaths]
      .filter(path => existsSync(path))
      .map(path => readFileSync(path, 'utf8'))
  }
}

function main(): number {
  const repoRoot = resolve(import.meta.dirname, '..')
  const cards = loadCards(resolve(repoRoot, ASSET_PATH))

  const configuredRoot = process.env.DSH_IPC_STANDARDS_SOURCE_ROOT
  // source 形如 `宝宸知识库/Wiki/复审无效/…`，首段是源库目录名而非 sourceRoot 之下
  // 的子目录，故默认根取本仓同级目录。
  const sourceRoot = configuredRoot === undefined || configuredRoot === ''
    ? resolve(repoRoot, '..')
    : resolve(configuredRoot)

  if (!existsSync(sourceRoot)) {
    if (configuredRoot !== undefined && configuredRoot !== '') {
      console.error(
        `verify-ipc-standards-source: DSH_IPC_STANDARDS_SOURCE_ROOT 指向的目录不存在: ${sourceRoot}`,
      )
      return 1
    }
    // 未配置源库时只判定路径格式,并说明载荷核对未执行。
    const formatOnly = verifyCardSources(cards, () => ['占位'])
    const malformed = formatOnly.filter(p => p.kind === 'malformed-source')
    if (malformed.length > 0) {
      for (const p of malformed) console.error(`  ${p.cardId}: ${p.detail}`)
      return 1
    }
    console.log(
      'verify-ipc-standards-source: 源库不可用(未设置 DSH_IPC_STANDARDS_SOURCE_ROOT,'
      + `默认位置 ${sourceRoot} 亦不存在),仅校验 ${cards.length} 张卡片的 source 路径格式;`
      + '载荷核对未执行。',
    )
    return 0
  }

  const problems = verifyCardSources(cards, makeVariantReader(sourceRoot))
  for (const p of problems) console.error(`  ${p.cardId} [${p.kind}]: ${p.detail}`)
  if (problems.length > 0) {
    console.error(
      `verify-ipc-standards-source: ${problems.length}/${cards.length} 张卡片回源核对未通过`,
    )
    return 1
  }
  console.log(
    `verify-ipc-standards-source: ${cards.length} 张卡片回源核对通过(源库 ${sourceRoot})`,
  )
  return 0
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) {
  process.exitCode = main()
}
