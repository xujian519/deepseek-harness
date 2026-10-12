# 专利模式与文档模式评审 — 调整取向与依据（2026-10-12）

- 触发：用户要求判断"根据最近一个月的开发，专利模式与文档模式是否应该进行调整和优化"。
- 范围：`packages/bundle/web-app/presets/patent.patch.yml` 与 `document.patch.yml`，以及两者的随包技能、领域包、门禁面与语料观测面。
- 方法：只读直读（两个 preset 全文、相关 README、`docs/tool-catalog.md`、四份前序审计）+ `git` 统计。**本文件产出代码零改动**。
- 基线：分支 `feat/patent-rule-warn-context`（相对 `master` 前进 7 个提交）。
- 工作区状态：评审期间工作区同时存在**另一会话**在 `packages/self-evolve/**` 与 `docs/{config,persistence}-catalog.*` 的未提交改动（38 个文件），与本批次无关，本评审的统计与结论不依赖它们。
- 前序：[`2026-10-10-repo-scan.md`](2026-10-10-repo-scan.md)（三模式扫描，16 条 issue 已闭合或转出仓外）、[`2026-09-30-patent-domain-external-benchmark.md`](2026-09-30-patent-domain-external-benchmark.md)（外部对标 12 项借鉴）、[`2026-09-21-patent-domain-review.md`](2026-09-21-patent-domain-review.md)（专利域代码质量）。
- 归档：[`2026-10-12-file-issues.sh`](2026-10-12-file-issues.sh)（本评审的待办，一条 issue，幂等）。已执行，创建为 **`#420`**。

## 0. 结论先行

**应该调整，但重点不是继续修缺陷，而是四项结构性的事。** 最近一个月是"高强度收口月"：三模式扫描的 16 条 issue 已全部闭合，四条假绿门禁被接进必过车道，受控草稿成为唯一内容通道，第二条检索通道进入 provider。收口方向正确，问题在于收口之后没有换挡——剩下的是"模式该长什么样""提示里该装什么""能力缺口补哪三个"这类需要裁决的判断，不是继续清点文档数字。

1. **两个模式是同一概念的两个实例，却没有共同标准。** `time-context` 两者都缺；"输出前强制质量门禁"这句纪律在两个模式里的执行强度不同；`tool-goal` 挂了而 `command-goal` 没挂。这些差异被 `preset-divergence-baseline.json` 记为"已知"，但没有一处记录**该不该有**。
2. **专利 persona 已从"人设"变成"运维手册"。** 固定前缀 16,678 字符（约 8.2k tokens），是文档模式的 8 倍；大量内容是技能与工具描述该承载的用法手册，并夹带部署可变项。
3. **09-30 对标清单未落地。** P0-1（交付物取代链与留档强制力）、P0-2（问题条目字段化与轮次上限）、P1-6（检索质量度量门）、P1-7（语义检索）在 `packages/patent` 与 `docs/` 内没有落地痕迹；近一个月的 `feat` 全部落在"已有能力的改造"上。
4. **两个模式的验收能力不对等。** 专利侧有语料观测与 KPI（能算出 `patent_search` 成功率 58.4%），文档侧没有任何度量，因此无法回答"这一版比上一版好在哪"。

另有一条操作性发现：**第二条检索通道的代码已在 `master`，但桌面应用未重新打包**，`app.asar` 里没有该通道的任何符号，#354 的语料级验收因此在等到重新打包之前不会改善。

**不建议动**：这一轮的四项成果（交付前置门禁、受控草稿单一内容通道、规则输出门、CNIPR 第二通道）不回退；不把文档模式拉成专利模式的规模（它不需要法条索引、期限、持久团队）；不拆技能（技能是按需加载的正确形态，要减的是 persona）。

## 1. 最近一个月的开发构成

统计口径：窗口起点 2026-09-12，终点为本分支 HEAD。

