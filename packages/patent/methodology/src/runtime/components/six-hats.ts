/**
 * Six Thinking Hats methodology: parallel thinking across six perspectives.
 * Ported from Sati's src/methodology/runtime/components/six-hats.ts.
 * @module @deepseek-ai/dsh-methodology/runtime/components/six-hats
 */

import type { MethodologyComponent } from '../../types.ts'
import { keywordScore } from '../keywordMatch.ts'

const TRIGGERS = ['六顶帽', '六顶思考帽', '多角度', '全面评估', 'six hats', '决策审查', '评审']

export const sixHats: MethodologyComponent = {
  name: 'six-hats',
  description: '从六个思考角度平行审视问题，避免立场混战',
  category: 'classical',
  applicableDomains: ['patent', 'legal', 'coding', 'general'],

  identify(context) {
    return keywordScore(context, TRIGGERS)
  },

  execute(context) {
    return {
      prompt: `使用 **六顶思考帽** 从六个角度平行审视以下议题：

议题：${context.goal}

六顶帽子：
1. **白帽（事实）**：只陈述已知事实、数据与信息，不做判断
2. **红帽（直觉）**：表达情绪、直觉与直觉判断，不需论证
3. **黑帽（风险）**：指出风险、缺陷、反对理由与潜在问题
4. **黄帽（价值）**：寻找收益、机会与积极面
5. **绿帽（创意）**：提出替代方案、新思路与可能性
6. **蓝帽（控制）**：总结讨论，形成结论与下一步

输出格式：
- 白帽（事实）：...
- 红帽（直觉）：...
- 黑帽（风险）：...
- 黄帽（价值）：...
- 绿帽（创意）：...
- 蓝帽（总结）：结论 = ...；下一步 = ...`,
    }
  },
}
