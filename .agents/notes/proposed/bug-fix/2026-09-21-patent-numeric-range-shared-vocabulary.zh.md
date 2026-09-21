# Agent Note: One numeric-range vocabulary for specification validation and novelty analysis

Status: proposed

[English](2026-09-21-patent-numeric-range-shared-vocabulary.md) | 中文

## Problem

「数值范围」是专利域两处都需要的词汇,而它被写了两遍。`packages/patent/patent-core/src/novelty/numeric-range.ts:85` 匹配的范围其单位可选,单位在匹配片段之后另行读取,连接符接受 `- – — ~ ～ 至 到`。`packages/patent/patent-tools/src/tool/validate-specification.ts:129` 的 pattern 由 `UNITS` 交替集拼装并**要求尾随单位**,只接受 `~ ～ 至 - —`。两者的单位归一也不同:`numeric-range.ts:119` 归一 `℃ / °c / °`,而 `validate-specification.ts:159` 的 `normalizeUnit` 归一 `℃ / °C / °`,不含 `°c`。

两份实现在具体文本上互相矛盾,而每一处矛盾都把两个生产消费方导向相反结论。`patent-core/src/graph/domains/novelty.ts:86` 消费 novelty 侧提取结果,为新颖性阶段构建图证据;`validate-specification.ts:207` 消费工具侧提取结果,对说明书草案作出报告。

- `温度为20℃至90℃`:单位夹在数字与连接符之间,novelty 侧 pattern 不匹配,文本退化到弱「独立数值」路径,得到两个强数值点而非一个区间;规格校验侧识别为一个区间。
- `重量比50-80`:规格校验侧 pattern 要求尾随单位,因此**完全不识别**该区间;novelty 侧识别。
- `25°c`:novelty 侧归一生效;规格校验侧既未归一,也未把它当作单位匹配。

定级依据是「哪个消费方错了」而非分歧幅度:novelty 侧喂给审查结论。一个区间变成两个数值点,会改变 novelty 节点能做的比较。

## Proposal

把范围语法抽成 `packages/patent/patent-core` 持有的单一模块,例如 `src/novelty/numeric-vocabulary.ts`,导出连接符集、单位表及其归一映射、范围 pattern,作为同一份语法。`numeric-range.ts` 原样消费。`validate-specification.ts` import 它,并在共享语法之上叠加自己更严的要求——范围必须带尾随单位——使两处的差别只剩各自真正需要的约束。

单位归一映射(`℃ / °C / °c / °`)成为一份共享取值,而不是两个近乎相等的集合。

新增跨解析器一致性测试,覆盖上述四种形态(`20℃至90℃`、`50-80`、`20到90℃`、`25°c`),断言两个解析器得到相同的区间端点与归一后的单位,并把规格校验侧的尾随单位要求写成显式期望,而不是它 pattern 的偶然结果。

## Alternatives considered

**让规格校验解析器直接 import novelty 解析器。** 否决:两处的接受条件确实不同——规格校验侧确实需要单位,因为草案里的无单位比较是值得报告的撰写缺陷;而 novelty 侧必须保持宽松,以免丢失证据。共享语法同时保留各处约束,比共享一个解析器并在每个调用点参数化其严格度更小。

**保留两个 pattern,加一条测试把他们当前的差异钉住。** 否决:这个差异不是任何人选定的契约。钉住它等于把缺陷文档化,并让下一次分歧看起来是有意为之。

**让 novelty 侧采用规格校验的 pattern。** 否决:在 novelty 侧要求尾随单位会丢掉无单位区间——在为审查结论提供依据的消费方里静默丢失证据。

## Acceptance criteria

- 连接符集、单位表与单位归一映射由单一模块持有;两个消费方都 import 它。
- 上述四种形态在两个入口得到相同的区间端点与单位,且规格校验侧的尾随单位要求以显式期望表达。
- 若任一侧的连接符集或单位表漂移,跨解析器一致性测试必须失败。
- `pnpm exec vitest run packages/patent/patent-core/tests/novelty/numeric-range.spec.ts packages/patent/patent-tools/tests/validate-specification.spec.ts` 通过。

## Risks

任何对 novelty 侧提取结果的改动都会改新颖性证据,因此这可能让此前产出两个数值点的文本改变审查结论——这是预期效果,但必须按行为变更评审,不能当作重构。若因依赖方向无法共享同一文件,退路是在 `patent-core` 放共享模块、让 `validate-specification.ts` 保留自己的 pattern 但 import 连接符与单位表;该变体仍是每处一个 pattern,因此全部保证都要由一致性测试承担。
