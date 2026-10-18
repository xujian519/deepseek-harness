/**
 * 检索域原子：citation-check（引用真实性校验）。
 *
 * 包装 `graph/domains/citation-check` 的纯函数判定，不新写引用规则：从结论/评估
 * 文本提取 D 标号与专利号，逐个要求其出现在 `prior_art` 检索结果中，杜绝模型
 * 引用未检索到的对比文件。D 标号为精确匹配（D10 不会被 D1 前缀接受），并按证据
 * 台账分配给 prior-art 的同一 `citationId` 接地，使结论引用可直接回溯到运行持久化
 * 的收据。
 *
 * 无法校验时按既有域契约放行并写明原因：无检索结果、无可提取标识。引用文本本身
 * 缺失（上游结论未产出）则降级，避免把上游失败当成"引用全部接地"。
 */

import { type Atom } from '../../atom.ts'
import { type PipelineState, type StageExecuteInput, type StageHandler, getStateArray, getStateString } from '../../handler.ts'
import { checkCitations } from '../../../graph/domains/citation-check.ts'
import { priorArtReceiptCitationIds } from '../../../evidence/ledger.ts'
import { degraded } from './llm.ts'
import { resolveConfiguredKey, resolveKeyList } from './state-keys.ts'

/** 默认引用文本来源键（新颖性/创造性原子的结论与收口阶段产出，多键拼接）。 */
export const DEFAULT_CITATION_REF_TEXT_KEYS: readonly string[] = [
  'novelty_result',
  'novelty_conclusion',
  'inventiveness_conclusion',
  'inventiveness_closest',
  'inventiveness_hint',
  'conclude',
]

/** 默认检索结果状态键。 */
export const DEFAULT_CITATION_PRIOR_ART_KEY = 'prior_art'

/** citation-check 原子：结论引用与检索结果的一致性校验。 */
export const citationCheckAtom: Atom = {
  name: 'citation-check',
  description: '引用真实性校验：结论/评估中的 D 标号须命中 prior_art 的证据台账收据，专利号须在检索结果中接地（D10 不会匹配 D1）',
  category: 'gate',
  inputSchema: ['prior_art', ...DEFAULT_CITATION_REF_TEXT_KEYS],
  outputSchema: ['citation_check_report', 'citation_check_grounded', 'citation_check_failures'],
}

/** citation-check 执行器：汇总引用文本后调用域内确定性校验。 */
export class CitationCheckHandler implements StageHandler {
  readonly name = 'citation-check'
  readonly category = 'gate' as const

  /**
   * 执行引用真实性校验。
   * @param input - 阶段执行输入（state 携带引用文本与检索结果）。
   * @returns `citation_check_report`（主输出）、`citation_check_grounded` 与 `citation_check_failures`。
   */
  // oxlint-disable-next-line typescript/require-await -- StageHandler contract requires async execute
  async execute(input: StageExecuteInput): Promise<PipelineState> {
    const { state } = input
    const keys = resolveKeyList(state, 'ref_text_keys', DEFAULT_CITATION_REF_TEXT_KEYS)
    if (keys === undefined) {
      return degraded('citation-check', 'params.ref_text_keys 必须是非空字符串数组')
    }
    const priorArtKey = resolveConfiguredKey(state, 'prior_art_key', DEFAULT_CITATION_PRIOR_ART_KEY)
    if (priorArtKey === undefined) {
      return degraded('citation-check', 'params.prior_art_key 必须是非空字符串')
    }
    const refTexts = keys.map(key => getStateString(state, key)).filter(text => text.trim().length > 0)
    if (refTexts.length === 0) {
      return degraded('citation-check', `缺少引用文本（${keys.join('、')} 均无产出）`)
    }
    const docs = getStateArray(state, priorArtKey)
    const result = checkCitations({
      refTexts,
      docs,
      receiptCitationIds: priorArtReceiptCitationIds(docs),
    })
    return {
      citation_check_report: result.report,
      citation_check_grounded: result.grounded,
      citation_check_failures: result.uncited,
    }
  }
}
