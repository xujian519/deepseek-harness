import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  loadActivationOverrides,
  loadPatentComplianceRuleSet,
  loadPatentFullRuleSet,
  RuleOutputGate,
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

  it('loadActivationOverrides parses 29 patches with no warnings', () => {
    const ov = loadActivationOverrides()
    expect(ov.source).not.toBeNull()
    expect(ov.byId.size).toBe(29)
    expect(ov.warnings.length).toBe(0)
    expect(ov.byId.get('CON-102')?.action).toBe('review')
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
})
