import { expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ClaimBinding,
  ConflictDetector,
  EvidenceEngine,
  EvidenceExtension,
  STANDARD_CLEAR_CONVINCING,
  createSpan,
  credibilityToScore,
  determinePublicationDate,
  evaluatePublicIntent,
  extractDateFromText,
  extractWaybackMachineDate,
  inferEvidenceType,
  inferredMonthEnd,
  isBeforeFilingDate,
  loadEvidenceRulesEngine,
  parseDateFlexible,
  platformCategory,
  platformCredibility,
  receiptFromToolExecution,
  type EvidenceSpan,
} from '@deepseek-ai/dsh-patent-core'

function span(overrides: Partial<EvidenceSpan> & { snippet?: string }): EvidenceSpan {
  return createSpan({ snippet: '', direction: 'neutral', ...overrides })
}

// ---------------------------------------------------------------------------
// ClaimBinding：双向映射其余分支
// ---------------------------------------------------------------------------

it('ClaimBinding：重复绑定幂等 / claimsForSpan / 未知键 / clear', () => {
  const binding = new ClaimBinding()
  binding.bind('claim-1', 'span-1')
  binding.bind('claim-1', 'span-1') // 已有 set 的分支（path 2/2）
  binding.bind('claim-2', 'span-1') // 一个证据支持多个结论
  expect(binding.spansForClaim('claim-1')).toEqual(['span-1'])
  expect(binding.spansForClaim('ghost')).toEqual([]) // ?? [] 兜底
  expect(binding.claimsForSpan('span-1').sort()).toEqual(['claim-1', 'claim-2'])
  expect(binding.claimsForSpan('ghost')).toEqual([])
  binding.unbind('claim-2', 'span-1')
  expect(binding.claimsForSpan('span-1')).toEqual(['claim-1'])
  binding.clear()
  expect(binding.spansForClaim('claim-1')).toEqual([])
  expect(binding.claimsForSpan('span-1')).toEqual([])
})

// ---------------------------------------------------------------------------
// ConflictDetector：缺失证据与无来源证据
// ---------------------------------------------------------------------------

it('ConflictDetector：缺失证据实体/无来源证据不报冲突', () => {
  const detector = new ConflictDetector()
  const spansById = new Map<string, EvidenceSpan>([
    ['s1', createSpan({ id: 's1', direction: 'supporting', sourceUri: 'file:///a' })],
  ])
  // s2 出现在 spansByClaim 但不在 spansById → continue
  const spansByClaim = new Map([['c1', ['s1', 's2']]])
  expect(detector.detect({ claimIds: ['c1'], spansByClaim, spansById })).toEqual([])
  // 无 sourceUri 的 span → 跳过同源分组
  const noSource = new Map<string, EvidenceSpan>([
    ['s3', createSpan({ id: 's3', direction: 'supporting' })],
  ])
  expect(detector.detect({ claimIds: [], spansByClaim: new Map(), spansById: noSource })).toEqual([])
})

// ---------------------------------------------------------------------------
// 平台可信度：分级/分类/公开意图
// ---------------------------------------------------------------------------

it('credibilityToScore：全部等级映射', () => {
  expect(credibilityToScore('high')).toBe(0.95)
  expect(credibilityToScore('medium_high')).toBe(0.75)
  expect(credibilityToScore('medium')).toBe(0.55)
  expect(credibilityToScore('low')).toBe(0.25)
})

it('platformCredibility/platformCategory：URI 解析失败回退', () => {
  expect(platformCredibility('not a url')).toBe('low')
  expect(platformCategory('not a url')).toBe('unknown')
})

it('platformCategory：按平台分类（权威/新闻/内容/聚合/社交）', () => {
  expect(platformCategory('web:https://patents.google.com/patent/CN1')).toBe('行业权威平台')
  expect(platformCategory('web:https://www.bbc.com/news')).toBe('正规新闻媒体')
  expect(platformCategory('web:https://mp.weixin.qq.com/s/1')).toBe('内容平台')
  expect(platformCategory('web:https://baidu.com/s')).toBe('搜索/聚合平台')
  expect(platformCategory('web:https://weibo.com/u/1')).toBe('社交/自媒体/未知')
})

