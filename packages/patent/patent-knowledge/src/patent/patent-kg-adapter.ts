import { KgStore, type KgNeighbor } from '../shared/kg-store.ts'
import type { KgNode } from './types.ts'

/**
 * 专利知识图谱适配器（封装 KgStore，提供专利语义查询）。
 *
 * searchRelevant：关键词搜索命中节点后，按关系类型做有限扩展
 * （相似节点/引用链），返回带关系的上下文节点。
 */

export type RelevantHit = {
  node: KgNode
  /** 命中方式：keyword（关键词直接命中）/ similar（SIMILAR_TO 扩展）/ cites（引用扩展） */
  via: 'keyword' | 'similar' | 'cites'
  relation?: string
}

/** 专利知识图谱关键词搜索选项。 */
export type PatentKgSearchOptions = {
  /** 关键词搜索返回数（默认 5）。 */
  keywordLimit?: number
  /** 每个命中节点扩展的邻居上限（默认 6）。 */
  expandLimit?: number
  /** 关键词匹配模式：phrase（默认）/ or（分词 OR，多词召回）。 */
  mode?: 'phrase' | 'or'
}

const SIMILAR_RELATIONS = new Set(['SIMILAR_TO', 'RELATED_TO'])
const CITE_RELATIONS = new Set(['CITES', 'CITES_LAW', 'FREQUENTLY_CITES', 'REFERENCES'])

/**
 * node_type 别名映射：数据库实际类型与 types.ts 中 KgNodeType 定义不一致
 * （如 KgNodeType 的 "Judgment" 对应 db 中的 SupremeCourtJudgment / RegionalCourtJudgment）。
 */
const NODE_TYPE_ALIASES: Record<string, string[]> = {
  Judgment: ['SupremeCourtJudgment', 'RegionalCourtJudgment'],
  LawArticle: ['Clause', 'Chapter'],
  Concept: ['Concept', 'ConceptDetail', '一级概念', '二级概念', '三级概念'],
}

/**
 * 解析 node_type（别名展开；未命中别名时按数据库实际类型透传）。
 * @param raw 数据库 node_type 原始值。
 * @returns 展开后的类型列表。
 */
export function resolveNodeTypes(raw: string): string[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  const exact = NODE_TYPE_ALIASES[trimmed]
  if (exact) return exact
  const lower = trimmed.toLowerCase()
  for (const [alias, types] of Object.entries(NODE_TYPE_ALIASES)) {
    if (alias.toLowerCase() === lower) return types
  }
  return [trimmed]
}

/** 专利知识图谱适配器（封装 KgStore，提供专利语义查询）。 */
export class PatentKgAdapter {
  constructor(private readonly store: KgStore) {}

  /**
   * 按 id 取节点（语义召回命中后回查详情）。
   * @param id 节点 id。
   * @returns 匹配的图谱节点，不存在时 undefined。
   */
  getNode(id: string): KgNode | undefined {
    return this.store.getNode(id)
  }

  /**
   * 关键词搜索 + 关系扩展。
   * @param query 关键词查询。
   * @param options 检索与扩展选项。
   * @returns 带命中方式的上下文节点列表。
   */
  searchRelevant(query: string, options: PatentKgSearchOptions = {}): RelevantHit[] {
    const keywordLimit = options.keywordLimit ?? 5
    const expandLimit = options.expandLimit ?? 6
    const hits = this.store.searchByKeyword(query, keywordLimit, options.mode ? { mode: options.mode } : {})
    const results: RelevantHit[] = []
    const seen = new Set<string>()

    for (const node of hits) {
      /* v8 ignore next -- store.searchByKeyword returns unique node ids */
      if (seen.has(node.id)) continue
      seen.add(node.id)
      results.push({ node, via: 'keyword' })
    }

    // 扩展：相似节点 + 引用关系（取优先类型，避免重复）
    for (const hit of hits) {
      for (const relation of SIMILAR_RELATIONS) {
        for (const neighbor of this.store.getNeighbors(hit.id, relation, expandLimit)) {
          if (seen.has(neighbor.targetId)) continue
          const node = this.store.getNode(neighbor.targetId)
          if (!node) continue
          seen.add(node.id)
          results.push({ node, via: 'similar', relation })
        }
      }
      for (const relation of CITE_RELATIONS) {
        for (const neighbor of this.store.getNeighbors(hit.id, relation, 4)) {
          if (seen.has(neighbor.targetId)) continue
          const node = this.store.getNode(neighbor.targetId)
          if (!node) continue
          seen.add(node.id)
          results.push({ node, via: 'cites', relation })
        }
      }
    }

    return results
  }

  /**
   * 展开某节点的相似/相关邻居。
   * @param nodeId 节点 id。
   * @param limit 返回邻居数量上限。
   * @returns 邻居节点及其关系列表。
   */
  getSimilarNodes(nodeId: string, limit = 10): Array<{ node: KgNode; relation: string }> {
    const results: Array<{ node: KgNode; relation: string }> = []
    const seen = new Set<string>([nodeId])
    for (const relation of SIMILAR_RELATIONS) {
      for (const neighbor of this.store.getNeighbors(nodeId, relation, limit)) {
        if (seen.has(neighbor.targetId)) continue
        const node = this.store.getNode(neighbor.targetId)
        if (!node) continue
        seen.add(node.id)
        results.push({ node, relation })
      }
    }
    return results
  }

  /**
   * 按类型列出节点（如 "IPC"、"GuidelineRule"、"WikiCard"）。
   * @param nodeType 节点类型。
   * @param limit 返回数量上限。
   * @returns 该类型的节点列表。
   */
  listByType(nodeType: string, limit = 50): KgNode[] {
    return this.store.listByType(nodeType, limit)
  }

  /**
   * 查询节点的出向邻居（relation 过滤可选）。
   * @param nodeId 节点 id。
   * @param relation 关系类型过滤，省略时不限关系。
   * @param limit 返回邻居数量上限。
   * @returns 邻居节点列表。
   */
  getNeighbors(nodeId: string, relation?: string, limit = 20): KgNeighbor[] {
    return this.store.getNeighbors(nodeId, relation, limit)
  }

  /**
   * KG FTS tokenizer 实际生效模式（诊断用：trigram/unicode61/none）。
   * @returns 生效的 FTS 模式。
   */
  ftsMode(): 'trigram' | 'unicode61' | 'none' {
    return this.store.ftsMode()
  }

  /** 关闭底层 KgStore（释放数据库连接）。 */
  close(): void {
    this.store.close()
  }
}