| 口径 | 数量 | 命令 |
|---|---|---|
| 触及 `packages/patent` 的提交（含分支与合并提交） | 195 | `git log --since=2026-09-12 --oneline -- packages/patent \| wc -l` |
| 触及 `packages/document` 的提交（同口径） | 59 | `git log --since=2026-09-12 --oneline -- packages/document \| wc -l` |
| 主线 first-parent 提交（`packages/patent`） | 107 | 追加 `--first-parent` |
| 主线 first-parent 提交（`packages/document`） | 19 | 追加 `--first-parent` |

专利域提交的类型分布（`packages/patent` + `presets` + `skills` 三路径合并，含合并提交）：`fix` 74、`feat` 60、`Merge` 32、`refactor` 27、`docs` 13、`test` 12。其中 `feat` 集中在两组改造——专利受控草稿（10-09）与 CNIPR 第二通道（10-12）——没有一项来自 09-30 的外部对标清单。

三个并列事实构成这份评审的前提：**收口量很大（195/59）、新增能力集中在两处改造、对标清单零落地。**

## 2. 发现

### 2.1 两个模式是同一概念的两个实例，却没有共同标准

| 维度 | 专利模式 | 文档模式 | 复查方式 |
|---|---|---|---|
| 装配行（顶层 / 嵌套） | 27 / 17 = 44 | 19 / 12 = 31 | `grep -c '^          - id:'` 与 `grep -c '^              - id:'` |
| persona 正文 | 16,678 字符（CJK 6,614，约 8.2k tokens） | 2,248 字符（CJK 827，约 1.0k tokens） | `patent.patch.yml:20-99`、`document.patch.yml:19-48` |
| 随包技能 | 15 个 / 104 KB | 6 个 / 24 KB | `packages/bundle/web-app/skills/{patent,document}` |
| 领域包 | `packages/patent/` 16 个 | `packages/document/` 5 个 | `ls -d packages/*/*/` |
| 专利域模型可见工具 | 55 | 0 | 见下 |
| 交付门 | `deliveryGate`（`:353`）：未跑过 `rule_check` + `law_verify` 就**拒绝** `render_patent_document` / `build_patent_filing` | `document_deliver`：模型**自愿**调用的登记 + 核验 | 两个 preset 与两个包 README |

专利域 55 个工具的构成（全部出自 `docs/tool-catalog.md` 的生成表）：`patent-tools` 32、`patent-document` 2、`patent-filing` 2、`patent-teams` 11、`patent-deadline` 1、`patent-fees` 1、`patent-law` 1、`writing-patterns` 1、`methodology` 1、`tool-literature` 3。

差异本身合理。问题在三处**看不出是设计还是遗漏**：

**（a）两个模式都没有 `time-context` 行。** `standard` / `cordis` / `ptc` 有，专利与文档没有（`grep -rn "time-context" packages/bundle/web-app/presets/` 只命中这三个）。`@deepseek-ai/dsh-time-context` 的 README 明写"`standard`、`cordis`、`ptc` declare it"，且不改 `system-prompt` 的 `personaPrefix`（该前缀只声明模型名与语言策略），所以这两个模式的 agent 拿不到当前日期。而两者都是日期敏感：专利 persona 把期限纪律写成硬要求（"日期一律用 `patent_deadlines` 按现行细则计算"），文档 persona 要求"页脚版本与日期""事实性断言的日期必须可验证来源"。模型只能绕道跑 `date`。

**（b）"输出前强制质量门禁"在两个模式里的执行强度不同。** 专利的门设在"产出交付件"这一步（渲染与成文调用被拒），文档的门设在"登记交付"这一步——模型不调 `document_deliver` 而直接回复，就没有任何东西阻止它。`document_deliver` 自身是 fail-closed 的（`placeholder` 与 `anti_pattern` 是 `block`，抛错拒绝登记），但它不是 `tools/post-execute` 上的门，没有"交付前必须跑过"的强制。

