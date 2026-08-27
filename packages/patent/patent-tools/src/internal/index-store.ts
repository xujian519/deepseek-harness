/**
 * 通用单文件索引存储（figure / chemistry 共用）。
 *
 * 一个索引是一个 JSON 文件：`{ version, updatedAt, entries }`。写入走原子写
 * （同目录临时文件 + rename），同一文件路径的并发 upsert 在进程内串行化，避免
 * "读-改-写"竞态丢条目；命中损坏/版本不兼容/含无效条目的旧索引时先备份原文件
 * 再合并，避免静默丢弃原有有效条目。参考 Sati 的 figure / chemistry index-store。
 * @module @deepseek-ai/dsh-patent-tools/internal/index-store
 */

import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { atomicWriteJson } from '@deepseek-ai/dsh-patent-core'

/** 索引加载结果：条目列表 + 非致命异常提示。 */
export type IndexStoreLoadResult<TEntry> = {
  entries: TEntry[]
  /** 非致命异常提示（文件损坏/版本不兼容/无效条目被忽略），无则省略。 */
  warning?: string
}

/** 索引存储实例：load 缺失/损坏返回空索引，upsert 按 entryKey 覆盖 + compare 排序。 */
export type IndexStore<TEntry> = {
  /** 读取索引：文件缺失 → 空；损坏/版本不兼容 → 空 + warning（不抛出）。 */
  load(filePath: string): Promise<IndexStoreLoadResult<TEntry>>
  /** 整体写回索引（调用方负责保证目录可写；不串行化，批量重建场景用）。 */
  save(filePath: string, entries: TEntry[]): Promise<void>
  /** 按 entryKey 合并进索引：同 key 覆盖、新 key 追加，compare 排序后写回。 */
  upsert(filePath: string, entry: TEntry): Promise<void>
}

/** 索引存储工厂参数。 */
export type IndexStoreOptions<TEntry> = {
  /** 索引文件版本（结构不兼容时升版，旧文件按空索引处理）。 */
  version: number
  /** 条目结构校验器：非法条目在 load 时被忽略。 */
  validateEntry: (value: unknown) => value is TEntry
  /** 条目唯一键（figure=imagePath；chemistry=sourceKey），upsert 以此判重。 */
  entryKey: (entry: TEntry) => string
  /** 写回排序（保持确定性顺序）。 */
  compare: (a: TEntry, b: TEntry) => number
  /** 索引类型名（warning 文案用，如 "附图" / "化学"）。 */
  kindLabel: string
}

/**
 * 创建单文件索引存储实例。
 * @param options - version/校验器/键/排序/文案配置。
 * @returns load/save/upsert 三接口。
 */
export function createIndexStore<TEntry>(options: IndexStoreOptions<TEntry>): IndexStore<TEntry> {
  /** 进程内写队列：同一文件路径的 upsert 串行执行（防读-改-写竞态）。 */
  const upsertQueues = new Map<string, Promise<unknown>>()

  async function load(filePath: string): Promise<IndexStoreLoadResult<TEntry>> {
    let raw: string
    try {
      raw = await readFile(filePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: [] }
      throw error
    }
    try {
      const parsed = JSON.parse(raw) as { version?: unknown; entries?: unknown }
      if (parsed.version !== options.version || !Array.isArray(parsed.entries)) {
        return { entries: [], warning: `${options.kindLabel}索引版本不兼容或结构异常，已按空索引处理` }
      }
      const entries = parsed.entries.filter(options.validateEntry)
      const dropped = parsed.entries.length - entries.length
      return dropped > 0
        ? { entries, warning: `${options.kindLabel}索引中存在 ${dropped} 条无效条目，已忽略` }
        : { entries }
    } catch {
      return { entries: [], warning: `${options.kindLabel}索引文件损坏，已按空索引处理` }
    }
  }

  async function save(filePath: string, entries: TEntry[]): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    await atomicWriteJson(
      filePath,
      JSON.stringify({ version: options.version, updatedAt: new Date().toISOString(), entries }, null, 2),
    )
  }

  async function upsert(filePath: string, entry: TEntry): Promise<void> {
    const previous = upsertQueues.get(filePath) ?? Promise.resolve()
    const run = previous.then(async () => {
      const { entries, warning } = await load(filePath)
      // 命中损坏/版本不兼容/含无效条目的旧索引时，先保留原始文件备份，
      // 避免用仅含新条目的内容静默覆盖掉原有的有效条目。
      if (warning !== undefined) await backupCorruptIndex(filePath)
      const key = options.entryKey(entry)
      const next = entries.filter(existing => options.entryKey(existing) !== key)
      next.push(entry)
      next.sort(options.compare)
      await save(filePath, next)
    })
    // 队列吞掉失败，避免一条失败阻塞后续写入；调用方 await run 感知自身失败。
    upsertQueues.set(
      filePath,
      /* v8 ignore next -- the catch fires only when run rejects, which upsert rethrows to its own caller. */
      run.catch(() => {}),
    )
    await run
  }

  /** 原始索引文件备份（`.corrupt-<时间戳>` 后缀）；备份失败不阻断写入。 */
  async function backupCorruptIndex(filePath: string): Promise<void> {
    try {
      await copyFile(filePath, `${filePath}.corrupt-${Date.now()}`)
    } catch {
      /* v8 ignore next -- copyFile onto a fresh .corrupt path cannot fail in a writable temp dir. */
    }
  }

  return { load, save, upsert }
}
