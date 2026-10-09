import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateTemplateDraft } from '@deepseek-ai/dsh-patent-core'
import { readTemplateHtml } from '../src/document/templateResolver.ts'
import {
  FORM_TEMPLATE_IDS,
  FORM_TEMPLATE_SCHEMAS,
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
        const raw = JSON.parse(readFileSync(
          `packages/patent/patent-document/assets/templates/patent/${template}/assets/example-draft.json`,
          'utf8',
        )) as unknown
        const draft = validateTemplateDraft(raw, schema)
        expect(draft.sections.length).toBeGreaterThan(0)
      })
    })
  }
})