it('evaluatePublicIntent：未知主机与付费墙域 restricted', () => {
  expect(evaluatePublicIntent(undefined)).toBe('public')
  expect(evaluatePublicIntent('not a url')).toBe('public')
  expect(evaluatePublicIntent('web:https://www.wsj.com/article')).toBe('restricted')
  expect(evaluatePublicIntent('web:https://www.springer.com/article')).toBe('restricted')
  expect(evaluatePublicIntent('web:https://www.cnipa.gov.cn/x')).toBe('public')
})

// ---------------------------------------------------------------------------
// 日期解析：边界与非法值
// ---------------------------------------------------------------------------

it('parseDateFlexible：空串/非法年月日拒绝', () => {
  expect(parseDateFlexible('   ')).toBeNull() // trim 后为空
  expect(parseDateFlexible('2023-13-01')).toBeNull() // 月 > 12
  expect(parseDateFlexible('2023-00-01')).toBeNull() // 月 < 1
  expect(parseDateFlexible('0000-01-01')).toBeNull() // 年 < 1
  expect(parseDateFlexible('2023-01-00')).toBeNull() // 日 < 1
  expect(parseDateFlexible('2023-01-32')).toBeNull() // 日 > 31
})

it('parseDateFlexible：英文月份名全名缺失回退与非法日期', () => {
  // 全名不在 MONTHS（如 Septe）→ 前三字母回退
  const parsed = parseDateFlexible('Septe 2, 2023')
  expect(parsed?.getUTCFullYear()).toBe(2023)
  expect(parsed?.getUTCMonth()).toBe(8) // September
  expect(parseDateFlexible('Jan 45, 2023')).toBeNull() // 日超界
  expect(parseDateFlexible('Feb 31, 2023')).toBeNull() // 溢出回绕（3 月 3 日）
  expect(parseDateFlexible('Sept 2, 2023')?.getUTCDate()).toBe(2)
})

it('inferredMonthEnd：月级日期推定到月末', () => {
  expect(inferredMonthEnd(parseDateFlexible('2023-01')!)).toBe('2023-01-31')
  expect(inferredMonthEnd(parseDateFlexible('2024-02')!)).toBe('2024-02-29')
})

it('extractWaybackMachineDate：非法 URL 与非法时间戳', () => {
  expect(extractWaybackMachineDate('not a url')).toBe('')
  expect(extractWaybackMachineDate('https://web.archive.org/web/20239999/https://example.com')).toBe('')
  expect(extractWaybackMachineDate('https://example.com/web/20230615/x')).toBe('')
})

it('determinePublicationDate：空输入/不可解析/月级推定', () => {
  const empty = determinePublicationDate(undefined, undefined)
  expect(empty.determined).toBe('unknown')
  expect(empty.reliability).toBe('low')

  const unparseable = determinePublicationDate('not-a-date', 'web:https://example.com')
  expect(unparseable.determined).toBe('unknown')

  const monthOnly = determinePublicationDate('2023-01', 'web:https://example.com')
  expect(monthOnly.determined).toBe('2023-01-31')
  expect(monthOnly.sourceType).toBe('claimed_date')
  expect(monthOnly.isPriorArt).toBe(false)

  const withFiling = determinePublicationDate('2023-01', undefined, '2023-06-01')
  expect(withFiling.isPriorArt).toBe(true)
  expect(withFiling.filingDate).toBe('2023-06-01')

  const english = determinePublicationDate('Jan 15, 2023', undefined, '2023-06-01')
  expect(english.determined).toBe('2023-01-15')
  expect(english.reliability).toBe('high')
  expect(english.sourceType).toBe('exact_page_date')
})

