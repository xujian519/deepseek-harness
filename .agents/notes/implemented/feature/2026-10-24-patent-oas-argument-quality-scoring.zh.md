# Agent Note: patent-oas 按论证质量评分,并让第二次审查意见与第一轮产出一致

Status: implemented

[English](2026-10-24-patent-oas-argument-quality-scoring.md) | 中文

## Problem

`patent-oas` 的两个缺陷让回归门禁跟踪噪声而不是交付物质量。`novelty-creative` 的 rubric 第 4、5 维只在交付物结论为「具备创造性」时给满分;论证 D1 + D2 结合显而易见的运行只拿到 20/30 与 60/100,`technical-teaching` 因此在 74.2 与 69.9 之间摆动,需要单列 60 的下限。另一个问题是 `oa-answer` 第 2 轮审查意见断言申请人修改了权利要求 1,而第 1 轮任务允许说明理由后不修改。三份第 1 轮交付物都选择不修改,第 2 轮评估者给 `amendment-grounding` 35、50、60(均值 48.3),低于下限 50,门禁因此拒绝重录的基线。

## Decision

`novelty-creative` 第 4、5 维改为评论证而非结论。第 4 维要求正确认定 D2 的技术领域与作用,并完整论证结合动机的有无;第 5 维要求分别给出新颖性与创造性结论、与论证一致,并正确引用专利法第二十二条第二款/第三款。问题空间节点的 observable 本来就是这样写的,漂移在 rubric。

`oa-answer` 第 2 轮审查意见改为条件式:第三十三条的质疑只在第一次答复作过修改时提出;`amendment-grounding` 接受与第一次答复及本次审查意见一致、说明了理由的不修改。金标摘要与基线于 2026-10-24 重录:聚合 95.70,`novelty-creative` 98.1,`oa-answer` 92.0,`technical-teaching` 92.2,`amendment-grounding` 83.3。

## Alternatives considered

**保留结论方向评分并删除 `novelty-creative`。** 否决:任务本身允许两个可辩护结论,删除会掩盖论证质量与结论选择的区别。

**强制第 1 轮修改。** 否决:第一次审查意见只提第二十二条第三款,说明理由后不修改是合法答复;第 2 轮凭空断言修改会让评估失去一致前提。

**下调 `amendment-grounding` 下限以接受旧测量。** 否决:会把用例缺陷读成模型质量,并放过真实回退。

## Consequences

- `technical-teaching` 与 `amendment-grounding` 使用统一的 node 下限 70;单列的 60 与 50 已撤销。
- 门禁会拒绝第 2 轮审查意见摘要与当前脚本不一致的基线,因此用例修改与重录必须同批落地。
- 随仓基线来自同一 profile 的两次采集:三个单轮 case 来自一次采集,`oa-answer` 在审查意见修改后单独重采。token 合计覆盖全部 96 次被接受的调用。
- `novelty-creative` 不再把任一可辩护结论判为失败;若未来恢复结论方向评分,必须重录金标摘要与基线。
