import { describe, expect, it } from 'vitest'
import { compareFigureAnalysis } from '../src/figure/figure-comparison.ts'
import type { FigureComparisonSide } from '../src/figure/figure-comparison.ts'

/** 期望 vs 识图：缺标、多标、名称不符与图型不符的确定性口径。 */

function side(figureType: string | undefined, components: [string, string][]): FigureComparisonSide {
  return {
    ...(figureType === undefined ? {} : { figureType }),
    components: components.map(([refNumber, name]) => ({ refNumber, name })),
  }
}

describe('compareFigureAnalysis', () => {
  it('两侧一致时通过', () => {
    const report = compareFigureAnalysis({
      expected: side('flowchart', [['10', '壳体'], ['20', '盖板']]),
      actual: side('flowchart', [['20', '盖板'], ['10', '壳体']]),
    })
    expect(report.consistent).toBe(true)
    expect(report.findings).toEqual([])
    expect(report.expectedCount).toBe(2)
    expect(report.actualCount).toBe(2)
    expect(report.summary).toContain('图文比对通过')
  })

  it('缺标与多标分别报出，按标号数值排序', () => {
    const report = compareFigureAnalysis({
      expected: side(undefined, [['10', '壳体'], ['2', '底座'], ['', '']]),
      actual: side(undefined, [['2', '底座'], ['30', '转轴']]),
    })
    expect(report.consistent).toBe(false)
    expect(report.findings.map(finding => [finding.check, finding.ref])).toEqual([
      ['missing-mark', '10'],
      ['unexpected-mark', '30'],
    ])
    expect(report.findings[0]?.message).toContain('标号 10（壳体）')
    expect(report.summary).toContain('缺标 1 个')
    expect(report.summary).toContain('多标 1 个')
  })

  it('缺标一侧名称为空时消息不带括号', () => {
    const report = compareFigureAnalysis({
      expected: side(undefined, [['10', '']]),
      actual: side(undefined, []),
    })
    expect(report.findings[0]?.message).toBe('标号 10 在期望中出现，但识图未识别到')
  })

  it('名称只在两侧都非空且不同时算不符', () => {
    const report = compareFigureAnalysis({
      expected: side(undefined, [['10', '壳体'], ['20', '盖板'], ['30', '']]),
      actual: side(undefined, [['10', '底座'], ['20', '盖板'], ['30', '转轴']]),
    })
    expect(report.findings.map(finding => finding.check)).toEqual(['name-mismatch'])
    expect(report.findings[0]?.message).toContain('期望「壳体」，识图为「底座」')
    expect(report.summary).toContain('名称不符 1 个')
  })

  it('图型规范化后相同不报，不同时报在图型不符且排在最前', () => {
    const same = compareFigureAnalysis({
      expected: side('FlowChart', [['10', '壳体']]),
      actual: side(' flowchart ', [['10', '壳体']]),
    })
    expect(same.findings).toEqual([])

    const mismatch = compareFigureAnalysis({
      expected: side('flowchart', [['10', '壳体']]),
      actual: side('block_diagram', []),
    })
    expect(mismatch.findings[0]).toMatchObject({ check: 'figure-type-mismatch', ref: '' })
    expect(mismatch.summary).toContain('图型不符')
  })

  it('任一侧缺图型或两侧都为空串时不判图型', () => {
    for (const [expectedType, actualType] of [
      [undefined, 'flowchart'],
      ['flowchart', undefined],
      ['', 'flowchart'],
      ['flowchart', '  '],
    ] as const) {
      const report = compareFigureAnalysis({
        expected: side(expectedType, [['10', '壳体']]),
        actual: side(actualType, [['10', '壳体']]),
      })
      expect(report.findings).toEqual([])
    }
  })

  it('同一标号重复出现时保留第一个非空名称', () => {
    const report = compareFigureAnalysis({
      expected: side(undefined, [['10', ''], ['10', '壳体'], ['10', '另一个壳体']]),
      actual: side(undefined, [['10', '壳体']]),
    })
    expect(report.consistent).toBe(true)
    expect(report.expectedCount).toBe(1)
  })

  it('重复标号先有名称后空时保留已有名称', () => {
    const report = compareFigureAnalysis({
      expected: side(undefined, [['10', '壳体'], ['10', '']]),
      actual: side(undefined, [['10', '壳体']]),
    })
    expect(report.findings).toEqual([])
  })
})
