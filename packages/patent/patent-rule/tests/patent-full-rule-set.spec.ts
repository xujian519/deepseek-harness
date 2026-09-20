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
  RuleOutputGate,
  type PatentComplianceLoadResult,
} from '@deepseek-ai/dsh-patent-rule'

describe('patent full rule set', () => {
  it('loadPatentFullRuleSet merges compliance + nuo full rule set (4 + 96 = 100 rules)', () => {
    const loaded = loadPatentFullRuleSet()
    expect(loaded.source).not.toBeNull()
    expect(loaded.ruleSet.rules.length).toBe(100)
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

  it('scope differs: patent keeps 4 rules, patent-full keeps 100', () => {
    const patent = loadPatentComplianceRuleSet()
    const full = loadPatentFullRuleSet()
    expect(patent.ruleSet.rules.length).toBe(4)
    expect(full.ruleSet.rules.length).toBe(100)
  })

  it('loadActivationOverrides parses 31 patches with no warnings', () => {
    const ov = loadActivationOverrides()
    expect(ov.source).not.toBeNull()
    expect(ov.byId.size).toBe(31)
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

  it('补丁无可识别字段 → 告警（避免空条目被当成生效的评审结论）', () => {
    withTempOverrides(
      ['overrides:', '  CON-102:', '    reason: "只有 reason，没有处置"', ''].join('\n'),
      (loaded) => {
        expect(loaded.warnings.some(w => w.includes('CON-102') && w.includes('无有效字段'))).toBe(true)
      },
    )
  })
})
