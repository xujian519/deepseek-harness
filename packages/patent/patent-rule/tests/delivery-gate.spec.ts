import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import type { ToolExecutionInput } from '@deepseek-ai/dsh-tools'
import * as PatentRule from '@deepseek-ai/dsh-patent-rule'

const signal = new AbortController().signal

/** The agent surface a tool call carries. */
type ToolAgent = NonNullable<ToolExecutionInput['agent']>

/**
 * A call's owning agent. The gate attributes a call by the agent object's
 * identity, and the tool runtime hands it only to `scopeTarget`, which reads no
 * field, so this fixture carries the identity and asserts the live-Agent surface
 * it does not exercise.
 * @param id - session id the call is attributed to.
 * @returns the agent value a tool call carries.
 */
function fakeAgent(id: string): ToolAgent {
  return { id: SessionId(id) } as ToolAgent
}

/** Two callers: the ledger groups by it, so one never satisfies the other. */
const AGENT = fakeAgent('session-delivery-gate')
const OTHER_AGENT = fakeAgent('session-other')

let callSeq = 0

function okTool(name: string) {
  return defineContentToolFixture({
    name,
    description: name,
    parameters: {},
    async execute(): Promise<ContentBlock[]> { return [{ type: 'text', text: 'ok' }] },
  })
}

function failingTool(name: string) {
  return defineContentToolFixture({
    name,
    description: name,
    parameters: {},
    async execute(): Promise<ContentBlock[]> { throw new Error(`${name} 执行失败`) },
  })
}

function documentTool() {
  return defineContentToolFixture({
    name: 'render_patent_document',
    description: 'render',
    parameters: { template: { type: 'string' } },
    async execute(): Promise<ContentBlock[]> { return [{ type: 'text', text: 'HTML written: out.html' }] },
  })
}

function call(
  ctx: Context,
  name: string,
  args: Record<string, unknown>,
  agent?: ToolAgent,
) {
  callSeq += 1
  return ctx.tools.execute({
    name,
    callId: ToolCallId(`delivery-${callSeq}`),
    arguments: args,
    signal,
    ...(agent === undefined ? {} : { agent }),
  })
}

describe('args-match', () => {
  it('把对象收窄为字符串记录，数组与非记录返回 null', () => {
    expect(PatentRule.jsonRecord({ template: 'claims-spec' })).toEqual({ template: 'claims-spec' })
    expect(PatentRule.jsonRecord(['claims-spec'])).toBeNull()
    expect(PatentRule.jsonRecord(null)).toBeNull()
    expect(PatentRule.jsonRecord('claims-spec')).toBeNull()
  })

  it('未声明约束时恒适用；入参不是记录时不适用', () => {
    expect(PatentRule.declaredArgsMatch(undefined, { template: 'claims-spec' })).toBe(true)
    expect(PatentRule.declaredArgsMatch({ template: 'claims-spec' }, 'claims-spec')).toBe(false)
  })

  it('字符串为精确匹配，字符串数组为取值集合', () => {
    const args = { template: 'claims-spec' }
    expect(PatentRule.declaredArgsMatch({ template: 'claims-spec' }, args)).toBe(true)
    expect(PatentRule.declaredArgsMatch({ template: 'oa-response' }, args)).toBe(false)
    expect(PatentRule.declaredArgsMatch({ template: ['oa-response', 'claims-spec'] }, args)).toBe(true)
    expect(PatentRule.declaredArgsMatch({ template: ['oa-response'] }, args)).toBe(false)
    // 取值集合只认字符串：实际入参不是字符串时集合不命中。
    expect(PatentRule.declaredArgsMatch({ template: ['claims-spec'] }, { template: 7 })).toBe(false)
  })
})

describe('resolveDeliveryGate', () => {
  it('空声明告警并剔除，其余按声明顺序保留', () => {
    const plan = PatentRule.resolveDeliveryGate([
      { tool: 'draft_claims', requires: [] },
      { tool: 'render_patent_document', requires: ['rule_check'] },
    ])
    expect(plan.entries.map(entry => entry.tool)).toEqual(['render_patent_document'])
    expect(plan.warnings).toEqual(['交付前置门禁 draft_claims: 未声明任何前置调用，该条不生效'])
  })
})

