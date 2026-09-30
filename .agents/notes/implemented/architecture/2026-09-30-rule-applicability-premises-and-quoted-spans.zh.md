# Agent Note: 专利规则命中以适用前提与引述范围为门

Status: implemented

[English](2026-09-30-rule-applicability-premises-and-quoted-spans.md) | 中文

## Problem

2026-09-30 撰写的一份 26.3 审查意见答复（案件 202522146475.8）在 `rule_check` scope `patent-oa-response` 下返回 49 条命中，没有一条指出它真正的问题。其中 48 条是 `structural_analysis`「要素不完整」，来自答复根本未涉及的法定理由的完整性规则——新颖性、创造性、权利要求撰写形态。「缺失即违规」的规则在缺要素的文本上就报，文本是否讨论该主题对它没有区别。最后一条是误报：`PAT-ABS-001` 命中的是答复逐字引述通知书的句子里的「一定」。答复真正的两处缺陷——用词频统计（「『储漆』出现 0 次」）代替能够实现的判准、同一段说明书原文复述四次——则没有任何规则可查。

此前的杠杆是严重级别：评审已把这批并入规则从上游 `block` 降到 `warn`/`log`。降级只是把命中调轻，不会移除命中；48 条不适用的 `warn` 环绕着运行结果里并不存在的那 2 条相关命中，让自检恰好在模型需要它时不可用。

## Decision

规则模型新增三件事，声明在 [`@deepseek-ai/dsh-patent-core`](../../../../packages/patent/patent-core/README.zh.md) 的规则类型里，由 [`@deepseek-ai/dsh-patent-rule`](../../../../packages/patent/patent-rule/README.zh.md) 执行：

**适用前提。** `ConstitutionalRule.premise` 是规则级、大小写不敏感的正则 OR 列表：无任一命中时该规则不评估、不产生结果。前提取规则所约束的**主题**——法律问题、文书话题；不得复述规则自身的要素词表，因为完整性规则的要素正是它要报的缺失项，用要素做前提只剩一条只在无事可报时才运行的规则。前提不满足是静默，不是降级：「该规则不适用于本文书」不是严重级别问题。

**引文豁免。** `keyword_blocklist` 接受 `quoteImmune: true`：命中位置落在成对引号（`「」`、`『』`、`“”`）内的是被引述文本，不是作者自己的表述。`PAT-RISK-001` 与 `PAT-ABS-001` 均开启，答复引述通知书的「需要一定的时间」不再被读成本模型的绝对化断言。未闭合引号不豁免——失效方向仍是检出。

**引文重复。** `quote_repetition` 检查把每段引文规范化（去除空白与省略号），统计长度不低于 `minLength`（缺省 12）字符的片段，任一达到 `minOccurrences`（缺省 2）次的片段即报，附出现次数与片段本身。

建立在这三项检查上的答复形式规则是新写资产 `oa-response-form.yaml`：`PR-OA-005`（计数式论证，`pattern_analysis`）、`PR-OA-006`（重复引证）、`PR-OA-007`（26.3 答复必须落到能够实现的判准，本身带前提）。三条都是 `warn` 且不进输出门禁——门禁仍只取 `keyword_blocklist` 规则；它们经显式 `rule_check` 作用于文书，`patent-oa-response` 技能要求在交付前做这次自检。

补丁面：`activation-overrides.yaml` 接受 `premise` 为整字段替换，并新增顶层 `premise-vocab` 以 YAML 锚点托管共享主题词表——每个主题只有一处定义。前提写错在加载期显式失败：空表、空白串或非法正则在资产上是加载告警，在评审补丁上则整条跳过——写下的结论不会静默失效。2026-09-30 的评审为「按文书是否触及该主题选择性讨论」的完整性家族补了前提，并把评审中发现的退化个案（`EX-PRC-002`、`JD-PRC-003`、`P-PRC-003`——单要素期望规则、其模式列表即自身主题词表）逐条记入补丁理由，而不是任其静默死亡。

## Alternatives considered

**继续降级这批完整性规则而不是给它们加前提。** 否决：降级只调低命中级别、不移除命中，并入规则已从 `block` 降到 `warn`/`log`——49 条命中的运行结果就是它的产物。缺陷在于规则压根不该被评估，而不在于它报得多响。

