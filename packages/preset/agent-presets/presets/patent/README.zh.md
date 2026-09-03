# 专利模式 preset

[English](README.md) | 中文

`patent` agent preset 在 DeepSeek Harness 上组合一个面向中国专利作业的 Agent。它以 `standard` preset 为基础，加入专利域插件、12 个预设内技能，以及专利专用的人设与计划模式纪律，按 docs/patent-mode-design.md §4–§9 与 docs/sati-as-dsh-plugins-plan.md 的 P4.4 组装。法条/审查指南/判例核验优先走本机 cnlaw REST 法律底座（semantica-cnlaw，见「前置条件」），保留 source_path 溯源，不可用时回退 patent_case_search / patent_kg_query。

## 挂载内容

除专利作业所需的标准编码行（shell、文件、jobs、skills、goals、计划模式、压缩、委托、web）外，本 preset 挂载 9 个专利域插件：

- `@deepseek-ai/dsh-patent-data` — 数据接缝（ctx.patentData：nuo 检索 provider 工厂 + ego-browser 会话运行器）。patent_pdf_download 经该服务运行其 ego-browser 下载适配器。
- `@deepseek-ai/dsh-patent-knowledge` — knowledge.db 查询服务（ctx.patentKnowledge：caseLawSearch / legalSearch / wikiCards / kgSearch / kgGetNode / kgListByType / ipcClassify）。
- `@deepseek-ai/dsh-patent-workflow` — 执行管线服务（ctx.patentWorkflow：runWorkflow / runPlantask / approve / reject）。
- `@deepseek-ai/dsh-patent-tools` — 23 个模型工具：检索、元数据、法律状态、判例/wiki/图谱查询、撰写、权利要求对照表、工作流收口、附图分析、PDF 下载、知识笔记。
- `@deepseek-ai/dsh-patent-teams` — 持久多智能体团队服务（ctx.patentTeams），提供十一个 `patent_teams_*` 工具；`qualityGate: true` 时运行组合完成门禁。
- `@deepseek-ai/dsh-patent-rule` — 规则引擎、tools/post-execute 输出门禁、EVI-011 证据守卫。
- `@deepseek-ai/dsh-patent-document` — render_patent_document。
- `@deepseek-ai/dsh-tool-literature` — paper_search / paper_list_sources。
- `@deepseek-ai/dsh-methodology` — triz 工具。

专利服务放在 isolate 领域（patentData / patentKnowledge / patentWorkflow / patentTeams）内，与 patent-tools 共享该领域，使后者的 ctx.get('patentData') / ctx.get('patentKnowledge') 解析到本 preset 的实例而非宿主实例。省略 tool-ralph（一个案子用 goal / todo / workflow，而非 fresh-agent 迭代）；tool-web 保持 fetch 关闭，因为发货 profile 不挂 fetch provider（见 base 层注释）；需要 web_fetch 的部署自行添加 provider，如 `dsh plugin --profile patent add @deepseek-ai/dsh-web-fetch-http`。

本 preset 还挂载 `@deepseek-ai/dsh-self-evolve-benchmark`，放在独立的 isolate 领域（selfEvolveBenchmark）内：benchmark 驱动的自进化 provider，仅编程接口——无模型工具。其 `agentStateDir` 指向数据根下播种的 `patent-state` 工作副本（包内 examples/patent-oas），绝不指向调用方工作目录，真实案卷或知识库永远不会被优化循环打快照或改写。

## 技能

skills/ 下随附 12 个技能：

- patent-disclosure-understanding
- patent-prior-art-search
- patent-novelty-inventiveness
- patent-infringement
- patent-invalidity
- patent-quality-gate
- patent-workspace-layout
- patent-team-composition
- inventive-step-analysis
- patent-matter
- patent-fact-check
- patent-compliance-review

