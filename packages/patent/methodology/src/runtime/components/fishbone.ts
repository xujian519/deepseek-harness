/**
 * Fishbone (Ishikawa) methodology: cause-and-effect diagram for multi-factor
 * root-cause analysis. Ported from Sati's
 * src/methodology/runtime/components/fishbone.ts.
 * @module @deepseek-ai/dsh-methodology/runtime/components/fishbone
 */

import type { MethodologyComponent } from '../../types.ts'
import { keywordScore } from '../keywordMatch.ts'

const TRIGGERS = ['鱼骨图', '因果', '原因分析', '影响因素', '多因素', 'ishikawa', 'fishbone']

/** Fishbone (Ishikawa) methodology component for multi-factor root-cause analysis. */
export const fishbone: MethodologyComponent = {
  name: 'fishbone',
  description: '用鱼骨图从多个类别维度系统排查问题的潜在原因',
  category: 'analytical',
  applicableDomains: ['patent', 'legal', 'coding', 'general'],

  identify(context) {
    return keywordScore(context, TRIGGERS)
  },

  execute(context) {
    return {
      prompt: `使用 **鱼骨图（Ishikawa）分析法** 排查以下问题的潜在原因：

问题：${context.goal}

方法：
1. 把问题写在「鱼头」位置
2. 确定主要类别分支（通用六类：人/机/料/法/环/测；或按领域定制，如专利领域：技术/法律/程序/信息/外部）
3. 在每个类别下头脑风暴列出具体原因，追问「为什么会这样」
4. 用投票或影响度对原因排序，标记最可能的根本原因
5. 对根本原因提出验证方案

输出格式：
- 问题（鱼头）：${context.goal}
- 类别 1：<类别名>
  - 原因 1.1：...
  - 原因 1.2：...
- 类别 2：<类别名>
  - 原因 2.1：...
- ...
- 最可能根本原因：<1-3 条>
- 验证方案：<如何证实>`,
    }
  },
}
