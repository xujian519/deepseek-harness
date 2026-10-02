import { describe, expect, it } from 'vitest'
import { checkFigureHierarchy } from '../src/figure/hierarchy-check.ts'

/** 声明层级：系统 1 → 控制单元 3 → 恒电位控制单元 31 → 输入端 311。 */
const CHAIN = [
  { parent: '1', child: '3' },
  { parent: '3', child: '31' },
  { parent: '31', child: '311' },
]

/** 声明层级：输入端 311 挂在 3 之下（漏了一层 31），与权项的归属矛盾。 */
const MISPLACED = [
  { parent: '1', child: '3' },
  { parent: '3', child: '31' },
  { parent: '3', child: '311' },
]

describe('checkFigureHierarchy', () => {
  it('权利要求的归属与声明的祖先关系一致时不出发现（直接与间接都可）', () => {
    expect(checkFigureHierarchy(CHAIN, '所述恒电位控制单元31的输入端311，其特征在于……')).toEqual([])
    expect(checkFigureHierarchy(CHAIN, '所述系统1的输入端311，其特征在于……')).toEqual([])
  })

  it('子标记画在别的父节点之下时报出矛盾，并给出实际的父节点', () => {
    const findings = checkFigureHierarchy(MISPLACED, '所述恒电位控制单元31的输入端311，其特征在于……')
    expect(findings.map(finding => finding.check)).toEqual(['figure-hierarchy'])
    expect(findings[0]?.message).toContain('权利要求说「31…的…311」')
    expect(findings[0]?.message).toContain('把 311 画在 3 之下')
  })

  it('子标记在声明里没有父节点时说明画在顶层', () => {
    const findings = checkFigureHierarchy(
      [{ parent: '31', child: '311' }],
      '所述安装板311的加强筋31，其特征在于……',
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.message).toContain('把 31 画在顶层')
  })

  it('方向颠倒（父标记实际画在子标记之下）同样报出', () => {
    const findings = checkFigureHierarchy(
      [{ parent: '3', child: '311' }, { parent: '311', child: '31' }],
      '所述恒电位控制单元31的输入端311，其特征在于……',
    )
    expect(findings.map(finding => finding.check)).toEqual(['figure-hierarchy'])
    expect(findings[0]?.message).toContain('把 311 画在 3 之下')
  })

  it('两端标记未在声明里出现时跳过：权利要求序号与图号不参与判定', () => {
    expect(checkFigureHierarchy(CHAIN, '根据权利要求1所述的装置2，其特征在于……')).toEqual([])
    expect(checkFigureHierarchy(CHAIN, '如图1所示的模块9，其特征在于……')).toEqual([])
  })

  it('父子标记相同时跳过', () => {
    expect(checkFigureHierarchy(CHAIN, '所述模块31的31号引脚，其特征在于……')).toEqual([])
  })

  it('同一对归属重复出现只报一次', () => {
    const findings = checkFigureHierarchy(MISPLACED, '所述控制单元31的输入端311；所述控制单元31的输入端311。')
    expect(findings).toHaveLength(1)
  })

  it('层级声明成环时该边忽略并告警，其余层级仍可用', () => {
    const findings = checkFigureHierarchy(
      [{ parent: '31', child: '3' }, { parent: '3', child: '31' }],
      '所述系统3的控制单元31，其特征在于……',
    )
    expect(findings[0]?.check).toBe('figure-hierarchy')
    expect(findings[0]?.message).toContain('构造层级声明成环')
  })

  it('底层子标记的归属正确时不报：三跳祖先链', () => {
    expect(checkFigureHierarchy(CHAIN, '所述系统1的控制单元3的恒电位控制单元31的输入端311，其特征在于……')).toEqual([])
  })
})