`patent-team-composition` 是持久团队组建模板：本会话已挂载 dsh-patent-teams 插件（patent_teams_* 工具），案件按覆盖专利全生命周期的七个场景角色包选择——立案包（案件管理员 / 检索员 / 技术专家 / 撰写员）、撰写包（检索员 / 撰写员 / 对立审查员 / 技术专家 / 申请人代理）、答复审查意见包（同撰写五角色）、补正包（撰写员 / 形式审查员）、复审包（检索员 / 撰写员 / 对立审查员 / 申请人代理 / 合议组）、无效宣告包（检索员 / 撰写员 / 技术专家 / 无效请求人 / 专利权人 / 合议组）、侵权诉讼包（检索员 / 撰写员 / 技术专家 / 专利权人 / 被告代理人 / 裁判，另可选技术调查官），由当前会话任 captain 统一调度；仅当插件被禁用时回退单会话 + subagent_fork 专家互评。复审、无效与诉讼包采用"立场配对 + 中立裁判"的对抗结构。

新颖性/创造性、侵权、无效三个技能改写自 Sati 的 patent-novelty-analysis、patent-inventiveness-analysis、patent-infringement-checker、patent-invalidity-checker。Sati 工具引用（patent_kg_query / patent_case_search / law_search）替换为 dsh 专利工具，<memory-context> 自动注入替换为显式必查清单，Sati 内部文件路径替换为工作目录相对路径。

## 知识库策略

按计划 P4.4，系统知识读 dsh-patent-knowledge：判例、wiki 卡片与知识图谱经 patent_case_search / patent_wiki_search / patent_kg_query 查询，法条原文优先经本机 cnlaw REST（:8100 /search，source_path 溯源）核验权威来源，cnlaw 不可用时经 patent_case_search 加 web_fetch（挂载 fetch provider 时）核验。工作目录 `99-知识库/` 仍作为项目级沉淀，用 fs-search / grep 先查本地再上网。

这修订了 docs/patent-mode-design.md §9（原为无引擎文件库）。`99-知识库/` 仍作项目沉淀；变化在于系统知识现在有了引擎。

## 前置条件

知识工具需要 knowledge.db。用 patent-knowledge-install bin 安装，或将 Config.sourceDbPath 指向已有 knowledge.db；见 packages/patent/patent-knowledge/README.md。缺库时知识工具在执行期 fail-loud。

cnlaw 法律底座为可选增强：本机运行 semantica-cnlaw 的 REST 服务（:8100 检索、:8001 图谱/案件 API）与 Neo4j（7687）时，法条/审查指南/判例核验走 cnlaw 并保留 source_path 溯源；未运行时纪律回退 patent_case_search / patent_kg_query（见 Known Limitations）。

## Model Experience

模型看到：中文专利代理人设（专业身份、七条作业纪律、标准作业流程、带强制免责声明的输出纪律）、专利计划模式段落、7 个预设内技能，以及专利工具加标准编码工具。人设要求先验证后引用（挂载时每个事实用 web_fetch）、单独对比、逐特征比对附引用，且每份分析输出必含免责声明。

## Known Limitations and Deferred Work

- 法条检索（ctx.patentKnowledge.legalSearch）无模型工具；法条原文优先经本机 cnlaw REST 核验（可选底座，见前置条件），cnlaw 不可用时经 patent_case_search 加 web_fetch（挂载 fetch provider 时）与 `99-知识库/` 基线核验。发货 profile 不挂 fetch provider（SSRF 防护延后），未添加前 web_fetch 会以 WEB_PROVIDER_UNAVAILABLE 失败。
- patent_pdf_download 需要宿主机可用的 ego-browser（ego lite）：ego-browser CLI 必须安装并在 PATH 上（仅 macOS），否则工具以 setup 指引 fail-loud。knowledge_note_save 将笔记写入工作目录 `99-知识库/` 下的文件（knowledge.db 原生写 API 延后）。
- 4 个改写分析技能继承 Sati 方法论，但尚未对照现行中国专利实务复核；依赖前请将其检查清单与用户 patent-legal 基线交叉核验。
- 设计文档的 `~/.agents/skills/patent-legal/_shared/patent-law-baseline-2024.md` 是 Sati 用户级资产，未随附；法条原文在使用时核验。
- 自进化 benchmark 仅编程接口：`ctx.selfEvolveBenchmark` 不挂模型工具；建立基线 / 优化循环由 operator 或脚本解析某 agent 的该服务后驱动。其默认 seams 在宿主 subagents 注册表上 fork 子代理，子代理继承本 preset 的 approval 设置（`'never'`）与计划模式纪律——需审批的操作在子代理中被拒，executor prompt 已显式退出计划语义，可直接产出交付物。