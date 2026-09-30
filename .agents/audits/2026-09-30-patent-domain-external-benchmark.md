# 专利域外部对标：可借鉴项（2026-09-30）

> 目的：对用户简报中列出的开源项目与论文做一手核实，判断本项目（deepseek-harness 的专利域插件族 + `patent` agent preset）有哪些值得借鉴的优化点。
> 方法：三路并行调研（A 类技能包 / B 类检索数据平台 / C 类生成与评测研究），全部走 `gh api` 与官方站点/论文原文，只读，未在仓库内产生任何改动。A 类与 C 类在 `/tmp` 留痕；调研原始报告见本文件 §9 的来源清单。
> 边界：M-Cube 已有专项报告（`~/projects/Sati/deepresearch-output/mcube-multimodal-vs-sati.md`，R1–R11 缺口清单），本文件不重复展开。
> 既有规划的借鉴项（`docs/patent-workbench-plan.md` §5 的 star 核验清单、`docs/sati-as-dsh-plugins-plan.md` §1.3 的"不移植"清单）视为已知，本文件只在需要修正或推进时引用，不重新立项。

---

## 0. 结论先行

1. **本项目专利域的"工具面、法条/费用/期限基座、durable 日志、规则引擎 + 输出门、持久团队"强于本批全部开源项目**；这些项目强在本项目较薄的三处：**交付物的版本/取代关系与每轮留档的强制力**、**案卷"问题条目"的字段化与轮次上限的机器校验**、**证据引证的确定性断言与检索质量的度量基准**。
2. **最该做的不是补功能，而是把已有的"人工勾选约定"换成确定性 gate。** 本仓 AGENTS.md 要求"把机械可检的不变量接进被执行的顶层门禁，并为每条改动的验收路径证明它能拒绝无效用例"；而当前 `patent-matter` 的 `_checklist.md` 是人工勾选、`patent_eval` 的 `retrieval` 模式只统计关键词条数（`>=3` 即 1.0 分，见 `packages/patent/patent-tools/src/tool/patent-eval.ts:163-170`）——两者都不是可拒绝无效输入的判定。
3. **一条外部量化背书值得写进决策依据**：PatentEval（NAACL 2024）测量各自动指标与专家判断的 Kendall τ，**规则检查器 τ=0.4120 高于全部语义相似度指标**（加权语义 0.2848、SemSim 0.1278、EntityGrid 0.0309、IPC 微调语义 0.0249）。这独立支持本项目的 rule-engine-first 架构，并给出分工依据：**语义覆盖交给模型（LLM-judge 在"要点覆盖"上最强），形式合规交给确定性规则**。
4. **用户简报中有 9 处与一手证据不符**，其中 3 处会实质影响判断（见 §2）：`illusionality/aloh-my-patent` 不存在；AutoPatent 的"代码开源"不成立（无代码无数据）；"通用大模型优于领域小模型"不是 PatentWriter 的结论。

---

## 1. 证据分级

| 级别 | 含义 | 本文件用法 |
|---|---|---|
| 已核验 | 一手来源（GitHub API / 原文文件 / 论文 HTML / HTTP 状态码）直接支持 | 作为结论正文 |
| 部分证实 | 仓库有对应物但表述需收窄（如"动态激活"实际无显式规则） | 标明收窄后的表述 |
| 未证实 | 本环境取不到（DNS/403/需登录）或来源相互矛盾 | 单列 §8，不作决策依据 |

---

## 2. 用户简报的一手纠错

| # | 简报表述 | 一手证据 | 结论 |
|---|---|---|---|
| 1 | patent-disclosure-skill「~9.3k star」 | `gh api repos/handsomestWei/patent-disclosure-skill` → `stargazers_count: 10500` | 实际更高；MIT、未归档、主分支末次提交 2026-09-24 属实 |
| 2 | 同上「含 patent-docket / patent-reader」 | 根目录 `SKILL.md`（路由，v4.13.0）+ `skills/` 下 **8 个子技能**：patent-disclosure / patent-application / patent-docket / patent-search / patent-reader / patent-map / patent-oa / patent-exam-policy | 属实但不完整；真正有价值的是未被提及的 `patent-docket` 状态机与 `patent-oa` 案例库 |
| 3 | Claude-Patent-Creator「13 个 Skills 按操作动态激活」 | `skills/` 实测 **17 个**目录（13 是 CHANGELOG 中 0.2.0 的历史数字）；各 `SKILL.md` 只有 `description` frontmatter，**无 `globs`/`paths`/触发规则**；`hooks/hooks.json` 仅 `SessionStart` 与一条 `PreToolUse` 提示 | "17 个"已核验；"按操作动态激活"在 HEAD 未证实，实际是宿主按 description 语义匹配 |
| 4 | 同上「MCP Server + Plugin 双层」 | 仓库同时有 `mcp_server/`（31 工具）与 `.claude-plugin/`，但 `.mcp.json` 内容为 `{"mcpServers": {}}`，`plugin.json` 自述 "NO MCP server required" | 部分证实：两层都在仓库，是否同时生效取决于是否执行 `patent-creator setup` |
| 5 | 同上「BigQuery 76M+ 专利」 | GitHub 描述写 76M+，README/pyproject 一律写 100M+ | 口径未统一；数据集为 `patents-public-data.patents` |
| 6 | `illusionality/aloh-my-patent` | `gh api repos/illusionality/aloh-my-patent` → **404**；实际仓库为 **`illusionaireal/oh-my-patent`**（98★，MIT，TS，npm `oh-my-patent` 0.3.3） | 仓库名与 owner 均写错；且其 `docs/RETRIEVAL_DEV_PLAN.md` 自述"检索没血肉"，TS 层零检索实现 |
| 7 | yuc16/PatentRadar | 64★、1071 blob / 294 MB；**无 LICENSE 文件且 `gh api` 返回 `license: null`**（README 声称 MIT） | 描述属实；许可证**未证实**，不可复用其代码 |
| 8 | AutoPatent「代码 QiYao-Wang/AutoPatent」 | 全仓库仅 `README.md` + 10 个示例 PDF + 网页资源 + `requirements.txt`；README：数据与代码"upon the paper's acceptance"才发布 | **代码与 D2P 数据集均未发布**，无可复用实现 |
| 9 | PatentWriter「结论是通用大模型优于领域小模型」 | 该表述出现在 §1 相关工作，引述 **Jiang et al. (2025)**；本文实验基线只有 6 个通用模型 + 人类 + 随机，**从未跑 PatentGPT/PGT** | 属转引失真；真正跑过该对照的是 PatentEval |