describe('DeliveryAttemptLedger', () => {
  it('按归属单位分组：只认已登记的调用，别的会话不顶替', () => {
    const ledger = new PatentRule.DeliveryAttemptLedger()
    expect(ledger.has(AGENT, 'rule_check')).toBe(false)
    ledger.record(AGENT, 'rule_check')
    ledger.record(AGENT, 'law_verify')
    expect(ledger.has(AGENT, 'rule_check')).toBe(true)
    expect(ledger.has(AGENT, 'law_verify')).toBe(true)
    expect(ledger.has(OTHER_AGENT, 'rule_check')).toBe(false)
  })
})

describe('deliveryGateMissing', () => {
  const plan = PatentRule.resolveDeliveryGate([
    { tool: 'render_patent_document', requires: ['rule_check', 'law_verify'] },
    { tool: 'render_patent_document', requires: ['law_verify', 'patent_workflow_run'] },
    { tool: 'render_patent_document', requires: ['patent_fees'], whenArgs: { template: 'claims-spec' } },
    { tool: 'draft_specification', requires: ['patent_fees'] },
  ])

  it('按声明顺序去重，跨条目重复的前置只报一次', () => {
    const ledger = new PatentRule.DeliveryAttemptLedger()
    ledger.record(AGENT, 'rule_check')
    expect(PatentRule.deliveryGateMissing(plan, ledger, AGENT, 'render_patent_document', { template: 'oa-response' }))
      .toEqual(['law_verify', 'patent_workflow_run'])
  })

  it('whenArgs 命中时才追加该条的前置', () => {
    const ledger = new PatentRule.DeliveryAttemptLedger()
    ledger.record(AGENT, 'rule_check')
    expect(PatentRule.deliveryGateMissing(plan, ledger, AGENT, 'render_patent_document', { template: 'claims-spec' }))
      .toEqual(['law_verify', 'patent_workflow_run', 'patent_fees'])
  })

  it('未声明门禁的工具没有缺口', () => {
    const ledger = new PatentRule.DeliveryAttemptLedger()
    expect(PatentRule.deliveryGateMissing(plan, ledger, AGENT, 'validate_specification', {})).toEqual([])
  })

  it('归属不明时按全部未满足处理', () => {
    const ledger = new PatentRule.DeliveryAttemptLedger()
    expect(PatentRule.deliveryGateMissing(plan, ledger, undefined, 'render_patent_document', { template: 'oa-response' }))
      .toEqual(['rule_check', 'law_verify', 'patent_workflow_run'])
  })
})

describe('renderDeliveryGateDenial', () => {
  it('点名缺失的前置调用，并说明补哪一步', () => {
    const text = PatentRule.renderDeliveryGateDenial('render_patent_document', ['rule_check', 'law_verify'])
    expect(text).toContain('交付前置门禁拒绝 render_patent_document')
    expect(text).toContain('rule_check、law_verify')
    expect(text).toContain('再重新调用该工具')
  })
})

describe('Config.deliveryGate', () => {
  it('接受部署声明的形态：字符串数组 whenArgs 与并列多条', () => {
    const parsed = PatentRule.Config({
      deliveryGate: [
        { tool: 'render_patent_document', requires: ['rule_check', 'law_verify'] },
        {
          tool: 'render_patent_document',
          requires: ['patent_workflow_run'],
          whenArgs: { template: ['patentability-opinion', 'search-report'] },
        },
      ],
    })
    expect(parsed.deliveryGate).toEqual([
      { tool: 'render_patent_document', requires: ['rule_check', 'law_verify'], whenArgs: {} },
      {
        tool: 'render_patent_document',
        requires: ['patent_workflow_run'],
        whenArgs: { template: ['patentability-opinion', 'search-report'] },
      },
    ])
  })

  it('未声明时门禁缺省为空（opt-in）', () => {
    expect(PatentRule.Config({}).deliveryGate).toEqual([])
  })
})

