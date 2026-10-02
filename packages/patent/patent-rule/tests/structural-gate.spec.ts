import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as PatentRule from '@deepseek-ai/dsh-patent-rule'
import type { StructuralGateEntry } from '@deepseek-ai/dsh-patent-rule'

const signal = new AbortController().signal

/**
 * A rulesDir fixture: one block-level layout rule, one block-level effect rule,
 * and one warn-level rule (all structural_analysis = absence-based).
 */
function makeRulesFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'patent-rule-structural-'))
  const patentDir = join(root, 'patent')
  mkdirSync(patentDir)
  writeFileSync(
    join(patentDir, 'compliance.yaml'),
    [
      'rules:',
      '  - id: TEST-LAYOUT',
      '    name: 测试独权布局',
      '    severity: critical',
      '    action: block',
      '    legalBasis: 细则第二十一条第二款',
      '    check:',
      '      type: structural_analysis',
      '      requiresAll:',
      '        - element: characterizing',
      '          patterns: ["其特征在于"]',
      '  - id: TEST-EFFECT',
      '    name: 测试有益效果',
      '    severity: critical',
      '    action: block',
      '    check:',
      '      type: structural_analysis',
      '      requiresAll:',
      '        - element: effect',
      '          patterns: ["有益效果"]',
      '  - id: TEST-SOFT',
      '    name: 测试提示级结构',
      '    severity: minor',
      '    action: warn',
      '    check:',
      '      type: structural_analysis',
      '      requiresAll:',
      '        - element: effect',
      '          patterns: ["有益效果"]',
    ].join('\n'),
    'utf8',
  )
  return root
}

function planOf(root: string, entries: readonly StructuralGateEntry[]) {
  return PatentRule.resolveStructuralGate(PatentRule.loadPatentFullRuleSet(root).ruleSet, entries)
}

describe('structuralGateText', () => {
  it('拼接声明入参里的全部字符串（记录取全部值、数组逐项展开）', () => {
    const args = {
      sections: { claims: '一种装置，其特征在于：A。', spec: { abstract: '摘要正文' } },
      other: '不参与',
      list: ['甲', '乙'],
    }
    expect(PatentRule.structuralGateText(args, ['sections'])).toBe('一种装置，其特征在于：A。\n摘要正文')
    expect(PatentRule.structuralGateText(args, ['sections', 'list'])).toBe('一种装置，其特征在于：A。\n摘要正文\n甲\n乙')
  })

  it('非字符串值与缺失入参不产出文本', () => {
    expect(PatentRule.structuralGateText({ count: 3, flag: true, nil: null }, ['count', 'flag', 'nil'])).toBe('')
    expect(PatentRule.structuralGateText({ count: 3 }, ['missing'])).toBe('')
    expect(PatentRule.structuralGateText(7, ['sections'])).toBe('')
    expect(PatentRule.structuralGateText(null, ['sections'])).toBe('')
    expect(PatentRule.structuralGateText([{ a: 'x' }], ['a'])).toBe('')
  })
})

describe('resolveStructuralGate', () => {
  it('把规则 id 解析成规则对象', () => {
    const plan = planOf(makeRulesFixture(), [{ tool: 'render_patent_document', textArgs: ['sections'], ruleIds: ['TEST-LAYOUT'] }])
    expect(plan.warnings).toEqual([])
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]?.rules.map(rule => rule.id)).toEqual(['TEST-LAYOUT'])
  })

  it('规则集内不存在的 id 告警并剔除，全部未知则整条不生效', () => {
    const plan = planOf(makeRulesFixture(), [
      { tool: 'render_patent_document', textArgs: ['sections'], ruleIds: ['TEST-LAYOUT', 'NO-SUCH-RULE'] },
      { tool: 'other_tool', textArgs: ['text'], ruleIds: ['NO-SUCH-RULE'] },
    ])
    expect(plan.entries).toHaveLength(1)
    expect(plan.entries[0]?.rules.map(rule => rule.id)).toEqual(['TEST-LAYOUT'])
    expect(plan.warnings).toEqual([
      '制品结构门禁 render_patent_document: 规则集内不存在规则 NO-SUCH-RULE，该条已忽略',
      '制品结构门禁 other_tool: 规则集内不存在规则 NO-SUCH-RULE，该条已忽略',
      '制品结构门禁 other_tool: 没有可用规则，该条不生效',
    ])
  })

  it('空声明得到空计划', () => {
    const plan = planOf(makeRulesFixture(), [])
    expect(plan.entries).toEqual([])
    expect(plan.warnings).toEqual([])
  })
})

