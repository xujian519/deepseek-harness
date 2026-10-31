/**
 * 篇幅纪律口径对账（P1-04）：`oa-response` 模板的 `references/conventions.md` §10 是唯一
 * 口径源，数字取自 `OA_RESPONSE_DRAFT_BUDGET`；`checklist.md` P0 的三条篇幅自查、两个
 * `SKILL.md` 与 preset 输出纪律都指向它。
 *
 * 为什么对账放在本包：预算常量住在这里，文档只是它的投影。任一侧单改都在此失败，而不是
 * 等模型照着过时数字写完、渲染时再被槽位硬上限拒绝——那时用户已经拿到半成品。
 *
 * 硬上限按文档写明的规则从预算推得（预算 × 1.25 向上取整），不复制配额表的字面值：
 * 配额表的数值一致性由 `patent-document` 自己的 `template-draft-limits.spec.ts` 覆盖。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OA_RESPONSE_DRAFT_BUDGET } from '../src/workflow.ts'

const REPO_ROOT = join(import.meta.dirname, '../../../..')
const TEMPLATE_ROOT = join(REPO_ROOT, 'packages/patent/patent-document/assets/templates/patent/oa-response')
const CONVENTIONS = join(TEMPLATE_ROOT, 'references/conventions.md')
const CHECKLIST = join(TEMPLATE_ROOT, 'references/checklist.md')
const TEMPLATE_SKILL = join(TEMPLATE_ROOT, 'SKILL.md')
const BUNDLE_SKILL = join(REPO_ROOT, 'packages/bundle/web-app/skills/patent/patent-oa-response/SKILL.md')
const PRESET = join(REPO_ROOT, 'packages/bundle/web-app/presets/patent.patch.yml')

/** 读取一份参与对账的文件。 */
function text(path: string): string {
  return readFileSync(path, 'utf8')
}

/** 取某一节正文：从给定标题到下一个二级标题为止；标题缺失时让用例失败。 */
function section(source: string, heading: string): string {
  const start = source.indexOf(heading)
  expect(start, `缺少小节：${heading}`).toBeGreaterThanOrEqual(0)
  const rest = source.slice(start + heading.length)
  const end = rest.search(/\n## /u)
  return end < 0 ? rest : rest.slice(0, end)
}

/** 配额表的口径：预算 × 1.25 向上取整。 */
function cap(value: number): string {
  return String(Math.ceil(value * 1.25))
}

describe('oa-response 篇幅预算：文档与常量对账', () => {
  it('conventions §10 写全了 OA_RESPONSE_DRAFT_BUDGET 的每一个数字', () => {
    const budget = section(text(CONVENTIONS), '## 10. 篇幅预算与删减纪律')
    for (const [field, value] of Object.entries(OA_RESPONSE_DRAFT_BUDGET)) {
      expect(budget, `§10 缺少 ${field}（${String(value)}）`).toContain(String(value))
    }
  })

  it('§10 的硬上限按预算 × 1.25 推导', () => {
    const budget = section(text(CONVENTIONS), '## 10. 篇幅预算与删减纪律')
    expect(budget).toContain(cap(OA_RESPONSE_DRAFT_BUDGET.argumentNovelty))
    expect(budget).toContain(cap(OA_RESPONSE_DRAFT_BUDGET.argumentInventiveness))
    // 事实小节没有独立的预算字段：文档按「5 项 × 2 句 × 约 80 字」记 800 字，配额的 1000 字由它推出。
    expect(budget).toContain(cap(OA_RESPONSE_DRAFT_BUDGET.factItems * OA_RESPONSE_DRAFT_BUDGET.factSentences * 80))
    // 条目上限同样由 ×1.25 推出：5 项 → 7 项。
    expect(budget).toContain(`${String(Math.ceil(OA_RESPONSE_DRAFT_BUDGET.factItems * 1.25))} 项`)
  })

  it('§3 写入了「未提出的争点不设节」', () => {
    expect(section(text(CONVENTIONS), '## 3. 组织单元是争点，不是审查意见编号')).toContain('未提出的争点不设节')
  })

  it('checklist P0 的三条篇幅自查都在，且各自回指 §10', () => {
    const p0 = section(text(CHECKLIST), '## P0 — 必须通过')
    for (const phrase of ['无空节', '模板指导语', '篇幅预算']) {
      expect(p0, `P0 缺少「${phrase}」一条`).toContain(phrase)
    }
    expect(p0).toContain('§10')
  })

  it('两个 SKILL 与 preset 输出纪律都指向 §10 与全篇预算', () => {
    for (const path of [TEMPLATE_SKILL, BUNDLE_SKILL, PRESET]) {
      const content = text(path)
      expect(content, path).toContain('§10')
      expect(content, path).toContain(String(OA_RESPONSE_DRAFT_BUDGET.total))
    }
  })
})
