/**
 * Patent knowledge-base contracts: the nodes/edges tables of the knowledge
 * graph (knowledge.db unified schema or legacy patent_kg.db).
 *
 * The IPC classification and examination-standard card contracts moved to
 * @deepseek-ai/dsh-patent-core/src/ipc/types.ts in P2.1 (single home for the
 * pure lookup used by the workflow flexible-plan stage).
 * @module @deepseek-ai/dsh-patent-knowledge/patent/types
 */

/** Knowledge-graph node type (Mady GraphNode.NodeType constant subset). */
export type KgNodeType =
  | 'Concept'
  | 'LawArticle'
  | 'GuidelineRule'
  | 'Case'
  | 'Judgment'
  | 'WikiCard'
  | 'PersonalNote'
  | 'BookReference'
  | 'Rule'
  | 'DomainGuide'
  | 'IPC'
  | 'Evidence'
  | 'WritingPattern'

/** One knowledge-graph node (nodes table columns). */
export type KgNode = {
  id: string
  nodeType: string
  name?: string | undefined
  title?: string | undefined
  content?: string | undefined
  lawRefsCount?: number | undefined
  source?: string | undefined
  fullRef?: string | undefined
  chapter?: string | undefined
  articleNumber?: string | undefined
  version?: string | undefined
}

/** One knowledge-graph edge (edges table columns). */
export type KgEdge = {
  source: string
  target: string
  relation: string
}
