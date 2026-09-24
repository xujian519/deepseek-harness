/**
 * 有界 LRU 容器：Map 的插入序即最近使用序，命中时重新插入以刷新，写入超限时淘汰最久未访问项。
 *
 * 只在需要「命中即热、且键空间无自然上界」的内存缓存时使用；调用方给出上限，因为上限由
 * 部署规模决定（例如知识图谱查询一次可触达的节点数）。
 *
 * @module @deepseek-ai/dsh-patent-knowledge/shared/lru-cache
 */

/** 键值对缓存，容量固定并按下标淘汰最久未使用项。 */
export class LruCache<K, V> {
  private readonly entries = new Map<K, V>()

  /**
   * @param maxEntries - 条目上限（≥1）；达到上限后每次写入淘汰最久未访问项。
   */
  constructor(private readonly maxEntries: number) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError(`LruCache maxEntries must be a positive integer, got ${String(maxEntries)}`)
    }
  }

  /** 当前条目数（诊断与用例断言用）。 */
  get size(): number {
    return this.entries.size
  }

  /**
   * 键是否存在；不改变使用序。
   * @param key - 查询键。
   * @returns 存在为 true。
   */
  has(key: K): boolean {
    return this.entries.has(key)
  }

  /**
   * 取值并把该键刷新为最近使用。
   * @param key - 查询键。
   * @returns 缓存值；不存在为 undefined（与缓存了 undefined 的键由 {@link has} 区分）。
   */
  get(key: K): V | undefined {
    if (!this.entries.has(key)) return undefined
    const value = this.entries.get(key) as V
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  /**
   * 写入并把该键置为最近使用，超限时淘汰最久未访问项。
   * @param key - 写入键。
   * @param value - 写入值（允许 undefined，用于负缓存）。
   */
  set(key: K, value: V): void {
    this.entries.delete(key)
    this.entries.set(key, value)
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as K
      this.entries.delete(oldest)
    }
  }

  /** 清空所有条目。 */
  clear(): void {
    this.entries.clear()
  }
}
