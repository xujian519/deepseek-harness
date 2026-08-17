import { expect, it } from 'vitest'
import {
  RuleEngine,
  aggregate,
  defaultPatentRules,
  formatRuleResults,
  infringementRules,
  inventivenessRules,
  matchKeyword,
  noveltyRules,
  reasoningPatternRules,
  specRules,
  type RuleCheckResult,
  type Verdict,
} from '@deepseek-ai/dsh-patent-core'

// =============================================================================
// 判级模型（Aggregate）
// =============================================================================

function failure(level: 0 | 1 | 2, passed = false): RuleCheckResult {
  return {
    ruleId: `test-rule-${level}`,
    ruleName: `测试规则${level}`,
    passed,
    level,
    severity: level === 0 ? 'critical' : level === 1 ? 'major' : 'minor',
    message: '测试失败',
    fixSuggestion: '测试建议',
  }
}

it('aggregate: 空结果 → pass', () => {
  expect(aggregate([])).toBe('pass')
})

it('aggregate: Level-0 (Must) 失败 → blocked', () => {
  expect(aggregate([failure(0)])).toBe('blocked')
})

it('aggregate: Level-1 (Should) 失败 → blocked', () => {
  expect(aggregate([failure(1)])).toBe('blocked')
})

it('aggregate: 1-2 条 Level-2 失败 → pass（质量小问题可容忍）', () => {
  expect(aggregate([failure(2)])).toBe('pass')
  expect(aggregate([failure(2), failure(2)])).toBe('pass')
})

it('aggregate: 3 条及以上 Level-2 失败 → needs_revision', () => {
  expect(aggregate([failure(2), failure(2), failure(2)])).toBe('needs_revision')
})

it('aggregate: passed 结果不参与判级', () => {
  expect(aggregate([failure(2, true), failure(2, true)])).toBe('pass')
})

// =============================================================================
// 新颖性规则（单独对比原则）
// =============================================================================

const engine = new RuleEngine()
engine.registerMany(defaultPatentRules())

it('novelty: 违反单独对比原则（多份文件结合）→ 阻断', () => {
  const text = '结合多份对比文件结合，可认定本申请不具备新颖性。'
  const failures = engine.evaluate(text, { rules: noveltyRules() })
  const single = failures.find(f => f.ruleId === 'NOVELTY-SINGLE-COMPARISON')
  expect(single).toBeTruthy()
  expect(single!.level).toBe(0)
  expect(single!.message).toMatch(/单独对比原则/)
})

it('novelty: 规范文本（单独对比+特征覆盖）→ 通过', () => {
  const text =
    '新颖性分析：将权利要求1与对比文件D1进行单独对比。' +
    '逐项比对技术特征，权利要求1的所有技术特征均已被D1公开，故不具备新颖性。'
  const failures = engine.evaluate(text, { rules: noveltyRules() })
  expect(failures).toEqual([])
})

// =============================================================================
// 创造性三步法
// =============================================================================

it('inventiveness: 缺三步法步骤 → 阻断', () => {
  const text = '创造性分析：本领域技术人员有动机结合，故不具备创造性。'
  const failures = engine.evaluate(text, { rules: inventivenessRules() })
  const threeStep = failures.find(f => f.ruleId === 'INVENTIVENESS-THREE-STEP')
  expect(threeStep).toBeTruthy()
  expect(threeStep!.level).toBe(0)
  expect(threeStep!.message).toMatch(/三步法/)
})

it('inventiveness: 三步法齐全 → 通过', () => {
  const text =
    '创造性分析（三步法）：首先确定最接近的现有技术为D1；' +
    '其次，权利要求1相对于D1的区别技术特征为X；' +
    '最后，D2给出了将X应用于D1的技术启示，故不具备创造性。'
  const failures = engine.evaluate(text, { rules: inventivenessRules() })
  expect(failures).toEqual([])
})

// =============================================================================
// 侵权规则（全面覆盖）
// =============================================================================

it('infringement: 缺全面覆盖分析 → 阻断', () => {
  const text = '侵权分析：被控方案的技术特征与权利要求基本相同。'
  const failures = engine.evaluate(text, { rules: infringementRules() })
  const coverage = failures.find(f => f.ruleId === 'INFRINGEMENT-FULL-COVERAGE')
  expect(coverage).toBeTruthy()
  expect(coverage!.level).toBe(0)
})