it('isBeforeFilingDate：不可解析日期返回 false', () => {
  expect(isBeforeFilingDate('not-a-date', '2023-06-01')).toBe(false)
  expect(isBeforeFilingDate('2023-01-02', 'not-a-date')).toBe(false)
})

it('extractDateFromText：中文完整/月级/ASCII 与非法回退', () => {
  expect(extractDateFromText('公开日为2023年1月5日，见说明书')).toBe('2023年1月5日')
  expect(extractDateFromText('申请于2023年1月提交')).toBe('2023年1月')
  expect(extractDateFromText('证据日期 2023-01-05 存档')).toBe('2023-01-05')
  expect(extractDateFromText('2023年13月45日')).toBe('') // 全匹配但非法 → 回退
  expect(extractDateFromText('2023年13月')).toBe('') // 月级匹配但非法 → 回退
  expect(extractDateFromText('2023-13-45')).toBe('') // ASCII 匹配但非法
  expect(extractDateFromText('')).toBe('')
  expect(extractDateFromText('无日期描述')).toBe('')
})

// ---------------------------------------------------------------------------
// EvidenceExtension：spanFromReceipt 缺省分支 / registerSpan / listSpans / clear
// ---------------------------------------------------------------------------

it('EvidenceExtension：spanFromReceipt 缺省 snippet/无结果文本/无路径', () => {
  const ext = new EvidenceExtension()
  const bare = ext.spanFromReceipt(
    { toolCallId: 'c', turnId: 't', toolName: 'read_file', args: {}, success: true, startedAt: 'x', write: false },
    'neutral',
  )
  expect(bare.contentHash).toBeUndefined()
  expect(bare.snippet).toBeUndefined()
  expect(bare.sourceUri).toBeUndefined()
  const withSnippet = ext.spanFromReceipt(
    { toolCallId: 'c2', turnId: 't', toolName: 'read_file', args: {}, success: true, startedAt: 'x', resultText: '原文', write: false },
    'supporting',
    '显式摘录',
  )
  expect(withSnippet.snippet).toBe('显式摘录')
  expect(withSnippet.contentHash).toBeTruthy()
})

it('EvidenceExtension：registerSpan/listSpans/bind 未知证据/clear', () => {
  const ext = new EvidenceExtension()
  const imported = createSpan({ id: 'imported-1', snippet: '外部导入', direction: 'supporting' })
  ext.registerSpan(imported)
  expect(ext.listSpans().map(s => s.id)).toEqual(['imported-1'])
  expect(ext.getSpan('imported-1')).toBe(imported)
  ext.bind('claim-1', 'imported-1')
  ext.bind('claim-1', 'unknown-span') // span 不存在 → 不回写 claimRefs
  expect(imported.claimRefs).toEqual(['claim-1'])
  ext.clear()
  expect(ext.listSpans()).toEqual([])
  expect(ext.ledger.size()).toBe(0)
  expect(ext.unbackedClaims(['claim-1'])).toEqual(['claim-1'])
})

// ---------------------------------------------------------------------------
// receiptFromToolExecution：bash 写意图 / 非对象 args
// ---------------------------------------------------------------------------

