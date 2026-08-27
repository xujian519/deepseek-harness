/**
 * IPC classification and examination-standard contracts (moved from
 * @deepseek-ai/dsh-patent-knowledge in P2.1: the classifier and the
 * ipc-standards.yaml loader are pure lookups used by the workflow's
 * flexible-plan stage, so they belong in the pure patent-core library).
 * @module @deepseek-ai/dsh-patent-core/ipc/types
 */

/** IPC examination-standard card (ipc-standards.yaml entry). */
export type IpcStandardCard = {
  /** Unique card id, e.g. "创造性-三步法-A61医药-A61". */
  id: string
  /** Related law article, e.g. "patent-law-a22.3". */
  article: string
  /** IPC section (A-H). */
  ipcSection: string
  /** IPC class/subclass, e.g. "A61" or "G06". */
  ipcDetail?: string | undefined
  /** Card name, e.g. "创造性-审查标准-体育娱乐". */
  name: string
  /** Examination key points. */
  keyPoints: string[]
  /** Drafting/response tips. */
  tips: string[]
  /** Source file path. */
  source: string
}

/** One IPC classification result. */
export type IpcClassification = {
  /** IPC section (A-H). */
  section: string
  /** Confidence 0..1 (saturation: 0.5 + 0.5*(1 - e^(-hits/K))). */
  confidence: number
  /** Matched keywords. */
  matchedKeywords: string[]
  /** Best in-section class (e.g. "A61"); absent when no class keyword matches. */
  detail?: string
  /** Class-hit confidence 0..1 (same formula; threshold for precise injection). */
  detailConfidence?: number
  /** 该 IPC 领域的创造性审查要点（自 IPC_DOMAINS.inventivenessFocus 前几条，确定性）。 */
  noveltyImplications?: string[]
}
