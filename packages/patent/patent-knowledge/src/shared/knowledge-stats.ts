/**
 * 知识库运行时状态聚合（可观测性出口的数据源）。
 *
 * 两个全文引擎在检索路径打点 `legalFtsDegraded` / `caseLawFtsDegraded` /
 * `likeFallbacks`，`snapshot()` 供外部诊断只读消费。
 *
 * 设计约束：
 * - 打点全部为可选注入（provider 不传 stats 时行为与现状完全一致）；
 * - snapshot 为纯读取，不加锁——单进程内 JS 事件循环保证计数自洽。
 */

/** 知识库运行时统计快照。 */
export type KnowledgeRuntimeStatsSnapshot = {
  /** 法规全文引擎 FTS5 已粘性降级（查询期异常后永久走 LIKE；false=未降级/无引擎）。 */
  legalFtsDegraded: boolean
  /** 判例全文引擎 FTS5 已粘性降级（同上）。 */
  caseLawFtsDegraded: boolean
  /** 关键词检索 LIKE 回退累计次数（短词/未命中/FTS 降级等设计内路径）。 */
  likeFallbacks: number
}

/** 知识库运行时状态聚合（可观测性出口的数据源）。 */
export class KnowledgeRuntimeStats {
  private legalFtsDegraded = false
  private caseLawFtsDegraded = false
  private likeFallbacks = 0

  /**
   * 法规全文引擎 FTS5 粘性降级（引擎查询期异常后打点一次）。
   * @param degraded 是否已降级。
   */
  setLegalFtsDegraded(degraded: boolean): void {
    this.legalFtsDegraded = degraded
  }

  /**
   * 判例全文引擎 FTS5 粘性降级（同上）。
   * @param degraded 是否已降级。
   */
  setCaseLawFtsDegraded(degraded: boolean): void {
    this.caseLawFtsDegraded = degraded
  }

  /** 关键词检索 LIKE 回退一次（短词/未命中/FTS 降级等设计内路径）。 */
  recordLikeFallback(): void {
    this.likeFallbacks += 1
  }

  /**
   * 只读快照（每次新建对象，消费方可安全序列化）。
   * @returns 运行时统计快照。
   */
  snapshot(): KnowledgeRuntimeStatsSnapshot {
    return {
      legalFtsDegraded: this.legalFtsDegraded,
      caseLawFtsDegraded: this.caseLawFtsDegraded,
      likeFallbacks: this.likeFallbacks,
    }
  }
}
