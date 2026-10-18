import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assetRulesRoot, loadRuleSetDir, patentAssetDir } from '@deepseek-ai/dsh-patent-rule'

/**
 * 《专利审查指南》引用的节号校验。
 *
 * 指南按「部分—章—节」编号，节号只由非零数字段组成，「2.0」不是节号：这类引用指向的
 * 不是任何一节，在指南索引里也落成「未收录」，规则声称的依据因而是错的。节号按
 * 2023 年修订版核对。
 */

/** 指南引用里带零段的节号，如「审查指南第二部分第九章2.0」。 */
const ZERO_SECTION = /审查指南[^\n]*?[0-9]\.0/g

/**
 * 规则资产根下每个 YAML 的相对路径与正文。
 * @returns 按相对路径排序的资产文件列表。
 */
function assetTexts(): Array<{ file: string; text: string }> {
  const root = assetRulesRoot()
  const paths: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.name.endsWith('.yaml') || entry.name.endsWith('.yml')) paths.push(path)
    }
  }
  walk(root)
  return paths.sort().map(path => ({ file: relative(root, path), text: readFileSync(path, 'utf8') }))
}

/**
 * 平铺专利规则资产里每条规则的 legalBasis。
 * @returns 规则 id 到 legalBasis 的映射，未声明 legalBasis 的规则不在其中。
 */
function flatRuleBasis(): Map<string, string> {
  const byId = new Map<string, string>()
  for (const ruleSet of loadRuleSetDir(patentAssetDir()).ruleSets) {
    for (const rule of ruleSet.rules) {
      if (rule.legalBasis !== undefined) byId.set(rule.id, rule.legalBasis)
    }
  }
  return byId
}

/**
 * 去掉空白，便于把资产里「审查指南第一部分第一章 4.3」这类带空格的写法按节号比较。
 * @param text - 待处理文本。
 * @returns 去掉全部空白字符的文本。
 */
function withoutSpacing(text: string): string {
  return text.replaceAll(/\s+/g, '')
}

describe('guideline citations', () => {
  it('never numbers a guideline section with a zero segment', () => {
    const offenders = assetTexts().flatMap(({ file, text }) =>
      [...text.matchAll(ZERO_SECTION)].map(match => `${file}: ${match[0].trim()}`),
    )
    expect(offenders).toEqual([])
  })

  it('cites the section the 2023 revision holds each subject in', () => {
    const basis = flatRuleBasis()
    const cited = [
      // 智力活动的规则和方法在第二部分第一章第 4 节，不在第 3 节（第 3 节是专利法第五条）。
      ['EX-SEL-001', '审查指南第二部分第一章4.2'],
      // 疾病的诊断和治疗方法是 4.3；4.1 是科学发现。
      ['EX-SEL-002', '审查指南第二部分第一章4.3'],
      // 第二部分第九章第 2 节登记审查基准，该章不写「2.0」。
      ['EX-SEL-003', '审查指南第二部分第九章2'],
      ['EX-CMP-001', '审查指南第二部分第九章2'],
      // 说明书与权利要求书的撰写要求在该章第 5 节，5.1 / 5.2 分别是两者。
      ['EX-CMP-002', '审查指南第二部分第九章5.1'],
      ['EX-CMP-003', '审查指南第二部分第九章5.2'],
      // 术语前后一致在 2.2.7「说明书用词规范」；2.1.1 是说明书应当清楚。
      ['PR-SPEC-005', '审查指南第二部分第二章2.2.7'],
      // 附图绘制要求在 4.3；第一部分第一章第 2 节「审查原则」没有子节。
      ['H-FIG-001', '审查指南第一部分第一章4.3'],
      // 复审请求的审查依据在第四部分第二章第 4.1 节（理由和证据的审查）；第二部分
      // 第八章第 4.1 节是实质审查的「审查的文本」，与复审请求无关。
      ['P-PRC-004', '审查指南第四部分第二章4.1'],
      // 新颖性审查基准按 3.2.1 相同内容、3.2.2 上位/下位概念、3.2.4 数值和数值范围、
      // 3.2.5 含性能参数的产品权利要求排列；第 5 节是宽限期，不是审查基准。
      ['EX-NOV-003', '审查指南第二部分第三章3.2.2'],
      ['EX-NOV-004', '审查指南第二部分第三章3.2.4'],
      ['EX-NOV-005', '审查指南第二部分第三章3.2.5'],
      // 权利要求书应当满足的要求中，3.2.1 是以说明书为依据、3.2.2 是清楚。
      ['EX-CLM-001', '审查指南第二部分第二章3.2.2'],
      // 避免「事后诸葛亮」在第二部分第四章第 6.2 节，第 5.4 节是商业上获得成功。
      ['EX-INV-007', '审查指南第二部分第四章6.2'],
      // 答复审查意见是第 5 节「答复和修改」下的 5.1「答复」，5.1 本身就是「应当在通知
      // 书指定的期限内作出答复」加答复内容的撰写要求；第 4 节是审查员侧的「实质审查」。
      ['EX-PRC-003', '审查指南第二部分第八章5.1'],
      // 方法权利要求「通常应当用工艺过程、操作条件、步骤或者流程等技术特征来描述」在
      // 3.2.2「清楚」；3.2.1 是「以说明书为依据」，讲的是概括是否得到支持。
      ['PR-CLM-003', '审查指南第二部分第二章3.2.2'],
      // 分案申请的条件在实施细则第 48 条；第二部分第六章的章名即「单一性和分案申请」，
      // 分案申请的核实与期限也在该章目录内（不是第一部分第一章的初步审查节）。
      ['EX-PRC-002', '审查指南第二部分第六章'],
    ] as const
    for (const [id, section] of cited) {
      expect(withoutSpacing(basis.get(id) ?? ''), `${id} 未声明 legalBasis`).toContain(section)
    }
  })
})