**（c）挂了 `tool-goal` 却没挂 `command-goal`**，`/goal` 命令入口因此缺失；`tool-schedule` 也没挂，而专利的答复期限提醒本可以用它。整行缺失清单（相对 `standard`，排除 `preset-standard` 自身声明行）：

| 文件 | 缺失行 |
|---|---|
| `patent.patch.yml` | `command-goal`、`present`、`time-context`、`tool-plugin-manager`、`tool-plugin-market`、`tool-schedule` |
| `document.patch.yml` | 上述 6 个 + `openviking` |

`preset-divergence-baseline.json` 的 `rowSets` 分区已经记录了这些缺失（#385 的处置是"记录"而非"补齐"），但记录里只有 id，没有理由；#322 留下的"给基线每条记录补理由"这一通用做法也仍未做。

### 2.2 专利 persona 已从"人设"变成"运维手册"

`patent.patch.yml:20-99` 是 16,678 字符的固定前缀，每请求都付。内容构成上，身份与不可协商的纪律约占三成，其余是操作手册：法条核验流程、cnlaw 的 MCP 与 REST 端点调用法、图谱与判例的定向检索式格式、团队派工模板、工作台协作、通道优先级、体例参数（含"4.23 毫米"）。它点名引用了 17 个技能。

四个具体代价：

1. **固定成本 vs 按需成本。** 同等内容放进技能是按需加载的（技能库 104 KB 只在加载时付费），放进 persona 是每请求都付。加上 55 个专利域工具的 schema，固定前缀对上下文与工具选择的压力是叠加的。
2. **部署可变项写死在提示里。** persona 里给了 cnlaw 端点、通道顺序、图面字号下限；而 `figureFontMm: 4.25` 已经进了 `Config`（`patent.patch.yml:319`），persona 又抄了一遍 4.23 毫米。本仓的规则方向是"部署可变项进 Config、一处一个权威"。
3. **重复维护。** 案型路由、交付纪律、通道纪律在 persona 与技能里各有一份；10-10 那一轮已见过这类副本失真的实例——`fetch` 两侧取值相反、`patent.md:77` 与代码相反、`patent.patch.yml:80` 的"实测"断言没有可复算出处（三处均已修，但根因是"同一事实两处维护"）。
4. **迁移已在发生，但方向相反。** `patent-law` 的 README 明确写"persona 与专利技能把这个底座当作 cnlaw 声明段来引用，因此随包文本不写端口"——即插件侧已经在做"声明段 + 引用"，persona 侧仍在写端点细节。

可执行的目标：persona 压到 12 KB 以内，"作业手册"段迁进技能或工具描述，persona 只留身份、不可协商的纪律、案型路由。

### 2.3 09-30 对标清单未落地

09-30 的外部对标给出 12 项借鉴，本仓落地情况（核查命令与结果）：

| 项 | 内容 | 落地痕迹 | 核查方式 |
|---|---|---|---|
| P0-1 | 交付物取代链与每轮留档强制力 | 无 | `git grep -in supersedes -- packages/patent docs` 的 4 处命中全在 `llm-streaming`、`patent-law` 等无关语境 |
| P0-2 | 问题条目字段化（`kind→disposition`、`blocking` 三档）与轮次上限 | 无 | `max_rounds`、`issue_item` 零命中；`disposition` 的 5 处命中全在 `subprocess`、`capability-seams` 等无关语境；`docket` 仅 `docs/patent-workbench-plan.md:43` 的一句提及 |
| P1-6 | 检索质量度量门（主指标 rank-of-first-relevant，BM25 基线） | 无 | `nDCG`、"rank of first" 零命中；`patent_eval` 的 `retrieval` 仍是"关键词条数 ≥3 即 1.0"（`packages/patent/patent-tools/src/tool/patent-eval.ts:163-170`） |
| P1-7 | 语义检索最小闭环 | 无 | `packages/patent/patent-knowledge/README.md:86` 仍写 "No vector or semantic retrieval in P1" |

