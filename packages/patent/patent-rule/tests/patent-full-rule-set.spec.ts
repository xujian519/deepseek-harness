import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  evaluateText,
  loadActivationOverrides,
  loadPatentComplianceRuleSet,
  loadPatentFullRuleSet,
  parseRuleSetFromYaml,
  patentAssetDir,
  patentCaseDomains,
  RuleOutputGate,
  selectGateRules,
  type PatentComplianceLoadResult,
} from '@deepseek-ai/dsh-patent-rule'

describe('patent full rule set', () => {
  it('loadPatentFullRuleSet merges compliance + nuo assets + merged gap assets (4 + 96 + 20 = 120 rules)', () => {
    const loaded = loadPatentFullRuleSet()
    expect(loaded.source).not.toBeNull()
    expect(loaded.ruleSet.rules.length).toBe(120)
    const ids = new Set(loaded.ruleSet.rules.map(r => r.id))
    expect(ids.has('PAT-RISK-001')).toBe(true)
    expect(ids.has('CON-COMP-0101')).toBe(true)
    expect(ids.has('PR-OA-001')).toBe(true)
  })

  it('activation overrides downgrade block → review/warn/log', () => {
    const { ruleSet } = loadPatentFullRuleSet()
    const byId = new Map(ruleSet.rules.map(r => [r.id, r]))
    expect(byId.get('CON-COMP-0101')?.action).toBe('block')
    expect(byId.get('X-REF-003')?.action).toBe('block')
    expect(byId.get('CON-102')?.action).toBe('review')
    expect(byId.get('EX-CLM-001')?.action).toBe('warn')
    expect(byId.get('EX-SEL-004')?.action).toBe('warn')
    expect(byId.get('EX-DIS-002')?.action).toBe('warn')
    expect(byId.get('CON-401')?.action).toBe('warn')
    expect(byId.get('CON-301')?.action).toBe('log')
    expect(byId.get('CON-COMP-0104')?.action).toBe('log')
    expect(byId.get('PR-OA-002')?.action).toBe('log')
  })

  it('override only changes action, keeping name/check fields (field-level merge)', () => {
    const { ruleSet } = loadPatentFullRuleSet()
    const byId = new Map(ruleSet.rules.map(r => [r.id, r]))
    const con102 = byId.get('CON-102')
    expect(con102?.action).toBe('review')
    expect(con102?.name).toBe('禁止编造对比文件')
    expect(con102?.check.type).toBe('keyword_blocklist')
    expect(Array.isArray((con102?.check as { keywords?: string[] }).keywords)).toBe(true)
  })

  it('patent-full is consumable by RuleOutputGate: placeholder hit → needsApproval', () => {
    const { ruleSet } = loadPatentFullRuleSet()
    const gate = new RuleOutputGate(ruleSet)
    const hit = gate.process('现有技术 CNXXXXXX 公开了一种方法。')
    expect(hit.blockHits).toContain('CON-COMP-0101')
    expect(hit.needsApproval).toBe(true)
    const clean = gate.process('现有技术 CN201910123456A 公开了一种方法。')
    expect(clean.blockHits).not.toContain('CON-COMP-0101')
  })

  it('scope differs: patent keeps 4 rules, patent-full keeps 120', () => {
    const patent = loadPatentComplianceRuleSet()
    const full = loadPatentFullRuleSet()
    expect(patent.ruleSet.rules.length).toBe(4)
    expect(full.ruleSet.rules.length).toBe(120)
  })

  it('loadActivationOverrides parses 90 patches with no warnings', () => {
    const ov = loadActivationOverrides()
    expect(ov.source).not.toBeNull()
    expect(ov.byId.size).toBe(90)
    expect(ov.warnings.length).toBe(0)
    expect(ov.byId.get('CON-102')?.action).toBe('review')
    // check 级增补（2026-09-16 语义增强）与 action 整替换共存于同一份补丁表。
    expect(ov.byId.get('EX-SEL-004')?.negationContext).toBe(true)
    expect(ov.byId.get('EX-SEL-004')?.additionalNegationWords).toEqual(['防', '反', '抑制', '检测'])
    expect(ov.byId.get('X-REF-003')?.addKeywords?.length).toBe(3)
    expect(ov.byId.get('IPC-GEN-INV-002')?.action).toBe('log')
  })

  it('a broken nuo file does not block loading (skipped with a warning)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'sati-rules-'))
    const patentDir = join(tmp, 'patent')
    try {
      mkdirSync(patentDir)
      writeFileSync(
        join(patentDir, 'compliance.yaml'),
        'rules:\n  - id: PAT-X\n    name: x\n    severity: minor\n    action: warn\n    check: { type: keyword_blocklist, keywords: ["x"] }\n',
        'utf8',
      )
      writeFileSync(join(patentDir, 'nuo-patent-law.yaml'), 'rules: [ { id: 坏\n', 'utf8')
      const loaded = loadPatentFullRuleSet(tmp)
      expect(loaded.ruleSet.rules.length).toBeGreaterThan(0)
      expect(loaded.warnings.some(w => w.includes('规则资产加载失败') || w.includes('nuo'))).toBe(true)
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  // -------------------------------------------------------------------------
  // 补丁结构性问题必须可见：「评审写了但没生效」此前是静默的
  //   （非 action 字段一律被忽略、引用不存在的 id 一律被忽略）
  // -------------------------------------------------------------------------

  /**
   * 用临时 rulesDir 注入一份自造 activation-overrides.yaml，跑 body 后清理。
   *
   * 与 Sati 的 SATI_RULES_DIR 版不同：dsh 的 `rulesDir` 完全替换包内资产根，
   * 且不向仓库根 walk（见 asset-location.ts），故 nuo 文件必须整目录拷贝——
   * 否则「补丁引用 CON-102 等既有 id」的用例会因规则不存在而误告警。
   */
  function withTempOverrides(body: string, run: (loaded: PatentComplianceLoadResult) => void): void {
    const tmp = mkdtempSync(join(tmpdir(), 'dsh-overrides-'))
    const patentDir = join(tmp, 'patent')
    try {
      cpSync(patentAssetDir(), patentDir, { recursive: true })
      writeFileSync(join(patentDir, 'activation-overrides.yaml'), body, 'utf8')
      run(loadPatentFullRuleSet(tmp))
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  it('语义增强补丁（#357）落地：check 级键为增补语义，不改动生成物', () => {
    const { ruleSet, warnings } = loadPatentFullRuleSet()
    expect(warnings).toEqual([])
    const byId = new Map(ruleSet.rules.map(r => [r.id, r]))

    // ① X-REF-003：追加变体关键词，原有 3 条保留（增补而非替换）
    const xref = byId.get('X-REF-003')
    expect(xref?.check.type).toBe('keyword_blocklist')
    const xrefKeywords = xref?.check.type === 'keyword_blocklist' ? xref.check.keywords : []
    expect(xrefKeywords.length).toBe(6)
    expect(xrefKeywords).toContain('(202X)最高法知民终')
    expect(xrefKeywords).toContain('(202X)最高法知民终|（202X）最高法知民终|(202x)最高法知民终|（202x）最高法知民终')

    // ② EX-SEL-004：开否定语境 + 4 个领域放行词（默认词表在代码侧，补丁只追加）
    const exSel = byId.get('EX-SEL-004')
    expect(exSel?.action).toBe('warn')
    expect(exSel?.check.type).toBe('keyword_blocklist')
    if (exSel?.check.type === 'keyword_blocklist') {
      expect(exSel.check.negationContext).toBe(true)
      expect(exSel.check.additionalNegationWords).toEqual(['防', '反', '抑制', '检测'])
    }

    // ③ IPC-GEN-INV-002：去重降级，与重复项 EX-INV-007 的处置方向一致（保留前者 warn）
    expect(byId.get('IPC-GEN-INV-002')?.action).toBe('log')
    expect(byId.get('EX-INV-007')?.action).toBe('warn')
  })

  it('rule 级 additionalNegationWords：两键正交（开开关才生效，缺开关显式告警）', () => {
    const withFlag = parseRuleSetFromYaml(
      [
        'rules:',
        '  - id: T-NEG-001',
        '    name: 领域放行词样本',
        '    severity: major',
        '    action: warn',
        '    check:',
        '      type: keyword_blocklist',
        '      keywords: ["窃听"]',
        '      negationContext: true',
        '      additionalNegationWords: ["防"]',
        '',
      ].join('\n'),
    )
    expect(withFlag.issues).toEqual([])
    expect(evaluateText('本发明提供一种防窃听装置。', withFlag.ruleSet).violations.length).toBe(0)
    expect(evaluateText('本发明提供一种窃听装置。', withFlag.ruleSet).violations.length).toBe(1)

    // 缺开关 ⇒ 词表不生效，且必须在加载期可见（否则是"声明了却不生效"的死配置）
    const withoutFlag = parseRuleSetFromYaml(
      [
        'rules:',
        '  - id: T-NEG-002',
        '    name: 领域放行词样本（缺开关）',
        '    severity: major',
        '    action: warn',
        '    check:',
        '      type: keyword_blocklist',
        '      keywords: ["窃听"]',
        '      additionalNegationWords: ["防"]',
        '',
      ].join('\n'),
    )
    expect(
      withoutFlag.issues.some(i => i.message.includes('T-NEG-002') && i.message.includes('negationContext')),
    ).toBe(true)
    expect(evaluateText('本发明提供一种防窃听装置。', withoutFlag.ruleSet).violations.length).toBe(1)
  })

  it('补丁引用不存在的 id → 告警（拼错 id 不再静默失效）', () => {
    withTempOverrides(
      ['overrides:', '  NO-SUCH-RULE:', '    action: log', '    reason: "拼错的 id"', ''].join('\n'),
      (loaded) => {
        expect(loaded.warnings.some(w => w.includes('NO-SUCH-RULE') && w.includes('无此 id'))).toBe(true)
      },
    )
  })

  it('补丁未知键 → 告警（拼错键名不再静默失效），已知键仍生效', () => {
    withTempOverrides(
      ['overrides:', '  CON-102:', '    action: review', '    addKeyword: ["x"]', '    reason: "键名拼错"', ''].join(
        '\n',
      ),
      (loaded) => {
        expect(loaded.warnings.some(w => w.includes('CON-102') && w.includes('未知键') && w.includes('addKeyword'))).toBe(
          true,
        )
        expect(loaded.ruleSet.rules.find(r => r.id === 'CON-102')?.action).toBe('review')
      },
    )
  })

  it('check 级补丁打在非 keyword_blocklist 规则上 → 告警并忽略，规则保持原样', () => {
    withTempOverrides(
      ['overrides:', '  IPC-GEN-INV-001:', '    addKeywords: ["事后诸葛亮"]', '    reason: "结构规则不支持关键词增补"', ''].join(
        '\n',
      ),
      (loaded) => {
        expect(
          loaded.warnings.some(w => w.includes('IPC-GEN-INV-001') && w.includes('仅支持 keyword_blocklist')),
        ).toBe(true)
        expect(loaded.ruleSet.rules.find(r => r.id === 'IPC-GEN-INV-001')?.check.type).toBe('structural_analysis')
      },
    )
  })

  it('补丁增补词表但未开开关 → 告警（与资产校验同一条判据）', () => {
    withTempOverrides(
      ['overrides:', '  EX-SEL-004:', '    additionalNegationWords: ["防"]', '    reason: "只写了词表，没开开关"', ''].join(
        '\n',
      ),
      (loaded) => {
        expect(loaded.warnings.some(w => w.includes('EX-SEL-004') && w.includes('negationContext'))).toBe(true)
      },
    )
  })

  // -------------------------------------------------------------------------
  // 适用前提评审（2026-09-30，26.3 答复自检事故）
  //   事故形态：一份只讨论 26.3 的答复在 rule_check(scope='patent-oa-response')
  //   下返回 49 条命中，其中 48 条来自「该答复根本没讨论的主题」的完整性规则。
  // -------------------------------------------------------------------------

  /** 一份只讨论 26.3（充分公开）的答复主干：不提新颖性/创造性/权项撰写等主题。 */
  const DISCLOSURE_ONLY_ANSWER = [
    '审查员认为本申请说明书公开不充分，不符合专利法第二十六条第三款的规定。',
    '申请人认为，根据说明书的记载，本领域技术人员能够实现该技术方案。',
    '说明书具体实施方式部分记载了喷漆、烘干时间的具体控制方式，附图1示出了整体结构，实施例给出了完整工艺参数。',
    '因此本申请符合专利法第二十六条第三款的规定。',
  ].join('')

  /** 与事故无关主题的规则族：这些规则在这份答复上必须保持沉默。 */
  const UNTOUCHED_FAMILIES = [
    ['新颖性', ['EX-NOV-001', 'EX-NOV-003', 'EX-NOV-004', 'EX-NOV-005', 'CON-103', 'P-NOV-001', 'P-NOV-002', 'P-NOV-003', 'PR-OA-004']],
    ['创造性', ['EX-INV-004', 'EX-INV-005', 'EX-INV-006', 'CON-104', 'CON-401', 'CON-402', 'CON-601', 'P-INV-004', 'PR-OA-003', 'IPC-GEN-INV-003']],
    ['权利要求撰写形态', ['PR-CLM-001', 'PR-CLM-002', 'PR-CLM-003', 'PR-CLM-004', 'PR-CLM-005', 'PR-CLM-006', 'PR-FMT-003', 'EX-CLM-004', 'EX-CLM-005']],
    ['不授予专利权客体', ['EX-SEL-001', 'EX-SEL-002', 'EX-SEL-003', 'EX-SEL-005']],
    ['其他主题（程序/摘要/生物/权属/判例）', ['EX-CMP-001', 'EX-CMP-002', 'EX-CMP-003', 'EX-SPEC-002', 'EX-SPEC-003', 'EX-PRC-002', 'P-PRC-003', 'JD-PRC-003', 'JD-PRC-004', 'JD-PRC-005', 'JD-OWN-001', 'JD-OWN-002']],
  ] as const

  it('前提评审落地：只讨论 26.3 的答复不触发无关主题的完整性规则', () => {
    const { ruleSet } = loadPatentFullRuleSet()
    const domains = patentCaseDomains('patent-oa-response')
    expect(domains).toBeDefined()
    const ids = new Set(
      evaluateText(DISCLOSURE_ONLY_ANSWER, ruleSet, undefined, { domain: domains ?? [] }).violations.map(v => v.ruleId),
    )
    for (const [family, members] of UNTOUCHED_FAMILIES) {
      const hit = members.filter(id => ids.has(id))
      expect(hit, `${family} 族不应在只讨论 26.3 的答复上命中`).toEqual([])
    }
  })

  it('无关主题族清单与规则集同步：每个成员 id 都必须存在', () => {
    const { ruleSet } = loadPatentFullRuleSet()
    const known = new Set(ruleSet.rules.map(r => r.id))
    for (const [family, members] of UNTOUCHED_FAMILIES) {
      const missing = members.filter(id => !known.has(id))
      expect(missing, `${family} 族的成员 id 在规则集中不存在`).toEqual([])
    }
  })

  it('前提是主题词表而非全局静音：答复一旦讨论创造性，创造性族的完整性检查回归', () => {
    const { ruleSet } = loadPatentFullRuleSet()
    const domains = patentCaseDomains('patent-oa-response')
    expect(domains).toBeDefined()
    const withInventiveness = `${DISCLOSURE_ONLY_ANSWER}审查员还认为本申请不具备创造性。`
    const ids = new Set(
      evaluateText(withInventiveness, ruleSet, undefined, { domain: domains ?? [] }).violations.map(v => v.ruleId),
    )
    expect(ids.has('CON-104')).toBe(true)
    expect(ids.has('EX-INV-001')).toBe(true)
  })

  it('前提不改变规则本身：patent-full（无域过滤）仍按主题评估同一批规则', () => {
    const { ruleSet } = loadPatentFullRuleSet()
    const ids = new Set(evaluateText(DISCLOSURE_ONLY_ANSWER, ruleSet).violations.map(v => v.ruleId))
    expect(ids.has('CON-104')).toBe(false)
    expect(ids.has('EX-NOV-001')).toBe(false)
  })

  it('引述豁免落地：审查员原话里的「一定」不判本模型违规，引号外的照常判', () => {
    const { ruleSet } = loadPatentFullRuleSet()
    const ids = (text: string): string[] => evaluateText(text, ruleSet).violations.map(v => v.ruleId)
    expect(ids('审查员认为「该参数一定能够提高效率」，申请人认为该认定缺乏依据。')).not.toContain('PAT-ABS-001')
    expect(ids('该参数一定能够提高效率。')).toContain('PAT-ABS-001')
  })

  it('权利要求书产物形态前提：答复引述权项不触发撰写形态规则，携带权项书则恢复', () => {
    const { ruleSet } = loadPatentFullRuleSet()
    const domains = patentCaseDomains('patent-oa-response')
    expect(domains).toBeDefined()
    const ids = (text: string): string[] =>
      evaluateText(text, ruleSet, undefined, { domain: domains ?? [] }).violations.map(v => v.ruleId)
    // 引述「权利要求1记载了…」是论证，不是撰写形态
    expect(ids('申请人认为权利要求1记载的技术方案未被公开。')).not.toContain('PR-CLM-002')
    // 答复携带修改后的权利要求书 → 撰写形态规则恢复评估
    expect(ids('修改后的权利要求书如下：\n1. 一种喷漆装置，其特征在于，包括喷头。')).toContain('PR-CLM-002')
    // 直接粘贴的权项清单（无「权利要求书」字样）按编号行起首词识别为产物
    expect(ids('1. 一种喷漆装置，包括喷头。')).toContain('PR-CLM-001')
  })

  it('编号列举不复活撰写形态规则：编号行起首须是权项写法', () => {
    const { ruleSet } = loadPatentFullRuleSet()
    const domains = patentCaseDomains('patent-oa-response')
    const numbered = `${DISCLOSURE_ONLY_ANSWER}\n1. 首先，说明书公开了完整工艺参数。`
    const ids = new Set(
      evaluateText(numbered, ruleSet, undefined, { domain: domains ?? [] }).violations.map(v => v.ruleId),
    )
    for (const [family, members] of UNTOUCHED_FAMILIES) {
      const hit = members.filter(id => ids.has(id))
      expect(hit, `${family} 族不应因编号列举恢复命中`).toEqual([])
    }
  })

  it('答复形式规则（PR-OA-005/006/007）随 patent-full 一并加载，且只作用于答复域', () => {
    const { ruleSet } = loadPatentFullRuleSet()
    const byId = new Map(ruleSet.rules.map(r => [r.id, r]))
    for (const id of ['PR-OA-005', 'PR-OA-006', 'PR-OA-007']) {
      expect(byId.get(id)?.domain).toBe('patent_oa_response')
      expect(byId.get(id)?.action).toBe('warn')
    }
    expect(byId.get('PR-OA-005')?.check.type).toBe('pattern_analysis')
    expect(byId.get('PR-OA-006')?.check).toEqual({ type: 'quote_repetition', minLength: 12, minOccurrences: 2 })
    // 答复形式规则不进输出门禁（门禁只取 keyword_blocklist）
    expect(selectGateRules(ruleSet).rules.some(r => r.id === 'PR-OA-006')).toBe(false)
  })

  it('前提词表与顶层键校验：写错的前提必须可见，不能只剩「规则不生效」', () => {
    withTempOverrides(
      [
        'version: "1.0"',
        'premise-vocab:',
        '  broken: ["(未闭合"]',
        '  blank: ["  "]',
        'unknown-section: {}',
        'overrides:',
        '  CON-102:',
        '    premise: []',
        '    reason: "空前提"',
        '',
      ].join('\n'),
      (loaded) => {
        expect(loaded.warnings.some(w => w.includes('premise-vocab.broken'))).toBe(true)
        expect(loaded.warnings.some(w => w.includes('premise-vocab.blank'))).toBe(true)
        expect(loaded.warnings.some(w => w.includes('unknown-section') && w.includes('未知顶层键'))).toBe(true)
        expect(loaded.warnings.some(w => w.includes('CON-102') && w.includes('premise'))).toBe(true)
        // 整条跳过：premise 不会被应用（规则只剩资产原值——本用例的补丁文件替换了随包
        // 补丁表，故 CON-102 保持资产里的 block，而不是随包评审的 review）
        const con102 = loaded.ruleSet.rules.find(r => r.id === 'CON-102')
        expect(con102?.action).toBe('block')
        expect(con102?.premise).toBeUndefined()
      },
    )
  })

  it('补丁 premise 生效：把规则限定到主题词表', () => {
    withTempOverrides(
      [
        'overrides:',
        '  CON-401:',
        '    premise:',
        '      - "创造性"',
        '    reason: "只在该主题下评估"',
        '',
      ].join('\n'),
      (loaded) => {
        expect(loaded.warnings).toEqual([])
        expect(loaded.ruleSet.rules.find(r => r.id === 'CON-401')?.premise).toEqual(['创造性'])
      },
    )
  })

  it('补丁无可识别字段 → 告警（避免空条目被当成生效的评审结论）', () => {
    withTempOverrides(
      ['overrides:', '  CON-102:', '    reason: "只有 reason，没有处置"', ''].join('\n'),
      (loaded) => {
        expect(loaded.warnings.some(w => w.includes('CON-102') && w.includes('无有效字段'))).toBe(true)
      },
    )
  })
})
