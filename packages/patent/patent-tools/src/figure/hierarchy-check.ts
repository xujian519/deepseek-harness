/**
 * 图内构造层级 ↔ 权利要求构造层级的一致性核验。
 *
 * 附图里一个部件挂在哪个上位部件之下（`311` 挂在 `31` 下还是挂在 `3` 下），在 SVG 上只能
 * 靠几何包含关系猜——而说明书的标号是外置的（引线引到轮廓外），猜错反而误导。可确定的
 * 判据是：**出图时声明的层级**与**权利要求书里写出的层级**必须一致。本模块只做这一件事：
 * 权利要求里出现「<父标记>…的…<子标记>」这类结构归属表述时，子标记在声明的层级里必须
 * 落在父标记之下（直接或间接）。两端标记都必须是声明过的节点，权利要求序号（「权利要求
 * 1 所述的…2」）与图号因此落在判据之外。
 *
 * 只报「矛盾」，不报「未声明」：权利要求提到的部件是否画在图上，是图文一致性的另一条判据
 * （`validate_specification`）。
 * @module @deepseek-ai/dsh-patent-tools/figure/hierarchy-check
 */

import type { RenderCheckFinding } from './render-check.ts'

/** 声明的一条构造层级：父部件标记 → 直接子部件标记。 */
export type FigureHierarchyEdge = {
  /** 父部件标记（附图标记数字，如 "31"）。 */
  readonly parent: string
  /** 直接子部件标记（如 "311"）。 */
  readonly child: string
}

/** 权利要求里的结构归属表述：父标记 + 至多 8 个非数字非标点字符 + 「的」+ 至多 8 个字符 + 子标记。 */
const ATTRIBUTION_PATTERN = /(\d+)[^\d，。；：、（）()]{0,8}?的[^\d，。；：、（）()]{0,8}?(\d+)/g

/** 声明层级的索引。 */
type Hierarchy = {
  /** 声明里出现过的全部标记。 */
  readonly nodes: ReadonlySet<string>
  /** 标记 → 直接父标记。 */
  readonly parentOf: ReadonlyMap<string, string>
  /** 标记 → 全部祖先标记。 */
  readonly ancestorsOf: ReadonlyMap<string, ReadonlySet<string>>
  /** 声明成环被忽略的边。 */
  readonly warnings: readonly string[]
}

/**
 * 建立层级索引。声明成环（沿父边能回到自身）时忽略该边并告警：成环的层级无法判定归属，
 * 忽略一条边之外的部分仍可用，比整份声明作废更有用。
 * @param edges - 声明的构造层级。
 * @returns 层级索引。
 */
function indexHierarchy(edges: readonly FigureHierarchyEdge[]): Hierarchy {
  const nodes = new Set<string>()
  for (const edge of edges) {
    nodes.add(edge.parent)
    nodes.add(edge.child)
  }
  const parentOf = new Map<string, string>()
  const warnings: string[] = []
  for (const edge of edges) {
    const chain = new Set<string>([edge.child])
    let cursor: string | undefined = edge.parent
    while (cursor !== undefined && !chain.has(cursor)) {
      chain.add(cursor)
      cursor = parentOf.get(cursor)
    }
    if (cursor !== undefined) {
      warnings.push(`构造层级声明成环：${edge.parent} → ${edge.child} 沿父边回到自身，该条已忽略`)
      continue
    }
    parentOf.set(edge.child, edge.parent)
  }
  const ancestorsOf = new Map<string, ReadonlySet<string>>()
  for (const node of nodes) {
    const ancestors = new Set<string>()
    let cursor = parentOf.get(node)
    while (cursor !== undefined && !ancestors.has(cursor)) {
      ancestors.add(cursor)
      cursor = parentOf.get(cursor)
    }
    ancestorsOf.set(node, ancestors)
  }
  return { nodes, parentOf, ancestorsOf, warnings }
}

/**
 * 核对权利要求里的结构归属表述与声明的图内层级。
 * @param edges - 声明的构造层级（父标记 → 直接子标记）。
 * @param claims - 权利要求书正文（标记按说明书写法紧跟名称，如「恒电位控制单元31的输入端311」）。
 * @returns 发现的问题（成环告警与层级矛盾各一条）。
 */
export function checkFigureHierarchy(
  edges: readonly FigureHierarchyEdge[],
  claims: string,
): RenderCheckFinding[] {
  const hierarchy = indexHierarchy(edges)
  const findings: RenderCheckFinding[] = hierarchy.warnings.map(message => ({ check: 'figure-hierarchy', message }))
  const reported = new Set<string>()
  for (const match of claims.matchAll(ATTRIBUTION_PATTERN)) {
    const [, parent = '', child = ''] = match
    if (parent === child) continue
    if (!hierarchy.nodes.has(parent) || !hierarchy.nodes.has(child)) continue
    if (reported.has(`${parent}>${child}`)) continue
    reported.add(`${parent}>${child}`)
    if (hierarchy.ancestorsOf.get(child)?.has(parent) === true) continue
    const actual = hierarchy.parentOf.get(child)
    const placement = actual === undefined ? '画在顶层' : `画在 ${actual} 之下`
    findings.push({
      check: 'figure-hierarchy',
      message: `权利要求说「${parent}…的…${child}」，而声明的图内层级把 ${child} ${placement}（${parent} 不是 ${child} 的上位部件）：`
        + '图纸层级与权利要求的构造归属不一致，请按权利要求重绘图，或把权利要求的归属改成与图一致',
    })
  }
  return findings
}
