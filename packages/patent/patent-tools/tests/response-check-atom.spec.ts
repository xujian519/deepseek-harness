import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseOfficeAction, type ConstitutionalRule, type PipelineState, type RuleViolation } from '@deepseek-ai/dsh-patent-core'
import {
  loadResponseCheckRules,
  ResponseCheckHandler,
  responseCheckAtom,
  type ResponseCheckLoader,
} from '../src/atoms/response-check.ts'

const NOTICE =
  '权利要求 1-2 不具备创造性，不符合专利法第22条第3款的规定；权利要求 3 的保护范围不清楚，不符合专利法第26条第4款的规定。'
const DISCLOSURE_NOTICE = '权利要求 1 的技术方案公开不充分，不符合专利法第26条第3款的规定。'

const officeAction = (notice: string): string => JSON.stringify(parseOfficeAction(notice))

/** 覆盖创造性、不清楚两条理由，并引用通知书已提条款。 */
const PASSING_RESPONSE = [
  '关于创造性：对比文件 1 与 2 的结合无技术启示，权利要求 1 符合专利法第22条第3款的规定。',
  '关于不清楚：修改权利要求 3 的表述，符合专利法第26条第4款的规定。',
].join('\n')

type ResponseOutput = {
  response_check_report: string
  response_check_passed: boolean
  response_check_violations: RuleViolation[]
  response_check_unevaluated: string[]
}

/** 读取并校验原子输出，避免在断言处重复类型收窄。 */
function readOutput(output: PipelineState): ResponseOutput {
  const report = output.response_check_report
  const passed = output.response_check_passed
  const violations = output.response_check_violations
  const unevaluated = output.response_check_unevaluated
  if (
    typeof report !== 'string'
    || typeof passed !== 'boolean'
    || !Array.isArray(violations)
    || !Array.isArray(unevaluated)
  ) {
    throw new Error('response-check 输出缺少约定的键')
  }
  return {
    response_check_report: report,
    response_check_passed: passed,
    response_check_violations: violations as RuleViolation[],
    response_check_unevaluated: unevaluated.filter(
      (entry): entry is string => typeof entry === 'string',
    ),
  }
}

const ruleIds = (output: ResponseOutput): string[] =>
  output.response_check_violations.map(violation => violation.ruleId)

const degradedReason = (output: PipelineState): string => {
  const error = output._error
  if (typeof error !== 'string') throw new Error('expected degraded output')
  return error
}

