import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createVerifyDeliverableTool, renderDeliverableResult, verifyDeliverable } from '../src/tool/verify-deliverable.ts'
import type { VerifyDeliverableOutput } from '../src/tool/verify-deliverable.ts'

const ROOT = mkdtempSync(join(tmpdir(), 'dsh-deliverable-'))
afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true })
})

/** Write a file with a fixed mtime (seconds since the epoch). */
function write(path: string, body: string, seconds: number): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
  utimesSync(path, seconds, seconds)
  return path
}

describe('verifyDeliverable', () => {
  it('passes when each artifact matches its delivered copy and nothing precedes the render', () => {
    const dir = join(ROOT, 'clean')
    const canonical = write(join(dir, 'main/权利要求书.md'), '十项权利要求。', 1_000)
    const delivered = write(join(dir, 'batch/权利要求书.md'), '十项权利要求。', 1_000)
    const figure = write(join(dir, 'fig1.svg'), '<svg/>', 1_000)
    const rendered = write(join(dir, 'out.pdf'), '%PDF-1.4', 2_000)
    const out = verifyDeliverable({
      artifacts: [{ role: '权利要求书', canonical_path: canonical, delivered_path: delivered }],
      figures: [figure],
      rendered,
    })
    expect(out.passed).toBe(true)
    expect(out.violations).toEqual([])
    expect(out.manifest.map(m => m.role)).toEqual(['权利要求书', '附图', '渲染件'])
    expect(out.manifest[0]?.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(out.manifest[0]?.mtimeMs).toBe(1_000_000)
  })

  it('reports a main path still holding the superseded text', () => {
    const dir = join(ROOT, 'stale')
    const canonical = write(join(dir, 'main/权利要求书.md'), '十五项权利要求。', 1_000)
    const delivered = write(join(dir, 'batch/权利要求书.md'), '十项权利要求。', 2_000)
    const out = verifyDeliverable({ artifacts: [{ role: '权利要求书', canonical_path: canonical, delivered_path: delivered }] })
    const v = out.violations.find(x => x.rule === 'artifact_mismatch')
    expect(out.passed).toBe(false)
    expect(v?.severity).toBe('error')
    expect(v?.message).toContain('案卷主路径与交付版内容不一致')
    expect(out.manifest).toHaveLength(1)
  })

  it('reports an artifact path that cannot be read, once, naming the role', () => {
    const dir = join(ROOT, 'missing')
    const present = write(join(dir, 'a.md'), '正文。', 1_000)
    const out = verifyDeliverable({
      artifacts: [
        { role: '权利要求书', canonical_path: join(dir, 'absent.md'), delivered_path: present },
        { role: '说明书', canonical_path: present, delivered_path: join(dir, 'absent.md') },
      ],
    })
    expect(out.violations.map(v => v.rule)).toEqual(['artifact_missing', 'artifact_missing'])
    expect(out.violations[0]?.message).toContain('权利要求书')
    expect(out.violations[1]?.message).toContain('说明书')
    expect(out.manifest).toEqual([])
  })

  it('reports an empty artifact list instead of passing vacuously', () => {
    const out = verifyDeliverable({ artifacts: [] })
    expect(out.passed).toBe(false)
    expect(out.violations.map(v => v.rule)).toEqual(['no_artifacts'])
  })

  it('reports a missing drawing', () => {
    const dir = join(ROOT, 'nofig')
    const missingFigure = join(dir, 'fig9.svg')
    const out = verifyDeliverable({ artifacts: [], figures: [missingFigure] })
    expect(out.violations.map(v => v.rule)).toEqual(['no_artifacts', 'figure_missing'])
    expect(out.violations[1]?.message).toContain(missingFigure)
  })

  it('reports a rendered file that cannot be read', () => {
    const dir = join(ROOT, 'norender')
    const out = verifyDeliverable({ artifacts: [], rendered: join(dir, 'out.pdf') })
    expect(out.violations.map(v => v.rule)).toEqual(['no_artifacts', 'rendered_missing'])
  })

  it('reports a render produced before its newest input, naming that input', () => {
    const dir = join(ROOT, 'order')
    const canonical = write(join(dir, 'main/说明书.md'), '说明书。', 1_000)
    const delivered = write(join(dir, 'batch/说明书.md'), '说明书。', 1_000)
    const figure = write(join(dir, 'fig1.svg'), '<svg/>', 5_000)
    const rendered = write(join(dir, 'out.pdf'), '%PDF-1.4', 2_000)
    const out = verifyDeliverable({
      artifacts: [{ role: '说明书', canonical_path: canonical, delivered_path: delivered }],
      figures: [figure],
      rendered,
    })
    const v = out.violations.find(x => x.rule === 'render_order')
    expect(out.passed).toBe(false)
    expect(v?.message).toContain('渲染件早于其输入件')
    expect(v?.message).toContain('附图')
  })

  it('renders the manifest and the violations', () => {
    const dir = join(ROOT, 'render-text')
    const canonical = write(join(dir, 'main/权利要求书.md'), '旧版。', 1_000)
    const delivered = write(join(dir, 'batch/权利要求书.md'), '新版。', 1_000)
    const out = verifyDeliverable({ artifacts: [{ role: '权利要求书', canonical_path: canonical, delivered_path: delivered }] })
    const text = renderDeliverableResult(out)
    expect(text).toContain('交付件核对：未通过')
    expect(text).toContain('## 交付清单')
    expect(text).toContain('## 违规项')
    expect(text).toContain('→ 把交付版复制到主路径并归档旧版')

    const clean = verifyDeliverable({ artifacts: [{ role: '权利要求书', canonical_path: canonical, delivered_path: canonical }] })
    const cleanText = renderDeliverableResult(clean)
    expect(cleanText).toContain('交付件核对：通过')
    expect(cleanText).not.toContain('## 违规项')
  })

  it('renders a violation without a suggestion', () => {
    const text = renderDeliverableResult({
      passed: false,
      manifest: [],
      violations: [{ rule: 'bare', severity: 'error', message: '裸违规' }],
    })
    expect(text).toContain('裸违规')
    expect(text).not.toContain('→')
    expect(text).not.toContain('## 交付清单')
  })
})

describe('createVerifyDeliverableTool', () => {
  it('declares the defineTool shape over the artifact parameters', () => {
    const tool = createVerifyDeliverableTool()
    expect(tool.name).toBe('verify_deliverable')
    expect(tool.description.length).toBeGreaterThan(0)
    const parameters = tool.parameters as { properties?: Record<string, unknown> }
    expect(parameters.properties).toHaveProperty('artifacts')
    expect(parameters.properties).toHaveProperty('figures')
    expect(parameters.properties).toHaveProperty('rendered')
    expect(typeof tool.output.render).toBe('function')
    expect(typeof tool.execute).toBe('function')
  })

  it('checks the artifacts it receives and reports the result', async () => {
    const dir = join(ROOT, 'tool')
    const canonical = write(join(dir, 'main/摘要.md'), '摘要。', 1_000)
    const delivered = write(join(dir, 'batch/摘要.md'), '摘要。', 1_000)
    const tool = createVerifyDeliverableTool()
    const value = (await tool.execute(
      { artifacts: [{ role: '摘要', canonical_path: canonical, delivered_path: delivered }] },
      { signal: new AbortController().signal } as never,
    )) as VerifyDeliverableOutput
    expect(value.passed).toBe(true)
    const blocks = tool.output.render({}, value as never)
    // vitest asymmetric matcher is typed any; the literal text field holds the matcher object
    const textMatcher = expect.stringContaining('交付件核对：通过') as string
    expect(blocks).toEqual([{ type: 'text', text: textMatcher }])
  })
})

describe('verify_deliverable 用户要求逐条核对表', () => {
  it('每条要求给出证据文件即满足，核对表随结果返回', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-deliv-req-'))
    try {
      writeFileSync(join(dir, 'claims.md'), '权利要求书')
      writeFileSync(join(dir, 'check.log'), 'heading_set: 通过')
      const value = verifyDeliverable({
        artifacts: [{ role: '权利要求书', canonical_path: join(dir, 'claims.md'), delivered_path: join(dir, 'claims.md') }],
        requirements: [
          { requirement: '权利要求不超过 10 项', evidence: [join(dir, 'check.log')] },
        ],
      })
      expect(value.passed).toBe(true)
      expect(value.requirements).toEqual([
        { requirement: '权利要求不超过 10 项', evidence: [join(dir, 'check.log')], satisfied: true },
      ])
      const rendered = renderDeliverableResult(value)
      expect(rendered).toContain('## 用户要求逐条核对')
      expect(rendered).toContain('- [满足] 权利要求不超过 10 项 → 证据：')
      expect(rendered).toContain('[证据]')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('没有证据的要求报错并按未满足处理', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-deliv-req-'))
    try {
      writeFileSync(join(dir, 'claims.md'), '权利要求书')
      const value = verifyDeliverable({
        artifacts: [{ role: '权利要求书', canonical_path: join(dir, 'claims.md'), delivered_path: join(dir, 'claims.md') }],
        requirements: [{ requirement: '说明书不得自加标题', evidence: [] }],
      })
      expect(value.passed).toBe(false)
      expect(value.violations.map(v => v.rule)).toContain('requirement_without_evidence')
      expect(value.requirements?.[0]?.satisfied).toBe(false)
      expect(renderDeliverableResult(value)).toContain('（无证据）')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('证据文件不存在时报错；同一证据文件在多条要求下只记一次', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-deliv-req-'))
    try {
      writeFileSync(join(dir, 'claims.md'), '权利要求书')
      writeFileSync(join(dir, 'check.log'), 'ok')
      const value = verifyDeliverable({
        artifacts: [{ role: '权利要求书', canonical_path: join(dir, 'claims.md'), delivered_path: join(dir, 'claims.md') }],
        requirements: [
          { requirement: 'A', evidence: [join(dir, 'nope.log')] },
          { requirement: 'B', evidence: [join(dir, 'check.log')] },
          { requirement: 'C', evidence: [join(dir, 'check.log')] },
        ],
      })
      expect(value.violations.map(v => v.rule)).toContain('requirement_evidence_missing')
      expect(value.requirements?.map(row => row.satisfied)).toEqual([false, true, true])
      expect(value.manifest.filter(record => record.role === '证据')).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('未给 requirements 时结果与渲染都不出现核对表', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-deliv-req-'))
    try {
      writeFileSync(join(dir, 'claims.md'), '权利要求书')
      const value = verifyDeliverable({
        artifacts: [{ role: '权利要求书', canonical_path: join(dir, 'claims.md'), delivered_path: join(dir, 'claims.md') }],
      })
      expect(value.requirements).toBeUndefined()
      expect(renderDeliverableResult(value)).not.toContain('用户要求逐条核对')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('requirements 给空数组时返回空核对表（渲染不出该小节）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-deliv-req-'))
    try {
      writeFileSync(join(dir, 'claims.md'), '权利要求书')
      const value = verifyDeliverable({
        artifacts: [{ role: '权利要求书', canonical_path: join(dir, 'claims.md'), delivered_path: join(dir, 'claims.md') }],
        requirements: [],
      })
      expect(value.requirements).toEqual([])
      expect(renderDeliverableResult(value)).not.toContain('用户要求逐条核对')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
