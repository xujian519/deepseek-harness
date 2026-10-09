import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateTemplateDraft } from '@deepseek-ai/dsh-patent-core'
import { readTemplateHtml } from '../src/document/templateResolver.ts'
import { findMatchingCloseTag } from '../src/document/htmlScan.ts'
import {
  FORM_TEMPLATE_IDS,
  FORM_TEMPLATE_SCHEMAS,
  GENERIC_TEMPLATE_IDS,
  GENERIC_TEMPLATE_SCHEMAS,
} from '../src/document/draftSchema/index.ts'

/** 从模板 HTML 机械提取全部 data-slot 引用（元素槽位与 choice 选项）。 */
function extractSlotRefs(html: string): { elements: string[]; choices: Map<string, string[]> } {
  const elements: string[] = []
  const choices = new Map<string, string[]>()
  for (const match of html.matchAll(/data-slot="([^"]+)"/g)) {
    const ref = match[1] as string
    const colon = ref.indexOf(':')
    if (colon === -1) {
      elements.push(ref)
    } else {
      const group = ref.slice(0, colon)
      const option = ref.slice(colon + 1)
      const list = choices.get(group) ?? []
      list.push(option)
      choices.set(group, list)
    }
  }
  return { elements, choices }
}

describe('draft schema conformance（注册表 ↔ 模板机械提取一致性）', () => {
  for (const template of FORM_TEMPLATE_IDS) {
    describe(template, () => {
      const schema = FORM_TEMPLATE_SCHEMAS[template]
      const { elements, choices } = extractSlotRefs(readTemplateHtml(template))

      it('模板每个元素槽位都被注册表 fields/sections 覆盖', () => {
        const registered = new Set([...Object.keys(schema.fields ?? {}), ...Object.keys(schema.sections ?? {})])
        const uncovered = [...new Set(elements)].filter(id => !registered.has(id))
        expect(uncovered).toEqual([])
      })

      it('注册表与模板的槽位集合完全一致（双向锁定）', () => {
        const inTemplate = new Set([...elements, ...choices.keys()])
        const registered = new Set([...Object.keys(schema.fields ?? {}), ...Object.keys(schema.sections ?? {})])
        const onlyInTemplate = [...inTemplate].filter(id => !registered.has(id))
        const onlyInRegistry = [...registered].filter(id => !inTemplate.has(id))
        expect({ onlyInTemplate, onlyInRegistry }).toEqual({ onlyInTemplate: [], onlyInRegistry: [] })
      })

      it('choice 组的选项集合与模板逐项一致', () => {
        for (const [group, options] of choices) {
          const slot = schema.fields?.[group]
          expect(slot?.kind, `组 ${group} 未注册为 choice`).toBe('choice')
          const registered = (slot?.options ?? []).map(option => option.id).sort()
          expect([...options].sort()).toEqual(registered)
        }
        for (const [id, slot] of Object.entries(schema.fields ?? {})) {
          if (slot.kind === 'choice') {
            expect(choices.has(id), `choice 组 ${id} 在模板中无选项`).toBe(true)
          }
        }
      })

      it('rows 槽位列数与模板行 .fill 单元格数一致', () => {
        const html = readTemplateHtml(template)
        for (const [id, slot] of Object.entries(schema.sections ?? {})) {
          if (slot.kind !== 'rows') continue
          const rowMatch = new RegExp(`<tr[^>]*data-slot="${id}"[^>]*>([\\s\\S]*?)</tr>`).exec(html)
          expect(rowMatch, `rows 槽位 ${id} 的模板行`).not.toBeNull()
          const fills = (rowMatch?.[1]?.match(/<span class="fill[^"]*"[^>]*><\/span>/g) ?? []).length
          expect(fills, `rows 槽位 ${id} 列数`).toBe(slot.columns)
        }
      })

      it('staticElements 的 marker 都在模板中存在', () => {
        const html = readTemplateHtml(template)
        for (const element of schema.staticElements) {
          expect(html.includes(element.marker), `marker ${element.marker}`).toBe(true)
        }
      })

      it('示例草案通过注册表校验（必填槽位齐全）', () => {
        const raw: unknown = JSON.parse(readFileSync(
          `packages/patent/patent-document/assets/templates/patent/${template}/assets/example-draft.json`,
          'utf8',
        ))
        const draft = validateTemplateDraft(raw, schema)
        expect(draft.sections.length).toBeGreaterThan(0)
      })
    })
  }
})

describe('generic draft schema conformance（通用模板注册表 ↔ 模板 id 提取一致性）', () => {
  function extractIds(html: string): string[] {
    return [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1] as string)
  }

  for (const template of GENERIC_TEMPLATE_IDS) {
    describe(template, () => {
      const schema = GENERIC_TEMPLATE_SCHEMAS[template]
      const html = readTemplateHtml(template)
      const ids = extractIds(html)

      it('注册表槽位集合与模板 id 集合完全一致（双向锁定）', () => {
        const registered = new Set([...Object.keys(schema.fields ?? {}), ...Object.keys(schema.sections ?? {})])
        const staticIds = schema.staticElements.map((element) => {
          const match = /id="([^"]+)"/.exec(element.marker)
          return match?.[1]
        }).filter((id): id is string => id !== undefined)
        const covered = new Set([...registered, ...staticIds])
        const onlyInTemplate = [...new Set(ids)].filter(id => !covered.has(id))
        const onlyInRegistry = [...registered].filter(id => !ids.includes(id))
        expect({ onlyInTemplate, onlyInRegistry }).toEqual({ onlyInTemplate: [], onlyInRegistry: [] })
      })

      it('rows 槽位列数与模板占位行单元格数一致', () => {
        for (const [id, slot] of Object.entries(schema.sections ?? {})) {
          if (slot.kind !== 'rows') continue
          const rowMatch = new RegExp(`<tbody[^>]*id="${id}"[^>]*>[\\s\\S]*?<tr[^>]*>([\\s\\S]*?)</tr>`).exec(html)
          expect(rowMatch, `rows 槽位 ${id} 的占位行`).not.toBeNull()
          const cells = (rowMatch?.[1]?.match(/<td[\s>]/g) ?? []).length
          expect(cells, `rows 槽位 ${id} 列数`).toBe(slot.columns)
        }
      })

      it('staticElements 的 marker 都在模板中存在', () => {
        for (const element of schema.staticElements) {
          expect(html.includes(element.marker), `marker ${element.marker}`).toBe(true)
        }
      })

      it('包装元素（含嵌套 id）全部登记为 staticElements', () => {
        for (const id of ids) {
          const openRe = new RegExp(`<([A-Za-z][A-Za-z0-9]*)[^>]*\\bid="${id}"[^>]*>`)
          const openMatch = openRe.exec(html)
          if (openMatch === null) continue
          const openEnd = openMatch.index + openMatch[0].length
          const closeStart = findMatchingCloseTag(html, openEnd)
          const inner = closeStart === undefined ? '' : html.slice(openEnd, closeStart)
          const nested = ids.filter(other => other !== id && inner.includes(`id="${other}"`))
          const isRegisteredSlot = Object.hasOwn(schema.fields ?? {}, id) || Object.hasOwn(schema.sections ?? {}, id)
          const isStatic = schema.staticElements.some(element => element.marker.includes(`id="${id}"`))
          if (nested.length > 0) {
            expect(isRegisteredSlot, `包装元素 ${id} 不应注册为槽位（内含 ${nested.join('、')}）`).toBe(false)
            expect(isStatic, `包装元素 ${id} 应登记 staticElements`).toBe(true)
          }
        }
      })
    })
  }
})

describe('draft schema 类型守卫', () => {
  it('isGenericTemplateId / isDraftTemplateId / isFormTemplateId 判定正确', async () => {
    const { isGenericTemplateId, isDraftTemplateId, isFormTemplateId } = await import('../src/document/draftSchema/index.ts')
    expect(isGenericTemplateId('oa-response')).toBe(true)
    expect(isGenericTemplateId('right-evaluation-report')).toBe(false)
    expect(isGenericTemplateId('claims-spec')).toBe(false)
    expect(isDraftTemplateId('oa-response')).toBe(true)
    expect(isDraftTemplateId('right-evaluation-report')).toBe(true)
    expect(isDraftTemplateId('claims-spec')).toBe(false)
    expect(isFormTemplateId('search-report-form')).toBe(true)
    expect(isFormTemplateId('search-report')).toBe(false)
  })
})
