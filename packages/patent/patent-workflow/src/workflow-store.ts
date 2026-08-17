/**
 * WorkflowRun 持久化后端（对齐 Sati src/workflow/persistence/WorkflowPlanStore
 * 的 save/load/list 三接口，持久化对象为 patent 域的 WorkflowRunResult）。
 *
 * - InMemoryWorkflowRunStore：内存 Map，适合测试与单次运行上下文
 * - JsonFileWorkflowRunStore：每 run 一个 JSON 文件（<dir>/<runId>.json），
 *   底层复用 JsonFileStore
 *
 * runId 缺省用 manifestId（中断后同 runId 重跑即覆盖上次记录，是恢复路径的
 * 有意语义）；同一 manifest 的多次独立运行请显式传不同 runId，否则后写覆盖
 * 前写。
 */

import { JsonFileStore } from '@deepseek-ai/dsh-patent-core'
import type { WorkflowRunResult, WorkflowRunStore } from '@deepseek-ai/dsh-patent-core'

/** 内存存储——适合测试与单次运行上下文。 */
export class InMemoryWorkflowRunStore implements WorkflowRunStore {
  private readonly runs = new Map<string, WorkflowRunResult>()

  /** 保存一次运行结果；runId 缺省为 manifestId（同 runId 重跑覆盖上次记录）。 */
  async saveRun(result: WorkflowRunResult, runId?: string): Promise<void> {
    this.runs.set(runId ?? result.manifestId, structuredClone(result))
  }

  /** 按 runId 加载运行结果。@returns 运行结果；不存在时为 undefined。 */
  async loadRun(runId: string): Promise<WorkflowRunResult | undefined> {
    const run = this.runs.get(runId)
    return run ? structuredClone(run) : undefined
  }

  /** 列出全部已保存的运行 ID。@returns 运行 ID 列表。 */
  async listRuns(): Promise<string[]> {
    return [...this.runs.keys()]
  }
}

/** JSON 文件存储——每 run 一个文件，位于同一目录下。 */
export class JsonFileWorkflowRunStore implements WorkflowRunStore {
  private readonly store: JsonFileStore<WorkflowRunResult>

  constructor(dir: string) {
    this.store = new JsonFileStore(dir, raw => JSON.parse(raw) as WorkflowRunResult, 'runId')
  }

  /** 保存一次运行结果；runId 缺省为 manifestId（同 runId 重跑覆盖上次记录）。 */
  async saveRun(result: WorkflowRunResult, runId?: string): Promise<void> {
    await this.store.save(runId ?? result.manifestId, result)
  }

  /** 按 runId 加载运行结果。@returns 运行结果；不存在时为 undefined。 */
  async loadRun(runId: string): Promise<WorkflowRunResult | undefined> {
    return this.store.load(runId)
  }

  /** 列出全部已保存的运行 ID。@returns 运行 ID 列表。 */
  async listRuns(): Promise<string[]> {
    return this.store.listIds()
  }
}