describe('structuralGateViolations', () => {
  const entries: StructuralGateEntry[] = [
    { tool: 'render_patent_document', textArgs: ['sections'], ruleIds: ['TEST-LAYOUT'] },
    {
      tool: 'render_patent_document',
      textArgs: ['sections'],
      ruleIds: ['TEST-EFFECT'],
      whenArgs: { template: 'claims-spec' },
    },
  ]

  it('命中 block 级结构规则即产出违规', () => {
    const plan = planOf(makeRulesFixture(), entries)
    const violations = PatentRule.structuralGateViolations(plan, 'render_patent_document', {
      sections: { claims: '一种装置，包括：A。' },
    })
    expect(violations.map(violation => violation.ruleId)).toEqual(['TEST-LAYOUT'])
    expect(violations[0]?.action).toBe('block')
  })

  it('whenArgs 精确匹配才生效', () => {
    const plan = planOf(makeRulesFixture(), entries)
    const matched = PatentRule.structuralGateViolations(plan, 'render_patent_document', {
      template: 'claims-spec',
      sections: { claims: '一种装置，其特征在于：A。' },
    })
    expect(matched.map(violation => violation.ruleId)).toEqual(['TEST-EFFECT'])
    const mismatched = PatentRule.structuralGateViolations(plan, 'render_patent_document', {
      template: 'oa-response',
      sections: { claims: '一种装置，其特征在于：A。' },
    })
    expect(mismatched).toEqual([])
  })

  it('入参不是记录时 whenArgs 不匹配', () => {
    const plan = planOf(makeRulesFixture(), entries)
    expect(PatentRule.structuralGateViolations(plan, 'render_patent_document', null)).toEqual([])
  })

  it('工具不匹配或制品文本为空时不判', () => {
    const plan = planOf(makeRulesFixture(), entries)
    expect(PatentRule.structuralGateViolations(plan, 'other_tool', { sections: { claims: '一种装置' } })).toEqual([])
    expect(PatentRule.structuralGateViolations(plan, 'render_patent_document', { sections: { claims: '   ' } })).toEqual([])
    expect(PatentRule.structuralGateViolations(plan, 'render_patent_document', { sections: { page: 3 } })).toEqual([])
  })

  it('只取 block 级：warn 级结构规则命中不算门禁违规', () => {
    const plan = planOf(makeRulesFixture(), [
      { tool: 'render_patent_document', textArgs: ['sections'], ruleIds: ['TEST-SOFT'] },
    ])
    const violations = PatentRule.structuralGateViolations(plan, 'render_patent_document', {
      sections: { claims: '一种装置，其特征在于：A。' },
    })
    expect(violations).toEqual([])
  })
})

describe('renderStructuralGateDenial', () => {
  it('给出规则编号、名称、说明与依据', () => {
    const plan = planOf(makeRulesFixture(), [{ tool: 'render_patent_document', textArgs: ['sections'], ruleIds: ['TEST-LAYOUT'] }])
    const violations = PatentRule.structuralGateViolations(plan, 'render_patent_document', { sections: { claims: '一种装置。' } })
    const text = PatentRule.renderStructuralGateDenial('render_patent_document', violations)
    expect(text).toContain('拒绝 render_patent_document')
    expect(text).toContain('TEST-LAYOUT')
    expect(text).toContain('测试独权布局')
    expect(text).toContain('依据：细则第二十一条第二款')
  })

  it('规则未声明依据时不出现依据括注', () => {
    const plan = planOf(makeRulesFixture(), [{ tool: 'render_patent_document', textArgs: ['sections'], ruleIds: ['TEST-EFFECT'] }])
    const violations = PatentRule.structuralGateViolations(plan, 'render_patent_document', { sections: { claims: '一种装置。' } })
    const text = PatentRule.renderStructuralGateDenial('render_patent_document', violations)
    expect(text).not.toContain('依据')
  })
})

describe('selectGateRules 检查族', () => {
  it('默认只保留 keyword_blocklist，选中结构族时保留结构规则', () => {
    const ruleSet = PatentRule.loadPatentFullRuleSet(makeRulesFixture()).ruleSet
    expect(PatentRule.selectGateRules(ruleSet).rules).toEqual([])
    expect(
      PatentRule.selectGateRules(ruleSet, ['structural_analysis']).rules.map(rule => rule.id),
    ).toEqual(['TEST-LAYOUT', 'TEST-EFFECT', 'TEST-SOFT'])
  })

  it('isGateCheckType 只认已声明的检查族', () => {
    expect(PatentRule.isGateCheckType('structural_analysis')).toBe(true)
    expect(PatentRule.isGateCheckType('keyword_blocklist')).toBe(true)
    expect(PatentRule.isGateCheckType('relevance')).toBe(false)
  })
})