it('infringement: 全面覆盖+等同+禁止反悔 → 通过', () => {
  const text =
    '侵权分析：将被控方案与权利要求1的技术特征逐一比对（全面覆盖原则），' +
    '特征A构成等同替换；同时审查审查过程修改，不存在禁止反悔情形，亦不适用捐献规则。'
  const failures = engine.evaluate(text, { rules: infringementRules() })
  expect(failures).toEqual([])
})

// =============================================================================
// 同义词扩展与否定检测
// =============================================================================

it('matchKeyword: 同义词扩展命中（现有技术 → 对比文件）', () => {
  expect(matchKeyword('检索到一篇现有技术文献', '对比文件')).toBe(true)
})

it('matchKeyword: 否定语境不误报（未发现区别特征）', () => {
  expect(matchKeyword('未发现区别技术特征', '区别技术特征')).toBe(false)
})

it('matchKeyword: 直接命中返回 true', () => {
  expect(matchKeyword('本申请具备新颖性', '新颖性')).toBe(true)
})

it('matchKeyword: 无关文本返回 false', () => {
  expect(matchKeyword('今天的天气很好', '新颖性')).toBe(false)
})

it('matchKeyword: 扩充否定词表不误报（缺乏/没有/未给出/未记载）', () => {
  // 扩充前这些表述会被当"肯定提及"→ 规则门漏报
  expect(matchKeyword('缺乏创造性', '创造性')).toBe(false)
  expect(matchKeyword('没有新颖性', '新颖性')).toBe(false)
  expect(matchKeyword('无法体现创造性', '创造性')).toBe(false)
  expect(matchKeyword('未给出技术启示', '技术启示')).toBe(false)
  expect(matchKeyword('说明书未记载技术效果', '技术效果')).toBe(false)
  expect(matchKeyword('难以认定具有创造性', '创造性')).toBe(false)
  // 肯定表述仍正常命中（不误伤）
  expect(matchKeyword('本申请具备新颖性', '新颖性')).toBe(true)
  expect(matchKeyword('对比文件未公开该特征，因此具备新颖性', '新颖性')).toBe(true)
})

it('matchKeyword: 双重否定不误判（并非没有/并不缺乏 = 肯定语义）', () => {
  // 窗口含命中词后，嵌目标词的否定模式会命中"并非没有新颖性"——
  // 反否定前缀守卫应将其翻转为肯定（典型紧邻形式）
  expect(matchKeyword('本发明并非没有新颖性', '新颖性')).toBe(true)
  expect(matchKeyword('本申请并不缺乏创造性', '创造性')).toBe(true)
  expect(matchKeyword('该方案并非没有技术启示', '技术启示')).toBe(true)
  // 单纯否定仍判否定（守卫不误放行）
  expect(matchKeyword('本申请没有新颖性', '新颖性')).toBe(false)
  expect(matchKeyword('该方案缺乏技术启示', '技术启示')).toBe(false)
})

// =============================================================================
// 域过滤
// =============================================================================

it('evaluate: 域过滤只评估匹配域的规则', () => {
  const text = '本申请具备新颖性。'
  const filtered = engine.evaluate(text, { domain: 'patent_novelty' })
  const allRules = defaultPatentRules()
  // 过滤后只含 patent_novelty 域规则（PRIORITY/PUBACC 规则 domain 同为 patent_novelty，属 Mady 设计）
  for (const failure of filtered) {
    const rule = allRules.find(r => r.id === failure.ruleId)
    expect(rule?.domain).toBe('patent_novelty')
  }
  // 全量评估结果数 ≥ 域过滤结果数（其余域规则对同一文本也可能失败）
  const full = engine.evaluate(text)
  expect(full.length >= filtered.length).toBeTruthy()
})

