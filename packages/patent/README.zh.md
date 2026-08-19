# patent/ — Sati 专利域能力族

[English](README.md) | 中文

按 [docs/sati-as-dsh-plugins-plan.md](../../docs/sati-as-dsh-plugins-plan.md) 将 Sati 专利域原生移植为 harness 插件：无 Sati 进程、无 MCP 桥——专利引擎、工具、规则门禁与知识访问以 `@deepseek-ai/dsh-patent-*` workspace 包运行。

| 包 | 职责 | ctx key |
|---|---|---|
| [`patent-data/`](patent-data/README.md) | 专利数据访问：nuo-patent 映射/检索 provider + ego-browser 子进程 provider。 | `patentData` |
| [`patent-knowledge/`](patent-knowledge/README.md) | knowledge.db 查询：判例 FTS、法规、wiki 卡片、知识图谱 + 安装命令。 | `patentKnowledge` |
| [`patent-core/`](patent-core/README.md) | 纯专利域库：ModelPort、atoms、checker、claim-chart、problem、evidence、reasoning、graph。 | — |
| [`patent-workflow/`](patent-workflow/README.md) | 执行管线：workflow/flexible-plan/plantask 状态机 + HITL 审批。 | `patentWorkflow` |
| [`patent-tools/`](patent-tools/README.md) | 模型可见专利工具集（检索/元数据/法律状态/判例/撰写/渲染/规则检查）。 | （注册于 `ctx.tools`） |
| [`patent-teams/`](patent-teams/README.md) | 持久多智能体团队：队长领导成员、依赖感知任务、邮箱消息、共享任务调度器。 | `patentTeams` |
| [`patent-rule/`](patent-rule/README.md) | 规则引擎、合规资产、`tools/post-execute` 输出门禁。 | （策略插件） |
| [`patent-document/`](patent-document/README.md) | 专利文书渲染：模板、品牌注入、PDF。 | （注册于 `ctx.tools`） |
| [`tool-literature/`](tool-literature/README.md) | 文献连接器：arXiv/OpenAlex/Semantic Scholar/Crossref。 | （注册于 `ctx.tools`） |
| [`methodology/`](methodology/README.md) | TRIZ 40 原理 + 39×39 矛盾矩阵。 | （section + 工具） |

各包契约由子 README 负责。在对应计划阶段落地前，所有包均处于脚手架阶段。
