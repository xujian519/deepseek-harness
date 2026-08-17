/**
 * 宪法规则引擎 — 输出门禁通道。
 *
 * 对 Agent 输出文本运行规则评估，并按 action 转换语义：
 *   - review / block ：needsApproval = true（命中强制/待审规则）
 *   - warn            ：在文本末尾追加合规提示（含规则依据）
 *   - log             ：仅记录，不改变文本
 *
 * 消费方式取决于调用方能否改写输出：
 *   - 能改写输出的调用方（如工作流结果收口）使用 process() 返回的 `text`
 *     （warn 追加提示、block 追加说明）。
 *   - tools/post-execute 接线无法改写已生成的结果：block 命中返回
 *     `{ kind: 'block' }` 硬拦截，review 命中经 ctx.approval 审批，warn/log
 *     原样放行（warn 命中记日志，不改变结果文本）。
 *
 * 与专利域 output-gate.ts 的挂起审批（DeferredPersistQueue）解耦：
 * 本门禁只产出判定结果，挂起/审批由调用方（tools/post-execute 接线）处理。
 * @module @deepseek-ai/dsh-patent-rule/runtime/output-gate
 */

import type { RuleSet, RuleViolation } from '@deepseek-ai/dsh-patent-core'
import type { RuleOutputGate as RuleOutputGateInterface, RuleOutputGateResult } from '@deepseek-ai/dsh-patent-core'
import { evaluateText, groupByAction } from './RuleEngine.ts'
import type { SynonymMap } from './synonym-engine.ts'

/** 输出门禁选项（warn/block 文案覆盖与同义词表）。 */
export type RuleOutputGateOptions = {
  /** warn 违规提示区块标题（默认 "合规提示"）。 */
  warnTitle?: string
  /** block 违规追加说明文案。 */
  blockMessage?: string
  /** 同义词表（synonym_match 检查用；缺省空表 = 纯关键词匹配）。 */
  synonyms?: SynonymMap
}

/** 规则驱动的输出门禁。一个实例持有一份 RuleSet（启动时加载一次）。 */
export class RuleOutputGate implements RuleOutputGateInterface {
  private readonly warnTitle: string
  private readonly blockMessage: string
  private readonly synonyms: SynonymMap

  constructor(
    private readonly ruleSet: RuleSet,
    options?: RuleOutputGateOptions,
  ) {
    this.warnTitle = options?.warnTitle ?? '合规提示'
    this.blockMessage = options?.blockMessage ?? '输出命中强制拦截规则，须经人工审批后发布。'
    this.synonyms = options?.synonyms ?? new Map()
  }

  /**
   * 评估并处理输出文本（纯函数）。
   * @param text 待评估的输出文本。
   * @returns 处理结果（text、violations、needsApproval 及警告/复核/拦截命中组）。
   */
  process(text: string): RuleOutputGateResult {
    const evaluation = evaluateText(text, this.ruleSet, this.synonyms)
    const grouped = groupByAction(evaluation)
    const warnGroup = grouped.warn ?? []
    const blockGroup = grouped.block ?? []
    const warnHits = warnGroup.map(v => v.ruleId)
    const reviewHits = (grouped.review ?? []).map(v => v.ruleId)
    const blockHits = blockGroup.map(v => v.ruleId)
    const needsApproval = reviewHits.length > 0 || blockHits.length > 0

    let output = text
    const append = (block: string) => {
      output = `${output}\n\n---\n${block}`
    }

    if (warnHits.length > 0) {
      const lines = warnGroup.map(formatViolation)
      append(`⚠️ ${escapeXml(this.warnTitle)}：\n${lines.join('\n')}`)
    }
    if (blockHits.length > 0) {
      const lines = blockGroup.map(formatViolation)
      append(`🚫 ${escapeXml(this.blockMessage)}\n${lines.join('\n')}`)
    }

    return {
      text: output,
      violations: evaluation.violations,
      needsApproval,
      warnHits,
      reviewHits,
      blockHits,
      evaluation,
    }
  }
}

function formatViolation(v: RuleViolation): string {
  const basis = v.legalBasis ? `（依据：${escapeXml(v.legalBasis)}）` : ''
  const evidence = v.evidence.length > 0 ? ` — 命中「${v.evidence.map(escapeXml).join('」「')}」` : ''
  return `- [${escapeXml(v.ruleId)}] ${escapeXml(v.ruleName)}：${escapeXml(v.message)}${evidence}${basis}`
}

/** 转义规则/证据文本中的 XML 特殊字符，防提示注入/格式混淆。 */
function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