it('evaluate: 多域过滤（任一匹配即评估）', () => {
  const text = '本申请具备新颖性。'
  const multi = engine.evaluate(text, { domain: ['patent_novelty', 'patent_disclosure'] })
  const allRules = defaultPatentRules()
  for (const failure of multi) {
    const rule = allRules.find(r => r.id === failure.ruleId)
    expect(rule?.domain === 'patent_novelty' || rule?.domain === 'patent_disclosure').toBeTruthy()
  }
  // 多域结果覆盖两个单域结果（并集）
  const single = engine.evaluate(text, { domain: 'patent_novelty' })
  const singleDisclosure = engine.evaluate(text, { domain: 'patent_disclosure' })
  expect(multi.length >= single.length && multi.length >= singleDisclosure.length).toBeTruthy()
})

it('evaluate: 空串域 = 全部规则（向后兼容）', () => {
  const all = engine.evaluate('本申请具备新颖性。', { domain: '' })
  const none = engine.evaluate('本申请具备新颖性。')
  expect(all.length).toBe(none.length)
})

// =============================================================================
// 注册/查询/移除与报告
// =============================================================================

it('RuleEngine: register/get/remove/all 生命周期', () => {
  const local = new RuleEngine()
  local.registerMany(noveltyRules())
  expect(local.all().length).toBe(noveltyRules().length)
  const id = noveltyRules()[0]!.id
  expect(local.get(id)).toBeTruthy()
  local.remove(id)
  expect(local.get(id)).toBeUndefined()
})

it('evaluate: 空文本触发全部失败，aggregate → blocked', () => {
  const failures = engine.evaluate('', { domain: 'patent_infringement' })
  expect(failures.length > 0).toBeTruthy()
  const verdict: Verdict = aggregate(failures)
  expect(verdict).toBe('blocked')
})

it('formatRuleResults: 通过时输出 Markdown 结论行', () => {
  const md = formatRuleResults([], 'pass')
  expect(md).toMatch(/检查结论: ✅ 通过/)
  expect(md).toMatch(/所有规则检查均通过/)
})

it('formatRuleResults: 失败时输出表格行', () => {
  const md = formatRuleResults(engine.evaluate('', { domain: 'patent_novelty' }), 'blocked')
  expect(md).toMatch(/检查结论: ⛔ 阻断/)
  expect(md).toMatch(/\| 规则 \| 级别 \| 严重度 \| 问题 \| 修改建议 \|/)
})

// =============================================================================
// 推理模式规则（18 模式 × CheckRules = 24 条，PathElements 路径完整性）
// =============================================================================

it('reasoningPatternRules: 24 条且并入 defaultPatentRules', () => {
  expect(reasoningPatternRules().length).toBe(24)
  const all = defaultPatentRules()
  expect(all.some(r => r.id === 'REASON-CREATIVITY-01A')).toBeTruthy()
  expect(all.some(r => r.id === 'REASON-NOVELTY-01A')).toBeTruthy()
  expect(all.some(r => r.id === 'REASON-OTHER-04')).toBeTruthy()
})

it('推理模式: 公知常识路径完整 → 通过', () => {
  const local = new RuleEngine()
  local.registerMany(reasoningPatternRules())
  const text =
    '最接近的现有技术为D1，区别技术特征在于X，该区别特征属于本领域的公知常识/惯用技术手段，' +
    '本领域技术人员无需创造性劳动即可获得（显而易见），故不具备创造性。'
  const failures = local.evaluate(text, { domain: 'patent_inventiveness' })
  expect(!failures.some(f => f.ruleId === 'REASON-CREATIVITY-01A')).toBeTruthy()
})

it('推理模式: 公知常识路径缺步骤 → 阻断并指出缺失步骤', () => {
  const local = new RuleEngine()
  local.registerMany(reasoningPatternRules())
  const text = '最接近的现有技术为D1，区别技术特征在于X，故不具备创造性。'
  const failures = local.evaluate(text, { domain: 'patent_inventiveness' })
  const r = failures.find(f => f.ruleId === 'REASON-CREATIVITY-01A')
  expect(r).toBeTruthy()
  expect(r!.level).toBe(0)
  expect(r!.message).toMatch(/推理路径步骤3不完整/)
})

