/**
 * 两处双份的口径对账（D-1 裁决，2026-10-31）：修改对照表 × 修改后独权全文、证据清单 ×
 * 引用日志都是**两份都写、不合并**。裁决的落地分散在四处——口径（`conventions.md` §11）、
 * 自查项（`checklist.md`）、两处消费者（模板 SKILL 与随包 SKILL）、载体本身（模板与样例的
 * 四个槽位/表格）。
 *
 * 这四处任何一处被「顺手合并」掉，成品就会少一份视图，而少的那一份不会让渲染失败（
 * 合规检查只报「表里有行、没有全文」，删掉表就什么都报不出来了）。故在此按文件对账：
 * 删一侧、去掉 §11 指针、样例只留一份，都在这里先红。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(import.meta.dirname, '../../../../')
const TEMPLATE_DIR = join(REPO_ROOT, 'packages/patent/patent-document/assets/templates/patent/oa-response')
const CONVENTIONS = join(TEMPLATE_DIR, 'references/conventions.md')
const CHECKLIST = join(TEMPLATE_DIR, 'references/checklist.md')
const TEMPLATE_HTML = join(TEMPLATE_DIR, 'assets/template.html')
const EXAMPLE_HTML = join(TEMPLATE_DIR, 'example.html')
const TEMPLATE_SKILL = join(TEMPLATE_DIR, 'SKILL.md')
const BUNDLE_SKILL = join(REPO_ROOT, 'packages/bundle/web-app/skills/patent/patent-oa-response/SKILL.md')

/**
 * 读取一份参与对账的文件。
 * @param path - 绝对路径。
 * @returns 文件文本。
 */
function text(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('两处双份的口径对账（D-1）', () => {
  it('conventions 有 §11 并把裁决写死：两处都不合并', () => {
    const content = text(CONVENTIONS)
    expect(content).toContain('## 11. 两处双份的边界（D-1 裁决）')
    expect(content).toMatch(/不合并/)
    expect(content).toContain('D-1')
    // 两条结构条目各自指向 §11：删掉指针时，条目与裁决的绑定就断了
    expect(content).toMatch(/二、本次修改[\s\S]{0,80}§11/)
    expect(content).toMatch(/七、证据与引用[\s\S]{0,80}§11/)
  })

  it('§11 写明两份的对应关系由哪三条机械检查兜住', () => {
    const content = text(CONVENTIONS)
    for (const rule of ['amendment-cross-reference', 'evidence-cross-reference', 'empty-table']) {
      expect(content, rule).toContain(rule)
    }
    // 反向不报的理由必须留在口径里：删掉它，§11 就变成「表里有的全文都必须有」，
    // 从属权项被误判成缺全文
    expect(content).toContain('反向不报')
  })

  it('checklist 保留三条双份/空表复核项', () => {
    const content = text(CHECKLIST)
    expect(content).toContain('双份不合并')
    expect(content).toContain('日志里引用的 D 编号都登记在清单')
    expect(content).toContain('三张表都没有空表头')
  })

  it('模板 SKILL 与随包 SKILL 都指向 conventions §11', () => {
    for (const path of [TEMPLATE_SKILL, BUNDLE_SKILL]) {
      expect(text(path), path).toMatch(/conventions\.md[^\n]*§11|§11[^\n]*conventions\.md/)
    }
  })

  it('模板载体四块都在：对照表、独权全文、证据清单、引用日志', () => {
    const content = text(TEMPLATE_HTML)
    // 成对断言：只删其中一块（把两种视图合成一种）就会在此失败
    expect(content).toContain('id="amendment-table"')
    expect(content).toContain('id="amended-claim-1"')
    expect(content).toContain('class="claim-text"')
    expect(content).toContain('id="evidence-table"')
    expect(content).toContain('id="citation-table"')
  })

  it('样例同样给出两份，样例教单份就等于教错', () => {
    const content = text(EXAMPLE_HTML)
    expect(content).toContain('表 1 · 权利要求修改对照')
    expect(content).toContain('class="claim-text"')
    expect(content).toContain('表 2 · 证据与对比文件清单')
    expect(content).toContain('表 3 · 关键断言溯源')
  })
})
