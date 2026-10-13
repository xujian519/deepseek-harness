# 文档模式交付门裁决与 09-30 对标清单再分诊（2026-10-13）

- 触发：用户批准的分段计划第 6 段（P2）「文档模式补齐与 09-30 清单再分诊」。
- 前序：[`2026-10-12-patent-document-mode-review.md`](2026-10-12-patent-document-mode-review.md)（本文件是它的补篇，回答其 §6「未证实项」第 1 条）、[`2026-09-30-patent-domain-external-benchmark.md`](2026-09-30-patent-domain-external-benchmark.md)（被逐项分诊的 12 项借鉴）。
- 范围：文档模式的交付门强度（裁决 + 落点）；09-30 清单 12 项的逐项定论。
- 方法：只读直读（两个 preset 全文、`document-deliver` 与 `patent-rule` 源码、`patent-document-polish` 与六个文档技能、`patent_search` 的工具描述）+ 本批次落的文档改动。
- 本批次改动：`packages/document/document-deliver/README.md` 与 `.zh.md`（裁决正文，配对记录已重录）、`packages/bundle/web-app/presets/document.md` 与 `.zh.md`（一行指针）。**代码零改动，两个 preset 的 `.patch.yml` 零改动。**

## 0. 结论先行

1. **文档模式的交付门有意弱于专利模式，这次差异有了书面裁决。** 交付门禁绑定的是「前置调用早于被门禁调用」；专利模式两半都齐——前置是一次中间动作（本轮的留档条目），被门禁的调用是专利域唯一被认可的产出路径。文档模式的 `document_deliver` 是终结性声明：字节先写出来，其后没有工具被调用，因而**没有后置调用可供前置条件去先行**。两条更强的路线（把落盘收进工具、在轮次边界做回复级检查）各有具体否决理由，裁决落在 `document-deliver` 的 README 已知限制第 2 条，并在文档模式的设计说明里放了一行指针。
2. **09-30 的 12 项全部有结论**：3 项已落地（P0-1、P0-2、P1-6，本分支第 3、4、5 段），1 项部分承接（P1-4 的「审查循环无上界」已由第 4 段的轮次上限与耗尽记录覆盖），1 项已具备无需做（P3-12 的检索式语义契约），7 项本轮不做并写明理由（P0-3、P1-4 余下、P1-5、P1-7、P2-8、P2-9、P3-10、P3-11），P3-12 余下两条分项定论。

## 1. 文档模式的交付门强度

### 1.1 事实核对

| 事实 | 证据 |
|---|---|
| 两个 preset 里只有专利预设声明了交付门禁 | `grep -rn "deliveryGate" packages/bundle/web-app/presets/` → 唯一命中 `patent.patch.yml:355` |
| 专利门禁的条目：`render_patent_document` 与 `build_patent_filing` 各要求本会话成功跑过 `rule_check`、`law_verify`、`matter_log_append`；分析与撰写类模板另要求 `patent_workflow_run` | `patent.patch.yml:355-383` |
| 专利域的交付件有唯一被认可的产出路径 | `packages/bundle/web-app/skills/patent/patent-document-polish/SKILL.md:40`「交付件只走这一条渲染路径——不要用 headless Chrome、pandoc、LibreOffice 手工渲染」 |
| 文档域的成品由多条路写出，其中两条是模型自己写文件 | `skills/document/document-html/SKILL.md:6,22,31`（OpenDesign 模板 / `render_doc_template` / 内置基线三条，模型自己「渲染为 `index.html`」）、`document-word/SKILL.md:11`（`render_doc_template` 出 `.docx`，再用 officecli 加工同一文件） |
| `document_deliver` 是终结动作：登记时读已存在的字节，做确定性核验 | `document-deliver/README.md`「What it mounts」与「Deterministic checks」两节；`src/tool.ts` 对每个声明路径做存在性检查 |
| 回复级扩展点确实存在 | `packages/core/agent-loop/src/agent.ts:362`（`agent/turn-stopping` 是 serial 事件）、`packages/core/agent-loop/tests/contract-regressions.spec.ts:319`（「steer() from an agent/turn-stopping listener continues the same turn」） |

### 1.2 为什么门禁的形式搬不过来

交付门禁能绑定的只有一种断言：**「工具 A 调用之前，工具 B 必须已经成功跑过」**（`packages/patent/patent-rule/src/runtime/delivery-gate.ts` 的 `DeliveryGateEntry = { tool, requires, whenArgs? }`，判定函数 `deliveryGateMissing`）。它需要一个被门禁的调用作为落点。