it('推理模式: 四相同标准路径（单独对比）→ 通过', () => {
  const local = new RuleEngine()
  local.registerMany(reasoningPatternRules())
  const text =
    '新颖性分析：现有技术D1，采用单独对比原则一一对比。技术领域相同、技术问题相同、' +
    '技术方案相同、技术效果相同，故不具备新颖性。'
  const failures = local.evaluate(text, { domain: 'patent_novelty' })
  expect(!failures.some(f => f.ruleId === 'REASON-NOVELTY-01A')).toBeTruthy()
})

it('推理模式: 四相同标准缺步骤 → 阻断', () => {
  const local = new RuleEngine()
  local.registerMany(reasoningPatternRules())
  const failures = local.evaluate('该申请具备新颖性。', { domain: 'patent_novelty' })
  const r = failures.find(f => f.ruleId === 'REASON-NOVELTY-01A')
  expect(r).toBeTruthy()
  expect(r!.level).toBe(0)
})

it('reasoningPatternRules: 4 组条数 = 7/6/5/6 且 id 唯一', () => {
  const rs = reasoningPatternRules()
  const byGroup = (prefix: string) => rs.filter(r => r.id.startsWith(prefix)).length
  expect(byGroup('REASON-CREATIVITY-')).toBe(7)
  expect(byGroup('REASON-NOVELTY-')).toBe(6)
  expect(byGroup('REASON-CLAIMS-')).toBe(5)
  expect(byGroup('REASON-OTHER-')).toBe(6)
  expect(new Set(rs.map(r => r.id)).size).toBe(rs.length)
})

it('推理模式: pathElements 为 string[][] 层级（每步至少命中其一）', () => {
  const rs = reasoningPatternRules()
  const sample = rs.find(r => r.id === 'REASON-CREATIVITY-01A')
  expect(sample).toBeTruthy()
  const steps = sample!.pathElements
  expect(Array.isArray(steps)).toBeTruthy()
  if (!steps) return
  for (const step of steps) {
    expect(Array.isArray(step) && step.length >= 1).toBeTruthy()
  }
  // 抽样其余三组各一条规则，校验嵌套层级
  for (const id of ['REASON-NOVELTY-01A', 'REASON-CLAIMS-01', 'REASON-OTHER-04']) {
    const rule = rs.find(r => r.id === id)
    expect(rule).toBeTruthy()
    if (rule!.pathElements) {
      expect(rule!.pathElements.every(s => Array.isArray(s))).toBeTruthy()
    }
  }
})

// =============================================================================
// 说明书域规则（patent_spec，spec-checklist 规则化）
// =============================================================================

it('spec: specRules 共 8 条并并入 defaultPatentRules', () => {
  expect(specRules().length).toBe(8)
  const all = defaultPatentRules()
  expect(all.some(r => r.id === 'SPEC-SECTIONS')).toBeTruthy()
  expect(all.some(r => r.id === 'SPEC-COMMERCIAL-BAN')).toBeTruthy()
  expect(all.some(r => r.id === 'SPEC-SCOPE-COMPLIANCE')).toBeTruthy()
})

it('spec: 说明书缺少章节 → 阻断', () => {
  const local = new RuleEngine()
  local.registerMany(specRules())
  const failures = local.evaluate('# 技术领域\n本发明涉及机械技术领域。', { domain: 'patent_spec' })
  const sections = failures.find(f => f.ruleId === 'SPEC-SECTIONS')
  expect(sections).toBeTruthy()
  expect(sections!.level).toBe(1)
})

it('spec: 七部分齐全 + 三段式 + 实施例 + 摘要关键词 → 通过', () => {
  const local = new RuleEngine()
  local.registerMany(specRules())
  const text = [
    '# 技术领域',
    '本发明涉及机械技术领域。',
    '# 背景技术',
    '现有技术存在效率低下的问题。',
    '# 发明内容',
    '本发明要解决的技术问题是提高分拣效率。本发明提供如下技术方案：包括壳体与驱动单元。本发明的有益效果是效率提升30%。',
    '# 附图说明',
    '图1为本发明实施例的整体结构示意图。附图标记：1-壳体；2-驱动单元。',
    '# 具体实施方式',
    '实施例1：驱动单元采用伺服电机，转速为1000rpm。',
    '# 摘要',
    '本发明公开了一种分拣装置。关键词：分拣；驱动。',
  ].join('\n')
  const failures = local.evaluate(text, { domain: 'patent_spec' })
  expect(failures).toEqual([])
})