it('receiptFromToolExecution：bash 写意图判定与 args 兜底', () => {
  const bashWrite = receiptFromToolExecution({
    toolCallId: 'b1', turnId: 't', toolName: 'bash',
    args: { command: 'echo x > /tmp/out.txt' }, success: true, startedAt: 'x',
  })
  expect(bashWrite.write).toBe(true)

  const bashCode = receiptFromToolExecution({
    toolCallId: 'b2', turnId: 't', toolName: 'bash',
    args: { code: 'sed -i s/a/b/ f' }, success: true, startedAt: 'x',
  })
  expect(bashCode.write).toBe(true)

  const bashNoIntent = receiptFromToolExecution({
    toolCallId: 'b3', turnId: 't', toolName: 'bash',
    args: { command: 'echo hi' }, success: true, startedAt: 'x',
  })
  expect(bashNoIntent.write).toBe(false)

  const bashNonString = receiptFromToolExecution({
    toolCallId: 'b4', turnId: 't', toolName: 'bash',
    args: { command: 42 }, success: true, startedAt: 'x',
  })
  expect(bashNonString.write).toBe(false)

  const bashEmpty = receiptFromToolExecution({
    toolCallId: 'b5', turnId: 't', toolName: 'bash',
    args: {}, success: true, startedAt: 'x',
  })
  expect(bashEmpty.write).toBe(false)

  const nonRecord = receiptFromToolExecution({
    toolCallId: 'b6', turnId: 't', toolName: 'read_file',
    args: 'not-an-object', success: true, startedAt: 'x',
  })
  expect(nonRecord.write).toBe(false)
  expect(nonRecord.path).toBeUndefined()

  const noArgs = receiptFromToolExecution({
    toolCallId: 'b7', turnId: 't', toolName: 'read_file',
    args: undefined, success: true, startedAt: 'x',
  })
  expect(noArgs.args).toEqual({})
})

// ---------------------------------------------------------------------------
// 证据引擎：类型特定判定其余分支
// ---------------------------------------------------------------------------

it('inferEvidenceType：notary 前缀与 notariz 子串', () => {
  expect(inferEvidenceType(span({ sourceUri: 'notary:公证文书' }))).toBe('notarial_certificate')
  expect(inferEvidenceType(span({ sourceUri: 'https://x.com/notarized.pdf' }))).toBe('notarial_certificate')
})

it('证据引擎：显式类型覆盖各类型特定分支', () => {
  const engine = new EvidenceEngine()

  const fl = engine.judge(span({ snippet: '外文证据' }), undefined, 'foreign_language')
  expect(fl.typeSpecificJudgment?.translationStatus).toBe('unknown')

  const notary = engine.judge(span({ snippet: '公证' }), undefined, 'notarial_certificate')
  expect(notary.typeSpecificJudgment?.notarizationStatus).toBe('confirmed')

  const witness = engine.judge(span({ snippet: '证人证言' }), undefined, 'witness_testimony')
  expect(witness.typeSpecificJudgment?.witnessCredibility).toBe('medium')

  const ck = engine.judge(span({ snippet: '公知常识' }), undefined, 'common_knowledge')
  expect(ck.typeSpecificJudgment?.exemptionApplied).toBe('无需举证')
  expect(ck.reasoning).toMatch(/公知常识/)

  const priorArt = engine.judge(
    span({ sourceUri: 'web:https://example.com', docVersion: '2022-01-01' }),
    undefined,
    'prior_art_date',
  )
  expect(priorArt.typeSpecificJudgment?.dateDetermination?.determined).toBe('2022-01-01')

  const overseasHash = engine.judge(span({ contentHash: 'h' }), undefined, 'overseas')
  expect(overseasHash.typeSpecificJudgment?.platformCredibility).toBe('high')

  const overseasEmptyHash = engine.judge(span({ contentHash: '' }), undefined, 'overseas')
  expect(overseasEmptyHash.typeSpecificJudgment?.platformCredibility).toBeUndefined()

  const overseasBare = engine.judge(span({}), undefined, 'overseas')
  expect(overseasBare.typeSpecificJudgment?.platformCredibility).toBeUndefined()
})