专利模式两半都齐：

- 前置是一次**中间动作**——本轮的留档条目（`matter_log_append`）。它在逻辑上早于成品，写进的是案卷的唯一事实源，缺没缺是可机械判定的。
- 被门禁的调用是**唯一产出路径**——`render_patent_document` / `build_patent_filing`。专利交付件的格式（模板版式 docx、提交格式 docx）只能由这两个工具从结构化输入产出，技能正文把"只走这一条"写成硬规矩。

文档模式只有后半句的反面：`document_deliver` 是**终结性声明**。成品字节在它之前就由作业需要的那条路写好了（手写 Markdown、自包含 HTML、`render_doc_template`、`.docx`/`.pptx` 的用户级 `officecli` 技能），它之后没有任何工具被调用。把「必须登记」挂到某个调用上，需要存在一个晚于登记的调用；这里没有。

### 1.3 两条更强路线的否决理由

| 路线 | 否决理由 |
|---|---|
| (a) 把成品落盘收进 `document_deliver`（让它成为唯一写字节的地方） | 登记工具会变成转换器：要覆盖 `.md`/`.html`/`.docx`/`.pptx` 就得把 `doc-template` 的渲染与 `officecli` 的加工各实现一遍，仍覆盖不到模型手写的那两条路（技能正文明确把 `index.html` 与 `report.md` 的撰写交给模型）。契约从"核验已存在的字节"改成"生成字节"，`document-deliver` 现有的确定性核验、`block` 级拒绝与工作室的机器核验列都要跟着重写。 |
| (b) 在轮次边界做回复级检查（`agent/turn-stopping` + `agent.steer`） | 机制可用（见 1.1 末两行），但**触发条件不可判定**：监听器要么看回复文本判断"这一轮意在交付"（文档模式有意先写 `brief.md`、大纲与草稿，文件写入不是交付信号，标题也不是），要么对"本轮写过文件"一律要求登记（那会在每一轮草稿上 steer）。剩下唯一可判定的信号是"登记过没有"，而用声明去门禁声明本身不判定任何东西。第 3 段已为同一形态的检查（留档段做回复级判定）记录过一次否决，理由同族：判自由文本 + 每次否决多付一步模型调用。 |

### 1.4 工具被调用时实际守住的

- 声明的文件不存在即调用失败（幽灵文件不是交付物）；`.docx` 走包内文本投影，超出读取预算报 `unreadable` 而不是截断读取。
- `placeholder` 与 `anti_pattern` 判为 `block` 时直接拒绝登记，错误里点名文件、检查项与行号。
- persona 的第 6 条把"登记会被独立核验、阻断项不修复不得交付"写成纪律（`document.patch.yml:36`）。
- 工作室按会话日志与结果元数据渲染交付物清单与两列门禁状态，因此"这次登记过没有"在会话内可见——**缺的不是观测，是拒绝**。

### 1.5 什么条件下应当升级

文档模式若有一天声明一条唯一被认可的产出路径（像专利域把"只走 `render_patent_document`"写成硬规矩那样），并且存在一个逻辑上早于该路径、缺失可机械判定的中间动作，那么同一套 `deliveryGate` 直接可用——落点是该中间动作工具名进 `requires`。本轮不升级的代价如实记录：**会话可以在交付物未登记的情况下结束，没有任何东西拒绝它**；这条代价写在 `document-deliver` 的 README 里，与 `preset-mode-baseline.json` 记的"有意缺失行 + 理由"是同一处置方式（记录并给出理由，而不是留成"看不出是设计还是遗漏"）。

## 2. 09-30 对标清单 12 项再分诊

