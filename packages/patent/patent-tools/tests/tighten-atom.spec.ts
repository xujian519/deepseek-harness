/**
 * tighten 原子（P2-01）：删减阶段的三条验收——字数真的降了、清单真的给了、
 * 没减到预算内就降级而不是假装收口。
 *
 * 「降级而不是静默放行」是本阶段的要点：删减的验收标准是字数，字数可以算，
 * 所以模型自称删完不算数，必须过 `visibleChars` 这道机械核对。
 */
import { describe, expect, it } from 'vitest'
import type { StageProvider } from '@deepseek-ai/dsh-patent-core'
import { TightenHandler } from '../src/atoms/tighten.ts'

const handler = new TightenHandler()

/** 造一段指定可见字数的正文（无空白、无标记，可见字数即长度）。 */
function body(chars: number): string {
  return '甲'.repeat(chars)
}

/** 模型替身：返回固定文本，并记录收到的提示词。 */
function providerOf(reply: string, prompts: string[] = []): StageProvider {
  return {
    callLLM: async (prompt: string) => {
      prompts.push(prompt)
      return reply
    },
  }
}

/** 模型替身：返回一段删减结果。 */
function replyOf(tightened: string, removed: { what: string; why: string }[] = []): string {
  return JSON.stringify({ tightened, removed })
}

describe('tighten：删到预算内', () => {
  it('写出删减后的正文、逐条删除清单与空的残留项', async () => {
    const prompts: string[] = []
    const out = await handler.execute({
      state: { draft: body(1200), char_budget: 1000 },
      provider: providerOf(replyOf(body(800), [
        { what: '复述审查意见第二项', why: '总体立场已有一句概括' },
        { what: '同一 D1 段落的第二次引述', why: '首次引述已带段落号' },
      ]), prompts),
    })
    expect(out.draft_tightened).toBe(body(800))
    expect(out.tighten_violations).toBe('')
    expect(out.tighten_report).toContain('1200 → 800')
    expect(out.tighten_report).toContain('预算 1000 字')
    expect(out.tighten_report).toContain('- 复述审查意见第二项：总体立场已有一句概括')
    // 提示词把当前字数与「至少需删」都算给模型，不留给它猜。
    expect(prompts[0]).toContain('可见字符 1200 字')
    expect(prompts[0]).toContain('至少需删 200 字')
  })

  it('没有删除项时报告写明未删内容，不编造理由', async () => {
    const out = await handler.execute({
      state: { draft: body(900) },
      provider: providerOf(replyOf(body(900))),
    })
    expect(out.tighten_report).toContain('900 → 900')
    expect(out.tighten_report).toContain('未删除任何内容')
  })

  it('已合规的正文原样交回不降级（等长不算「没删」）', async () => {
    const out = await handler.execute({
      state: { draft: body(500) },
      provider: providerOf(replyOf(body(500))),
    })
    expect(out.draft_tightened).toBe(body(500))
    expect(out._error).toBeUndefined()
  })

  it('已在预算内时原样放行、不调用模型，报告写明未调用', async () => {
    const prompts: string[] = []
    const out = await handler.execute({
      state: { draft: body(500), char_budget: 1000 },
      provider: providerOf(replyOf(body(100)), prompts),
    })
    expect(out.draft_tightened).toBe(body(500))
    expect(out.tighten_violations).toBe('')
    expect(out.tighten_report).toContain('500 → 500')
    expect(out.tighten_report).toContain('已在预算内')
    // 没有删减目标就不该花一次调用：提示词数组必须为空。
    expect(prompts).toHaveLength(0)
  })

  it('已在预算内时不因缺 provider 降级（不需要模型）', async () => {
    const out = await handler.execute({ state: { draft: body(500), char_budget: 1000 } })
    expect(out.draft_tightened).toBe(body(500))
    expect(out._error).toBeUndefined()
  })

  it('未声明预算时照常删减，不因缺预算降级', async () => {
    const out = await handler.execute({
      state: { draft: body(1200) },
      provider: providerOf(replyOf(body(600))),
    })
    expect(out.draft_tightened).toBe(body(600))
    expect(out.tighten_report).toContain('未声明预算')
  })
})

describe('tighten：没减到验收标准就降级', () => {
  it('删减后仍超预算：降级、给出还需删多少，且不写 draft_tightened', async () => {
    const out = await handler.execute({
      state: { draft: body(1200), char_budget: 1000 },
      provider: providerOf(replyOf(body(1100))),
    })
    expect(out.draft_tightened).toBeUndefined()
    expect(out._error).toContain('删减后仍超预算')
    expect(out._error).toContain('1100 > 预算 1000')
    expect(out._error).toContain('需再删 100 字')
    // 残留项同样落到 tighten_violations，供摘要与后续阶段读。
    expect(out.tighten_violations).toContain('仍超预算')
  })

  it('越删越长：降级', async () => {
    const out = await handler.execute({
      state: { draft: body(800), char_budget: 700 },
      provider: providerOf(replyOf(body(900))),
    })
    expect(out._error).toContain('反而变长')
    expect(out.draft_tightened).toBeUndefined()
  })

  it('tightened 为空：降级', async () => {
    const out = await handler.execute({
      state: { draft: body(800) },
      provider: providerOf(replyOf('   ')),
    })
    expect(out._error).toContain('tightened 为空')
  })

  it('模型只交正文（不走 JSON）：按正文收，报告写明清单缺失', async () => {
    const out = await handler.execute({
      state: { draft: body(800), char_budget: 700 },
      provider: providerOf(body(600)),
    })
    expect(out.draft_tightened).toBe(body(600))
    expect(out.tighten_report).toContain('800 → 600')
    expect(out.tighten_report).toContain('逐条清单缺失')
  })

  it('正文被 ``` 围栏包住时剥掉围栏再计字', async () => {
    const out = await handler.execute({
      state: { draft: body(800), char_budget: 700 },
      provider: providerOf(['```markdown', body(600), '```'].join('\n')),
    })
    expect(out.draft_tightened).toBe(body(600))
  })
})