it('使用公开：日期认定各分支', () => {
  const engine = new EvidenceEngine()
  // 月级 docVersion → 推定月末（精度不足时落 0.7）
  const monthOnly = engine.judge(span({ sourceUri: 'pub_use:x', docVersion: '2023-01' }))
  expect(monthOnly.typeSpecificJudgment?.dateDetermination?.determined).toBe('2023-01-31')
  expect(monthOnly.typeSpecificJudgment?.fourElementsCheck?.timeElement.detail).toMatch(/精度不足/)
  // 不可解析 docVersion → 从 snippet 提取日期
  const fromSnippet = engine.judge(span({ sourceUri: 'pub_use:x', docVersion: '未知', snippet: '2023年1月销售' }))
  expect(fromSnippet.typeSpecificJudgment?.dateDetermination?.determined).toBe('2023年1月')
  expect(fromSnippet.typeSpecificJudgment?.dateDetermination?.sourceType).toBe('inferred')
  // 无 docVersion 无 snippet → 保持 unknown（snippet ?? '' 兜底路径）
  const unknown = engine.judge(createSpan({ sourceUri: 'pub_use:x', direction: 'neutral' }))
  expect(unknown.typeSpecificJudgment?.dateDetermination?.determined).toBe('unknown')
  // 提供 filingDate → isPriorArt 判定
  const withFiling = engine.judge(span({ sourceUri: 'pub_use:x', docVersion: '2023-01-10' }), '2023-06-01')
  expect(withFiling.typeSpecificJudgment?.dateDetermination?.filingDate).toBe('2023-06-01')
  expect(withFiling.typeSpecificJudgment?.dateDetermination?.isPriorArt).toBe(true)
})

it('使用公开四要件：地点/方式/可获取性各分支', () => {
  const engine = new EvidenceEngine()
  // 展览 + 境外
  const exhibition = engine.judge(span({ sourceUri: 'pub_use:x', snippet: '2023年在美国展览演示' }))
  const fe1 = exhibition.typeSpecificJudgment?.fourElementsCheck
  expect(fe1?.placeElement.detail).toMatch(/境外/)
  expect(fe1?.methodElement.detail).toMatch(/展览/)
  // 发布 → publication 方式
  const published = engine.judge(span({ sourceUri: 'pub_use:x', snippet: '2023年1月发布于官网' }))
  expect(published.typeSpecificJudgment?.fourElementsCheck?.methodElement.detail).toMatch(/发布/)
  // 无方式关键词 → 方式不满足；无可获取性关键词 → 推定公开
  const bare = engine.judge(span({ sourceUri: 'pub_use:x', snippet: '2023年1月10日' }))
  const fe3 = bare.typeSpecificJudgment?.fourElementsCheck
  expect(fe3?.methodElement.met).toBe(false)
  expect(fe3?.accessibility.met).toBe(true)
  // 内部测试 → 限于特定范围
  const internal = engine.judge(span({ sourceUri: 'pub_use:x', snippet: '内部测试使用该产品' }))
  expect(internal.typeSpecificJudgment?.fourElementsCheck?.accessibility.met).toBe(false)
  // 四要素齐全 + contentHash → 证据链完整
  const complete = engine.judge(
    span({
      sourceUri: 'pub_use:x', docVersion: '2023-01-10', snippet: '2023年1月10日在上海公开销售', contentHash: 'h',
    }),
  )
  expect(complete.typeSpecificJudgment?.chainIntegrity).toMatch(/完整/)
  // 时间要素不可判 + 无 snippet → 证据链不完整（snippet ?? '' 兜底路径）
  const broken = engine.judge(createSpan({ sourceUri: 'pub_use:x', docVersion: 'not-a-date', direction: 'neutral' }))
  expect(broken.typeSpecificJudgment?.chainIntegrity).toMatch(/证据链不完整/)
  expect(broken.typeSpecificJudgment?.burdenDifficulty).toBe('高')
})

it('举证责任：别名 caseType / 未知类型 / 自定义 burden_holder', () => {
  const engine = new EvidenceEngine()
  expect(engine.assessBurdenOfProof('无效').reasoning).toMatch(/无效宣告/)
  expect(engine.assessBurdenOfProof('侵权').standard).toBe(STANDARD_CLEAR_CONVINCING)
  expect(engine.assessBurdenOfProof('新产品制造方法').hasShifted).toBe(true)
  const unknown = engine.assessBurdenOfProof('unknown-case')
  expect(unknown.burdenHolder).toBe('claimant')
  expect(unknown.reasoning).toMatch(/谁主张谁举证/)
  const overridden = engine.assessBurdenOfProof('infringement', { burden_holder: 'defendant' })
  expect(overridden.burdenHolder).toBe('defendant')
})

