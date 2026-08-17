# 专利模式 preset

[English](README.md) | 中文

`patent` agent preset 在 DeepSeek Harness 上组合一个面向中国专利作业的 Agent。它以 `standard` preset 为基础，加入专利域插件、7 个预设内技能，以及专利专用的人设与计划模式纪律，按 patent-mode-design.md §4–§9 与 docs/sati-as-dsh-plugins-plan.md 的 P4.4 组装。

## 挂载内容

除专利作业所需的标准编码行（shell、文件、jobs、skills、goals、计划模式、压缩、委托、web）外，本 preset 挂载 7 个专利域插件：

- `@deepseek-ai/dsh-patent-knowledge` — knowledge.db 查询服务（ctx.patentKnowledge：caseLawSearch / legalSearch / wikiCards / kgSearch / kgGetNode / kgListByType / ipcClassify）。
- `@deepseek-ai/dsh-patent-workflow` — 执行管线服务（ctx.patentWorkflow：runWorkflow / runPlantask / approve / reject）。
- `@deepseek-ai/dsh-patent-tools` — 23 个模型工具：检索、元数据、法律状态、判例/wiki/图谱查询、撰写、权利要求对照表、工作流收口、附图分析、PDF 下载、知识笔记。
- `@deepseek-ai/dsh-patent-rule` — 规则引擎、tools/post-execute 输出门禁、EVI-011 证据守卫。
- `@deepseek-ai/dsh-patent-document` — render_patent_document。
- `@deepseek-ai/dsh-tool-literature` — paper_search / paper_list_sources。
- `@deepseek-ai/dsh-methodology` — triz 工具。

专利服务放在 isolate 领域（patentKnowledge / patentWorkflow）内，与 patent-tools 共享该领域，使后者的 ctx.get('patentKnowledge') 解析到本 preset 的实例而非宿主实例。省略 tool-ralph（一个案子用 goal / todo / workflow，而非 fresh-agent 迭代）；tool-web 配置 fetch: true 以满足"先验证后引用"规则。

## 技能

skills/ 下随附 7 个技能：

- patent-disclosure-understanding
- patent-prior-art-search
- patent-novelty-inventiveness
- patent-infringement
- patent-invalidity
- patent-quality-gate
- patent-workspace-layout

新颖性/创造性、侵权、无效三个技能改写自 Sati 的 patent-novelty-analysis、patent-inventiveness-analysis、patent-infringement-checker、patent-invalidity-checker。Sati 工具引用（patent_kg_query / patent_case_search / law_search）替换为 dsh 专利工具，<memory-context> 自动注入替换为显式必查清单，Sati 内部文件路径替换为工作目录相对路径。

## 知识库策略

按计划 P4.4，系统知识读 dsh-patent-knowledge：判例、wiki 卡片与知识图谱经 patent_case_search / patent_wiki_search / patent_kg_query 查询，法条原文经 patent_case_search 加 web_fetch 核验权威来源。工作目录 `99-知识库/` 仍为项目级沉淀，用 fs-search / grep 先查本地再上网。

这修订了 patent-mode-design.md §9（原为无引擎文件库）。`99-知识库/` 仍作项目沉淀；变化在于系统知识现在有了引擎。

## 前置条件

知识工具需要 knowledge.db。用 patent-knowledge-install bin 安装，或将 Config.sourceDbPath 指向已有 knowledge.db；见 packages/patent/patent-knowledge/README.md。缺库时知识工具在执行期 fail-loud。

## Model Experience

模型看到：中文专利代理人设（专业身份、七条作业纪律、标准作业流程、带强制免责声明的输出纪律）、专利计划模式段落、7 个预设内技能，以及专利工具加标准编码工具。人设要求先验证后引用（每个事实 web_fetch）、单独对比、逐特征比对附引用，且每份分析输出必含免责声明。

## Known Limitations and Deferred Work

- 法条检索（ctx.patentKnowledge.legalSearch）无模型工具；法条原文经 patent_case_search 加 web_fetch 与 `99-知识库/` 基线核验。
- patent_pdf_download 与 knowledge_note_save 在 patent-tools 中是 fail-loud 占位（ego-browser 运行器与存储写入器未接线）；本 preset 未挂载 patent-data 服务（ctx.patentData）。
- 4 个改写分析技能继承 Sati 方法论，但尚未对照现行中国专利实务复核；依赖前请将其检查清单与用户 patent-legal 基线交叉核验。
- 设计文档的 `~/.agents/skills/patent-legal/_shared/patent-law-baseline-2024.md` 是 Sati 用户级资产，未随附；法条原文在使用时核验。
