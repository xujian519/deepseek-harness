/**
 * FlowGraph — 通用 DAG 拓扑工具（移植自 Sati src/workflow/runtime/DagEngine.ts，
 * 供 workflow-dag.ts 的 manifest → 图桥接借用）。
 *
 * 借用点：addNode/addEdge 建图、detectCycle/validate 静态校验、
 * topologicalLevels 拓扑分层、formatMermaid 可视化。
 * 专利域不需要 DagExecutor（其 wave-parallel 执行由 runWorkflow 承担）。
 */

export type FlowNodeType = 'agent' | 'tool' | 'quality-check' | 'human-approval' | 'code' | 'sub-workflow'

/** 有向图节点。 */
export type FlowNode = {
  id: string
  type: FlowNodeType
  name: string
}

/** 有向图边（from → to）。 */
export type FlowEdge = {
  from: string
  to: string
}

/** 有向图：显式建图 + 环检测 + 拓扑分层 + Mermaid 可视化。 */
export class FlowGraph {
  private readonly nodes = new Map<string, FlowNode>()
  private readonly edges: FlowEdge[] = []

  /**
   * 添加或覆盖节点。
   * @param node - 待添加的节点。
   */
  addNode(node: FlowNode): void {
    this.nodes.set(node.id, node)
  }

  /**
   * 添加边（两端节点须已存在，否则抛错）。
   * @param edge - 待添加的边。
   */
  addEdge(edge: FlowEdge): void {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new Error(`FlowGraph: edge ${edge.from} -> ${edge.to} references an unknown node`)
    }
    this.edges.push(edge)
  }

  /**
   * 判断节点是否存在。
   * @param id - 节点 id。
   * @returns 节点是否存在。
   */
  hasNode(id: string): boolean {
    return this.nodes.has(id)
  }

  /**
   * 返回从指定节点出发的边。
   * @param nodeId - 节点 id。
   * @returns 以该节点为起点的边列表。
   */
  outgoing(nodeId: string): FlowEdge[] {
    return this.edges.filter(edge => edge.from === nodeId)
  }

  /**
   * 返回指向指定节点的边。
   * @param nodeId - 节点 id。
   * @returns 以该节点为终点的边列表。
   */
  incoming(nodeId: string): FlowEdge[] {
    return this.edges.filter(edge => edge.to === nodeId)
  }

  /**
   * 存在环时返回环路径（ids），否则 null。
   * @returns 环路径（节点 id 序列），无环时为 null。
   */
  detectCycle(): string[] | null {
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const stack: string[] = []
    const visit = (id: string): string[] | null => {
      if (visiting.has(id)) {
        const start = stack.indexOf(id)
        return [...stack.slice(start), id]
      }
      if (visited.has(id)) return null
      visiting.add(id)
      stack.push(id)
      for (const edge of this.outgoing(id)) {
        const cycle = visit(edge.to)
        if (cycle) return cycle
      }
      stack.pop()
      visiting.delete(id)
      visited.add(id)
      return null
    }
    for (const id of this.nodes.keys()) {
      const cycle = visit(id)
      if (cycle) return cycle
    }
    return null
  }

  /**
   * Kahn 算法——按拓扑层返回节点 id 分组。
   * @returns 按拓扑层分组的节点 id 列表。
   */
  topologicalLevels(): string[][] {
    const indegree = new Map<string, number>()
    const outgoing = new Map<string, string[]>()
    for (const id of this.nodes.keys()) {
      indegree.set(id, 0)
      outgoing.set(id, [])
    }
    for (const edge of this.edges) {
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1)
      outgoing.get(edge.from)?.push(edge.to)
    }
    const levels: string[][] = []
    let frontier = [...indegree.entries()].filter(([, degree]) => degree === 0).map(([id]) => id)
    while (frontier.length > 0) {
      levels.push(frontier)
      const next: string[] = []
      for (const id of frontier) {
        for (const to of outgoing.get(id) ?? []) {
          const degree = (indegree.get(to) ?? 1) - 1
          indegree.set(to, degree)
          if (degree === 0) next.push(to)
        }
      }
      frontier = next
    }
    const scheduled = levels.flat().length
    if (scheduled !== this.nodes.size) {
      throw new Error(`FlowGraph: cycle detected — ${this.nodes.size - scheduled} nodes unschedulable`)
    }
    return levels
  }

  /**
   * 环 + 孤儿检查；合法时返回空数组。
   * @returns 问题列表（环路径与孤儿节点），合法时为空数组。
   */
  validate(): string[] {
    const problems: string[] = []
    const cycle = this.detectCycle()
    if (cycle) problems.push(`Cycle: ${cycle.join(' -> ')}`)
    for (const node of this.nodes.values()) {
      const incoming = this.incoming(node.id)
      const outgoing = this.outgoing(node.id)
      if (incoming.length === 0 && outgoing.length === 0 && this.nodes.size > 1) {
        problems.push(`Orphan node: ${node.id}`)
      }
    }
    return problems
  }

  /**
   * 生成 flowchart TD 格式的 Mermaid 源码。
   * @returns flowchart TD 格式的 Mermaid 源码。
   */
  formatMermaid(): string {
    const lines = ['flowchart TD']
    for (const node of this.nodes.values()) {
      lines.push(`  ${node.id}["${node.name}"]`)
    }
    for (const edge of this.edges) {
      lines.push(`  ${edge.from} --> ${edge.to}`)
    }
    return lines.join('\n')
  }
}