另有三处需要收窄或修正的技术表述：AutoPatent 的 PGTree 是**两层**多路树（论文 §4.2 原文 "two-layer multi-way tree"，"三层"混淆了三个步骤与树的层数）；"均长 14k tokens"指**说明书**均值 14,081.4，完整专利均值 17,005.3；PatentWriter 是"首项权利要求 → 摘要"的**短文本**基准（人类摘要均值 92.7 tokens），不是整篇撰写基准。

---

## 3. 本项目基线（已核验，作为"不必借鉴"的对照）

| 能力 | 现状与证据 |
|---|---|
| 工具面 | `patent-tools` **30 个模型可见工具**（`packages/patent/patent-tools/tests/registration.spec.ts:11-41` 的 `EXPECTED_TOOLS`）；另有 `render_patent_document`、`patent_deadlines`、`patent_fees`、`law_verify` 与 11 个 `patent_teams_*` |
| 技能面 | `packages/bundle/web-app/skills/patent/` 下 **15 个技能** |
| 规则与门禁 | `patent-rule` 的 YAML 规则包（`assets/rules/**`，含 `check.type` 结构化判据）+ `RuleOutputGate` 挂在 `tools/post-execute`（`src/index.ts:188`）+ EVI-011 证据守卫；`patent-workflow` 的 `slop-gate` 与 8 个 manifest |
| 过程留档 | `patent-matter` 技能：七级目录 + `_case-registry.md` + **只追加** `_matter-log.md` + 产物文件头元数据（来源/版本 v1v2/审批/时间戳）+ `_checklist.md` **人工勾选**；与 plantask 事件并轨，事件日志为唯一事实源 |
| 团队 | `patent-teams` 持久团队 + `patent-team-composition` 七场景角色包（角色目录 14 角色 / 16 worker） |
| 法条/费用/期限 | 随包索引（《专利法》36/82 条、《专利法实施细则》26/149 条已转录；《审查指南》仅主题），`law_verify` 对未转录条目报"未核验"不放过；`patent_fees` 未转录则拒绝给合计；`patent_deadlines` 含节假日顺延 |
| 检索 | 本地 nuo 引擎（`patent_search`/`patent_metadata`/`patent_legal_status`）+ `patent_pdf_download`（ego-browser 拦截，回退 CDN 抓取）+ `patentKnowledge` 的 FTS5/LIKE 检索 + 用户级 CNIPR/CNIPA/Google Patents 技能 |
| **向量检索** | **无**。`packages/patent/patent-tools/README.md:127`「Semantic recall removed … dsh ships no vector infrastructure yet」；`patent-knowledge/README.md:82`「No vector or semantic retrieval in P1」；`patent-knowledge/src/install.ts:107` 安装时丢弃 `embeddings`/`ivf_index`/`index_meta` |
| 领域评估 | `patent_eval` 五模式为**表面代理**：`retrieval` 只数关键词条数（`:163-170`），`workflow` 只数"步骤/Step/阶段"标题（`:172-180`），`citations` 只查要求字符串出现与条号正则（`:182-197`）；无 IR 指标、无金标准集、无分值重算 |
| 本机已具备的语义基建（仓库外） | `dsh-ip-wiki`（out-of-tree，`~/projects/dsh-ip-wiki`，P0–P3 已实施）已实测可用：`http://127.0.0.1:8000` 提供 `bge-m3-mlx-fp16` 嵌入（1024 维）与 `BAAI-bge-reranker-v2-m3-mlx-fp16` 精排 |

---

## 4. 对比矩阵（A 类四项目 × 本项目）