it('证明标准：未知标准按置信度宽松放行', () => {
  const engine = new EvidenceEngine()
  const strong = engine.judge(
    span({
      sourceUri: 'web:https://www.cnipa.gov.cn', contentHash: 'a', claimRefs: ['C1'],
      direction: 'supporting', snippet: 'x',
    }),
  )
  const result = engine.assessProofStandard([strong], 'some-other-standard')
  expect(result.met).toBe(true)
  expect(result.reasoning).toMatch(/平均置信度/)
})

it('batchJudge：批量判定', () => {
  const engine = new EvidenceEngine()
  const results = engine.batchJudge([span({ snippet: 'a' }), span({ snippet: 'b' })])
  expect(results.length).toBe(2)
  expect(results[0]?.spanId).toBeTruthy()
})

// ---------------------------------------------------------------------------
// 证据引擎：规则解析与条件评估的剩余分支
// ---------------------------------------------------------------------------

it('loadRules：非法 YAML / 顶层非对象 / 缺 rules 数组', () => {
  const bad = new EvidenceEngine('a: [unclosed')
  expect(bad.getRules().length).toBe(0)
  expect(bad.getWarnings().some(w => w.includes('解析失败'))).toBe(true)

  const arrayRoot = new EvidenceEngine('- just an array')
  expect(arrayRoot.getWarnings().some(w => w.includes('顶层必须是对象'))).toBe(true)

  const noRules = new EvidenceEngine('weights: {}')
  expect(noRules.getWarnings().some(w => w.includes('缺少 rules 数组'))).toBe(true)
  // weights 非数字 → 默认权重（同文件验证）
  expect(noRules.getRules().length).toBe(0)
})

it('规则解析：未知证据类型跳过 / 无 check 规则 / 字段缺省', () => {
  const unknownType = new EvidenceEngine(`
rules:
  - ruleId: X-001
    name: 未知类型规则
    evidenceType: bogus_type
`)
  expect(unknownType.getWarnings().some(w => w.includes('未知证据类型'))).toBe(true)

  const noCheck = new EvidenceEngine(`
weights:
  relevance: 0.35
  legality: 0.3
  authenticity: 0.35
rules:
  - ruleId: EVI-000
    name: 无检查规则
    evidenceType: general
`)
  const j = noCheck.judge(span({ snippet: 'x' }))
  const r = j.rulesApplied.find(x => x.ruleId === 'EVI-000')!
  expect(r.satisfied).toBe(true)
  expect(r.pendingInputs).toEqual([])
  expect(r.failedConditions).toEqual([])
})

it('规则解析：evidenceAssessment 维度/等级与缺省字段', () => {
  const engine = new EvidenceEngine(`
weights:
  relevance: 0.5
  legality: 0.25
  authenticity: 0.25
rules:
  - ruleId: EVI-100
    name: 带评估维度规则
    evidenceType: general
    legalBasis: 专利法第x条
    domain: patent
    evidenceAssessment:
      assessmentType: scored
      exemptions: [无]
      dimensions:
        - name: relevance
          weight: 0.5
          levels:
            - value: high
              score: 0.9
              description: 高
            - value: 123
              score: 0.5
            - value: medium
              score: maybe
            - 42
        - name: bad-dim
          weight: 0.5
          levels: not-an-array
        - not-an-object
  - ruleId: EVI-101
    name: 字段缺省规则
    evidenceType: general
    description: 42
    severity: 1
    action: 2
    check:
      type: 3
      method: 4
    evidenceAssessment: {}
`)
  const rule = engine.getRules().find(r => r.ruleId === 'EVI-100')!
  expect(rule.legalBasis).toBe('专利法第x条')
  expect(rule.domain).toBe('patent')
  const levels = rule.evidenceAssessment?.dimensions?.[0]?.levels
  expect(levels?.[0]?.value).toBe('high')
  expect(levels?.[0]?.score).toBe(0.9)
  expect(levels?.[0]?.description).toBe('高')
  expect(levels?.[1]?.value).toBe('medium') // value: 123 的条目被归一为 '' 后过滤
  expect(levels?.[1]?.score).toBe(0) // 非数字 score → 0
  expect(levels?.length).toBe(2) // value '' 与 42 被过滤

  const rule2 = engine.getRules().find(r => r.ruleId === 'EVI-101')!
  expect(rule2.description).toBe('')
  expect(rule2.severity).toBe('minor')
  expect(rule2.action).toBe('apply')
  expect(rule2.check?.type).toBe('')
  expect(rule2.check?.method).toBe('')
  expect(rule2.evidenceAssessment?.assessmentType).toBe('triple-attribute')
  expect(rule2.evidenceAssessment?.dimensions).toBeUndefined()
})

