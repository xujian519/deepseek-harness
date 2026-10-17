/**
 * 101001/100902/100014 载体口径对账：`invalidation-opinion` 的 `conventions.md` §7 是请求人侧
 * 的唯一口径源，`invalidation-defense` 的 `conventions.md` §10 是被请求人侧的唯一口径源，
 * 各自的消费方引用它。两侧的四个文件都必须同时出现依据表号与附页表号（请求书侧 101001／
 * 100902 与 100014，答辩侧 100902 与 100014）；每侧的三个消费方必须携带本侧口径源的指针——
 * 单侧改动（改表号、删指针）在此失败，而不是等到出件时才发现口径漂移。
 *
 * 附件清单的份数/页数映射也在此对账：官方表格要求附件栏写明名称、份数、页数、原件或复印件，
 * 而本件的证据清单只登记标识、名称与日期，两者的落差靠「出件时逐条填写」这一句承载。口径由
 * `CARRIER_LISTS` 一处声明，两侧的口径源与消费方都必须落在它上面；份数规则（一式两份）另由
 * 指南第四部分第三章4.4.1 决定，答辩侧口径源必须写明。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = join(import.meta.dirname, '../../../../')
const TEMPLATE_ROOT = join(REPO_ROOT, 'packages/patent/patent-document/assets/templates/patent')
const CONVENTIONS = join(TEMPLATE_ROOT, 'invalidation-opinion/references/conventions.md')
const CHECKLIST = join(TEMPLATE_ROOT, 'invalidation-opinion/references/checklist.md')
const TEMPLATE_SKILL = join(TEMPLATE_ROOT, 'invalidation-opinion/SKILL.md')
const BUNDLE_SKILL = join(REPO_ROOT, 'packages/bundle/web-app/skills/patent/patent-invalidity/SKILL.md')

const DEFENSE_CONVENTIONS = join(TEMPLATE_ROOT, 'invalidation-defense/references/conventions.md')
const DEFENSE_CHECKLIST = join(TEMPLATE_ROOT, 'invalidation-defense/references/checklist.md')
const DEFENSE_TEMPLATE_SKILL = join(TEMPLATE_ROOT, 'invalidation-defense/SKILL.md')
const DEFENSE_BUNDLE_SKILL = join(
  REPO_ROOT,
  'packages/bundle/web-app/skills/patent/patent-invalidation-defense/SKILL.md',
)

/** 读取一份参与对账的文件。 */
function text(path: string): string {
  return readFileSync(path, 'utf8')
}

/**
 * 一侧的附件清单口径。
 *
 * `listed` 是出件时附件栏必须逐条写明的字段（官方表格注意事项：附具证明文件的名称、份数、
 * 页数、原件或复印件）；`deferred` 是本件证据清单不登记、留到出件填写的字段；`pointer` 是
 * 本侧口径源在消费方里的指针形态。
 */
type CarrierSide = {
  /** 侧名，用于失败信息。 */
  side: string
  /** 口径源文件。 */
  source: string
  /** 本侧的三个消费方。 */
  consumers: readonly string[]
  /** 出件附件栏必须逐条写明的字段。 */
  listed: readonly string[]
  /** 本件证据清单登记、出件时不需要补填的字段。 */
  registered: readonly string[]
  /** 本件证据清单不登记、出件时逐条补填的字段。 */
  deferred: readonly string[]
  /** 消费方引用的口径源小节号。 */
  section: string
}

/** 两侧的附件清单口径，一处声明。 */
const CARRIER_SIDES: readonly CarrierSide[] = [
  {
    side: '请求人侧（101001 ⑨栏）',
    source: CONVENTIONS,
    consumers: [CHECKLIST, TEMPLATE_SKILL, BUNDLE_SKILL],
    listed: ['名称', '份数', '页数', '原件或复印件'],
    registered: ['标识', '名称', '日期'],
    deferred: ['份数', '页数', '原件或复印件'],
    section: '§7',
  },
  {
    side: '被请求人侧（100902 ⑦栏）',
    source: DEFENSE_CONVENTIONS,
    consumers: [DEFENSE_CHECKLIST, DEFENSE_TEMPLATE_SKILL, DEFENSE_BUNDLE_SKILL],
    listed: ['名称', '份数', '页数', '原件或复印件'],
    registered: ['标识', '名称', '日期'],
    deferred: ['份数', '页数', '原件或复印件'],
    section: '§10',
  },
]