describe('response-check atom', () => {
  const handler = new ResponseCheckHandler()

  it('声明的输出以报告为主输出，输入读取答复正文与通知书', () => {
    expect(responseCheckAtom.name).toBe('response-check')
    expect(responseCheckAtom.category).toBe('gate')
    expect(responseCheckAtom.outputSchema[0]).toBe('response_check_report')
    expect(responseCheckAtom.inputSchema).toEqual(expect.arrayContaining(['draft', 'office_action', 'notice']))
  })

  it('逐条覆盖通知书理由并引用已提条款 → 通过（正例）', async () => {
    const output = readOutput(await handler.execute({
      state: { draft: PASSING_RESPONSE, office_action: officeAction(NOTICE) },
    }))
    expect(output.response_check_passed).toBe(true)
    expect(output.response_check_violations).toEqual([])
    expect(output.response_check_unevaluated).toEqual([])
    expect(output.response_check_report).toContain('通过（0 条违规）')
    expect(output.response_check_report).toContain('通知书驳回理由：创造性、不清楚')
  })

  it('漏答某一审查意见项 → PR-OA-008 违规并点名缺失理由（反例）', async () => {
    const output = readOutput(await handler.execute({
      state: {
        draft: '关于创造性：对比文件 1 与 2 的结合无技术启示，权利要求 1 具备创造性。',
        office_action: officeAction(NOTICE),
      },
    }))
    expect(output.response_check_passed).toBe(false)
    expect(ruleIds(output)).toEqual(['PR-OA-008'])
    expect(output.response_check_violations[0]?.evidence).toEqual(['不清楚'])
    expect(output.response_check_report).toContain('未覆盖通知书提出的驳回理由：不清楚')
  })

  it('答复引用通知书未提出的驳回条款 → PR-OA-009 违规', async () => {
    const output = readOutput(await handler.execute({
      state: {
        draft: '关于创造性：对比文件 1 无技术启示，符合专利法第22条第3款的规定。此外，本申请符合专利法第26条第3款的规定。',
        office_action: officeAction('权利要求 1 不具备创造性，不符合专利法第22条第3款的规定。'),
      },
    }))
    expect(output.response_check_passed).toBe(false)
    expect(ruleIds(output)).toEqual(['PR-OA-009'])
    expect(output.response_check_violations[0]?.evidence).toEqual(['专利法第26条第3款'])
    expect(output.response_check_report).toContain('通知书未提出的驳回条款')
  })

  it('重复引用同一未提条款时证据去重', async () => {
    const output = readOutput(await handler.execute({
      state: {
        draft: '关于创造性：对比文件 1 无技术启示。专利法第26条第3款规定如下；再次强调专利法第26条第3款的要求。',
        office_action: officeAction('权利要求 1 不具备创造性，不符合专利法第22条第3款的规定。'),
      },
    }))
    const citation = output.response_check_violations.find(v => v.ruleId === 'PR-OA-009')
    expect(citation?.evidence).toEqual(['专利法第26条第3款'])
  })

  it('26.3 答复未落到法定判准 → PR-OA-007 阻断（反例）', async () => {
    const output = readOutput(await handler.execute({
      state: {
        draft: '关于公开不充分：说明书未记载相关处理手段，不符合专利法第二十六条第三款的规定。',
        office_action: officeAction(DISCLOSURE_NOTICE),
      },
    }))
    expect(output.response_check_passed).toBe(false)
    expect(ruleIds(output)).toEqual(['PR-OA-007'])
    expect(output.response_check_violations[0]?.action).toBe('block')
    expect(output.response_check_report).toContain('结构要素不完整')
  })

  it('26.3 答复包含判准三要素 → 无 PR-OA-007 违规（正例）', async () => {
    const output = readOutput(await handler.execute({
      state: {
        draft: '关于公开不充分：本领域技术人员根据说明书的记载能够实现该技术方案，符合专利法第二十六条第三款的规定。',
        office_action: officeAction(DISCLOSURE_NOTICE),
      },
    }))
    expect(output.response_check_passed).toBe(true)
    expect(output.response_check_violations).toEqual([])
  })

  it('缺少通知书时双输入规则显式列为未评估，不静默跳过', async () => {
    const output = readOutput(await handler.execute({
      state: { draft: PASSING_RESPONSE },
    }))
    expect(output.response_check_passed).toBe(true)
    expect(output.response_check_unevaluated).toEqual(['PR-OA-008', 'PR-OA-009'])
    expect(output.response_check_report).toContain('未提供通知书正文')
    expect(output.response_check_report).toContain('未评估规则：PR-OA-008、PR-OA-009')
  })

  it('缺少结构化结果时回退解析 state.input', async () => {
    const output = readOutput(await handler.execute({
      state: { draft: '关于创造性：无技术启示。', input: NOTICE },
    }))
    expect(ruleIds(output)).toEqual(['PR-OA-008'])
    expect(output.response_check_violations[0]?.evidence).toEqual(['不清楚'])
  })

  it('notice_key 可覆盖通知书正文键', async () => {
    const output = readOutput(await handler.execute({
      state: { draft: PASSING_RESPONSE, notice_key: 'oa_text', oa_text: NOTICE },
    }))
    expect(output.response_check_passed).toBe(true)
    expect(output.response_check_report).toContain('通知书驳回理由：创造性、不清楚')
  })

  it('response_key 可覆盖答复正文键', async () => {
    const output = readOutput(await handler.execute({
      state: {
        response_key: 'answer',
        answer: '关于创造性：无技术启示。',
        office_action: officeAction(NOTICE),
      },
    }))
    expect(ruleIds(output)).toEqual(['PR-OA-008'])
  })

  it('office_action 不是合法 JSON → 降级', async () => {
    const output = await handler.execute({ state: { draft: PASSING_RESPONSE, office_action: '{' } })
    expect(degradedReason(output)).toContain('不是合法 JSON')
  })

  it('office_action 不是字符串 → 降级', async () => {
    const output = await handler.execute({ state: { draft: PASSING_RESPONSE, office_action: 42 } })
    expect(degradedReason(output)).toContain('state.office_action 不是字符串')
  })

  it('office_action 缺少合法 rejectionTypes → 降级', async () => {
    const output = await handler.execute({
      state: { draft: PASSING_RESPONSE, office_action: JSON.stringify({ rejectionTypes: ['unknown'] }) },
    })
    expect(degradedReason(output)).toContain('缺少合法的 rejectionTypes')
  })

  it('答复正文缺失或类型错误 → 降级', async () => {
    const missing = await handler.execute({ state: {} })
    expect(degradedReason(missing)).toContain('未提供答复正文')

    const malformed = await handler.execute({ state: { draft: 42 } })
    expect(degradedReason(malformed)).toContain('state.draft 不是字符串')
  })

  it('阶段参数非法 → 降级', async () => {
    const output = await handler.execute({
      state: { draft: PASSING_RESPONSE, response_key: 42 },
    })
    expect(degradedReason(output)).toContain('params.response_key')
  })

  it('规则资产缺失 → 降级而非静默通过', async () => {
    const loader: ResponseCheckLoader = () => ({ rules: [], missingIds: ['PR-OA-007'], warnings: [] })
    const output = await new ResponseCheckHandler(loader).execute({
      state: { draft: PASSING_RESPONSE, office_action: officeAction(NOTICE) },
    })
    expect(degradedReason(output)).toContain('规则资产缺失：PR-OA-007')
  })

  it('规则加载抛错 → 降级', async () => {
    const loader: ResponseCheckLoader = () => {
      throw new Error('boom')
    }
    const output = await new ResponseCheckHandler(loader).execute({
      state: { draft: PASSING_RESPONSE, office_action: officeAction(NOTICE) },
    })
    expect(degradedReason(output)).toContain('规则资产加载失败：boom')
  })

  it('规则加载警告进入报告', async () => {
    const loaded = loadResponseCheckRules()
    const loader: ResponseCheckLoader = () => ({
      rules: loaded.rules,
      missingIds: [],
      warnings: ['测试警告'],
    })
    const output = readOutput(await new ResponseCheckHandler(loader).execute({
      state: { draft: PASSING_RESPONSE, office_action: officeAction(NOTICE) },
    }))
    expect(output.response_check_report).toContain('规则加载警告：测试警告')
  })

  it('通知书未识别到具体理由时双输入规则无从对照', async () => {
    const output = readOutput(await handler.execute({
      state: {
        draft: PASSING_RESPONSE,
        office_action: officeAction('本通知书随文送达，请按期答复。'),
      },
    }))
    expect(output.response_check_passed).toBe(true)
    expect(output.response_check_unevaluated).toEqual([])
    expect(output.response_check_report).toContain('未识别到具体驳回理由')
  })

  it('office_action 为空串 → 降级', async () => {
    const output = await handler.execute({ state: { draft: PASSING_RESPONSE, office_action: '  ' } })
    expect(degradedReason(output)).toContain('state.office_action 为空')
  })

  it('office_action 的 rejectionTypes 结构损坏 → 降级', async () => {
    for (const value of ['null', '"text"', '{"rejectionTypes":{}}', '{"rejectionTypes":[1]}']) {
      const output = await handler.execute({ state: { draft: PASSING_RESPONSE, office_action: value } })
      expect(degradedReason(output), value).toContain('缺少合法的 rejectionTypes')
    }
  })

  it('office_action_key 或 notice_key 非法 → 降级', async () => {
    const badOfficeAction = await handler.execute({
      state: { draft: PASSING_RESPONSE, office_action_key: ' ' },
    })
    expect(degradedReason(badOfficeAction)).toContain('params.office_action_key')

    const badNotice = await handler.execute({
      state: { draft: PASSING_RESPONSE, notice_key: 1 },
    })
    expect(degradedReason(badNotice)).toContain('params.notice_key')
  })

  it('通知书正文类型错误 → 降级', async () => {
    const output = await handler.execute({ state: { draft: PASSING_RESPONSE, notice: 1 } })
    expect(degradedReason(output)).toContain('state.notice 不是字符串')
  })

  it('规则加载抛出非 Error 时仍降级', async () => {
    const loader: ResponseCheckLoader = () => {
      throw 'asset broken'
    }
    const output = await new ResponseCheckHandler(loader).execute({
      state: { draft: PASSING_RESPONSE, office_action: officeAction(NOTICE) },
    })
    expect(degradedReason(output)).toContain('规则资产加载失败：asset broken')
  })

  it('规则加载警告超过三条时注明总数', async () => {
    const loaded = loadResponseCheckRules()
    const loader: ResponseCheckLoader = () => ({
      rules: loaded.rules,
      missingIds: [],
      warnings: ['w1', 'w2', 'w3', 'w4'],
    })
    const output = readOutput(await new ResponseCheckHandler(loader).execute({
      state: { draft: PASSING_RESPONSE, office_action: officeAction(NOTICE) },
    }))
    expect(output.response_check_report).toContain('规则加载警告：w1；w2；w3 等 4 条')
  })

  it('违规带行号时报告定位到行', async () => {
    const rule: ConstitutionalRule = {
      id: 'CUSTOM-1',
      name: '禁止词',
      severity: 'major',
      action: 'warn',
      legalBasis: '依据文本',
      check: { type: 'keyword_blocklist', keywords: ['禁止词'] },
    }
    const loader: ResponseCheckLoader = () => ({ rules: [rule], missingIds: [], warnings: [] })
    const output = readOutput(await new ResponseCheckHandler(loader).execute({
      state: { draft: '答复第一行。\n答复包含禁止词。' },
    }))
    expect(output.response_check_report).toContain('（依据：依据文本）')
    expect(output.response_check_report).toContain('（第 2 行')
  })

  it('违规没有法律依据与行号时两段说明都省略', async () => {
    const rule: ConstitutionalRule = {
      id: 'CUSTOM-2',
      name: '重复引证',
      severity: 'major',
      action: 'warn',
      check: { type: 'quote_repetition', minLength: 12, minOccurrences: 2 },
    }
    const loader: ResponseCheckLoader = () => ({ rules: [rule], missingIds: [], warnings: [] })
    const quote = '这是一段被重复引用的完整内容'
    const output = readOutput(await new ResponseCheckHandler(loader).execute({
      state: { draft: `“${quote}”……“${quote}”。` },
    }))
    expect(output.response_check_passed).toBe(false)
    expect(output.response_check_report).not.toContain('依据：')
    expect(output.response_check_report).not.toContain('（第 ')
  })
})

describe('loadResponseCheckRules', () => {
  it('资产缺少答复规则时逐个报告缺失编号', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-response-rules-'))
    try {
      const patentDir = join(root, 'patent')
      mkdirSync(patentDir)
      writeFileSync(
        join(patentDir, 'compliance.yaml'),
        'rules:\n  - id: C1\n    name: 其它规则\n    severity: minor\n    action: warn\n    check: { type: keyword_blocklist, keywords: ["x"] }\n',
        'utf8',
      )
      const loaded = loadResponseCheckRules(root)
      expect(loaded.rules).toEqual([])
      expect(loaded.missingIds).toEqual(['PR-OA-007', 'PR-OA-008', 'PR-OA-009'])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