it('规则条件：全部条件分支与未知条件', () => {
  const engine = new EvidenceEngine(`
weights:
  relevance: 0.35
  legality: 0.3
  authenticity: 0.35
rules:
  - ruleId: EVI-200
    name: 全条件规则
    evidenceType: general
    check:
      type: multi
      method: conditional
      conditions:
        - evidence_has_claim_refs
        - evidence_direction_clear
        - evidence_source_identified
        - evidence_content_hash_available
        - evidence_provenance_clear
        - publication_date_available
        - filing_date_available
        - evidence_legalized
        - evidence_witness_disclosed
        - fact_is_well_known
        - fact_is_uncontested
        - deadline_defined
        - submission_within_deadline
        - unknown_condition
`)
  const full = engine.judge(
    span({
      claimRefs: ['C1'], direction: 'supporting', sourceUri: 'web:https://x.com',
      contentHash: 'h', docVersion: '2023-01-01', snippet: 'x',
    }),
    '2023-06-01',
    undefined,
    {
      legalized: true, witnessDisclosed: true, isWellKnown: true, isUncontested: true,
      deadlineDefined: true, submissionWithinDeadline: true,
    },
  )
  const r = full.rulesApplied.find(x => x.ruleId === 'EVI-200')!
  expect(r.pendingInputs).toEqual(['unknown_condition'])
  expect(r.failedConditions).toEqual([])

  const bare = engine.judge(span({ direction: 'neutral' }))
  const r2 = bare.rulesApplied.find(x => x.ruleId === 'EVI-200')!
  expect(r2.failedConditions.length).toBeGreaterThan(0)

  const contradicting = engine.judge(span({ direction: 'contradicting', docVersion: '2023-01-01' }))
  const r3 = contradicting.rulesApplied.find(x => x.ruleId === 'EVI-200')!
  expect(r3.failedConditions).toContain('evidence_source_identified')
})

it('综合评分：权重全零时回退 0.5', () => {
  const engine = new EvidenceEngine(`
weights:
  relevance: 0
  legality: 0
  authenticity: 0
rules: []
`)
  const j = engine.judge(span({ snippet: 'x' }))
  expect(j.overallScore).toBe(0.5)
})

it('loadEvidenceRulesEngine：证据规则路径为目录时读文件失败', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-rules-dir-'))
  mkdirSync(join(dir, 'evidence-rules.yaml'))
  try {
    const { engine, source, warnings } = loadEvidenceRulesEngine([dir])
    expect(source).toBeNull()
    expect(engine.getRules().length).toBe(0)
    expect(warnings.some(w => w.includes('加载失败'))).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

it('loadEvidenceRulesEngine：规则文件不存在时继续下一个目录', () => {
  const dir = mkdtempSync(join(tmpdir(), 'evidence-rules-empty-'))
  try {
    const { source, warnings } = loadEvidenceRulesEngine([dir])
    expect(source).toBeNull()
    expect(warnings.some(w => w.includes('未找到证据规则资产'))).toBe(true)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
