/**
 * TRIZ methodology component: technical-contradiction definition, deterministic
 * contradiction-matrix lookup, and 40-principle ideation.
 *
 * Patent-scenario use: pre-drafting innovation aid / design-around / problem
 * reframing. The matrix data is the classic Altshuller 39x39 matrix (public
 * classical data).
 *
 * Deterministic lookup in the product path: execute() recognizes the 39
 * engineering-parameter names in the goal, looks up each recognized pair, and
 * injects the result into the prompt (the model need not recall the matrix).
 * When no parameter pair is recognized it falls back to prompting the model to
 * look up the matrix itself.
 * @module @deepseek-ai/dsh-methodology/runtime/components/triz
 */

import type { MethodologyComponent } from '../../types.ts'
import { detectParamNumbers, lookupMatrixCell, paramLabel, principleNames } from '../../data.ts'
import { keywordScore } from '../keywordMatch.ts'

/** TRIZ-specific triggers; generic 改进/优化/重构 words stay with pdca/first-principles. */
export const TRIGGERS = [
  '矛盾',
  '冲突',
  '权衡',
  '折中',
  'trade-off',
  'tradeoff',
  '规避',
  '设计规避',
  'design around',
] as const

/** Build deterministic matrix-lookup lines for every recognized parameter pair. */
function buildLookupLines(paramNos: number[]): string[] {
  const lines: string[] = []
  if (paramNos.length < 2) return lines
  for (const improving of paramNos) {
    for (const worsening of paramNos) {
      if (improving === worsening) continue
      const ids = lookupMatrixCell(improving, worsening)
      if (ids.length === 0) continue
      lines.push(
        `- 改善 ${paramLabel(improving)}(${improving}) → 恶化 ${paramLabel(worsening)}(${worsening})：原理 [${principleNames(ids)}]`,
      )
    }
  }
  return lines
}

/** TRIZ contradiction-matrix + 40-principles ideation component. */
export const triz: MethodologyComponent = {
  name: 'triz',
  description: 'TRIZ 矛盾矩阵 + 40 发明原理：定义技术矛盾 → 查矩阵 → 原理启发构思',
  category: 'creative',
  applicableDomains: ['patent', 'general'],

  identify(context) {
    return keywordScore(context, TRIGGERS)
  },

  execute(context) {
    const detected = detectParamNumbers(context.goal)
    const lookupLines = buildLookupLines(detected)
    const lookupSection = lookupLines.length > 0
      ? `\n【确定性查表结果】从问题中自动识别到工程参数 ${detected.map(n => `${paramLabel(n)}(${n})`).join('、')}，以下为经典矛盾矩阵（39×39）查得结果：\n${lookupLines.join('\n')}\n（若与你的技术矛盾方向不符，请忽略并按方法 2 自行查表）\n`
      : ''
    const prompt = `使用 **TRIZ（发明问题解决理论）** 分析以下问题：

问题：${context.goal}

方法：
1. **定义技术矛盾**：指出当前方案中「改善的参数」与「因此恶化的参数」，从 39 个工程参数中命名这对矛盾（如：改善强度→恶化重量）
2. **查矛盾矩阵**：以恶化参数为行、改善参数为列，从经典矛盾矩阵查得推荐发明原理编号（1-40）${lookupSection}
3. **原理启发构思**：按命中的发明原理（结合 40 发明原理说明）生成 2-3 个候选解决方案，逐个说明其如何消解矛盾
4. **专利场景落点**（如适用）：
   - 撰写前创新辅助：候选方案与已知现有方案的区别特征
   - 规避设计：识别目标专利的保护点，用命中原理寻找替代技术手段
   - 问题重构：把「改进 X」重构为矛盾对形式，便于检索与布局

输出格式：
- 技术矛盾：<改善参数> vs <恶化参数>（矛盾矩阵格：原理 [编号列表]）
- 候选方案：
  - 方案 1：<描述>（应用原理 N：<原理名>）
  - 方案 2：…
- 专利落点：<区别特征 / 替代手段 / 重构后的矛盾表述>`
    return { prompt }
  },
}
