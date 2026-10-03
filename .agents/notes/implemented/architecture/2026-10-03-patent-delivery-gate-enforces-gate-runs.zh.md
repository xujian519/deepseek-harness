# Agent Note: 专利域交付闸门在工具调用处强制

Status: implemented

[English](2026-10-03-patent-delivery-gate-enforces-gate-runs.md) | 中文

## Problem

`patent` 预置把交付纪律写在 persona 里：交付件欠一次 `rule_check`（合规规则库逐条）与一次 `law_verify`（引用形式与索引收录），分析欠一次 `patent_workflow_run` 收口，之后才能进入文档交付。2026-10-03 对同一语料的清算（[零调用归因的 Agent Note](2026-10-03-patent-zero-call-tool-attribution.zh.md)）把「什么真正到达了模型」与「文本要求了什么」对照起来：`patent_workflow_run` 在 91 个启用专利工具集的 work 会话里被提供、被调用 0 次，`law_verify` 在全语料被调用 0 次。`rule_check` 在 19 个会话里被调用 63 次，但渲染过交付件的 13 个会话里只有 2 个在首次渲染前跑过它——63 次渲染中有 55 次来自一个此前没有合规运行记录的会话。

只写在提示词里的纪律，在调用记录上与没有纪律无法区分：没有任何环节核对时，跑过的那次与没跑过的那次留下同样的痕迹。[收口必经的 Agent Note](2026-09-21-patent-workflow-closure-required.zh.md) 考虑过用工具级守卫强制收口并否决了它，记下两条理由——阻止渲染会打断没有 manifest 入口的案件类型（补正），也会打断合法停在人工确认门的 run。该笔记同时记下了它自己的失败条件：再一个等长窗口仍为零调用；2026-10-03 的窗口满足了它。

## Decision

`@deepseek-ai/dsh-patent-rule` 在 `structuralGate` 之外新增第二种声明式制品门禁。`deliveryGate` 条目给出一个交付工具，以及该工具被调用前**必须已在本会话成功执行过**的工具；可选 `whenArgs` 把该条收窄到匹配的调用，其中字符串为精确匹配、字符串数组为取值集合。未满足的条目经 `ctx.tools.guard()` 这一单调 guard 拒绝调用，故监听器顺序与权限规则都无法把拒绝还原成一次调用。拒绝理由点出尚缺的前置工具，模型据此补跑，而不是让这次交付静默地少一道闸门。

登记与判定是分开的，因为派发前作出的拒绝无法知道它即将放行的调用会不会成功。台账保存**成功返回**的工具名，由 `tools/post-execute` 填写，guard 读它。台账以活动调用方 agent 为键，一个案件的门禁运行永远不会满足另一个案件的交付；不带 agent 的调用按未满足处理——无法归属的交付件同样拿不出会话记录。随包默认不声明任何条目——一次交付欠哪些闸门调用，是部署的交付政策，不是本包的政策。

`patent` 预置为 `render_patent_document` 声明两条：任何渲染都要求 `rule_check` 与 `law_verify`；七个分析类模板（`patentability-opinion`、`search-report`、`oa-response`、`invalidation-opinion`、`re-examination-request`、`infringement-opinion`、`litigation-pleading`）另要求 `patent_workflow_run`。记下的两条反对意见正由这一形态化解：按模板收窄化解了补正那一例——`rectification-response` 与 `claims-spec` 不跑 manifest，留在收口条之外；认「成功调用」化解了人工确认门那一例——停在 `review_gate` 的 run 未报错返回即满足门禁，故 persona 既有的「带 `approveStageIds` 重新调用」承担审批步骤，没有任何东西把渲染锁在第二遍之后。

交付门禁是本包的第三个执行点，与 `tools/post-execute` 上的结果门禁（[输出门禁的 Agent Note](2026-09-28-patent-output-gating-runs-on-the-rule-gate.zh.md)，其中规则门禁是合规规则唯一的执行者）和制品结构门禁并列。三者回答不同的问题：产出的文本说了什么、即将被渲染的制品里有什么、本会话已完成过哪些运行。

入参匹配移到 `runtime/args-match.ts` 并由两种门禁共用：部署的制品门禁与交付门禁对一条声明回答同一个问题——它是不是冲着本次调用来的——两份副本会让同一条声明有两种含义。

## Alternatives considered

- **退役 `patent_workflow_run`，而不是强制它** —— 收口那篇在窗口再次为零后重启的分支。未采纳：收口那篇保留 stage 记录的理由（数月后可复查哪个阶段跑了、跑了什么输入、得了什么结论）仍然成立，退役是丢掉记录而不是产出记录。
- **继续靠路由并加强 persona 措辞。** 已经试过：要求既在 persona 里、也在五个技能的收口行里，2026-10-03 窗口仍记到 0 次收口调用与 0 次 `law_verify` 调用。
- **把三个闸门技能改成工具**，即优化账本原本的提案。否决：`patent-compliance-review` 本就是 `rule_check` 的薄壳，`patent-fact-check` 的第一步就是 `law_verify`，新工具会与两个已交付的工具重复。缺的从来不是工具，是没有任何环节要求这次调用。
- **在 `render_patent_document` 内部强制。** 否决：`patent-document` 将需要依赖 `patent-rule`，把能力缝倒过来，而且渲染器看不到本会话的其他调用。门禁属于拥有交付门禁、能观察调用流的插件。
- **判定结论而不是判定调用。** 否决：这要求把每个闸门的结构化结果归约成本包并不拥有的通过/不通过，而 `rule_check` 报出违规是供人阅读的正常答案，不是永久阻止渲染的理由。
- **把前置条件折进 `structuralGate`。** 否决：那个门禁判的是一次调用入参里的制品文本，而前置条件是会话状态——不同的输入、不同的失败，只能挂到一个 `textArgs` 与 `ruleIds` 对它毫无意义的条目类型上。

## Consequences

- 交付文档不能再从一个没跑过这两道闸门的会话里出件，分析类文档另需一次收口运行。下一个等长窗口检验这条要求的第三次尝试：在 `render_patent_document` 计数正常的情况下 `patent_workflow_run` 仍为 0 次，说明门禁本身没有到达模型。
- 台账不跨恢复保留：它保存在插件挂载内、以活动 agent 对象为键，故在新进程里恢复的会话会重跑前置调用，即使此前已满足。失败方向是多跑一次闸门，不是少跑。包 README 把它记在已知限制下。
- 台账认「成功调用」而非「通过结论」，故报出违规的 `rule_check` 也算满足。门禁强制的是这次运行在本会话发生过；结论由交付报告承载供人核阅。包 README 同样记录。
- `verify_deliverable` 不进前置集合：它核对的是渲染件晚于其输入件、且与案卷主路径逐字节一致，因此它在渲染之后运行，不可能是渲染的前置。
- `evaluate_evidence` 继续走路由而不设门禁。它的场景是「正在引用证据」，这是工具调用门禁观察不到的：一份不引用任何证据的审查意见答复会被逼去做一次没有对象可评的调用。[零调用归因那篇](2026-10-03-patent-zero-call-tool-attribution.zh.md) 把这项强制推迟到本批工作；推迟继续成立，障碍现在被点明为可观察性而非机制。
- `patent` 预置与 `scripts/preset-divergence-baseline.json` 承载新声明及其重录哈希，故预置自己的分歧行随这次强制改动一起移动。