三项（P0-1 / P0-2 / P1-6）有外部一手证据支撑、落点也在既有扩展点上，且与这一轮已被验证有效的手法同族：把"人工勾选约定"换成"确定性 gate"。同一手法的效果有先例——`patent_workflow_run` 曾是 91 次 offered / 0 次调用，加交付前置门禁后不再是零（#351）；三个交付闸门曾是零加载（#352）。

### 2.4 两个模式的验收能力不对等

专利侧有语料观测面：`.dsh/reports/patent-optimization/` 下的 `bypass.json`、`errors.json`、`kpi.mjs`，能算出 `patent_search` 10-03 后成功率 58.4%、`patent_metadata` 37.9%、旁路次数（#354 的复核评论）。文档侧没有对应物，因此文档模式的任何改动都无法回答"变好了没有"——这也是 2.1(c) 之外，第二个"两个模式不对等"的具体面。

## 3. 操作性发现：代码已改，部署未升级

> 本节证据来自 `#354` 的部署侧核对评论（2026-10-12 晚），**本评审未复跑打包件比对**。

#354 的第二条检索通道（CNIPR 作为 `patent-data` 的 provider）代码已在 `master`，但桌面应用没有重新打包：已安装的 `/Applications/DSH Patent.app` 与本地打包产物 `apps/desktop/.desktop-build/targets/mac-arm64/.../DSH Patent.app` 的 `app.asar` 里，`cnipr-channel` / `cniprEnabled` / `CNIPR_SEARCH` / `EGO_CNIPR` 全部零命中，对照字符串 `dsh-patent-tools` 133 处、`patent_search` 30 处。核心 bundle（含 `patent-data` / `patent-tools`）由打包件的 `resources/app.asar/dsh` 提供，不进 profile 存储，因此"装个插件就升级"这条路不通。

后果：#354 的第 1 条验收（成功率 ≥90%）在重新打包并替换安装件之前不会因为等待而改善。任何"模式调整是否有效"的语料级验证都受这条约束。

## 4. 不建议动的部分

- **不回退这一轮的四项成果**：交付前置门禁、受控草稿单一内容通道、规则输出门（含本分支的 warn 级上下文）、CNIPR 第二通道。
- **不把文档模式拉成专利模式的规模**：文档域不需要法条索引、期限计算、持久团队，`document_deliver` 的确定性核验面（占位符、禁用词、空节、断锚、长度预算）已覆盖文档域机械可判定的部分。
- **不拆技能**：技能是按需加载的正确形态，减重要减在 persona。
- **新机制要设边界**：本分支把 warn 级规则命中作为下一次请求的模型上下文（`patent-rule` 的 `warnContext`），机制正确（模型可见且入日志），但每次门禁工具命中都会追加一条 user message，需要观察累积；同时 `log` 级命中只留日志、模型看不见，这条要么升到 warn，要么明确它是纯审计。

## 5. 建议与优先级

| 优先级 | 事项 | 理由 | 风险 |
|---|---|---|---|
| P0 | 定一份"交付型模式基线"：`time-context`、交付门、命令与工具配套（`command-goal` / `tool-schedule`），并把有意差异写进基线理由 | 这是"模式"这个概念的自我一致性；现在差异既无理由也无裁决 | 需逐行判断 `present` / `plugin-*` 是否该有，不能盲补 |
| P0 | 专利 persona 减重到 12 KB 以内，作业手册迁入技能或工具描述 | 每请求固定成本；部署可变项硬编码与"一处一个权威"相反 | 迁移中容易丢纪律，需用快照对位 |
| P1 | 落地 09-30 的 P0-1 与 P0-2（取代链与留档强制力、问题条目字段化与轮次上限） | 有外部一手证据；落点在既有扩展点；与已验证有效的手法同族 | `blocking` 的粒度设计最容易做错（二元 gate 会让每次问人都停摆） |
| P1 | 检索质量度量门（P1-6） | 第二通道已落地，没有度量就无法验收 | 数据集许可（Patent-CE 为非商用）、抽样要贴近真实分布 |
| P2 | 文档模式补齐（`time-context` + 交付门强度）并建立自己的观测面；把 09-30 的 12 项重新分诊，明确不做哪些 | 消除两模式强度不对等；避免清单无限期悬空 | 需先确定文档模式的度量方式 |

