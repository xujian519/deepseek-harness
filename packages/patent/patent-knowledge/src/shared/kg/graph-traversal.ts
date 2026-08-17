/**
 * src/knowledge/shared/kg — 图谱遍历（图算法独立模块）。
 *
 * 从 kg-store.ts 拆出（A4 轮次 3）：getNeighbors / bfsPath / listByType /
 * expandNeighbors 四个图操作独立成类，经构造注入 prepared statements 与
 * getNode 回读钩子（无 DB 生命周期责任，可独立单测）。
 */

import type { StatementSync } from 'node:sqlite'
import type { KgNode } from '../../patent/types.ts'

/** 图谱邻居（目标节点 id + 关系类型）。 */
export type KgNeighbor = {
  /** 邻居节点 id */
  targetId: string
  /** 关系类型（CITES / RELATED_TO / SIMILAR_TO / CONTAINS / DEFINES…） */
  relation: string
}

/** 图谱路径边。 */
export type KgPathEdge = {
  source: string
  target: string
  relation: string
}

/** 图谱遍历（邻居/最短路径/按类型列表等图操作）。 */
export class GraphTraversal {
  constructor(
    private readonly stmts: {
      stmtNeighbors: StatementSync
      stmtNeighborsByRelation: StatementSync
      stmtListByType: StatementSync
    },
    private readonly getNode: (id: string) => KgNode | undefined,
  ) {}

  /**
   * 查询节点的出向邻居（按 relation 过滤可选）。
   * @param nodeId 节点 id。
   * @param relation 关系类型过滤，省略时不限关系。
   * @param limit 返回邻居数量上限。
   * @returns 邻居节点列表。
   */
  getNeighbors(nodeId: string, relation?: string, limit = 20): KgNeighbor[] {
    const rows = relation
      ? (this.stmts.stmtNeighborsByRelation.all(nodeId, relation, limit) as Array<{
        target: string
        relation: string
      }>)
      : (this.stmts.stmtNeighbors.all(nodeId, limit) as Array<{ target: string; relation: string }>)
    return rows.map(r => ({ targetId: r.target, relation: r.relation }))
  }

  /**
   * BFS 最短路径（有向图，沿出边遍历）。找不到返回 null。
   * @param fromId 起始节点 id。
   * @param toId 目标节点 id。
   * @param maxDepth 最大搜索深度。
   * @returns 最短路径边序列，不可达时 null。
   */
  bfsPath(fromId: string, toId: string, maxDepth = 5): KgPathEdge[] | null {
    if (fromId === toId) return []
    const visited = new Set<string>([fromId])
    const queue: Array<{ id: string; path: KgPathEdge[] }> = [{ id: fromId, path: [] }]

    while (queue.length > 0) {
      const entry = queue.shift()
      if (entry === undefined) continue
      const { id, path } = entry
      if (path.length >= maxDepth) continue
      const neighbors = this.getNeighbors(id, undefined, 100)
      for (const n of neighbors) {
        if (visited.has(n.targetId)) continue
        const nextPath = [...path, { source: id, target: n.targetId, relation: n.relation }]
        if (n.targetId === toId) return nextPath
        visited.add(n.targetId)
        queue.push({ id: n.targetId, path: nextPath })
      }
    }
    return null
  }

  /**
   * 按类型列出节点（用于图谱浏览/过滤）。
   * @param nodeType 节点类型。
   * @param limit 返回数量上限。
   * @returns 该类型的节点列表。
   */
  listByType(nodeType: string, limit = 50): KgNode[] {
    const rows = this.stmts.stmtListByType.all(nodeType, limit) as Array<{ id: string }>
    return rows.map(r => this.getNode(r.id)).filter((n): n is KgNode => n !== undefined)
  }

  /**
   * 展开某个节点的邻居（去重后），附带节点详情。
   * @param nodeId 节点 id。
   * @param relation 关系类型过滤，省略时不限关系。
   * @param depth 展开深度。
   * @param limit 每层返回数量上限。
   * @returns 展开得到的邻居节点及其关系列表。
   */
  expandNeighbors(nodeId: string, relation?: string, depth = 2, limit = 20): Array<{ node: KgNode; relation: string }> {
    const seen = new Set<string>([nodeId])
    const result: Array<{ node: KgNode; relation: string }> = []
    let frontier = [{ id: nodeId, relation: '' }]

    for (let d = 0; d < depth && frontier.length > 0; d++) {
      const next: Array<{ id: string; relation: string }> = []
      for (const { id } of frontier) {
        const neighbors = this.getNeighbors(id, relation, limit)
        for (const n of neighbors) {
          if (seen.has(n.targetId)) continue
          seen.add(n.targetId)
          const node = this.getNode(n.targetId)
          if (node) {
            result.push({ node, relation: n.relation })
            next.push({ id: n.targetId, relation: n.relation })
          }
        }
      }
      frontier = next
    }
    return result
  }
}
