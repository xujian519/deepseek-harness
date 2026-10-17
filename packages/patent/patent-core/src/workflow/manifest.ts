/**
 * src/patent/workflow — 声明式工作流 manifest 校验（轻量守卫，替代 zod）。
 *
 * 从 workflow.ts 拆出，供 graph/adapter（manifestToGraph）在移植 P3.1 的
 * runWorkflow 执行器之前独立消费：非法 manifest 即抛 WorkflowError（fail-fast）。
 */

import { WorkflowError, type WorkflowManifest } from './types.ts'

/**
 * Manifest 校验（轻量守卫，替代 zod）：非法即抛错。
 * options.atomNames 提供时，额外校验已声明 atom 均存在（fail-fast）。
 * @param manifest - 待校验的工作流 manifest。
 * @param options - 可选校验配置（atomNames 提供时校验 atom 均存在；
 *                  guidelineRevision 提供时期望 manifest 声明同一版本）。
 */
export function validateWorkflowManifest(
  manifest: WorkflowManifest,
  options?: { atomNames?: ReadonlySet<string>; guidelineRevision?: string },
): void {
  if (!manifest.id.trim()) throw new WorkflowError('manifest.id 不能为空')
  if (!manifest.name.trim()) throw new WorkflowError('manifest.name 不能为空')
  if (!manifest.caseType.trim()) throw new WorkflowError('manifest.caseType 不能为空')
  validateGuidelineRevision(manifest, options?.guidelineRevision)
  if (!Array.isArray(manifest.stages) || manifest.stages.length === 0) {
    throw new WorkflowError('manifest.stages 必须至少包含一个阶段')
  }
  const ids = new Set<string>()
  for (const stage of manifest.stages) {
    if (!stage.id.trim()) throw new WorkflowError('stage.id 不能为空')
    if (ids.has(stage.id)) throw new WorkflowError(`重复的阶段 id: ${stage.id}`)
    ids.add(stage.id)
    if (!['chain', 'react', 'sub_agent'].includes(stage.strategy)) {
      throw new WorkflowError(`未知策略: ${stage.strategy}（阶段 ${stage.id}）`)
    }
    if (!stage.description.trim()) throw new WorkflowError(`阶段 ${stage.id} 缺少描述`)
    if (stage.atom !== undefined && !stage.atom.trim()) {
      throw new WorkflowError(`阶段 ${stage.id} 的 atom 不能为空字符串`)
    }
    if (stage.guidance !== undefined && !stage.guidance.trim()) {
      throw new WorkflowError(`阶段 ${stage.id} 的 guidance 不能为空字符串`)
    }
    if (stage.consumes !== undefined) {
      if (stage.consumes.length === 0) {
        throw new WorkflowError(`阶段 ${stage.id} 的 consumes 不能为空数组`)
      }
      if (new Set(stage.consumes).size !== stage.consumes.length) {
        throw new WorkflowError(`阶段 ${stage.id} 的 consumes 有重复的阶段 id`)
      }
      for (const upstream of stage.consumes) {
        // 只认此前已出现过的阶段：自身与后续阶段都还没有产出可拼入。
        if (upstream === stage.id || !ids.has(upstream)) {
          throw new WorkflowError(`阶段 ${stage.id} 的 consumes 引用了不存在或非前序的阶段: ${upstream}`)
        }
      }
    }
    if (options?.atomNames && stage.atom !== undefined && !options.atomNames.has(stage.atom)) {
      throw new WorkflowError(`阶段 ${stage.id} 声明了未知 atom: ${stage.atom}`)
    }
    if (stage.retry !== undefined) {
      if (stage.retry.whenOutputMatches.trim() === '') {
        throw new WorkflowError(`阶段 ${stage.id} 的 retry.whenOutputMatches 不能为空`)
      }
      try {
        new RegExp(stage.retry.whenOutputMatches, 'i')
      } catch {
        throw new WorkflowError(`阶段 ${stage.id} 的 retry.whenOutputMatches 非法正则`)
      }
      if (stage.retry.rewindTo !== undefined && !ids.has(stage.retry.rewindTo)) {
        throw new WorkflowError(`阶段 ${stage.id} 的 retry.rewindTo 指向不存在的阶段: ${stage.retry.rewindTo}`)
      }
      if (stage.retry.rewindTo === stage.id) {
        throw new WorkflowError(`阶段 ${stage.id} 的 retry.rewindTo 不能指向自身（无回退意义）`)
      }
      const maxRetries = stage.retry.maxRetries ?? 1
      if (maxRetries < 0) throw new WorkflowError(`阶段 ${stage.id} 的 retry.maxRetries 不能为负`)
    }
  }
}

/**
 * Check the manifest's declared guideline revision against the revision the
 * deployment expects. The cross-check is opt-in: without an expected revision
 * the declaration is only checked for a blank value.
 * @param manifest - the manifest under validation.
 * @param expected - the revision the deployment expects, when it states one.
 * @throws WorkflowError when the declaration is blank, missing under an expected
 *         revision, or different from it.
 */
function validateGuidelineRevision(manifest: WorkflowManifest, expected: string | undefined): void {
  const declared = manifest.guidelineRevision?.trim()
  if (manifest.guidelineRevision !== undefined && declared === '') {
    throw new WorkflowError(`manifest ${manifest.id} 的 guidelineRevision 不能为空字符串`)
  }
  if (expected === undefined) return
  if (expected.trim() === '') {
    throw new WorkflowError('guidelineRevision 期望版本不能为空字符串')
  }
  if (declared === undefined) {
    throw new WorkflowError(`manifest ${manifest.id} 未声明 guidelineRevision，当前指南版本为 ${expected}`)
  }
  if (declared !== expected) {
    throw new WorkflowError(`manifest ${manifest.id} 的 guidelineRevision（${declared}）与当前指南版本（${expected}）不一致`)
  }
}