| 项 | 内容 | 结论 | 承接 / 理由 |
|---|---|---|---|
| P0-1 | 交付物的取代关系与"每轮必须留档" | **做（已落地）** | 第 3 段：新增单写者工具 `matter_log_append`（33 号工具）与取代链校验，并把它加进两个交付工具的 `deliveryGate` 前置；`verify-preset-tool-refs` 扩到解析门禁声明里的工具名。见 `.agents/notes/implemented/architecture/2026-10-12-matter-log-supersede-chain-gate.md`。不借鉴"时间戳文件名即版本历史"（与本仓日志为源的取向冲突）。 |
| P0-2 | 案卷问题条目字段化（`kind→disposition`、`blocking` 三档）与轮次上限 | **做（已落地）** | 第 4 段：`docket-issue.ts` + 随包 `assets/issue-dispositions.json`（六类 kind → 处置、三档 blocking）、plantask 转移守卫、`maxRounds` 进 `Config`（默认 3）、耗尽写进 run 结果。见 `.agents/notes/implemented/architecture/2026-10-12-case-docket-issue-grades-and-round-cap.md`。残余如实记录：把模型问题清单喂进 docket 的产出面工具不存在，条目式拒绝已随包但未被真实流程驱动。 |
| P0-3 | 交付物的确定性断言（引证必须来自工具返回值、分值/排序重算） | **不做（本轮）** | 两半分开判：单次工具产物的一致性（`claim_chart_build` 的 score↔status、TOP-N 排序与同公司去重）本身可做，但阈值语义（`disqualified ⟺` 权 1 明确不满足）来自汽车领域调参，搬进中文实务前必须重新标定；跨调用的"引证必须来自工具返回值"需要会话内累计，09-30 原文即警告"不要承诺成一行接线"。两者都需要先有标定，故不进本轮。 |
| P1-4 | 说明书分段计划（PGTree 类）作为一等产物 | **部分承接，其余不做（本轮）** | 承接：该条的另一半（"其审查循环无轮数上界，本项目必须设界并把耗尽记入 run 结果"）已由第 4 段的 `maxRounds` 与 `roundCapExhausted` 覆盖。不做的是"两层分段计划落 durable state 并先过 `awaiting_approval` 门"：外部证据只支持"长文需要一个外层分段纲要"这一产物形态（论文的代码与数据均未发布），落点是 plantask 新增 stage，与第 4 段同族但会把一次改动拆成两次设计。 |
| P1-5 | 错误类型学 → 规则资产 + 离线回归集 | **不做（本轮）** | 两套公开标注（PatentEval 的 7+18 类、Patent-CE 的五维 1,228 条）都是英文 USPTO/EPO 语料；18 类拆成可机检信号（前序基础、权项编号连续性、过渡词白名单、与在先权项的 n-gram 重合上限、摘要抄写率）需要先标定并换 CNIPA 条号，且 Patent-CE 为 CC BY-NC 4.0（只能内部回归、不可随商用产物分发）。 |
| P1-6 | 检索质量度量门（主指标 rank-of-first-relevant，BM25 基线） | **做（已落地）** | 第 5 段：`patent-tools/src/eval/ir-metrics.ts`（rank-of-first-relevant / MRR / nDCG）、仓库自撰 12 篇语料 + 10 条查询集 + **实测**的 FTS5 bm25 基线、判别力测试（退化排序必须显著更差）；同时把 `patent_eval` 的 `retrieval` 维度诚实化为"检索式形态"，不改判分行为。见 `.agents/notes/implemented/architecture/2026-10-13-retrieval-quality-metric-gate.md`。不引入 PatentMatch（许可未证实）、Patent-CE（非商用）与向量检索栈。 |
| P1-7 | 语义检索最小闭环 | **不做（留后）** | 三个前提只有半个满足：评测门（前置 ③）已由第 5 段给出，但它现在度量的是 FTS5 基线、还度量不了向量路径；其余两条仍缺——与 `dsh-ip-wiki` 的决策 D13（两者完全独立）冲突需要一次显式裁决（要么 ip-wiki 成为 Provider，要么 `patent-knowledge` 复用其端点，不要并存两套嵌入栈），引入向量存储是新的运行时依赖、须按插件纪律立项。 |
| P2-8 | 官方 API 与配额账本、同族去重、源中立记录 | **不做（本轮）** | 前置未清：EPO OPS 的免费阈值两处二手来源互相矛盾（3.5 GB/周 vs 4 GB/月）必须先向 EPO 确认；OPS 条款禁止把数据"as such"再分发；PatZilla 是 AGPL-3.0 + EUPL-1.2（只能学设计不能抄代码）。与本项目已有的第二通道不重叠也不替代：`#354` 的 CNIPR 是检索侧 provider，不是官方 API 的配额与限流账本。缺第二源时"源中立的统一模型"是空转，也正是本条排在此处的理由。 |
| P2-9 | 输入噪声鲁棒性冒烟 + 风格统计门 | **不做（本轮）** | 价值是防退化而非提质量（09-30 自己的排序即如此）；其数字基线（人类摘要 92.7 tokens、被动语态 43.6%）来自英文 USPTO，直接搬到中文实务会误导，需要先采本域基线才有对照。成本低，是下一轮的候选。 |
| P3-10 | 决策路径可分支/可恢复、被否方案留因由 | **不做（本轮）** | 只借数据结构（`path.json` + 每轮节点 + `refine\|merge\|split\|pivot` 词汇 + 归档理由）；要引入的是"从第 N 轮某方案分叉"这一等动作，而当前没有消费方（没有 UI 或工具读取分支），先做只会多一份无人读的 durable 状态。该仓库的检索层是空的，不作检索参照（09-30 已判）。 |
| P3-11 | 知识与案例入库门禁（脱敏门、状态门、嵌入指纹） | **不做（仓内）** | 落点是仓外的 `dsh-ip-wiki`（决策 D10：先自用 out-of-tree 验证，稳定后再内置），不在本仓插件范围内推进。若将来 `patent-knowledge` 也接向量，同一套门禁应共用，届时再立项。 |
| P3-12 | 工程规范三条 | **逐条定论** | ①**检索式语义契约写进工具描述：已具备，无需做**——`patent_search` 的 `query` 参数已写明接受 Google Patents 语法（关键词、短语、布尔、`assignee:` 等字段、`after:`/`before:` 日期区间），第二通道"只做关键词、带字段语法的查询不咨询它"由随包 usage note 说明（`packages/patent/patent-tools/src/tool/patent-search.ts:281,146`）。②**报告必须自述"跑了什么、跳过了什么"：不做（本轮）**——落点是 `patent-compliance-review` / `patent-quality-gate` 两处输出契约（当前两处均无 `ran\|skipped` 口径），与第 2 段刚迁入的体例判据同址，宜与 P1-5 合并成一轮，避免同一份契约改两次。③**增强步骤的显式 opt-in：当前不适用**——`patent` 侧还没有消费宿主模型 key 的查询扩展路径（HyDE 类增强未引入），条件成立时再按本仓"部署可变项进 `Config`"落地。另：工具清单门禁这一条 09-30 已判"不必借鉴"（`registration.spec.ts` 的 `EXPECTED_TOOLS` 是更强的变更探测器），本轮维持。 |