describe('tools/pre-execute 制品结构门禁', () => {
  function documentTool(name = 'render_patent_document') {
    return defineContentToolFixture({
      name,
      description: 'render',
      parameters: { template: { type: 'string' }, sections: { type: 'object', additionalProperties: true } },
      async execute(): Promise<ContentBlock[]> { return [{ type: 'text', text: 'HTML written: out.html' }] },
    })
  }

  async function mount(config: PatentRule.Config): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(PatentRule, config)
    return ctx
  }

  function call(ctx: Context, args: Record<string, unknown>) {
    return ctx.tools.execute({
      name: 'render_patent_document',
      callId: ToolCallId('structural-call'),
      arguments: args,
      signal,
    })
  }

  it('制品文本命中 block 级结构规则即拒绝该次调用', async () => {
    const ctx = await mount({
      rulesDir: makeRulesFixture(),
      structuralGate: [{ tool: 'render_patent_document', textArgs: ['sections'], ruleIds: ['TEST-LAYOUT'] }],
    })
    ctx.tools.register(documentTool())
    const result = await call(ctx, { template: 'claims-spec', sections: { claims: '一种装置，包括：A。' } })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toMatch(/TEST-LAYOUT/)
    expect(result.error?.message).toMatch(/制品结构门禁拒绝 render_patent_document/)
  })

  it('制品合格时放行，且未声明的工具不受影响', async () => {
    const ctx = await mount({
      rulesDir: makeRulesFixture(),
      structuralGate: [{ tool: 'render_patent_document', textArgs: ['sections'], ruleIds: ['TEST-LAYOUT'] }],
    })
    ctx.tools.register(documentTool())
    ctx.tools.register(documentTool('other_tool'))
    const allowed = await call(ctx, { template: 'claims-spec', sections: { claims: '一种装置，其特征在于：A。' } })
    expect(allowed.isError).toBe(false)
    const other = await ctx.tools.execute({
      name: 'other_tool',
      callId: ToolCallId('other-call'),
      arguments: { sections: { claims: '一种装置。' } },
      signal,
    })
    expect(other.isError).toBe(false)
  })

  it('whenArgs 不匹配时该条不适用', async () => {
    const ctx = await mount({
      rulesDir: makeRulesFixture(),
      structuralGate: [{
        tool: 'render_patent_document',
        textArgs: ['sections'],
        ruleIds: ['TEST-EFFECT'],
        whenArgs: { template: 'claims-spec' },
      }],
    })
    ctx.tools.register(documentTool())
    const result = await call(ctx, { template: 'oa-response', sections: { body: '答复如下。' } })
    expect(result.isError).toBe(false)
  })

  it('未声明制品结构门禁时不做 pre-execute 判定（opt-in）', async () => {
    const ctx = await mount({ rulesDir: makeRulesFixture() })
    ctx.tools.register(documentTool())
    const result = await call(ctx, { template: 'claims-spec', sections: { claims: '一种装置，包括：A。' } })
    expect(result.isError).toBe(false)
  })

  it('未知规则 id、未知门禁检查族与「缺失即违规」族都告警但不阻塞挂载', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const warnSpy = vi.spyOn(ctx.logger, 'warn')
    await ctx.plugin(PatentRule, {
      rulesDir: makeRulesFixture(),
      gateCheckTypes: ['keyword_blocklist', 'not_a_check_type', 'structural_analysis'],
      structuralGate: [
        { tool: 'render_patent_document', textArgs: ['sections'], ruleIds: ['NO-SUCH-RULE'] },
        { tool: 'render_patent_document', textArgs: ['sections'], ruleIds: ['TEST-LAYOUT'] },
      ],
    })
    ctx.tools.register(documentTool())
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('未知的门禁检查类型 "not_a_check_type"'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"structural_analysis" 是「缺失即违规」族'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('规则集内不存在规则 NO-SUCH-RULE'))
    const result = await call(ctx, { template: 'claims-spec', sections: { claims: '一种装置。' } })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toMatch(/TEST-LAYOUT/)
    warnSpy.mockRestore()
  })
})