| 维度 | 本项目 | patent-disclosure-skill | Claude-Patent-Creator | oh-my-patent | PatentRadar |
|---|---|---|---|---|---|
| star / 许可 | 内部 | 10,500 / MIT | 190 / MIT | 98 / MIT | 64 / 无 LICENSE |
| 维护 | 活跃 | 活跃（单人 52/60 提交） | 活跃（beta） | 活跃（单人） | 2026-08 后未动 |
| 工具面 | 30(+15) | 无工具注册（脚本 + prompt） | 31 MCP 工具 | 0 个专利工具 | 若干 MCP 工具 |
| 多智能体 | durable 团队 + 角色包 | 单协调者派工 | 13 agents（提示词级） | 14 agents（宿主执行） | 4 subagent 串行 |
| 规则/门禁 | 规则引擎 + 输出门 + 守卫 | 2 个局部校验脚本 | 分析器输出结构，无交付门 | schema 校验（阶段 1） | **提交级业务校验器（最接近）** |
| 过程留档 | 只追加日志 + 文件头版本（人工勾选） | **docket 状态机 + 时间戳版本 + 强制留档段** | 无 | **决策图 + 原子写 + 快照** | SQLite 案卷 + 阶段索引 |
| 检索质量度量 | **无**（`patent_eval` 为关键词代理） | 无（LLM 打分不落盘） | 无公开评测 | 无（未实现） | **有黄金集 + 反幻觉度量** |
| 法条/费用/期限 | 随包索引 | prompt 内写死口径 | 自建 500 MB 语料索引 | 靠外部 MCP | 无 |
| 输出可重构 | Model-visible ⟺ logged | 无 | 无 | 原子写 + 校验器 | 搜索审计 + 证据审计 |

一句话：**本项目的弱项正是这四家各自最强的那一格**——留档强制力（patent-disclosure-skill）、输出可判定性（PatentRadar）、决策可复现性（oh-my-patent）、工程规范（Claude-Patent-Creator）。

---

## 5. 可借鉴清单

排序依据：能否用本项目既有扩展点落地 × 是否直接作用于专利实务质量 × 是否已有外部量化证据。

### P0-1 交付物的取代关系与"每轮必须留档"

- **借鉴什么**：patent-disclosure-skill 的三条硬规则——① 交付物一律另存新文件、**禁止覆盖**上一轮；② 每次迭代必须在同一回复内追加固定标题的"合并摘要（留档）"，写明改了哪些章节/原因/是否影响保护点，**未输出该节视为本轮未完成**；③ 修订日志脚本只追加（`prev + "\n" + entry`），字段含本地时间与 UTC、轮次类型、用户诉求摘要、本轮交付文件名。
- **本项目现状与缺口**：`_matter-log.md` 已只追加、产物文件头已有"版本 v1/v2"，但 ①"版本"是文件头里的自述，**没有显式的取代链**（谁取代谁、取代原因）；② 没有"每轮交付必须带留档摘要"的强制力，该约定未进任何 gate。
- **落点**：`patent-matter` 技能的输出契约（留档段必须出现在交付回合）+ 交付登记进 `_matter-log.md` 时新增 `supersedes` 引用；若要机器校验，落在 `patent-rule` 的交付规则（检查交付回合是否含留档段与 `supersedes` 字段）。
- **前提与风险**：不要照抄"时间戳文件名即版本历史"（与本项目 durable 日志为源的设计冲突）；本项目应保持"日志为源、文件为投影"。

### P0-2 案卷"问题条目"的字段化与轮次上限的机器校验

- **借鉴什么**：patent-disclosure-skill 的 `patent-docket` 把案卷协调做成**数据 + 校验器**，而不是散文：`docket.schema.yaml` 定义 `issue_item = [id, summary, kind, disposition, status, blocking, round_opened]`；`issue_taxonomy.md` + `dispositions.yaml` 给 `kind → 默认 disposition` 映射（如 `machine_format→application_fix`、`scope_strategy→ask_human`（**默认不阻塞**，仅"用户已要求改独权但未说明怎么改"才 `blocking: true`）、`noise→ignore`）；`phases.yaml` 写 14 个阶段与转移表，并给四条不变量（交底初稿未完成不得进入申请阶段；存在 `blocking` 且 `status=open` 的 `ask_human` 条目时只能停在 `ask_human` 或终态；终态禁止再派工）；`validate_docket.py` 把这些不变量变成错误码，并配 `tests/test_docket.py` 逐条断言（如 `test_blocking_forbids_dispatch`、`test_max_rounds_cap`）；`max_rounds: 3` 写进配置，"第 3 轮必须停"写进文档。
- **本项目现状与缺口**：有工作流状态机（`patent_workflow_run` 的 manifest + `awaiting_approval` 门）、团队任务、`_matter-log.md`；**没有"问题条目"这一等公民**，因而没有 kind→处置映射、没有阻塞粒度、没有轮次上限与其机器校验。`_checklist.md` 是人工勾选，勾选错误不会被拦。
- **落点**：① `patent-matter` / `patent-oa-response` / `patent-reexamination` 技能的"问题清单"输出格式改为条目字段（可直接复用其字段名）；② 不变量做成 `patent-rule` 的规则资产或 `patent-workflow` 的一个确定性 stage handler——"`blocking && open` 时禁止进入派工态"是一条纯函数；③ 轮次上限进 `Config`（不得硬编码）。
- **前提与风险**：那条"不是所有问人都阻塞"的粒度设计是本项目最容易做错的地方（常见做法是二元 gate，会让每个问人都停摆），建议原样采纳其三档语义（不阻塞 / 阻塞 / 升级为终态）。

### P0-3 交付物的确定性断言（把"引证必须出现"变成拒绝条件）