## 6. 未证实项

1. 文档模式当前的门禁强度是否是**有意**低于专利模式。两个 preset 与两个包的 README 都没有裁决记录；本文件只记录"强度不同"这一事实，不判定意图。**已裁决（2026-10-13）**：是有意差异，理由、两条被否决的更强路线与该模式实际守住的部分见补篇 [`2026-10-13-document-gate-ruling-and-benchmark-triage.md`](2026-10-13-document-gate-ruling-and-benchmark-triage.md)；裁决正文落在 `packages/document/document-deliver/README.md` 的已知限制第 2 条。
2. `present` / `tool-plugin-market` / `tool-plugin-manager` 对两个模式是否有真实用途，未逐个评估（本文件只指出它们整行缺失且无理由记录）。
3. 专利 persona 减重到 12 KB 是否可行，未做迁移试验；12 KB 是按"身份 + 纪律 + 路由"的构成比例估的目标值，不是实测上限。
4. 09-30 清单的落地核查只覆盖 P0-1 / P0-2 / P1-6 / P1-7 四项关键词核查；其余八项（P0-3、P1-4、P1-5、P2-8、P2-9、P3-10、P3-11、P3-12）未逐项复算，其中 P3-12 的"报告自述跑了什么、跳过了什么"与 10-10 批次的部分改动可能有重叠。
5. 本文件未跑 `pnpm run lint` 与 `test:snapshot`；产出是一份 Markdown 报告与一份归档脚本，不含代码与模型可见文本。已跑的文档类门禁见 §8。

## 7. 与既有报告的关系

| 既有记录 | 本文件的态度 |
|---|---|
| [`2026-10-10-repo-scan.md`](2026-10-10-repo-scan.md) | 那轮是**缺陷扫描**（计数、路径、可达性、盲区），16 条已闭合；本文件是**取向评审**，不重复任何一条已闭合项。其中 `time-context` 缺失那一条（#385）当时的处置是"记录"，本文件要求把它升级为裁决。 |
| [`2026-09-30-patent-domain-external-benchmark.md`](2026-09-30-patent-domain-external-benchmark.md) | 那轮产出 12 项借鉴，本文件第 2.3 节核实其零落地，并把其中的 P0-1 / P0-2 / P1-6 提到本轮的 P1。 |
| [`2026-09-21-patent-domain-review.md`](2026-09-21-patent-domain-review.md) | 代码质量视角，与本文的取向视角无重叠。 |
| `docs/patent-mode-design.md` §12 七道防线 | 本文件的 P0（交付门强度）是防线 5（输出门禁）在两个模式间的**一致性**问题，不是新增防线。 |

## 8. 验收

- 本文件产出：本报告 + [`2026-10-12-file-issues.sh`](2026-10-12-file-issues.sh)（一条 issue，幂等；已执行为 `#420`）。**代码零改动**。
- 本批次只新增这两份文件；工作区同期存在的 `packages/self-evolve/**` 与 `.agents/notes/**` 改动来自另一会话，不属于本批次。
- 已跑 `pnpm run verify-repository-references`：通过（无提交标识与受限组织 URL）。
- 已跑 `pnpm run test:docs`：本批次两份文件落盘后的首次运行 **28 passed / 0 failed**（含 `markdown links`、`doc budgets`、`preset tool references`、`preset divergence baseline`）。
- 回填 issue 编号后复跑 `test:docs`：`translation pairing` 红，失败文件是 `.agents/notes/implemented/process/2026-10-10-upstream-dsh-v0.2.1-alpha.2-sync.i18n.yaml`（另一会话在评审期间同时改了该 note 的中英两版，`git status` 显示为未提交改动）。该文件不在本批次范围内，本批次的两份文件不参与中英配对。