**先判定文书类型、再据此选规则。** 否决（作为本修复的形态）：文书分类是另一套更重的机制，而前提形态是确定性的、无词表可判——规则声明自己约束的主题，文本本身显示是否触及该主题。它还和域过滤叠加而不是取代它。仍然没有任何环节对文书分类：前提命中的规则（比如答复引用了权利要求书原文）照样报它的缺失要素，包 README 把这保留为明确的局限。

**用规则自身的要素词表做前提。** 否决：构造性退化。完整性规则的要素恰是它要报的缺失项，用它们做前提只剩一条永远报不出东西的规则；评审发现已有三条规则就写成了这样，逐条记录在案。

**引号字符内一律豁免，不管闭合与否。** 否决：未闭合的引号会豁免文书其余部分，模型自己写下的红线措辞会藏在一个落单的「后面。

**持有通知书原文、只豁免与其逐字相同的引述。** 否决：`rule_check` 只评估一份文本，引文也来自法条、指南与现有技术；为一桩成对引号标记即可解决的情形要求第二路输入，会改变工具接口。

## Consequences

对本案答复，scope `patent-oa-response` 现在返回 2 条命中——`PR-OA-005` 与 `PR-OA-006`，即两处真实缺陷——而原规则集返回 49 条，没有一条是缺陷。不加域过滤时同一文本产出 12 条：其余 10 条属于该作业 scope 本就用于排除的侵权与损害赔偿规则。

120 条随包规则中 77 条带前提；全量新增 3 条答复形式规则，`activation-overrides.yaml` 有 90 条补丁。反方向写错的前提——过窄、或谁都匹配不上——会隐藏缺陷而不是制造噪音；加载期的正则校验、共享的 `premise-vocab` 锚点与逐规则补丁理由把这一风险限制住但无法消除。接受的残留是：论证型规则保留较宽的 `claims` 词表（论证权利要求缺陷的规则在出现权利要求词汇处即评估），而撰写形态规则用产物形态的 `claim-drafting` 词表。

输出门禁构成不变（14 条 `keyword_blocklist` 规则）；引文豁免收窄 `PAT-RISK-001` 与 `PAT-ABS-001` 对「命中」的计数，只引述这类措辞的被门禁工具结果不再被标记。

## Testing

`packages/patent/patent-rule/tests/rule-engine.spec.ts` —— 前提不满足静默、满足即报告；大小写不敏感；空前提数组等于始终评估；引文豁免在 `「」`/`『』`/`“”` 内、引号外、未闭合引号三种情形；`quote_repetition` 一次与两次出现、低于 `minLength`、规范化之后、配置 `minOccurrences`、未闭合片段、超长片段在证据与消息中同样截断。

`packages/patent/patent-rule/tests/rule-loader.spec.ts` —— 三个字段的解析与校验；补丁替换 `premise`；空 premise 补丁告警并跳过。

`packages/patent/patent-rule/tests/patent-full-rule-set.spec.ts` —— 120 条规则 / 90 条补丁且零告警；只讨论说明书的答复不会从新颖性、创造性、权利要求撰写形态、客体等未触及家族获得任何命中；答复中的编号列举不会恢复这些命中，因为只有以权项写法起首的编号行才算权项书产物；每个未触及家族的成员 id 都与规则集核对存在；前提是主题词表而非全局静音；补丁 `premise` 生效；`PR-OA-005`/`006`/`007` 按规格命中与静默；`premise-vocab` 条目与未知顶层键受校验。

`packages/patent/patent-rule/tests/output-gate.spec.ts` —— 引文豁免在门禁路径同样成立：仅引号内命中的风险词不产生 warn 提示，引号外照常命中。

`packages/patent/patent-rule/tests/case-scopes.spec.ts` —— scope 探针文本携带其规则所需的主题词表。

## Related

- [Job scopes for the patent rule gate](2026-09-21-patent-rule-job-scope-domains.zh.md) —— 前提门与之叠加的域过滤。
- [Apply field-level activation patches, not just action](../feature/2026-09-20-field-level-activation-patches.zh.md) —— `premise` 加入的补丁机制。
- [Patent output gating runs on the rule gate alone](2026-09-28-patent-output-gating-runs-on-the-rule-gate.zh.md) —— 引文豁免收窄其合规命中的那道门禁。