- **借鉴什么**：PatentRadar 的 `mcp/.../workflow.py` 是本批证据里最完整的**提交级业务校验器**，其判据全部是纯函数：`score` 必须等于 `STATUS_SCORE[status]` 常量映射；`total_score` 必须与"各特征 ratio 均值 × 100"在 `abs_tol=0.02` 内一致；TOP-N 必须按分降序、**同公司只保留最高分**、上限 5 条、`(company, product)` 不得重复；`明确满足` 必须至少 1 条**绝对 HTTP(S)** 证据 URL；`可能满足/证据不足` 必须给出"恰好两行、分别以『还缺：』『下一步建议：』开头"的缺口说明，非缺口状态该字段必须为空；报告正文必须**逐字包含**每个 `feature_id` 与每条证据 URL；提交阶段必须等于应提交阶段；配置了搜索 key 时模块二必须真的调用过 discovery 与 evidence 两种模式（失败也算已尝试）。
- **本项目现状与缺口**：已有 `rule_check`、`tools/post-execute` 输出门、`patent_eval` 的 `citations` 模式与 `patent-fact-check` 技能，但**缺跨文档一致性断言**（引证是否出自工具返回值）与**分值/排序重算不变量**；`patent_eval` 的判据是"字符串出现 + 条号正则"，可被"写了但错了"绕过。
- **落点**：扩展现有 `patent_eval` 的 `citations`/`report` 维度（不新建工具）与 `patent-rule` 规则包。单次工具产物的一致性（如 `claim_chart_build` 输出的 score↔status、排序与去重）在 `tools/post-execute` 内可直接判定；**跨调用的"引证必须来自工具返回值"需要会话内累计**（run 记录或会话事件），这一步需要单独设计，不要承诺成一行接线。
- **前提与风险**：`disqualified ⟺ 权1 明确不满足` 这类阈值语义来自汽车领域调参，直接搬到中文实务前需要重新标定。

### P1-4 说明书分段计划（PGTree 类）作为一等产物，且先过人审

- **借鉴什么**：AutoPatent 的消融是本批**最强的一条机制证据**：同一底座下带 PGTree 时 BLEU 50.83 / 输出 13,018 tokens，去掉 PGTree 后 3.43 / 1,914 tokens（Table 3；论文 §6.1 称"近 15 倍下降"）。它证明的是"**长文必须有一个外层的分段纲要**"这一结构性事实，而不是某个树算法好。其 RRAG 的另一半是：把**同一案子内已接受的短组件（标题/摘要/背景/发明内容/权利要求）与交底草稿**作为参考原文搬进每个分段，要求"原样拷贝、不得修改或新增"。
- **本项目现状与缺口**：`draft_specification` 是确定性工具，`writing-patterns` 提供 10 条撰写模式与 `evaluateQuality` 四维打分，但**没有"先产出并冻结一份分层分段计划、再逐段生成"的显式持久化产物**。
- **落点**：`patent-workflow` 新增一个 stage（atom），产出两层分段计划（大节 outline + 每节的写作指令）并落盘为 durable state；本项目的增量优势是**让这份计划先过 `plantask` 的 `awaiting_approval` 门**再进入逐段生成——AutoPatent 的 PGTree 从不经人审。分段指令的模板来源可用现有 `writing-patterns`。
- **前提与风险**：论文用 BLEU/ROUGE 度量、英文 USPTO 数据、**代码与数据均未发布**，因此只借"产物形态与生成顺序"，不借其数字作为中文实务的可用性证据。其审查循环**无轮数上界**，本项目必须设界并把耗尽记入 run 结果（与 P0-2 的轮次上限合流）。

### P1-5 错误类型学 → 规则资产 + 离线回归集

- **借鉴什么**：PatentEval（NAACL 2024，Inria；arXiv 2406.06589）给出**7 类摘要错误**（语法/不相关内容/覆盖不全/冗长/矛盾/不清楚/无效摘要——把权利要求逐字抄成摘要也计为错）与**18 类权利要求错误子类**（含前序基础错误、前序部分不一致、过渡词错误、从属引用不清晰、独立权利要求区分度不足、术语不一致、非区别性重复等），逐条挂 WIPO 页码；其人工标注 JSON 与逐模型预测**已随仓库公开**。Patent-CE（ACL 2025；arXiv 2505.11095）给出**五维对比标注**（特征完整/概念清楚/术语一致/逻辑连接正确/整体质量），1,228 条四元组、含执业专利律师标注，公开仓库为 `scylj1/PatClaimEval`（`quality_test.json` 184 条）。
- **落点**：`patent-rule` 的规则资产（把 18 类拆成可机检信号：名词短语首次出现无定义位置 = 前序基础；权项编号连续性；过渡词白名单；与在先权项的 n-gram 重合上限；摘要抄写率）+ `patent-quality-gate` 技能第 5 条（现仅"清楚/支持/充分公开/单一性/修改超范围"5 个粗项）细化为可归因条目；用两套公开标注建离线回归集，校准 reviewer 与专家偏好是否同向。
- **前提与风险**：Patent-CE 数据为 **CC BY-NC 4.0（非商用）**，只能内部回归、不可随商用产物分发；两套数据均为 USPTO/EPO 英文，阈值与法条引用须换为 CNIPA 条号；PatentEval 明确**不评新颖性/创造性**（需外部检索库），所以它只能补"形式与清楚性"这一层。

### P1-6 检索质量的度量门（先有基准，再谈改造）