describe('101001/100902/100014 载体口径对账', () => {
  it('四文件同时出现 101001 与 100014', () => {
    for (const path of [CONVENTIONS, CHECKLIST, TEMPLATE_SKILL, BUNDLE_SKILL]) {
      const content = text(path)
      expect(content, path).toContain('101001')
      expect(content, path).toContain('100014')
    }
  })

  it('口径源给出补充意见与答复转送的载体表号', () => {
    expect(text(CONVENTIONS)).toContain('100902')
  })

  it('三处消费方都携带 conventions §7 指针（单一口径源）', () => {
    for (const path of [CHECKLIST, TEMPLATE_SKILL, BUNDLE_SKILL]) {
      expect(text(path), path).toMatch(/conventions\.md[^\n]*§7|§7[^\n]*conventions\.md/)
    }
  })
})

describe('100902/100014 答辩载体口径对账', () => {
  it('四文件同时出现意见陈述书表号与附页表号', () => {
    for (const path of [DEFENSE_CONVENTIONS, DEFENSE_CHECKLIST, DEFENSE_TEMPLATE_SKILL, DEFENSE_BUNDLE_SKILL]) {
      const content = text(path)
      expect(content, path).toContain('100902')
      expect(content, path).toContain('100014')
    }
  })

  it('三处消费方都携带 conventions §10 指针（单一口径源）', () => {
    for (const path of [DEFENSE_CHECKLIST, DEFENSE_TEMPLATE_SKILL, DEFENSE_BUNDLE_SKILL]) {
      expect(text(path), path).toMatch(/conventions\.md[^\n]*§10|§10[^\n]*conventions\.md/)
    }
  })
})

describe('附件清单的份数/页数映射', () => {
  it('两侧口径源都写明出件附件栏的四个字段', () => {
    for (const { side, source, listed } of CARRIER_SIDES) {
      const content = text(source)
      for (const field of listed) expect(content, `${side}: ${field}`).toContain(field)
      // 四个字段必须在同一处并列写明：分散在几行里读起来仍像「说到过」，
      // 而出件时逐个槽位照着抄的人只会看那一行。
      const together = content.split('\n').filter(line => listed.every(field => line.includes(field)))
      expect(together.length, `${side} 未在同一行并列写明：${listed.join('、')}`).toBeGreaterThan(0)
    }
  })

  it('两侧口径源都写明本件登记什么、出件补填什么', () => {
    for (const { side, source, registered, deferred } of CARRIER_SIDES) {
      const content = text(source)
      for (const field of registered) expect(content, `${side} 登记: ${field}`).toContain(field)
      for (const field of deferred) expect(content, `${side} 出件补填: ${field}`).toContain(field)
      // 落差本身必须写成一句话，否则「不登记」读起来像「不需要」。
      expect(content, side).toMatch(/出件时逐条填写|逐条填写/)
    }
  })

  it('两侧消费方都点明件数与页数在出件时填写', () => {
    for (const { side, consumers } of CARRIER_SIDES) {
      for (const path of consumers) {
        expect(text(path), `${side} ${path}`).toMatch(/一式两份|份数|页数/)
      }
    }
  })

  it('答辩侧按指南写明一式两份的依据', () => {
    expect(text(DEFENSE_CONVENTIONS)).toContain('一式两份')
    expect(text(DEFENSE_CONVENTIONS)).toContain('审查指南第四部分第三章4.4.1')
  })

  it('每侧的三个消费方都落在本侧口径源上', () => {
    for (const { side, consumers, section } of CARRIER_SIDES) {
      for (const path of consumers) {
        expect(text(path), `${side} ${path}`).toMatch(new RegExp(`conventions\\.md[^\\n]*${section}|${section}[^\\n]*conventions\\.md`))
      }
    }
  })
})