it('spec: 商业宣传禁语 → 阻断', () => {
  const local = new RuleEngine()
  local.registerMany(specRules())
  const failures = local.evaluate('本方案行业领先，效率突出。', { domain: 'patent_spec' })
  const ban = failures.find(f => f.ruleId === 'SPEC-COMMERCIAL-BAN')
  expect(ban).toBeTruthy()
  expect(ban!.message).toMatch(/行业领先/)
})

it('spec: 超范围表述 → 阻断', () => {
  const local = new RuleEngine()
  local.registerMany(specRules())
  const failures = local.evaluate('该特征超出原申请记载范围，需补充说明。', { domain: 'patent_spec' })
  expect(failures.some(f => f.ruleId === 'SPEC-SCOPE-COMPLIANCE')).toBeTruthy()
})

it('spec: 否定语境（未超出原申请）不误报超范围', () => {
  const local = new RuleEngine()
  local.registerMany(specRules())
  const failures = local.evaluate('说明书内容未超出原申请记载范围，符合专利法第33条。', {
    domain: 'patent_spec',
  })
  expect(!failures.some(f => f.ruleId === 'SPEC-SCOPE-COMPLIANCE')).toBeTruthy()
})

it('spec: 无摘要说明书不被 SPEC-SECTIONS 阻断（摘要为 Quality 级检查）', () => {
  const local = new RuleEngine()
  local.registerMany(specRules())
  const text = [
    '# 技术领域',
    '本发明涉及机械技术领域。',
    '# 背景技术',
    '现有技术存在效率低下的问题。',
    '# 发明内容',
    '本发明要解决的技术问题是提高效率。本发明提供如下技术方案：包括驱动单元。本发明的有益效果是效率提升30%。',
    '# 附图说明',
    '图1为本发明实施例的整体结构示意图。附图标记：1-驱动单元。',
    '# 具体实施方式',
    '实施例1：驱动单元采用伺服电机。',
  ].join('\n')
  const failures = local.evaluate(text, { domain: 'patent_spec' })
  expect(!failures.some(f => f.ruleId === 'SPEC-SECTIONS')).toBeTruthy()
  // 摘要缺失只触发 Quality 级 SPEC-ABSTRACT（不阻断）
  expect(failures.some(f => f.ruleId === 'SPEC-ABSTRACT')).toBeTruthy()
})

it('spec: 双重否定（不仅超出）不误判为否定语境', () => {
  const local = new RuleEngine()
  local.registerMany(specRules())
  const failures = local.evaluate('该修改不仅超出原申请记载范围，且引入新内容。', { domain: 'patent_spec' })
  expect(failures.some(f => f.ruleId === 'SPEC-SCOPE-COMPLIANCE')).toBeTruthy()
})

// =============================================================================
// 规则总数与禁语扩充（防止注释失真/禁语漏网）
// =============================================================================

it('defaultPatentRules: 总条数 = 71（core 47 + reasoning 24）', () => {
  const all = defaultPatentRules()
  expect(all.length).toBe(71)
  // 每 3 条规则中约 1 条 Quality 级（粗粒度结构校验：各级别均非空）
  expect(all.some(r => r.level === 0)).toBeTruthy()
  expect(all.some(r => r.level === 1)).toBeTruthy()
  expect(all.some(r => r.level === 2)).toBeTruthy()
  // 规则 id 唯一（注册表按 id 覆盖，重复 id 会静默丢规则）
  const ids = new Set(all.map(r => r.id))
  expect(ids.size).toBe(all.length)
})

it('novelty: 单独对比禁语扩充（对比文件1和2结合）→ 阻断', () => {
  // 扩充前 "对比文件1和2结合" 不在禁语表，可绕过 NOVELTY-SINGLE-COMPARISON
  const text = '将对比文件1和2结合，可认定本申请不具备新颖性。'
  const failures = engine.evaluate(text, { rules: noveltyRules() })
  const single = failures.find(f => f.ruleId === 'NOVELTY-SINGLE-COMPARISON')
  expect(single).toBeTruthy()
  expect(single!.message).toMatch(/单独对比原则/)
})