- **借鉴什么**：PatentMatch（EPO 全文 + 检索报告派生，审查员标注的"权利要求 ↔ 破坏新颖性的对比文件段落"配对，MIT 代码）作为金标准；SearchFormer（EPO，World Patent Information 2023）给出**主指标 = rank of first relevant result**，并以 **BM25 作为必须打败的基线**（2014 对申请/对比文献，α=0.01 显著）。
- **本项目现状与缺口**：`patent_eval` 的 `retrieval` 模式只数关键词条数（`>=3` 即满分），不是检索质量度量；`patent-knowledge` 为 FTS5/LIKE，其 BM25 恰好就是天然基线，但**没有任何指标记录它当前的位次**。
- **落点**：纯评测资产（挂 `benchmarks/` 或 `patent_eval` 旁），**不改现网检索路径**；主指标 rank-of-first-relevant，辅以 MRR/nDCG。
- **前提与风险**：需先确认 PatentMatch 数据集的下载与使用条款；抽样策略要与真实请求分布对齐，否则评测集自欺。
- **为什么排在这里而不是更高**：它是"后续所有检索改造的验收前提"，但本身不提升当下产出质量；若时间有限，P0 三项的即时收益更大。

### P1-7 语义检索最小闭环（本机基建已就绪）

- **借鉴什么**：PQAI 在无 GPU 条件下跑全库的取舍可以直接抄——**384 维句向量 + 余弦 + 近似最近邻 + 按技术领域（CPC 子类）分片 + 先用轻量分类器选片 + 两级排序（ANN 召回 → 交叉编码重排）**；其 `/snippets/` 与 `/mappings/` 提供命中片段与逐元素映射，是产品化的"可解释性"重点。Claude-Patent-Creator 的混合 RAG（HyDE → FAISS + BM25 → RRF → cross-encoder）已在 `docs/patent-workbench-plan.md` §5 登记为"未来知识库引擎化时"的参照，此处不重复。
- **本项目现状与缺口**：`patent-knowledge` 明确"no vector infrastructure in P1"，安装时丢弃 embeddings 表（`src/install.ts:107`）；`patent_case_search` 只剩 FTS/LIKE。**但本机已具备可用基建**：`dsh-ip-wiki` 已实测 `bge-m3-mlx-fp16` 嵌入（1024 维）与 `bge-reranker-v2-m3` 精排（`http://127.0.0.1:8000`，需 key）。
- **落点与顺序**：① 先给 `patent-knowledge` 的 wiki 卡片与判例分块建向量索引（当前 README 自述"semantic/vector wiki index is deferred"）；② 再把向量召回接进结果流。向量存储建议同 `node:sqlite` 栈的 `sqlite-vec`（同进程、无新服务）。
- **前提与风险**：① 引入新的运行时依赖需按插件纪律立项；② 与 `dsh-ip-wiki` 的既有决策（D13"完全独立，不依赖 patent-knowledge"）冲突，需要一次明确裁决——要么让 ip-wiki 成为知识检索的 Provider，要么让 `patent-knowledge` 复用其端点，不要并存两套嵌入栈；③ **没有 P1-6 的评测门就不验收**；④ 新增模型可见输入必须能由会话日志重建（Model-visible ⟺ logged）。

### P2-8 官方 API 与配额账本、同族去重、源中立记录

- **借鉴什么**：EPO OPS 的工程处理有现成 Apache-2.0 实现可复用——`ip-tools/python-epo-ops-client`（194★，2026-09-12 仍在维护）把配额问题冒泡为 HTTP 错误，提供 `IndividualQuotaPerHourExceeded` / `RegisteredQuotaPerWeekExceeded` 专用异常，并有按 OPS"1 分钟滚动窗口"限流的 Throttler（需持久化存储）。PatZilla 给的是**去重维度**：`access/generic/search.py` 分块合并后按 **family id** 去重；BigQuery 的 `patents.publications.family_id` 语义（"按 family ID 聚合返回同族全部公开物"）可作对齐参照。`patent_client` 的分层（每源 `model/schema/manager/api` + 统一 `Manager` 查询语义）与凭据命名（`PATENT_CLIENT_ODP_API_KEY` 等）可作 Provider 的样板。PatentsView 已从 `api.patentsview.org` **301 迁移**到 USPTO 过渡指南，新检索 API 用 `X-API-Key`。
- **本项目现状与缺口**：取数依赖抓 Google Patents 页面（nuo vendor + Playwright）与 ego-browser 反爬通道——**这是整条链路最脆弱、与目标站点条款最冲突的一环**；没有专利族概念，没有配额/限流账本。
- **落点**：`patent-data` 增加官方源 Provider（EPO OPS + USPTO ODP/PatentsView），配额与限流全部进 `Config`（每周窗口、1 分钟滚动窗口、超限退避）；`patent-core` 定义源中立的 Publication 记录（公开号规范化、`source` 溯源、`familyId` 用 `Branded<>` 而非裸 `string`）。
- **前提与风险**：① EPO 免费阈值两处二手来源矛盾（**3.5 GB/周** vs **4 GB/月**），必须先向 EPO 确认；② OPS 条款禁止把数据"as such"向公众提供或再分发（T&C v2.0 §3.1/3.2），任何把检索结果对外暴露的产品形态都要先过这一条；③ PatZilla 是 **AGPL-3.0 + EUPL-1.2 双许可**（网络服务型 copyleft），**只能学设计不能抄代码**；④ 缺第二源时"统一模型"是空转，本项真正的前置是 ①。

### P2-9 输入噪声鲁棒性冒烟检查与风格统计门