## 3. 与既有记录的关系

| 既有记录 | 本文件的态度 |
|---|---|
| [`2026-10-12-patent-document-mode-review.md`](2026-10-12-patent-document-mode-review.md) | 本文件回答其 §6「未证实项」第 1 条（文档模式的门禁强度是否为有意）与 §5 的 P2 行；其 §2.4「两个模式验收能力不对等」本轮**不动**：仓内不新增聚合面，专利侧的 `.dsh/reports/patent-optimization/` 账本本身是仓外产物，文档侧的跨会话聚合仍归延期的 document-workbench v2。 |
| [`2026-09-30-patent-domain-external-benchmark.md`](2026-09-30-patent-domain-external-benchmark.md) | 本文件把它的 12 项逐项定论（§2）；其 §6「明确不借鉴」八条继续有效（本轮未新增反例）。P0-1 / P0-2 / P1-6 的落地记录见各自 Agent Note。 |
| `docs/TECH_DEBT.md` | 本轮结果记入该文件的 2026-10-13 更新节。 |
| `#420` | 本条的五条 checkbox 与本文件的 §2 一一对应；勾选以承接段与 PR 为准。 |

## 4. 未证实项

1. 文档模式的实际使用中"交付物未登记"这一失败模式的发生率未测——文档侧没有语料观测面（见 §3 第一行），本文件只能证明"没有任何东西拒绝它"，不能证明它发生过、发生多少。
2. `agent/turn-stopping` 路线在文档模式下的具体行为未实机验证：否决理由是触发条件不可判定，不是在实现后观察到误判。判据来自第 3 段的机制核实与文档技能的撰写顺序（先 brief、再大纲、再草稿）。
3. P3-12 ② 与 P1-5 合并成一轮是否确实省工，属工程判断，未估算两者共用一份输出契约的实际工作量。
4. 09-30 清单里的英文数据集与阈值（P1-5 / P2-9）在本轮只核实了许可标签与语料语言，未取回语料本身复核分布。

## 5. 验收

- 本批次产出：本文件 + `document-deliver` README 双语的裁决条目 + `presets/document.md` / `.zh.md` 的一行指针。
- 12 项每条都有结论（§2），文档模式的门强度有书面裁决（§1）——两条验收均满足。
- 已跑：`pnpm run verify-translation-pairing`（本批次触到的配对已重录并复核）、`pnpm run test:docs`（文档类门禁集合）。
- 未跑：`test:coverage`、完整 `test`、`test:e2e`（本机无 `DEEPSEEK_API_KEY`）。本批次不含代码改动，未跑非文档类门禁。
