/**
 * FlexiblePlan 持久化后端（save/load/list 三接口；持久化对象为 FlexiblePlanState）。
 *
 * - JsonFileFlexiblePlanStore：每计划一个 JSON 文件（<dir>/<caseId>.json），
 *   原子写（先写临时文件再 rename），caseId 安全字符校验防路径注入。
 *   底层复用 JsonFileStore（与 JsonFileWorkflowRunStore 同一实现）。
 */

import { basename } from 'node:path'
import { JsonFileStore, StoredRecordError } from '@deepseek-ai/dsh-patent-core'
import { fromJSON, type FlexiblePlanState } from './flexible-plan.ts'

/** FlexiblePlan 持久化后端接口（save/load/list 三接口）。 */
export interface FlexiblePlanStore {
  savePlan(state: FlexiblePlanState): Promise<void>
  loadPlan(caseId: string): Promise<FlexiblePlanState | undefined>
  listCaseIds(): Promise<string[]>
}

/**
 * JSON 文件存储——每计划一个文件，位于同一目录下。
 *
 * 读取时核对 `caseId` 与文件名一致：不一致的记录会让 `savePlan` 按记录内的
 * `caseId` 回写，覆盖另一份计划，因此按损坏记录拒绝。
 */
export class JsonFileFlexiblePlanStore implements FlexiblePlanStore {
  private readonly store: JsonFileStore<FlexiblePlanState>

  constructor(dir: string) {
    this.store = new JsonFileStore(dir, (raw, file) => {
      const plan = fromJSON(raw)
      // 文件名就是 caseId：不一致时 savePlan 会按记录内的 caseId 回写，覆盖另一份计划。
      const fileId = basename(file, '.json')
      if (plan.caseId !== fileId) {
        throw new StoredRecordError(
          file,
          'plan',
          `caseId ${JSON.stringify(plan.caseId)} does not match file name ${JSON.stringify(fileId)}`,
        )
      }
      return plan
    }, 'caseId')
  }

  async savePlan(state: FlexiblePlanState): Promise<void> {
    await this.store.save(state.caseId, state)
  }

  async loadPlan(caseId: string): Promise<FlexiblePlanState | undefined> {
    return this.store.load(caseId)
  }

  async listCaseIds(): Promise<string[]> {
    return this.store.listIds()
  }
}