- **借鉴什么**：PatentWriter 的三类输入扰动（打字错误、上下文替换、词序交换）加两项纯统计风格指标——长度分布、可读性、被动语态占比；其人类摘要为 92.7±44.8 tokens / 被动语态 43.6%，模型生成显著偏短偏少被动语态（GPT-4o 133.8 tokens / 32.4%）。另有一条被普遍忽略的反证：该文 §5 明写**要完全复现专家文风需要领域微调**。
- **落点**：`patent-quality-gate` 增一条"输入含错别字/词序错乱/术语替换时产物是否漂移"的冒烟项；被动语态占比与长度分布作为人工基线 vs 生成稿的 drift 指标，与 `writing-patterns` 的 `evaluateQuality` 四维合并（纯统计量，无需模型）。
- **前提与风险**：成本极低，但价值是"防退化"而非"提质量"，排在 P2 合理。

### P3-10 决策路径可分支/可恢复与被否方案留因由

- **借鉴什么**：oh-my-patent 的 `.brainstorm/` 把"方案演化"做成一等结构：`path.json`（nodes/edges/currentNode/finalDecision）+ `nodes/round-N.json`（每轮 agent 输出、创新点快照、评分、决策与理由）+ `snapshots/`；边的 `transformation` 词汇表为 `refine|merge|split|pivot` 并带逐项 `ChangeRecord`（add/modify/remove/target/description）；被归档的创新点保留 `archiveReason`/`archivedAt`（注释明说重启后可读回）；全部写入走 temp+rename 的原子写。其 `evaluateThreshold()` 是一条纯函数式的"何时该迭代"决策：红线违规优先 → 未达轮次上限则迭代、达到则强制通过（并在理由里逐条列出违规项与差值）；否则综合分达标则通过；否则达上限强制通过；否则迭代。
- **本项目现状与缺口**：会话日志可重放，但"从第 N 轮某个方案分叉"不是一等操作；被否掉的保护点/布局方案目前没有"留因由"的固定位置。
- **落点**：`patent-workflow` 的 run 记录增加分支/恢复（或把"分支"作为一等事件写入会话日志），复用 `refine|merge|split|pivot` + `ChangeRecord` 词汇；`evaluateThreshold()` 的决策形状并入 P0-2 的轮次上限规则。
- **前提与风险**：该仓库检索层是空的（`docs/RETRIEVAL_DEV_PLAN.md` 自述），**不要把它当作检索参照**；其阶段流转依赖 CLI+状态文件，与本项目插件/工具面模型差异大，只借数据结构。

### P3-11 知识与案例入库门禁

- **借鉴什么**：patent-disclosure-skill 的 `patent-oa` 把案例库入库做成门禁：**先脱敏（`redacted: true`）**、**仅 `status: history` 进向量库**、检索先按 `statutes`/`defect_types`/`patent_type` 过滤再向量 Top-K、换嵌入模型时写 `embedding_fingerprint` 并强制重建；生成答复必须引用命中案例并展示差异，不得无检索空写。
- **落点**：这是 **`dsh-ip-wiki`（patent-reader/Obsidian 在 dsh 侧的直接对应物）** 的写入面，不是仓库内插件——ip-wiki 已有"整理流水线 + lint 门禁 + 素材→卡片"闭环，缺的正是脱敏门、状态门与嵌入指纹。若将来 `patent-knowledge` 也接向量，同一套门禁应共用。
- **前提与风险**：ip-wiki 当前是 out-of-tree（决策 D10"先自用 out-of-tree 验证，稳定后再内置"），本项只在其自身范围内推进，不要提前引入仓库门禁。

### P3-12 工程规范三条（低成本、即插即用）

| 借鉴点 | 来源 | 本项目落点 |
|---|---|---|
| 检索式语义契约写进工具描述：本工具按空白 AND 切词、不支持布尔算符与括号、短语需引号、OR 需多次调用后合并去重 | Claude-Patent-Creator `skills/prior-art-search/SKILL.md` Step 2 | `patent_search` 等检索工具的 schema description（符合本仓"显式优于隐式"的包边界规则），避免模型产出被静默忽略的查询串 |
| 报告必须自述"跑了什么、跳过了什么"（每条检查项带 `ran|skipped` 与理由） | Claude-Patent-Creator `formalities_checker` 的 severity 体系 | `patent-compliance-review` / `patent-quality-gate` 的输出契约：干净报告不得被误读为全面通过 |
| 增强步骤的显式 opt-in 与逐级降级：不因存在宿主 API key 就静默消费（`HYDE_BACKEND=api` 才用），失败依次退到本地、再退到规则法 | Claude-Patent-Creator `mcp_server/hyde.py` | cnlaw/检索增强若引入查询扩展，消费宿主 key 必须是显式开关，降级链要落为可观测事实 |

工具清单门禁这一条**不必借鉴**：Claude-Patent-Creator 用"import 真实 server、断言工具数量来自源码"，本项目 `packages/patent/patent-tools/tests/registration.spec.ts` 的 `EXPECTED_TOOLS` 硬编码清单是更强的变更探测器（新增/删除工具都会失败），两者取向不同，保留现状。

---

## 6. 明确不借鉴

