/**
 * 100012/100014 载体口径对账（2026-10-16 审阅乙4）：`conventions.md` §8 是唯一口径源，
 * 其余三处引用它。四文件必须同时出现两个表号；三处消费方必须携带 §8 指针——
 * 单侧改动（改表号、删指针）在此失败，而不是等到出件时才发现口径漂移。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(import.meta.dirname, '../../../../')
const CONVENTIONS = join(
  REPO_ROOT,
  'packages/patent/patent-document/assets/templates/patent/oa-response/references/conventions.md',
)
const CHECKLIST = join(
  REPO_ROOT,
  'packages/patent/patent-document/assets/templates/patent/oa-response/references/checklist.md',
)
const TEMPLATE_SKILL = join(
  REPO_ROOT,
  'packages/patent/patent-document/assets/templates/patent/oa-response/SKILL.md',
)
const BUNDLE_SKILL = join(REPO_ROOT, 'packages/bundle/web-app/skills/patent/patent-oa-response/SKILL.md')

/** 读取一份参与对账的文件。 */
function text(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('100012/100014 载体口径对账（乙4）', () => {
  it('四文件同时出现 100012 与 100014', () => {
    for (const path of [CONVENTIONS, CHECKLIST, TEMPLATE_SKILL, BUNDLE_SKILL]) {
      const content = text(path)
      expect(content, path).toContain('100012')
      expect(content, path).toContain('100014')
    }
  })

  it('三处消费方都携带 conventions §8 指针（单一口径源）', () => {
    for (const path of [CHECKLIST, TEMPLATE_SKILL, BUNDLE_SKILL]) {
      expect(text(path), path).toMatch(/conventions\.md[^\n]*§8|§8[^\n]*conventions\.md/)
    }
  })
})