describe('tighten：参数与前置条件', () => {
  it('缺 provider 时降级（未配置 LLM）', async () => {
    const out = await handler.execute({ state: { draft: body(800) } })
    expect(out._error).toContain('未配置 LLM')
  })

  it('输入为空时降级并指出键名', async () => {
    const out = await handler.execute({ state: { draft: '   ' }, provider: providerOf(replyOf('x')) })
    expect(out._error).toContain('输入为空（draft）')
  })

  it('text_key / plan_key / char_budget 非法时降级', async () => {
    const provider = providerOf(replyOf(body(10)))
    expect((await handler.execute({ state: { draft: body(10), text_key: '  ' }, provider }))._error)
      .toContain('params.text_key')
    expect((await handler.execute({ state: { draft: body(10), plan_key: '' }, provider }))._error)
      .toContain('params.plan_key')
    expect((await handler.execute({ state: { draft: body(10), char_budget: 0 }, provider }))._error)
      .toContain('params.char_budget')
  })

  it('自定义 text_key 与 plan_key 生效，答复计划进提示词', async () => {
    const prompts: string[] = []
    const out = await handler.execute({
      state: {
        draft_tightened_raw: body(600),
        'my-plan': '策略表：第 3 项为纯争辩，第 5 项已并入论证',
        text_key: 'draft_tightened_raw',
        plan_key: 'my-plan',
        char_budget: 500,
      },
      provider: providerOf(replyOf(body(450)), prompts),
    })
    expect(out.draft_tightened).toBe(body(450))
    expect(prompts[0]).toContain('第 3 项为纯争辩')
  })
})

/** 一张 Markdown 表格（表头分隔行是载体识别的锚点）。 */
const TABLE = ['| 权项 | 修改前 | 修改后 |', '| --- | --- | --- |', '| 1 | 原权利要求1 | 未修改 |'].join('\n')

describe('tighten：载体块不计入篇幅、也不得被删', () => {
  it('删掉表 1 时字数达标也记一条残留项', async () => {
    const out = await handler.execute({
      state: { draft: `${body(1200)}\n\n${TABLE}`, char_budget: 1000 },
      provider: providerOf(replyOf(body(800))),
    })
    expect(out.draft_tightened).toBe(body(800))
    expect(out.tighten_violations).toContain('删掉了 1 张表')
  })

  it('删掉修改后独权全文时同样记一条残留项', async () => {
    const draft = `${body(1200)}\n\n## 2.1 修改后的独立权利要求\n权利要求 1：一种装置。`
    const out = await handler.execute({
      state: { draft, char_budget: 1000 },
      provider: providerOf(replyOf(body(800))),
    })
    expect(out.tighten_violations).toContain('修改后的独立权利要求')
  })

  it('表格与全文都原样保留时没有残留项', async () => {
    const draft = `${body(1200)}\n\n${TABLE}\n\n## 2.1 修改后的独立权利要求\n权利要求 1：一种装置。`
    const out = await handler.execute({
      state: { draft, char_budget: 1000 },
      provider: providerOf(replyOf(`${body(800)}\n\n${TABLE}\n\n## 2.1 修改后的独立权利要求\n权利要求 1：一种装置。`)),
    })
    expect(out.tighten_violations).toBe('')
    expect(out.tighten_report).toContain('1200 → 800')
  })

  it('提示词写明载体不计字数、且删项必须真的不在正文里', async () => {
    const prompts: string[] = []
    await handler.execute({
      state: { draft: `${body(1200)}\n\n${TABLE}`, char_budget: 1000 },
      provider: providerOf(replyOf(body(800)), prompts),
    })
    expect(prompts[0]).toContain('不计入字数')
    expect(prompts[0]).toContain('必须真的删')
  })
})

describe('tighten：原样返回与删不够分开报', () => {
  it('声明了预算而模型原样返回时报「未删除任何内容」', async () => {
    const out = await handler.execute({
      state: { draft: body(1200), char_budget: 1000 },
      provider: providerOf(replyOf(body(1200), [{ what: '某段复述', why: '已概括' }])),
    })
    expect(out._error).toContain('原样返回')
    expect(out._error).toContain('1200')
  })

  it('未声明预算时等长交回不算失败（没有必须删到的目标）', async () => {
    const out = await handler.execute({
      state: { draft: body(900) },
      provider: providerOf(replyOf(body(900))),
    })
    expect(out._error).toBeUndefined()
  })
})