| 项 | 原因 |
|---|---|
| 把站点细节写进技能正文（CNIPA 公布站每页 3/10 条、WAF 等待秒数、`stage=goto|gate|submit` 的具体取值） | 违反本仓"部署可变项进 Config、协议常量固定"的边界；站点改版即静默失效，且反爬/合规风险高。需要时只作 Provider 的 Config 字段与错误分类 |
| "时间戳文件名即版本历史" | 与本仓 durable 日志为源的设计冲突，且无内容指纹；见 P0-1 |
| `SKILL.md` 内自我授权自由 spawn subagent 并"严禁降级" | 权限自我授权，与本仓 subagent/权限模型冲突 |
| 付费搜索 API 组合（Tavily/博查/Exa/Brave）与 ChatGPT OAuth 登录作为依赖 | 供应商锁定；本仓应做可替换适配器 + 明确降级路径 |
| 500 MB 语料 + FAISS/BM25/HyDE 全量本地索引（Claude-Patent-Creator 的 install 路径） | 与本仓轻量法条基座不匹配，安装与维护成本远高于收益 |
| 以 prompt 内 LLM 打分为唯一排序依据（patent-disclosure-skill 的 0–5 分精排） | 不可复现（无落盘打分记录与阈值配置）；应改为确定性重算或落盘打分 |
| 照搬 AutoPatent 的 BLEU 结论或"三层 8 agent"表述作为设计依据 | 代码与数据均未发布、venue 未证实、指标不含法律可用性、PGTree 实为两层 |
| 照搬 PQAI 的模型权重 | 代码 MIT 但**训练好的模型与向量索引不随仓库分发且无许可声明**；PQAI+ 商用许可只在 Enterprise 档（$700/月 3000 次），ToS 明文禁止爬取、免费版仅限个人非商业 |

---

## 7. 与既有规划的关系

| 既有记录 | 本文件的态度 |
|---|---|
| `docs/patent-workbench-plan.md` §5 借鉴清单（patrick 的 docx tracked changes、OpenPatent 的角色划分、Claude-Patent-Creator 的 MPEP/USC Hybrid RAG、PatentRadar 的产出打包方式、patent-client-agents 的工具封装） | 视为已知。本文件对 Claude-Patent-Creator 的增量是**工程规范三条**（P3-12），不重复 RAG 设计；对 PatentRadar 的增量是**校验判据的具体清单**（P0-3）与**评估黄金集**（P1-6），不是"产出打包方式" |
| `docs/sati-as-dsh-plugins-plan.md` §1.3 明确不移植向量索引与白盒记忆；决策 D13 要求 ip-wiki 与 patent-knowledge 完全独立 | 本文件 P1-7 承认该决策，但指出**本机已具备可用嵌入/精排端点**这一新事实，要求做一次显式裁决，而不是悄悄并行两套栈 |
| `docs/patent-mode-design.md` §12 七道防线、§7.2 技能要点 | P0-3 / P1-5 是防线 5（输出门禁）与防线 2（检索验证分离）的**可判定化**，不是新增防线 |
| `.agents/audits/2026-09-21-patent-domain-review.md`（代码质量）、`2026-09-23-patent-domain-followup-issues.md`（issue 清单） | 本文件是**功能对标**，与那两份的代码质量/缺陷视角无重叠 |

---

## 8. 未证实项

1. EPO OPS 当前免费阈值（3.5 GB/周 vs 4 GB/月）与年费金额；`www.epo.org` 返回 403、OPS 官方文档 PDF 在本环境不可达。
2. BigQuery 公开数据集的**免费额度与数据集条款**（`cloud.google.com` 在本环境不可达）；可见的按年月快照止于 `_202204`，**当前更新频率未证实**。
3. PatentsView 新检索端点 `search.patentsview.org` 是否存活（本环境 DNS 返回 NXDOMAIN，且 DoH 被阻断）；v1 退役的具体日期；过渡指南正文（Angular SPA + AWS WAF 拦截）。
4. `patent-disclosure-skill` 的 `patent-reader` 在**脱离 Obsidian** 时的降级路径是否可用（该仓库以 vault 为落点）。
5. AutoPatent 的 venue（仓库描述自称 "[JCIP 2026]"，Crossref 按题名无命中）；D2P 是否已在别处镜像发布；审查循环的平均往返轮数。
6. PatentWriter 的代码仓库（`anonymous.4open.science` 链接返回 401）。
7. PatentMatch 的配对总数与数据集自身许可（代码 MIT，数据另附条款未取到）。
8. `mahesh-maan/awesome-patent-retrieval` **无 LICENSE 文件**，其整理文本不可搬运；且该清单已腐烂（仍推荐已退役的 PatentsView v1 端点），只能作候选源穷举用，不可作接口事实来源。
9. PQAI 的检索质量证据：未找到同行评审论文或公开评测集，其"效果更好"目前只有自我陈述。

---

## 9. Sources

**A 类技能包**