describe('tools/guard 交付前置门禁', () => {
  async function mount(config: PatentRule.Config): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(PatentRule, config)
    return ctx
  }

  it('未跑前置调用即拒绝交付渲染，并点名缺哪一步', async () => {
    const ctx = await mount({
      deliveryGate: [{ tool: 'render_patent_document', requires: ['rule_check', 'law_verify'] }],
    })
    ctx.tools.register(documentTool())
    ctx.tools.register(okTool('rule_check'))
    ctx.tools.register(okTool('law_verify'))

    const result = await call(ctx, 'render_patent_document', { template: 'claims-spec' }, AGENT)
    expect(result.isError).toBe(true)
    expect(result.error?.message).toMatch(/交付前置门禁拒绝 render_patent_document/)
    expect(result.error?.message).toMatch(/rule_check、law_verify/)
  })

  it('前置调用成功返回后放行', async () => {
    const ctx = await mount({ deliveryGate: [{ tool: 'render_patent_document', requires: ['rule_check'] }] })
    ctx.tools.register(documentTool())
    ctx.tools.register(okTool('rule_check'))

    expect((await call(ctx, 'render_patent_document', { template: 'claims-spec' }, AGENT)).isError).toBe(true)
    expect((await call(ctx, 'rule_check', { text: '权利要求 1' }, AGENT)).isError).toBe(false)
    expect((await call(ctx, 'render_patent_document', { template: 'claims-spec' }, AGENT)).isError).toBe(false)
  })

  it('前置调用报错不算跑过', async () => {
    const ctx = await mount({ deliveryGate: [{ tool: 'render_patent_document', requires: ['rule_check'] }] })
    ctx.tools.register(documentTool())
    ctx.tools.register(failingTool('rule_check'))

    expect((await call(ctx, 'rule_check', {}, AGENT)).isError).toBe(true)
    const result = await call(ctx, 'render_patent_document', { template: 'claims-spec' }, AGENT)
    expect(result.isError).toBe(true)
    expect(result.error?.message).toMatch(/rule_check/)
  })

  it('台账按会话隔离：别的会话跑过不算本会话跑过', async () => {
    const ctx = await mount({ deliveryGate: [{ tool: 'render_patent_document', requires: ['rule_check'] }] })
    ctx.tools.register(documentTool())
    ctx.tools.register(okTool('rule_check'))

    expect((await call(ctx, 'rule_check', {}, OTHER_AGENT)).isError).toBe(false)
    expect((await call(ctx, 'render_patent_document', { template: 'claims-spec' }, AGENT)).isError).toBe(true)
  })

  it('whenArgs 按模板收窄：分析类要收口，撰写类不要', async () => {
    const ctx = await mount({
      deliveryGate: [{
        tool: 'render_patent_document',
        requires: ['patent_workflow_run'],
        whenArgs: { template: ['patentability-opinion', 'search-report'] },
      }],
    })
    ctx.tools.register(documentTool())

    expect((await call(ctx, 'render_patent_document', { template: 'patentability-opinion' }, AGENT)).isError).toBe(true)
    expect((await call(ctx, 'render_patent_document', { template: 'claims-spec' }, AGENT)).isError).toBe(false)
  })

  it('归属不明的调用拿不出本会话记录，按未满足处理', async () => {
    const ctx = await mount({ deliveryGate: [{ tool: 'render_patent_document', requires: ['rule_check'] }] })
    ctx.tools.register(documentTool())
    ctx.tools.register(okTool('rule_check'))

    const result = await call(ctx, 'render_patent_document', { template: 'claims-spec' })
    expect(result.isError).toBe(true)
    expect(result.error?.message).toMatch(/rule_check/)
  })

  it('未声明交付门禁时不做判定（opt-in）', async () => {
    const ctx = await mount({})
    ctx.tools.register(documentTool())
    expect((await call(ctx, 'render_patent_document', { template: 'claims-spec' }, AGENT)).isError).toBe(false)
  })

  it('被门禁的工具之外的调用不受影响', async () => {
    const ctx = await mount({ deliveryGate: [{ tool: 'render_patent_document', requires: ['rule_check'] }] })
    ctx.tools.register(documentTool())
    ctx.tools.register(okTool('validate_specification'))
    expect((await call(ctx, 'validate_specification', {}, AGENT)).isError).toBe(false)
  })

  it('空声明告警且该条不生效', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const warnSpy = vi.spyOn(ctx.logger, 'warn')
    await ctx.plugin(PatentRule, { deliveryGate: [{ tool: 'render_patent_document', requires: [] }] })
    ctx.tools.register(documentTool())

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('交付前置门禁 render_patent_document: 未声明任何前置调用'))
    expect((await call(ctx, 'render_patent_document', { template: 'claims-spec' }, AGENT)).isError).toBe(false)
  })

  it('撤销贡献后门禁随之移除（HMR 安全）', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fiber = await ctx.plugin(PatentRule, {
      deliveryGate: [{ tool: 'render_patent_document', requires: ['rule_check'] }],
    })
    ctx.tools.register(documentTool())

    expect((await call(ctx, 'render_patent_document', { template: 'claims-spec' }, AGENT)).isError).toBe(true)
    await fiber.dispose()
    expect((await call(ctx, 'render_patent_document', { template: 'claims-spec' }, AGENT)).isError).toBe(false)
  })
})