- [handsomestWei/patent-disclosure-skill](https://github.com/handsomestWei/patent-disclosure-skill)（`gh api repos/...` → 10,500★、MIT；`skills/` 8 子技能；`skills/patent-docket/references/{docket.schema.yaml,phases.yaml,issue_taxonomy.md,dispositions.yaml,max_rounds.md}`；`tools/validate_docket.py`、`skills/patent-docket/tests/test_docket.py`；`prompts/{merger.md,iteration_context.md,prior_art_search.md}`；`tools/iteration_dialog_log.py`；`tools/crawl/cnipa_epub_*.py` + `cnipa_epub_wait.yaml`；`skills/patent-disclosure/examples/` 三案例；`skills/patent-oa/references/schemas/oa_case.schema.yaml`）
- [RobThePCGuy/Claude-Patent-Creator](https://github.com/RobThePCGuy/Claude-Patent-Creator)（190★、MIT、status-beta；17 个 `skills/`；`mcp_server/{hyde.py,validation.py,bigquery_search.py}`；`tests/test_server_boot.py`；`.claude-plugin/plugin.json`、`.mcp.json`）
- [illusionaireal/oh-my-patent](https://github.com/illusionaireal/oh-my-patent)（98★、MIT；`src/core/threshold-config.ts`、`workflow-stages.ts`、`brainstorm-path.ts`、`atomic-write.ts`；`docs/RETRIEVAL_DEV_PLAN.md`）
- [yuc16/PatentRadar](https://github.com/yuc16/PatentRadar)（64★、无 LICENSE；`mcp/src/patentradar_mcp/{workflow.py,store.py,security.py,search.py}`；`evaluate/{eval.py,check_urls.py,check_evidence.py,EVALUATION.md}`）

**B 类检索与数据平台**

- [pqaidevteam/pqai](https://github.com/pqaidevteam/pqai)（138★、MIT；`core/{vectorizers.py,index_selection.py,reranking.py,datasets.py}`、`services/vector_search.py`）· [检索入口](https://search.projectpq.ai) · [覆盖更新日志](https://search.projectpq.ai/updates)（2024-12-17：68 国 / 1 亿论文）· [API 定价](https://projectpq.ai/api-pricing) · [条款](https://projectpq.ai/terms-and-conditions)
- [ip-tools/patzilla](https://github.com/ip-tools/patzilla)（120★、**AGPL-3.0 + EUPL-1.2**；`access/generic/search.py:89,208`；`access/epo/ops/api.py`）· [python-epo-ops-client](https://github.com/ip-tools/python-epo-ops-client)（Apache-2.0，配额异常与 Throttler）
- [google/patents-public-data](https://github.com/google/patents-public-data)（Apache-2.0，2024-06 后未动）· 表结构参照 [whale 镜像](https://github.com/rsyi/whale-bigquery-public-data)（`patents.publications.family_id`；`google_patents_research.publications.embedding_v1` / `similar` / `cpc`；`annotations` 化学实体）
- [parkerhancock/patent_client](https://github.com/parkerhancock/patent_client)（已归档）→ [patent-client-agents](https://github.com/parkerhancock/patent-client-agents)（Apache-2.0，49★）
- PatentsView：旧端点 `https://api.patentsview.org/patents/query` → **HTTP 301** → `https://data.uspto.gov/support/transition-guide/patentsview`；新 API 源码 [PatentsView/PatentSearch-API](https://github.com/PatentsView/PatentSearch-API)（`API/permissions.py` 的 `X-API-Key`）
- [julian-risch/PatentMatch](https://github.com/julian-risch/PatentMatch)（MIT，2022-10 后未动；arXiv [2012.13919](https://arxiv.org/abs/2012.13919)；数据集 [hpi.de](https://hpi.de/naumann/s/patentmatch)）
- SearchFormer：[OpenAlex 10.1016/j.wpi.2023.102192](https://doi.org/10.1016/j.wpi.2023.102192)（EPO，World Patent Information 2023，无代码发布）
- [mahesh-maan/awesome-patent-retrieval](https://github.com/mahesh-maan/awesome-patent-retrieval)（103★、无 LICENSE、2024-06 后未动）

**C 类生成与评测研究**

- AutoPatent：[arXiv 2412.09796](https://arxiv.org/abs/2412.09796) · [HTML v1](https://arxiv.org/html/2412.09796v1)（Table 1/2/3、§4.2、§6.1）· [QiYao-Wang/AutoPatent](https://github.com/QiYao-Wang/AutoPatent)（仅 README + 示例 PDF，代码与 D2P 未发布）
- PatentWriter：[arXiv 2507.22387](https://arxiv.org/abs/2507.22387) · [HTML v1](https://arxiv.org/html/2507.22387v1)（§1 的 Jiang et al. 引述、§5 风格局限、Table 2/3/5/6）
- PatentEval：[arXiv 2406.06589](https://arxiv.org/abs/2406.06589)（NAACL 2024，pp.2687–2710）· [ZoeYou/PatentEval](https://github.com/ZoeYou/PatentEval)（人标 JSON 与逐模型预测公开）
- Patent-CE：[arXiv 2505.11095](https://arxiv.org/abs/2505.11095)（ACL 2025）· [scylj1/PatClaimEval](https://github.com/scylj1/PatClaimEval)（**CC BY-NC 4.0**）· [HF lj408/PatClaimEval-Quality](https://huggingface.co/lj408/PatClaimEval-Quality)

**本项目内部证据**

- `packages/bundle/web-app/skills/patent/`（15 技能）、`packages/bundle/web-app/presets/patent.md`、`packages/patent/patent-tools/tests/registration.spec.ts:11-41`（30 工具）、`packages/patent/patent-tools/src/tool/patent-eval.ts:163-197`、`packages/patent/patent-tools/README.md:127`、`packages/patent/patent-knowledge/README.md:82`、`packages/patent/patent-knowledge/src/install.ts:107`、`packages/patent/patent-rule/src/index.ts:188`、`packages/patent/patent-rule/assets/rules/**`、`docs/patent-mode-design.md`、`docs/patent-workbench-plan.md`、`docs/sati-as-dsh-plugins-plan.md`、`.agents/audits/2026-09-29-dsh-ip-wiki-design.md`
