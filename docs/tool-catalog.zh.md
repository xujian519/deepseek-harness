<!-- 英文源文件由 scripts/gen-tool-catalog.ts 生成；本中文文件是通过双语配对维护的经评审对侧。
     更新时先运行 `pnpm run gen-tool-catalog` 更新英文，再更新本文件并运行 `pnpm run verify-translation-pairing --write docs/tool-catalog.md` 重新记录配对。 -->

# 工具 Schema 目录

[English](tool-catalog.md) | 中文

已发布插件向 `ctx.tools` 提供的所有面向模型的工具：模型通过系统提示词组装获得的 `name`、`description` 和 JSON Schema `parameters`。本目录是[子系统页面](subsystems/core.zh.md)（类型及每页生成的 `cordis-surface` 接线区域）的补充；本页列出的是向 agent（智能体）提供的*工具*。

英文源文件由系统**生成**，并通过 `pnpm run verify-tool-catalog`（`doc-sync`（文档同步门禁）的一部分）验证新鲜度；本中文文件作为经评审对侧通过双语配对维护。与 Cordis 目录（纯源码 AST 处理）不同，英文生成器会在真实上下文中**启动**每个工具插件并读取 `ctx.tools.schemas()`，因为工具 schema 无法通过静态分析完全确定，例如运行时展开的枚举、拼接的描述、由配置决定的名称以及使用原始 JSON Schema 的 MCP 工具。完整性守卫会 glob 匹配 `packages/*/tool-*`；如果生成器的启动 manifest（元数据清单）遗漏任何包，检查就会失败，因此新工具不会在无人察觉的情况下缺少文档。

范围：`packages/*/tool-*` 下已发布的产品工具，每个工具均使用其**默认**配置启动；但如果某个 Config 字段是**必填项**且没有默认值，生成器就必须作出选择，对应包的说明会记录本页展示的是哪个分支。注册的工具**名称**可以是加载时配置，例如 `tool-subagent` 的 `toolName`，因此部署可能以不同名称或额外名称提供某个包；如果存在随产品发布的别名，对应包的说明会予以记录。`examples/` 中的演示工具（例如 `echo`）不在范围内，这与 Cordis 目录仅涵盖包的范围一致。

<a id="tool-package-map"></a>

## 工具包映射

下表将模型可见的工具名称与其背后的插件包和服务 seam 对应起来。各包章节随后给出确切的 JSON Schema。

| 工具包 | 模型可见名称 | 依赖 | 写入／影响 | 随产品发布的别名 | 部署说明 |
| --- | --- | --- | --- | --- | --- |
| `@deepseek-ai/dsh-plugin-manager` | `plugin_manager` | `ctx.tools`, `ctx.pluginManager`, `ctx.sandboxPolicy` | `tool/call`, `tool/result`, `user/message` | - | - |
| `@deepseek-ai/dsh-mcp-resources` | `list_mcp_resource_templates`, `list_mcp_resources`, `read_mcp_resource` | `ctx.tools`, `ctx.mcpResources` | `tool/call`, `tool/result` | - | - |
| `@deepseek-ai/dsh-experimental-browser-use-stagehand-native` | `stagehand_act`、`stagehand_extract`、`stagehand_navigate`、`stagehand_observe`、`stagehand_screenshot`、`stagehand_tabs` | `ctx.browserUse`、`ctx.agents`、`ctx.tools`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | - |
| `@deepseek-ai/dsh-tool-ask-user` | `ask_user_question` | `ctx.tools`、`ctx.userQuestions` | `tool/call`、`tool/result after a UI/provider answers the question` | - | ask_user_question 会暂停工具调用，直到当前 UI 提供方返回人类答案。 |
| `@deepseek-ai/dsh-tools` | `run_code` | `ctx.tools`、`ctx.ptcRuntime (execution time)`、`ctx.systemPrompt` | `tool/call`、`one tool/ptc-dispatch-start + tool/ptc-dispatch pair per bridged sub-call`、`tool/result` | - | 在 `mode: ptc`／`mode: both` 下，它由工具注册表所有，作为可过滤能力层之外的保留传输机制（参见 PTC mode Agent Note）。在 `ptc` 下，它是注册表对协议格式（wire format）的唯一贡献；其他可见能力在使用已加载运行时语言生成的 SDK 章节中声明。程序通过 binding 调用这些能力，调用按照原生并发约定调度：启动顺序和策略遵循提交顺序，并发安全的函数体最多重叠执行 `maxParallelSubCalls` 个。调用会重新进入完整且受守卫保护的工具流水线，并将每个嵌套执行关联到此外层结果。 |
| `@deepseek-ai/dsh-plan-mode` | `exit_plan_mode` | `ctx.tools`、`ctx.systemPrompt`、`ctx.userQuestions (execution time, opportunistic)` | `tool/call`、`plan/mode inactive on an approved review`、`tool/result` | - | 规划未激活时，exit_plan_mode 仍保留在面向模型的 schema 中，这样状态转换不会在规划策略变更之外额外造成工具目录变动。其执行路径会拒绝规划模式之外的调用；在规划模式下，它通过用户交互 seam 提交计划（批准／根据反馈继续规划），批准后会在步骤边界记录规划模式已停用。 |
| `@deepseek-ai/dsh-tool-bash` | `bash` | `ctx.tools`、`ctx.shell`、`ctx.systemPrompt`、`ctx.shellEnv`、`ctx.jobs for run_in_background and the job-backed foreground path` | `tool/call`、`tool/result` | - | bash 工具是 bash 执行器 seam 面向模型的消费方。组合了 job 注册表时，每次调用在启动时即注册到通用 `ctx.jobs` 运行时，并通过 `job_*` 工具（来自 `@deepseek-ai/dsh-tool-jobs`）收集／停止；未组合注册表时，或 `enableRunInBackground: false` 时，该工具注册的是不含 `run_in_background` 参数的前台专用 schema。 |
| `@deepseek-ai/dsh-tool-present` | `present` | `ctx.tools`, `ctx.fs`, `ctx.sessionProjections` | `tool/call`, `deliverables/presented 在成功的最终结果之后`, `tool/result` | - | 交付归调用方 Session 所有；Web ui-deliverables 提供源文件打开与卡片。 |
| `@deepseek-ai/dsh-tool-pwsh` | `pwsh` | `ctx.tools`、`ctx.shell`、`ctx.systemPrompt`、`ctx.shellEnv`、`ctx.jobs for run_in_background and the job-backed foreground path` | `tool/call`、`tool/result` | - | pwsh 工具是 Windows 组合中 bash 执行器 seam 的 PowerShell 方言消费方（由 `@deepseek-ai/dsh-pwsh-local` 等 PowerShell 执行器为 `ctx.shell` 提供后端）；除沙箱接口外，它逐项对应 bash 工具调用。使用 `run_in_background` 的运行会注册到通用 `ctx.jobs` 运行时，并通过 `job_*` 工具收集／停止；托管的 `DSH_*` 环境来自 `@deepseek-ai/dsh-shell-env`。每次调用都在新进程中运行，不使用持久 PTY 会话。路径采用原生 `C:\...` 形式，变量采用 `$env:NAME`。 |
| `@deepseek-ai/dsh-tool-cordis` | `cordis_inspect_list`、`cordis_inspect_query` | `ctx.tools`、`ctx.cordisInspect` | `tool/call`、`tool/result` | - | Creator 模式提供两个只读的运行时检查工具。检查注册表由 Cordis host runner 提供；Client 查询需要已连接的页面。持久变更请写成组合包，并用 plugin_manager 安装。 |
| `@deepseek-ai/dsh-tool-plugin-market` | `market_plugin_preview`、`market_plugin_search`、`market_source_list` | `ctx.tools`、`ctx.systemPrompt`、`ctx.pluginMarket` | `tool/call`、`tool/result` | - | 市场工具集读取 `@deepseek-ai/dsh-host-plugin-market` 提供的 `ctx.pluginMarket`，后者始终从内存提供内置离线目录（`builtin-deepseek`），并通过市场的受限 fetch 提供用户注册的 HTTPS 来源。标准 preset 下这些工具对所有 agent 会话可见；安装始终是操作者在 `dsh plugin` CLI 上的动作，绝不是模型调用。 |
| `@deepseek-ai/dsh-tool-bash-persistent` | `bash` | `ctx.tools`、`ctx.terminals`、`an owning Agent at execution time` | `tool/call`、`PTY shell state`、`tool/result` | - | 一个按所有者隔离的持久 bash 工具；部署组合提供 PTY 后端，并可覆盖面向模型的环境描述。 |
| `@deepseek-ai/dsh-tool-pwsh-persistent` | `pwsh` | `ctx.tools`、`ctx.terminals`、`an owning Agent at execution time` | `tool/call`、`PTY shell state`、`tool/result` | - | 一个按所有者隔离的持久 pwsh 工具，持久 bash 工具的 Windows 对应物；部署组合提供 pwsh 方言的 PTY 后端，并可覆盖面向模型的环境描述。 |
| `@deepseek-ai/dsh-tool-str-replace-editor` | `str_replace_editor` | `ctx.tools`、`ctx.fs` | `tool/call`、`fs/observed after view presence/absence, edit absence, or successful mutation`、`tool/result` | - | 基于文件系统 seam 的独立查看／创建／唯一字面量替换／按行插入工具；可与任何 shell 或终端接口组合。 |
| `@deepseek-ai/dsh-tool-fs` | `edit`、`read`、`read_image`、`write` | `ctx.tools`、`ctx.fs`、`ctx.systemPrompt`、`ctx.attachments (image-tool registration)`、`ctx.llm + an image-capable route (image-tool execution)` | `tool/call`、`fs/write-intent or fs/edit-intent for mutations`、`fs/observed after read presence/absence or successful file operation`、`durable attachment (read_image)`、`tool/result` | - | 先读后写／编辑策略由 `@deepseek-ai/dsh-fs-observation-policy` 添加；它是一个 `fs/*` 事件门禁插件，不会改变 schema。加载这些工具的部署按预期也应加载该插件。没有 `ctx.attachments` 时图片工具不会注册；其 schema 与路由无关，执行时除非确切路由的模型声明图片输入，否则拒绝。 |
| `@deepseek-ai/dsh-tool-fs-search` | `glob`、`grep` | `ctx.tools`、`ctx.subprocess`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | glob 和 grep 是无条件可用的发现工具，通过 ctx.subprocess spawn 随包提供的 ripgrep 二进制文件（`@vscode/ripgrep`），并作为普通前台调用运行，绝不作为后台任务；无需在宿主机安装 `rg`，也不经过 shell 层。本目录使用 `sampleOverCapGlobResults: true`；部署必须显式选择该行为。结果超过上限时，会通过可选的 ctx.spillStore 后端保存完整的格式化列表；在共置部署中，如果后端公开本地路径，返回的定位信息可供后续读取／搜索。 |
| `@deepseek-ai/dsh-tool-terminal` | `terminal_close`、`terminal_list`、`terminal_open`、`terminal_read`、`terminal_send`、`terminal_signal` | `ctx.tools`、`ctx.terminals`、`ctx.systemPrompt`、`ctx.jobs at call time for run_in_background` | `tool/call`、`tool/result` | - | 这 6 个终端工具需要选择启用，用于补充一次性 bash／文件系统工具。`terminal_send(run_in_background: true)` 会注册到 `ctx.jobs`；schema 不包含 TUI、具名按键序列、BEL、调整尺寸、自动启动和跨 agent 共享。 |
| `@deepseek-ai/dsh-tool-goal` | `create_goal`、`get_goal`、`update_goal` | `ctx.tools`、`ctx.agents`、`ctx.goals`、`ctx.systemPrompt`、`a calling Agent in an authorized open turn` | `tool/call`、`goal/change for mutations`、`tool/result` | - | create、edit、pause 和 resume 要求直接来自人类的根权限；complete 和 blocked 也接受确切的当前 Goal Round。blocked 的默认下限是 3 个获准的 Round。 |
| `@deepseek-ai/dsh-schedule` | `schedule_create`、`schedule_delete`、`schedule_list` | `ctx.tools`、`ctx.sessions`、Session 持久化、未来创建的 live 根 Agent | `tool/call`、`schedule/change create or delete`、`tool/result` | - | 仅在选择启用的 Schedule 插件加载后创建的 live 根 Agent scope 内注册。版本 1 接受 after_seconds、显式绝对 at 和有界固定速率 every_seconds，并披露 session-local 交付；管理读取与变更必须通过共享的 Session 持久化 barrier。 |
| `@deepseek-ai/dsh-tool-lsp` | `lsp` | `ctx.tools`、`ctx.lsp`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | lsp 工具将提供方选择和语言服务器子进程置于 ctx.lsp 之后，因此其模型可见 schema 在更换提供方时保持稳定。运行时要求已注册提供方，例如 `@deepseek-ai/dsh-lsp-stdio`；如果没有提供方，查询会返回结构化 `LSP_UNAVAILABLE` 错误，而不会改变 schema。 |
| `@deepseek-ai/dsh-tool-ralph` | `ralph` | `ctx.tools`、`ctx.workflowEngine`、`ctx.subagents`、`ctx.systemPrompt`、`a calling Agent (exec.agent parents every fresh round)` | `tool/call`、`tool/result`、`workflow and child session events during execution` | - | 固定的前台工作流会在每个 Round 启动一个全新的结构化子级；模型只能选择不可变目标和可选的 Round 上限。 |
| `@deepseek-ai/dsh-tool-skill` | `skill` | `ctx.tools`、`ctx.agents`、`ctx.skills` | `tool/call`、`tool/result`、`user/message replacement catalogs via agent.inject()` | - | - |
| `@deepseek-ai/dsh-tool-self-evolve` | `self_evolve_inspect_patterns`、`self_evolve_now` | `ctx.tools`、`ctx.systemPrompt`、`ctx.selfEvolve`、`ctx.agents` | `tool/call`、`tool/result`、`self-evolve/start|end brackets when a loop runs` | - | 两个工具驱动 self-evolve 能力缝：`self_evolve_inspect_patterns` 读取会话投影出的失败模式，`self_evolve_now` 启动一次显式循环。基础提供方仅面向 L1-skill 与 L2-context；L3-workflow 与 L4-harness 请求暂不产生提案。 |
| `@deepseek-ai/dsh-tool-session-query` | `session_event_read`、`session_event_search`、`session_event_trace`、`session_search`、`session_trace` | `ctx.tools`、`ctx.systemPrompt`、`ctx.sessionQuery`、`a calling Agent for workspace authority` | `tool/call`、`tool/result` | - | 这 5 个只读工具会隐藏提供方游标，并根据不可变的调用 agent 会话为每个结果授权。该包需要选择启用；需要强制截止时间或限制行内输出的组合还会挂载通用超时或 spill 策略。 |
| `@deepseek-ai/dsh-tool-subagent` | `list_subagent_models`、`subagent` | `ctx.tools`、`ctx.subagents`、`ctx.systemPrompt`、`用于模型发现和所选路由校验的 ctx.llm` | `tool/call`、`tool/result`、`child session events through the chosen provider` | `subagent`、`subagent_fork` | 注册的委派工具名称取决于加载时 `toolName` 配置（默认为 `subagent`）；上述默认 schema 关闭模型选择，而发现 schema 则展示为已启用 Session 中可用的固定配套工具。Web preset 会在每个新顶层 Session 创建时读取插件页偏好，并为其子 Session 保留该决定；`subagent_fork` 始终使用固定路由。每个实例通过 `modelSelectionSettings`、`backgroundMode` 与 `enableRunInBackground` 独立控制是否读取模型选择设置及其后台行为。 |
| `@deepseek-ai/dsh-tool-subagent-control` | `interrupt_agent`、`list_agents`、`send_message` | `ctx.tools`、`ctx.subagents`、`ctx.agents and ctx.sessionProjections (list_agents only)` | `tool/call`、`tool/result`、`child session events through ctx.subagents` | - | 这些是控制可继续后台 subagent 的全局命名工具：绑定提供方的 `tool-subagent` 实例注册不同的委派工具；本包注册一次 `send_message` 和 `interrupt_agent`，另由 `list_agents` 通过单独加载的 `/list-agents` 插件提供，其目录行使用 sessionProjections 和实时 Agent 注册表。 |
| `@deepseek-ai/dsh-tool-jobs` | `job_kill`、`job_list`、`job_output` | `ctx.tools`、`ctx.jobs`、`ctx.systemPrompt` | `tool/call`、`tool/result`、`user/message via agent.inject() for background completion notices` | - | 与任务种类无关的后台任务控制器：后台 bash 命令、PTY 发送和 subagent 都通过相同的 3 个工具读取、列出和终止。加载该插件会挂接控制器，从而启用生产方的 `ctx.jobs.start()`。 |
| `@deepseek-ai/dsh-experimental-tool-agent-team` | `interrupt_agent`、`list_agents`、`send_message`、`spawn_teammate`、`team_task_create`、`team_task_get`、`team_task_list`、`team_task_update`、`wait_agent` | `ctx.tools`、`ctx.systemPrompt`、`ctx.agentTeams`、`an exact live Team member Agent` | `tool/call`、`team/member`、`team/message/queued`、`team/message/delivered`、`team/task`、`tool/result` | - | 这 9 个工具限定于隐式 Team Lead 与持久 teammate 作用域。随产品发布的 dsh-base bundle 默认禁用该包；文档中的 Agent Teams profile patch 会启用它，并禁用旧 continuable child 的同名控制工具。 |
| `@deepseek-ai/dsh-tool-todo` | `todo_write` | `ctx.tools`、`owning Agent session` | `tool/call`、`todo/write`、`tool/result` | - | todo_write 是会话所有的状态；UI 将最新的 todo/write 事件渲染为检查清单。`allowParallelInProgress` 是没有默认值的必填项，因此本目录明确选择 `true`，对应描述允许同时存在多个 `in_progress` 项。选择 `false` 的部署会获得同一工具，但描述会要求只能有 1 个活动任务。 |
| `@deepseek-ai/dsh-methodology` | `triz` | `ctx.tools`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | triz 在无参数时列出 40 条发明原理与 39 个工程参数，并在给定 improving/worsening 参数对时读取对应的 39×39 矛盾矩阵单元格；registerSection（默认 true）只切换常驻的 tool:triz 提示词区段。 |
| `@deepseek-ai/dsh-tool-literature` | `paper_download`、`paper_list_sources`、`paper_search` | `ctx.tools` | `tool/call`、`tool/result` | - | paper_list_sources 与 paper_search 是对四个免 key 公开源（arXiv、OpenAlex、Semantic Scholar、Crossref）的无状态查询；连接器开关属于配置，只会收窄可用的 `db` id。 |
| `@deepseek-ai/dsh-doc-template` | `list_doc_templates`, `render_doc_template` | `ctx.tools`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | list_doc_templates 列出随包的文档模板及其变量与支持的格式；render_doc_template 用给定变量把其中一个渲染为 Markdown、HTML 或 DOCX，并返回文档、残余占位符与变量警告。部署还可在 `styleGuide` 中指定已加载的书写风格名，把该风格指南作为系统提示段落注入。 |
| `@deepseek-ai/dsh-document-deliver` | `document_deliver` | `ctx.tools`、`ctx.fs` | `tool/call`、`tool/result` | - | document_deliver 把交付文件（path + format）、P0/P1 质量门状态与 brief 引用记录进会话日志；文件缺失即报错，工具本身不写任何文件。它还会读取每个交付文件并在工具结果里给出自己的确定性核验结论（残余占位符、未声明锚点、空章节、风格禁用词、声明字数预算），阻断级问题直接拒绝登记。交付工作室把该调用与结果元数据折叠进交付物清单、质量门徽标与机器核验徽标。 |
| `@deepseek-ai/dsh-patent-tools` | `add_patent_figure_references`、`analyze_patent_figure`、`claim_chart_build`、`draft_claims`、`draft_specification`、`evaluate_evidence`、`flexible_plan`、`generate_patent_figure`、`generate_structure_figure`、`knowledge_note_save`、`parse_office_action`、`patent_analysis_report`、`patent_case_search`、`patent_eval`、`patent_kg_query`、`patent_legal_status`、`patent_metadata`、`patent_pdf_download`、`patent_plan_task`、`patent_search`、`patent_wiki_search`、`patent_worker_validate`、`patent_workflow`、`patent_workflow_run`、`recognize_chemical_structure`、`rule_check`、`search_patent_figure`、`validate_specification`、`workbench_link_patent_case` | `ctx.tools` | `tool/call`、`tool/result` | - | Sati 专利领域工具集：检索/元数据/法律状态/判例/wiki/知识图谱查询，权利要求对照表、通知书解析、撰写、分析报告、说明书校验、证据判定、规则检查、附图分析、PDF 下载、化学结构识别、知识笔记，以及工作流/计划状态机。render_patent_document 由 @deepseek-ai/dsh-patent-document 提供。 |
| `@deepseek-ai/dsh-patent-document` | `render_patent_document` | `ctx.tools`、`ctx.subprocess` | `tool/call`、`tool/result` | - | render_patent_document 从内置 HTML 模板渲染专利交付物（权利要求书/说明书/检索报告/OA 答复/无效意见），可选通过 ctx.subprocess 调用无头 Chrome 生成 PDF。 |
| `@deepseek-ai/dsh-writing-patterns` | `query_writing_patterns` | `ctx.tools`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | query_writing_patterns selects drafting and office-action patterns from the packaged corpus by category, keyword, or case features, and returns the matched patterns with the compiled <writing_skills> block; the same block is injected as a system-prompt section so the drafting discipline is present without a call. |
| `@deepseek-ai/dsh-patent-deadline` | `patent_deadlines` | `ctx.tools` | `tool/call`、`tool/result` | - | patent_deadlines 报告一件中国专利案件的法定与指定期限，适用专利法实施细则的期限与送达规则，并把落在节假日的届满日顺延至其后第一个工作日；由通知起算的期限以待补项返回，并点名所缺的送达记录。 |
| `@deepseek-ai/dsh-patent-teams` | `patent_teams_add_member`, `patent_teams_archive`, `patent_teams_claim_task`, `patent_teams_create`, `patent_teams_create_task`, `patent_teams_delete`, `patent_teams_reassign_task`, `patent_teams_remove_member`, `patent_teams_send_message`, `patent_teams_status`, `patent_teams_update_task` | `ctx.tools`, `ctx.subagents`, `ctx.systemPrompt`, `a calling Agent as captain (member spawn/follow-up)` | `tool/call`, `tool/result`, `patent-teams/* session events` | - | The durable multi-agent team service for the patent domain: create a team (you become captain), add continuable subagent members by role, break the goal into dependency-aware tasks, and let the shared-task scheduler wake idle members. Member spawn and messaging use the captain as the direct parent, so a team survives harness restarts. |
| `@deepseek-ai/dsh-tool-workflow` | `workflow` | `ctx.tools`、`ctx.workflowEngine`、`ctx.systemPrompt`、`a calling Agent (exec.agent parents the script children)` | `tool/call`、`tool/result` | - | - |
| `@deepseek-ai/dsh-tool-workspace-dependencies` | `load_workspace_dependencies` | `ctx.tools` | `tool/call`、`tool/result` | - | - |
| `@deepseek-ai/dsh-tool-web` | `web_fetch`、`web_search` | `ctx.tools`、`ctx.web`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | web_search 和 web_fetch 将提供方选择置于 ctx.web 之后，使模型可见 schema 在更换后端时保持稳定。 |
| `@deepseek-ai/dsh-macos-tools` | `macos_app`、`macos_clipboard_get`、`macos_clipboard_set`、`macos_notify`、`macos_open_path`、`macos_open_url`、`macos_speak` | `ctx.tools`、`ctx.approval（打开/读剪贴板/应用启停的一次性许可；缺失即拒绝）` | `tool/call`、`tool/result`、`受控调用的 approval/asked + approval/decided` | - | 七个基于系统 CLI 的 macOS 原生工具（打开/显示、浏览器网址、剪贴板读写、通知、朗读、应用控制）；每次调用都以参数数组启动绝对路径的可执行文件，绝不使用 shell 字符串。 |

<a id="deepseek-aidsh-plugin-manager"></a>

## `@deepseek-ai/dsh-plugin-manager`

### `plugin_manager`

在当前 profile 中列出插件或组合包，启用或禁用它们，安装组合包，或移除已安装的组合包。每项操作都要求 danger-full-access 权限或本次调用的批准。批准不改变会话权限模式。变更影响该 profile 的所有会话。先列出条目以获取准确标识。包安装可能运行已获批准的构建脚本。支持热更新的 profile 立即应用变更；仅启动时加载的 profile 需要重启。不兼容的 DSH peer 依赖会阻止安装和激活。版本豁免可能导致崩溃和数据丢失：授权前必须警告用户，并获得用户对精确插件版本与运行时版本组合的明确许可。

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "description": "Management operation.",
      "enum": [
        "list_plugins",
        "list_bundles",
        "set_plugin",
        "set_bundle",
        "install_bundle",
        "remove_bundle",
        "list_version_exemptions",
        "set_version_exemption"
      ]
    },
    "target": {
      "type": "string",
      "description": "Plugin entry id, bundle package name, or installation spec, according to action."
    },
    "enabled": {
      "type": "boolean",
      "description": "Required for set operations; defaults to true for installation. For set_version_exemption, true grants and false revokes."
    },
    "runtimeVersion": {
      "type": "string",
      "description": "For set_version_exemption: exact DSH version from list_version_exemptions. Target must be the manifest package-name@version, not an alias or version range."
    },
    "acceptRisk": {
      "type": "boolean",
      "description": "For granting an exemption: true only after warning the user about possible crashes and data loss and receiving explicit permission for this exact plugin/runtime pair. General installation permission is not enough."
    },
    "approvedBuilds": {
      "type": "array",
      "description": "For install_bundle: pass names from pendingBuilds only after the user explicitly approves running their install scripts in the conversation. This grants persistent permission for this profile.",
      "items": {
        "type": "string"
      }
    },
    "registry": {
      "type": "string",
      "description": "For install_bundle: the npm registry URL asked first, when the user names one; otherwise the configured registry is asked, and its configured fallbacks while a registry is unreachable."
    },
    "offset": {
      "type": "number",
      "description": "Zero-based list offset; defaults to 0."
    },
    "limit": {
      "type": "number",
      "description": "List page size, from 1 to 100; defaults to 25."
    }
  },
  "required": [
    "action"
  ]
}
```

Source: [`packages/boot/plugin-manager/src/tools.ts`](../packages/boot/plugin-manager/src/tools.ts)

<a id="deepseek-aidsh-mcp-resources"></a>

## `@deepseek-ai/dsh-mcp-resources`

### `list_mcp_resource_templates`

列出 MCP 服务器提供的参数化资源 URI 模板。

```json
{
  "type": "object",
  "properties": {
    "server": {
      "type": "string",
      "description": "Configured MCP server name."
    },
    "cursor": {
      "type": "string",
      "description": "Continuation cursor returned by this server."
    }
  },
  "required": [
    "server"
  ]
}
```

来源：[`packages/mcp/mcp-resources/src/tools.ts`](../packages/mcp/mcp-resources/src/tools.ts)

### `list_mcp_resources`

列出 MCP 服务器提供的资源。

```json
{
  "type": "object",
  "properties": {
    "server": {
      "type": "string",
      "description": "Configured MCP server name."
    },
    "cursor": {
      "type": "string",
      "description": "Continuation cursor returned by this server."
    }
  },
  "required": [
    "server"
  ]
}
```

来源：[`packages/mcp/mcp-resources/src/tools.ts`](../packages/mcp/mcp-resources/src/tools.ts)

### `read_mcp_resource`

按 URI 从指定服务器读取 MCP 资源。使用已列出的 URI 或展开后的资源模板。

```json
{
  "type": "object",
  "properties": {
    "server": {
      "type": "string",
      "description": "Configured MCP server name."
    },
    "uri": {
      "type": "string",
      "description": "Resource URI to read."
    }
  },
  "required": [
    "server",
    "uri"
  ]
}
```

来源：[`packages/mcp/mcp-resources/src/tools.ts`](../packages/mcp/mcp-resources/src/tools.ts)

<a id="deepseek-aidsh-experimental-browser-use-stagehand-native"></a>

## `@deepseek-ai/dsh-experimental-browser-use-stagehand-native`

### `stagehand_act`

使用配置的 Stagehand 模型执行一次自然语言浏览器操作。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pageId": {
      "type": "string",
      "minLength": 1
    },
    "instruction": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "instruction"
  ],
  "additionalProperties": false
}
```

来源：[`packages/experimental/browser-use-stagehand-native/src/index.ts`](../packages/experimental/browser-use-stagehand-native/src/index.ts)

### `stagehand_extract`

使用配置的 Stagehand 模型与可选的 JSON Schema 提取页面数据。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pageId": {
      "type": "string",
      "minLength": 1
    },
    "instruction": {
      "type": "string",
      "minLength": 1
    },
    "schema": {
      "type": "object",
      "propertyNames": {
        "type": "string"
      },
      "additionalProperties": {
        "$ref": "#/$defs/__schema0"
      }
    }
  },
  "required": [
    "instruction"
  ],
  "additionalProperties": false,
  "$defs": {
    "__schema0": {
      "anyOf": [
        {
          "type": "string"
        },
        {
          "type": "number"
        },
        {
          "type": "boolean"
        },
        {
          "type": "null"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/$defs/__schema0"
          }
        },
        {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "$ref": "#/$defs/__schema0"
          }
        }
      ]
    }
  }
}
```

来源：[`packages/experimental/browser-use-stagehand-native/src/index.ts`](../packages/experimental/browser-use-stagehand-native/src/index.ts)

### `stagehand_navigate`

将 Stagehand 浏览器标签页导航至指定 URL。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pageId": {
      "type": "string",
      "minLength": 1
    },
    "url": {
      "type": "string",
      "format": "uri"
    }
  },
  "required": [
    "url"
  ],
  "additionalProperties": false
}
```

来源：[`packages/experimental/browser-use-stagehand-native/src/index.ts`](../packages/experimental/browser-use-stagehand-native/src/index.ts)

### `stagehand_observe`

使用配置的 Stagehand 模型查找符合指令的浏览器操作。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pageId": {
      "type": "string",
      "minLength": 1
    },
    "instruction": {
      "type": "string",
      "minLength": 1
    }
  },
  "required": [
    "instruction"
  ],
  "additionalProperties": false
}
```

来源：[`packages/experimental/browser-use-stagehand-native/src/index.ts`](../packages/experimental/browser-use-stagehand-native/src/index.ts)

### `stagehand_screenshot`

截取 Stagehand 标签页图像以供视觉检查。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "pageId": {
      "type": "string",
      "minLength": 1
    },
    "fullPage": {
      "default": false,
      "type": "boolean"
    }
  },
  "required": [
    "fullPage"
  ],
  "additionalProperties": false
}
```

来源：[`packages/experimental/browser-use-stagehand-native/src/index.ts`](../packages/experimental/browser-use-stagehand-native/src/index.ts)

### `stagehand_tabs`

列出、创建、选择或关闭 Stagehand 浏览器标签页。

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "oneOf": [
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "list"
        }
      },
      "required": [
        "action"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "const": "new"
        },
        "url": {
          "type": "string",
          "format": "uri"
        }
      },
      "required": [
        "action"
      ],
      "additionalProperties": false
    },
    {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "select",
            "close"
          ]
        },
        "pageId": {
          "type": "string",
          "minLength": 1
        }
      },
      "required": [
        "action",
        "pageId"
      ],
      "additionalProperties": false
    }
  ],
  "type": "object"
}
```

来源：[`packages/experimental/browser-use-stagehand-native/src/index.ts`](../packages/experimental/browser-use-stagehand-native/src/index.ts)

<a id="deepseek-aidsh-tool-ask-user"></a>

## `@deepseek-ai/dsh-tool-ask-user`

### `ask_user_question`

继续操作前，如果需要确认、选择或缺失的信息，请向用户提出简明问题。发送一个或多个问题，每个问题都带一个稳定 id，该 id 会在答案中原样返回。

```json
{
  "type": "object",
  "properties": {
    "questions": {
      "type": "array",
      "description": "Questions to ask the user before continuing.",
      "items": {
        "type": "object",
        "additionalProperties": true,
        "properties": {
          "id": {
            "type": "string",
            "description": "Stable id for this question; echoed in the answer."
          },
          "question": {
            "type": "string",
            "description": "The specific question to ask the user."
          },
          "header": {
            "type": "string",
            "description": "Optional short heading for the question, such as \"Confirm\" or \"Choose Mode\"."
          },
          "options": {
            "type": "array",
            "description": "Optional choices to show the user. If you recommend one, put it first and append \"(Recommended)\" to that label.",
            "items": {
              "type": "object",
              "additionalProperties": true,
              "properties": {
                "label": {
                  "type": "string",
                  "description": "Short user-facing option label."
                },
                "description": {
                  "type": "string",
                  "description": "One sentence explaining the tradeoff or impact."
                }
              },
              "required": [
                "label"
              ]
            }
          },
          "multi_select": {
            "type": "boolean",
            "description": "Whether the user may select more than one option. Defaults to false."
          }
        },
        "required": [
          "id",
          "question"
        ]
      }
    }
  },
  "required": [
    "questions"
  ]
}
```

来源：[`packages/interaction/tool-ask-user/src/index.ts`](../packages/interaction/tool-ask-user/src/index.ts)

ask_user_question 会暂停工具调用，直到当前 UI 提供方返回人类答案。

<a id="deepseek-aidsh-tools"></a>

## `@deepseek-ai/dsh-tools`

### `run_code`

针对可用工具执行 TypeScript 程序。接受两个必填参数：`code`，即异步函数的**函数体**（仅使用可擦除语法；支持顶层 `await` 和 `return`）；以及 `description`，简要说明该程序做什么。请根据系统提示词中的声明，以 `await tools.name(args)` 形式调用工具。只有打印或返回的内容属于程序输出，请谨慎筛选。含图片的子工具结果会在运行结束后附加。

```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "description": "The program: the body of an async TypeScript function."
    },
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this program does in active voice, 5-10 words (shown in the UI). Examples: \"Count TODO markers across packages\"; \"Read failing test and its fixture\"; \"Rename config key in every cordis.yml\"."
    },
    "timeoutMs": {
      "type": "number",
      "description": "Positive elapsed-time budget in milliseconds, capped by the deployment maximum."
    },
    "sandbox_permissions": {
      "type": "string",
      "description": "Wider sandbox mode for this complete program execution; requires justification and approval.",
      "enum": [
        "workspace-write",
        "danger-full-access"
      ]
    },
    "justification": {
      "type": "string",
      "description": "Reason this complete program needs wider access, shown to the user for approval."
    }
  },
  "required": [
    "code",
    "description"
  ]
}
```

来源：[`packages/core/tools/src/ptc.ts`](../packages/core/tools/src/ptc.ts)

在 `mode: ptc`／`mode: both` 下，它由工具注册表所有，作为可过滤能力层之外的保留传输机制（参见 PTC mode Agent Note）。在 `ptc` 下，它是注册表对协议格式的唯一贡献；其他可见能力在使用已加载运行时语言生成的 SDK 章节中声明。程序通过 binding 调用这些能力，调用按照原生并发约定调度：启动顺序和策略遵循提交顺序，并发安全的函数体最多重叠执行 `maxParallelSubCalls` 个。调用会重新进入完整且受守卫保护的工具流水线，并将每个嵌套执行关联到此外层结果。

<a id="deepseek-aidsh-plan-mode"></a>

## `@deepseek-ai/dsh-plan-mode`

### `exit_plan_mode`

仅在规划模式下使用。提交计划供用户评审，并在获批后退出规划模式。发送**完整的** Markdown 计划，以一个为计划命名的 # 标题开头。用户可以批准（从你的下一步骤起执行计划），也可以要求继续规划；其反馈会通过工具结果返回，请修改后再次提交。

```json
{
  "type": "object",
  "properties": {
    "plan": {
      "type": "string",
      "description": "The complete plan, as markdown, starting with a # heading that names it."
    }
  },
  "required": [
    "plan"
  ]
}
```

来源：[`packages/plan/plan-mode/src/index.ts`](../packages/plan/plan-mode/src/index.ts)

规划未激活时，exit_plan_mode 仍保留在面向模型的 schema 中，这样状态转换不会在规划策略变更之外额外造成工具目录变动。其执行路径会拒绝规划模式之外的调用；在规划模式下，它通过用户交互 seam 提交计划（批准／根据反馈继续规划），批准后会在步骤边界记录规划模式已停用。

<a id="deepseek-aidsh-tool-bash"></a>

## `@deepseek-ai/dsh-tool-bash`

### `bash`

执行一条 bash 命令（`bash -c`）并返回其 stdout/stderr。每次调用都在全新 shell 中运行：cwd、变量与函数等状态都不会在调用之间保留——请传 `workdir`，不要用 `cd`。非零退出以 `[exit code: N]` 报告。当前 harness 环境事实通过托管的 `$DSH_*` 变量暴露，需要时请读取。命令可能在文件沙箱下运行；被阻止的文件操作以 `[sandbox: file access denied under <mode> mode]` 报告——这是策略拒绝，不是命令本身的缺陷，不要换别的方式重试。过长输出会被截断为尾部；完整输出保存到文件，可用时报告其路径。长时间运行的命令请设 `run_in_background: true`：调用立即返回 job id；用 `job_output` 读取它的输出，用 `job_kill` 停止它。达到超时的前台命令不会被杀死：它会以同样的方式转入后台，返回其 job id 以及目前已有的输出。

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The bash command to execute."
    },
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: \"ls\" → \"List files in current directory\"; \"git status\" → \"Show working tree status\"; \"npm install\" → \"Install package dependencies\"."
    },
    "timeoutMs": {
      "type": "number",
      "description": "Timeout in milliseconds. The executor applies its configured default and cap; on expiry the command moves to the background as a job instead of being killed."
    },
    "workdir": {
      "type": "string",
      "description": "Working directory for this command. Defaults to the session workspace; a relative path is resolved against it."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies."
    }
  },
  "required": [
    "command",
    "description"
  ]
}
```

来源：[`packages/shell/tool-bash/src/index.ts`](../packages/shell/tool-bash/src/index.ts)

bash 工具是 bash 执行器 seam 面向模型的消费方。组合了 job 注册表时，每次调用在启动时即注册到通用 `ctx.jobs` 运行时，并通过 `job_*` 工具（来自 `@deepseek-ai/dsh-tool-jobs`）收集／停止；未组合注册表时，或 `enableRunInBackground: false` 时，该工具注册的是不含 `run_in_background` 参数的前台专用 schema。

<a id="deepseek-aidsh-tool-present"></a>

## `@deepseek-ai/dsh-tool-present`

### `present`

声明选定的已有文件为可通过 Session 文件系统访问的最终交付物。当用户需要单独的文件交付物时使用 present，尤其是 Office 文档、电子表格和幻灯片。若在最终回复中展示结果已经足够，请优先那样做；创建或编辑文件本身并不要求调用 present。通常选择最重要的 1-2 个交付物；需要时可增加，但单次 present 调用最多 4 个文件。文件必须已存在。用户打开当前源文件；不复制或保存其内容。

```json
{
  "type": "object",
  "properties": {
    "files": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "path": {
            "type": "string",
            "description": "Path of an existing regular file. Relative paths use the Session working directory."
          },
          "description": {
            "type": "string",
            "description": "Brief description for the user."
          }
        },
        "required": [
          "path"
        ]
      }
    }
  },
  "required": [
    "files"
  ]
}
```

来源：[`packages/deliverables/tool-present/src/index.ts`](../packages/deliverables/tool-present/src/index.ts)

交付归调用方 Session 所有；Web ui-deliverables 提供源文件打开与卡片。

<a id="deepseek-aidsh-tool-pwsh"></a>

## `@deepseek-ai/dsh-tool-pwsh`

### `pwsh`

执行一条 PowerShell 命令（`pwsh -Command`）并返回其 stdout/stderr。每次调用都在全新 pwsh 进程中运行：cwd、变量与函数等状态都不会在调用之间保留——请传 `workdir`，不要用 `cd`。路径采用原生 Windows 形式（`C:\...`）；用 `$env:NAME` 读取环境变量。非零退出以 `[exit code: N]` 报告。当前 harness 环境事实通过托管的 `$env:DSH_*` 变量暴露，需要时请读取。命令可能在文件沙箱下运行；被阻止的文件操作以 `[sandbox: file access denied under <mode> mode]` 报告——这是策略拒绝，不是命令本身的缺陷，不要换别的方式重试。过长输出会被截断为尾部；完整输出保存到文件，可用时报告其路径。在 Windows 上，被强制终止的命令以 `[exit code: 1]` 结算且不带信号标记——应视为中断，而不是命令失败。长时间运行的命令请设 `run_in_background: true`：调用立即返回 job id；用 `job_output` 读取它的输出，用 `job_kill` 停止它。达到超时的前台命令不会被杀死：它会以同样的方式转入后台，返回其 job id 以及目前已有的输出。

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The PowerShell command to execute."
    },
    "description": {
      "type": "string",
      "description": "Clear, concise description of what this command does in active voice, 5-10 words (shown in the UI). Examples: \"ls\" → \"List files in current directory\"; \"git status\" → \"Show working tree status\"; \"Get-Process\" → \"List running processes\"."
    },
    "timeoutMs": {
      "type": "number",
      "description": "Timeout in milliseconds. The executor applies its configured default and cap; on expiry the command moves to the background as a job instead of being killed."
    },
    "workdir": {
      "type": "string",
      "description": "Working directory for this command. Defaults to the session workspace; a relative path is resolved against it."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies."
    }
  },
  "required": [
    "command",
    "description"
  ]
}
```

来源：[`packages/shell/tool-pwsh/src/index.ts`](../packages/shell/tool-pwsh/src/index.ts)

pwsh 工具是 Windows 组合中 bash 执行器 seam 的 PowerShell 方言消费方（由 `@deepseek-ai/dsh-pwsh-local` 等 PowerShell 执行器为 `ctx.shell` 提供后端）；除沙箱接口外，它逐项对应 bash 工具调用。使用 `run_in_background` 的运行会注册到通用 `ctx.jobs` 运行时，并通过 `job_*` 工具收集／停止；托管的 `DSH_*` 环境来自 `@deepseek-ai/dsh-shell-env`。每次调用都在新进程中运行，不使用持久 PTY 会话。路径采用原生 `C:\...` 形式，变量采用 `$env:NAME`。

<a id="deepseek-aidsh-tool-cordis"></a>

## `@deepseek-ai/dsh-tool-cordis`

### `cordis_inspect_list`

列出 Host 当前已知的全部 Cordis Inspect Provider，包括本地 Host Provider 和 Client 最近同步的 manifest。每项包含所属平台、用途、只读方法及输入／输出 schema。创建或修改 Package 前先调用本 Tool，再从结果中选择 cordis_inspect_query 的 provider 和 method。不要猜测名称，也不要把 Inspect method 当作 Plugin 代码可调用的业务 Service。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_inspect_query`

执行 Inspect Provider 声明的只读查询。platform、provider 和 method 必须来自 cordis_inspect_list，input 必须符合该方法的 schema。在编写 plugin 代码前用本 Tool 读取精确 Service 方法、Event mode、plugin Config schema、Tool schema、主题 token，或实时 Slot 树及 props。Host 查询在本地执行；Client 查询等待首个有效页面响应，在页面回答或 Tool 被取消前保持 pending。本 Tool 不能调用业务 Service 方法或修改运行时。

```json
{
  "type": "object",
  "properties": {
    "platform": {
      "type": "string",
      "description": "Runtime platform that owns the Provider.",
      "enum": [
        "host",
        "client"
      ]
    },
    "provider": {
      "type": "string",
      "description": "Exact Provider ID returned by cordis_inspect_list."
    },
    "method": {
      "type": "string",
      "description": "Exact method name declared by the Provider manifest."
    },
    "input": {
      "description": "Optional query input; it must satisfy the method input schema."
    }
  },
  "required": [
    "platform",
    "provider",
    "method"
  ]
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

Creator 模式提供两个只读的运行时检查工具。检查注册表由 Cordis host runner 提供；Client 查询需要已连接的页面。持久变更请写成组合包，并用 plugin_manager 安装。

<a id="deepseek-aidsh-tool-plugin-market"></a>

## `@deepseek-ai/dsh-tool-plugin-market`

### `market_plugin_preview`

针对 npm registry 预览一个包引用（`name@version`），不触碰任何 profile。它报告该引用是否解析为真实且未废弃的发布版本、全部拒绝原因、包声明的生命周期脚本，以及其 engines 约束是否接受正在运行的 Node。推荐安装之前先调用本工具；当搜索条目带有固定版本时，必须使用那个版本字符串。Preview 是只读的，从不安装。

```json
{
  "type": "object",
  "properties": {
    "ref": {
      "type": "string",
      "description": "Package reference as `name@version`, e.g. @deepseek-ai/dsh-tool-bash@0.1.2-alpha.1."
    }
  },
  "required": [
    "ref"
  ]
}
```

来源：[`packages/extensions/tool-plugin-market/src/index.ts`](../packages/extensions/tool-plugin-market/src/index.ts)

### `market_plugin_search`

在一个目录来源中搜索插件。省略 sourceId 时查询内置的 DeepSeek 目录；传入来自 market_source_list 的显式来源 id，即可搜索用户注册的目录。可用 q（自由文本）、category 与 capability 过滤。结果是一页条目，每条包含准确的 npm 包名、固定版本、描述、能力标签及其来源。搜索是只读的：用 market_plugin_preview 对照 registry 检查包，把安装留在 dsh plugin CLI 上——不要声称已安装某个包。

```json
{
  "type": "object",
  "properties": {
    "sourceId": {
      "type": "string",
      "description": "Source id from market_source_list; defaults to the bundled catalog."
    },
    "q": {
      "type": "string",
      "description": "Free-text search term."
    },
    "category": {
      "type": "string",
      "description": "Exact category label to filter by."
    },
    "capability": {
      "type": "string",
      "description": "Exact capability label to filter by."
    },
    "limit": {
      "type": "number",
      "description": "Maximum entries to return (the source may clamp it)."
    }
  }
}
```

来源：[`packages/extensions/tool-plugin-market/src/index.ts`](../packages/extensions/tool-plugin-market/src/index.ts)

### `market_source_list`

列出插件市场当前可用的全部目录来源，包括宿主内置的 DeepSeek 目录和任何用户注册的 HTTPS 目录。每个条目展示其稳定来源 id、提供方 id、显示名称、是否为内置离线目录，以及它接受的查询参数。尚不知道有效来源 id 时，先调用本工具再调用 market_plugin_search；除非依赖内置目录默认值，搜索必须提供来源 id。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/extensions/tool-plugin-market/src/index.ts`](../packages/extensions/tool-plugin-market/src/index.ts)

市场工具集读取 `@deepseek-ai/dsh-host-plugin-market` 提供的 `ctx.pluginMarket`，后者始终从内存提供内置离线目录（`builtin-deepseek`），并通过市场的受限 fetch 提供用户注册的 HTTPS 来源。标准 preset 下这些工具对所有 agent 会话可见；安装始终是操作者在 `dsh plugin` CLI 上的动作，绝不是模型调用。

<a id="deepseek-aidsh-tool-bash-persistent"></a>

## `@deepseek-ai/dsh-tool-bash-persistent`

### `bash`

在持久 bash shell 中运行命令。包括当前目录和已导出环境变量在内的状态会在此 agent 的多次调用之间保留。

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The bash command to run. Relative path is preferred in the command."
    }
  },
  "required": [
    "command"
  ]
}
```

来源：[`packages/shell/tool-bash-persistent/src/index.ts`](../packages/shell/tool-bash-persistent/src/index.ts)

一个按所有者隔离的持久 bash 工具；部署组合提供 PTY 后端，并可覆盖面向模型的环境描述。

<a id="deepseek-aidsh-tool-pwsh-persistent"></a>

## `@deepseek-ai/dsh-tool-pwsh-persistent`

### `pwsh`

在持久 PowerShell shell 中运行命令。包括当前目录和已导出环境变量在内的状态会在此 agent 的多次调用之间保留。

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The PowerShell command to run. Relative path is preferred in the command."
    }
  },
  "required": [
    "command"
  ]
}
```

来源：[`packages/shell/tool-pwsh-persistent/src/index.ts`](../packages/shell/tool-pwsh-persistent/src/index.ts)

一个按所有者隔离的持久 pwsh 工具，持久 bash 工具的 Windows 对应物；部署组合提供 pwsh 方言的 PTY 后端，并可覆盖面向模型的环境描述。

<a id="deepseek-aidsh-tool-str-replace-editor"></a>

## `@deepseek-ai/dsh-tool-str-replace-editor`

### `str_replace_editor`

用于查看、创建和编辑文件的自定义编辑工具：

* 状态会在命令调用以及与用户的讨论之间持久保留
* 如果 `path` 是文件，`view` 会显示应用 `cat -n` 后的结果。如果 `path` 是目录，`view` 会列出最多向下 2 层的非隐藏文件和目录
* 如果指定的 `create` 命令目标 `path` 已作为文件存在，则不能使用该命令
* 如果 `command` 产生较长输出，输出会被截断并标记为 `<response clipped>`
* 当前命令不使用某个参数时，值为 `null` 的占位参数视为未提供。必填参数仍须提供值；删除匹配内容时应省略 `str_replace.new_str`，而不是将其设为 `null`

使用 `str_replace` 命令时请注意：

* `old_str` 参数应与原文件中一行或多行连续内容**完全**匹配。请留意空白字符！
* 如果 `old_str` 参数在文件中不唯一，则不会执行替换。请确保在 `old_str` 中包含足够的上下文，使其唯一
* `new_str` 参数应包含用于替换 `old_str` 的已编辑行

```json
{
  "type": "object",
  "properties": {
    "command": {
      "type": "string",
      "description": "The commands to run. Allowed options are: `view`, `create`, `str_replace`, `insert`.",
      "enum": [
        "view",
        "create",
        "str_replace",
        "insert"
      ]
    },
    "path": {
      "type": "string",
      "description": "Absolute path to file or directory, e.g. `/repo/file.py` or `/repo`."
    },
    "file_text": {
      "oneOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "description": "Required string parameter of `create` command, with the content of the file to be created. A null placeholder is treated as omitted by commands that do not use this parameter."
    },
    "insert_line": {
      "oneOf": [
        {
          "type": "integer"
        },
        {
          "type": "null"
        }
      ],
      "description": "Required integer parameter of `insert` command. The `new_str` will be inserted AFTER the line `insert_line` of `path`. A null placeholder is treated as omitted by commands that do not use this parameter."
    },
    "new_str": {
      "oneOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "description": "Optional string parameter of `str_replace` command containing the new string (if omitted, no string will be added). Required string parameter of `insert` command containing the string to insert. A null placeholder is accepted only by commands that do not use this parameter."
    },
    "old_str": {
      "oneOf": [
        {
          "type": "string"
        },
        {
          "type": "null"
        }
      ],
      "description": "Required string parameter of `str_replace` command containing the string in `path` to replace. A null placeholder is treated as omitted by commands that do not use this parameter."
    },
    "view_range": {
      "oneOf": [
        {
          "type": "array",
          "items": {
            "type": "integer"
          }
        },
        {
          "type": "null"
        }
      ],
      "description": "Optional parameter of `view` command when `path` points to a file. If omitted or null, the full file is shown. If provided, the file will be shown in the indicated line number range, e.g. [11, 12] will show lines 11 and 12. Indexing at 1 to start. Setting `[start_line, -1]` shows all lines from `start_line` to the end of the file."
    }
  },
  "required": [
    "command",
    "path"
  ]
}
```

来源：[`packages/fs/tool-str-replace-editor/src/index.ts`](../packages/fs/tool-str-replace-editor/src/index.ts)

基于文件系统 seam 的独立查看／创建／唯一字面量替换／按行插入工具；可与任何 shell 或终端接口组合。

<a id="deepseek-aidsh-tool-fs"></a>

## `@deepseek-ai/dsh-tool-fs`

### `edit`

通过替换字面量文本来编辑现有 UTF-8 文本文件。

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to edit, resolved by the filesystem backend."
    },
    "old_string": {
      "type": "string",
      "description": "Literal text to replace. Must match exactly."
    },
    "new_string": {
      "type": "string",
      "description": "Literal replacement text. Use an empty string to delete the match."
    },
    "replace_all": {
      "type": "boolean",
      "description": "Replace all matches. Defaults to false; when false, old_string must appear exactly once."
    }
  },
  "required": [
    "file_path",
    "old_string",
    "new_string"
  ]
}
```

来源：[`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

### `read`

读取 UTF-8 文本文件，并返回带行号的内容。

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to read, resolved by the filesystem backend."
    },
    "offset": {
      "type": "number",
      "description": "1-based first line to return. Defaults to 1."
    },
    "limit": {
      "type": "number",
      "description": "Maximum number of lines to return. Defaults to 2000."
    }
  },
  "required": [
    "file_path"
  ]
}
```

来源：[`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

### `read_image`

读取 PNG/JPEG/WebP/GIF 文件并返回图像本身。无扩展名的路径同样被接受；格式按文件内容检测，因此规范化附件路径可以直接传入，无需复制或重命名。Harness 会在下一次模型请求前校验并缩小受支持的大图，因此仅为查看图片时应直接使用此工具，无需安装图片库或创建缩略图。可以用小批次并发读取彼此独立的文件。要求当前模型接受图像输入。

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to the image file, resolved by the filesystem backend."
    }
  },
  "required": [
    "file_path"
  ]
}
```

来源：[`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

### `write`

创建或完全替换 UTF-8 文本文件。

```json
{
  "type": "object",
  "properties": {
    "file_path": {
      "type": "string",
      "description": "Path to write, resolved by the filesystem backend."
    },
    "content": {
      "type": "string",
      "description": "Full UTF-8 text content to write."
    }
  },
  "required": [
    "file_path",
    "content"
  ]
}
```

来源：[`packages/fs/tool-fs/src/index.ts`](../packages/fs/tool-fs/src/index.ts)

先读后写／编辑策略由 `@deepseek-ai/dsh-fs-observation-policy` 添加；它是一个 `fs/*` 事件门禁插件，不会改变 schema。加载这些工具的部署按预期也应加载该插件。没有 `ctx.attachments` 时图片工具不会注册；其 schema 与路由无关，执行时除非确切路由的模型声明图片输入，否则拒绝。

<a id="deepseek-aidsh-tool-fs-search"></a>

## `@deepseek-ai/dsh-tool-fs-search`

### `glob`

查找路径匹配 glob 模式的文件。只返回匹配的文件路径，绝不返回目录；包括隐藏文件和被忽略的文件，但排除 VCS 元数据目录。最多按修改时间顺序返回 100 条路径；如果结果更多，则改为返回从顶层条目中抽样的 100 条路径，说明已抽样，并报告完整排序列表的保存位置。该工具不枚举目录条目。

```json
{
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string",
      "description": "Glob pattern to match file paths against (e.g. \"**/*.ts\", \"src/**/*.test.js\"). A pattern with no \"/\" matches the basename at any depth, so \"*\" and \"*.ts\" both search the whole tree; include a separator to anchor the depth."
    },
    "path": {
      "type": "string",
      "description": "Directory to search in. Defaults to the session workspace; a relative path resolves against it."
    }
  },
  "required": [
    "pattern"
  ]
}
```

来源：[`packages/fs/tool-fs-search/src/index.ts`](../packages/fs/tool-fs-search/src/index.ts)

### `grep`

使用 ripgrep 正则表达式搜索文件内容。返回带行号的匹配行，并按文件分组。前 250 条匹配会直接返回；结果达到上限时会报告完整匹配列表的保存位置。如需周边上下文，请对匹配的文件使用 read。

```json
{
  "type": "object",
  "properties": {
    "pattern": {
      "type": "string",
      "description": "Regular expression to search for (ripgrep syntax)."
    },
    "path": {
      "type": "string",
      "description": "File or directory to search. Defaults to the session workspace; a relative path resolves against it."
    },
    "include": {
      "type": "string",
      "description": "One glob filter for which files to search (e.g. \"*.ts\", \"*.{js,jsx}\"). Not a list; negation is not supported."
    }
  },
  "required": [
    "pattern"
  ]
}
```

来源：[`packages/fs/tool-fs-search/src/index.ts`](../packages/fs/tool-fs-search/src/index.ts)

glob 和 grep 是无条件可用的发现工具，通过 ctx.subprocess spawn 随包提供的 ripgrep 二进制文件（`@vscode/ripgrep`），并作为普通前台调用运行，绝不作为后台任务；无需在宿主机安装 `rg`，也不经过 shell 层。本目录使用 `sampleOverCapGlobResults: true`；部署必须显式选择该行为。结果超过上限时，会通过可选的 ctx.spillStore 后端保存完整的格式化列表；在共置部署中，如果后端公开本地路径，返回的定位信息可供后续读取／搜索。

<a id="deepseek-aidsh-tool-terminal"></a>

## `@deepseek-ai/dsh-tool-terminal`

### `terminal_close`

关闭一个持久终端，并等待其捕获且所有的进程树完全退出。

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id."
    }
  },
  "required": [
    "sessionId"
  ]
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_list`

列出当前 agent 所有的持久终端会话。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_open`

通过已注册的后端类型创建按所有者隔离的持久终端会话。需要在多次工具调用之间保留 shell 或 REPL 状态时，请使用此工具。

```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "description": "Registered terminal backend type, usually \"shell\"."
    },
    "name": {
      "type": "string",
      "description": "Optional owner-local display name such as \"main\" or \"gdb\"."
    },
    "cwd": {
      "type": "string",
      "description": "Initial working directory. Defaults to the deployment workspace root."
    }
  },
  "required": [
    "type"
  ]
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_read`

从持久终端读取一页有界的保留输出，不发送输入。

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id."
    },
    "offset": {
      "type": "number",
      "description": "Newest-relative line offset (default 0)."
    },
    "count": {
      "type": "number",
      "description": "Requested line count (default 500; backend caps apply)."
    }
  },
  "required": [
    "sessionId"
  ]
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_send`

向持久终端发送文本。默认会提交 Enter，并等待提示符、stdin 等待、输出静默、超时或会话退出。后台模式会返回供 job_output／job_kill 使用的 job id。

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id returned by terminal_open or terminal_list."
    },
    "text": {
      "type": "string",
      "description": "UTF-8 text to write to the terminal."
    },
    "submit": {
      "type": "boolean",
      "description": "Submit Enter after text (default true). Set false for control characters or incomplete REPL input."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Return a job id immediately; collect with job_output or stop with job_kill."
    }
  },
  "required": [
    "sessionId",
    "text"
  ]
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

### `terminal_signal`

向持久终端当前的前台进程组发送允许的信号。

```json
{
  "type": "object",
  "properties": {
    "sessionId": {
      "type": "string",
      "description": "Terminal session id."
    },
    "signal": {
      "type": "string",
      "description": "Signal to deliver. Shell-targeted SIGKILL is rejected; use terminal_close.",
      "enum": [
        "SIGINT",
        "SIGTERM",
        "SIGKILL",
        "SIGTSTP",
        "SIGHUP"
      ]
    }
  },
  "required": [
    "sessionId",
    "signal"
  ]
}
```

来源：[`packages/terminal/tool-terminal/src/index.ts`](../packages/terminal/tool-terminal/src/index.ts)

这 6 个终端工具需要选择启用，用于补充一次性 bash／文件系统工具。`terminal_send(run_in_background: true)` 会注册到 `ctx.jobs`；schema 不包含 TUI、具名按键序列、BEL、调整尺寸、自动启动和跨 agent 共享。

<a id="deepseek-aidsh-tool-goal"></a>

## `@deepseek-ai/dsh-tool-goal`

### `create_goal`

当当前直接人类请求是需要跨自主 Goal Round 持续推进的长期目标时，创建一个持久化的同会话完成目标。即使用户没有明确说「创建目标」，你也可以推断其意图。不要用于简单的单轮工作。执行时会拒绝非人类权限和 subagent 权限。

```json
{
  "type": "object",
  "properties": {
    "objective": {
      "type": "string",
      "description": "The concrete completion objective inferred from the direct human request."
    },
    "max_goal_rounds": {
      "type": "number",
      "description": "Optional positive safe-integer limit on automatic continuation rounds."
    }
  },
  "required": [
    "objective"
  ]
}
```

来源：[`packages/goal/tool-goal/src/index.ts`](../packages/goal/tool-goal/src/index.ts)

### `get_goal`

读取当前的同会话目标，包括确切的 id／revision、目标、阶段、已完成的延续 Round 数、Round 上限、存在时的阻塞原因，以及是否已准备下一次延续。更新目标前请先调用此工具。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/goal/tool-goal/src/index.ts`](../packages/goal/tool-goal/src/index.ts)

### `update_goal`

更新确切的当前目标 revision。edit、pause 和 resume 要求直接的顶层人类请求。在自动延续当前目标期间，也允许 complete 和 blocked。在达到配置的最小 Round 数之前会拒绝 blocked；模型仍须判断相同条件是否在这些 Round 中持续存在，并在 blocked_reason 中予以说明。

```json
{
  "type": "object",
  "properties": {
    "goal_id": {
      "type": "string",
      "description": "Exact id returned by get_goal."
    },
    "revision": {
      "type": "number",
      "description": "Exact positive revision returned by get_goal."
    },
    "action": {
      "type": "string",
      "description": "edit | pause | resume | complete | blocked",
      "enum": [
        "edit",
        "pause",
        "resume",
        "complete",
        "blocked"
      ]
    },
    "objective": {
      "type": "string",
      "description": "Replacement objective; valid only with action edit."
    },
    "max_goal_rounds": {
      "type": "number",
      "description": "Replacement cap; valid only with action edit."
    },
    "blocked_reason": {
      "type": "string",
      "description": "Concrete blocking condition; required only with action blocked."
    }
  },
  "required": [
    "goal_id",
    "revision",
    "action"
  ]
}
```

来源：[`packages/goal/tool-goal/src/index.ts`](../packages/goal/tool-goal/src/index.ts)

create、edit、pause 和 resume 要求直接来自人类的根权限；complete 和 blocked 也接受确切的当前 Goal Round。blocked 的默认下限是 3 个获准的 Round。

<a id="deepseek-aidsh-schedule"></a>

## `@deepseek-ai/dsh-schedule`

### `schedule_create`

在当前会话中创建一条提醒。请提供非空 prompt 和恰好一个 selector：正的安全整数 after_seconds 延时；作为严格带偏移日期时间或本地日期／时间对象的 at；或不小于 300 的安全整数 every_seconds。固定速率提醒始终与创建时刻对齐，会跳过错过的发生时点，并把每条逾期规则的最新一个发生时点合并到一个批次中。交付模式是 session-local：只有此会话处于 live 状态时，提醒才会准时运行；否则提醒会进入 overdue 状态，直至会话恢复。

```json
{
  "type": "object",
  "properties": {
    "prompt": {
      "type": "string",
      "description": "Reminder content to present when the target becomes due."
    },
    "after_seconds": {
      "type": "number",
      "description": "Positive safe-integer delay in seconds."
    },
    "every_seconds": {
      "type": "number",
      "description": "Fixed-rate safe-integer interval in seconds, at least 300."
    },
    "at": {
      "oneOf": [
        {
          "type": "string"
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "date": {
              "type": "string"
            },
            "time": {
              "type": "string"
            },
            "time_zone": {
              "type": "string"
            }
          },
          "required": [
            "date",
            "time",
            "time_zone"
          ]
        }
      ],
      "description": "Absolute target as strict offset RFC 3339 or local date/time with an explicit IANA zone."
    }
  },
  "required": [
    "prompt"
  ]
}
```

来源：[`packages/schedule/schedule/src/tools.ts`](../packages/schedule/schedule/src/tools.ts)

### `schedule_delete`

使用 schedule_create 或 schedule_list 返回的确切 id，删除当前会话中的一条活动提醒。未知或已经结束的 id 会返回 deleted false。

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "description": "Exact session-local schedule id."
    }
  },
  "required": [
    "id"
  ]
}
```

来源：[`packages/schedule/schedule/src/tools.ts`](../packages/schedule/schedule/src/tools.ts)

### `schedule_list`

按创建顺序列出当前会话中的所有活动提醒，包括确切 id、UTC 目标、scheduled 或 overdue 状态，以及 session-local 交付模式。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/schedule/schedule/src/tools.ts`](../packages/schedule/schedule/src/tools.ts)

仅在选择启用的 Schedule 插件加载后创建的 live 根 Agent scope 内注册。版本 1 接受 after_seconds、显式绝对 at 和有界固定速率 every_seconds，并披露 session-local 交付；管理读取与变更必须通过共享的 Session 持久化 barrier。

<a id="deepseek-aidsh-tool-lsp"></a>

## `@deepseek-ai/dsh-tool-lsp`

### `lsp`

查询语言服务器，以精确导航代码。operation 可取 goToDefinition、findReferences、goToImplementation 或 hover。line 和 character 是从 1 开始的 UTF-16 光标坐标。findReferences 包含声明。

```json
{
  "type": "object",
  "properties": {
    "operation": {
      "type": "string",
      "description": "goToDefinition, findReferences, goToImplementation, or hover.",
      "enum": [
        "goToDefinition",
        "findReferences",
        "goToImplementation",
        "hover"
      ]
    },
    "file_path": {
      "type": "string",
      "description": "The source file to query, relative to the workspace or absolute."
    },
    "line": {
      "type": "number",
      "description": "One-based line of the cursor."
    },
    "character": {
      "type": "number",
      "description": "One-based UTF-16 column of the cursor."
    }
  },
  "required": [
    "operation",
    "file_path",
    "line",
    "character"
  ]
}
```

来源：[`packages/lsp/tool-lsp/src/index.ts`](../packages/lsp/tool-lsp/src/index.ts)

lsp 工具将提供方选择和语言服务器子进程置于 ctx.lsp 之后，因此其模型可见 schema 在更换提供方时保持稳定。运行时要求已注册提供方，例如 `@deepseek-ai/dsh-lsp-stdio`；如果没有提供方，查询会返回结构化 `LSP_UNAVAILABLE` 错误，而不会改变 schema。

<a id="deepseek-aidsh-tool-ralph"></a>

## `@deepseek-ai/dsh-tool-ralph`

### `ralph`

围绕一个不可变目标运行使用全新 agent 的前台 Ralph 循环。仅当直接人类明确要求 Ralph 或使用全新 agent 迭代时使用。每个 Round 都会启动一个全新子级，该子级看不到父级对话或先前子会话；共享工作区充当长期记忆，Round 之间只传递有界的结构化报告。当工作进程报告完成、报告具体阻塞项或达到 Round 上限时，调用返回。普通的长期同会话工作应使用 goal 工具。

```json
{
  "type": "object",
  "properties": {
    "objective": {
      "type": "string",
      "description": "The immutable completion objective for every fresh Ralph round."
    },
    "maxRounds": {
      "type": "number",
      "description": "Optional positive safe-integer round cap, bounded by the deployment ceiling."
    }
  },
  "required": [
    "objective"
  ]
}
```

来源：[`packages/workflow/tool-ralph/src/index.ts`](../packages/workflow/tool-ralph/src/index.ts)

固定的前台工作流会在每个 Round 启动一个全新的结构化子级；模型只能选择不可变目标和可选的 Round 上限。

<a id="deepseek-aidsh-tool-skill"></a>

## `@deepseek-ai/dsh-tool-skill`

### `skill`

加载可用 skill（技能）的完整说明。在执行点名某项 skill 或与其明确匹配的任务前，请使用会话 skill 目录中的确切名称调用此工具。

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "The exact skill name from the available skills list."
    }
  },
  "required": [
    "name"
  ]
}
```

来源：[`packages/skill/tool-skill/src/index.ts`](../packages/skill/tool-skill/src/index.ts)

<a id="deepseek-aidsh-tool-self-evolve"></a>

## `@deepseek-ai/dsh-tool-self-evolve`

### `self_evolve_inspect_patterns`

读取当前会话投影出的失败模式状态。返回条目按出现次数排序；每条都引用支撑该模式的事件在持久化会话中的 seq。在调用 self_evolve_now 之前先调用此工具，以便针对真实模式而非猜测。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/self-evolve/tool-self-evolve/src/index.ts`](../packages/self-evolve/tool-self-evolve/src/index.ts)

### `self_evolve_now`

为当前会话发起一次显式自进化循环：挖掘投影出的失败模式，为所请求层级提出窄幅编辑，并提交通过提供方验证门禁的提案。`levels` 默认指向 skill 与提示词片段编辑（L1-skill、L2-context）。L3-workflow 与 L4-harness 为前向兼容而接受，但基础提供方目前不产出这两个层级的提案。

```json
{
  "type": "object",
  "properties": {
    "levels": {
      "type": "array",
      "description": "Edit surfaces this loop may target. Defaults to the two narrowest surfaces. The base provider implements L1-skill and L2-context only; L3-workflow and L4-harness produce no proposals until advanced providers land.",
      "items": {
        "type": "string",
        "enum": [
          "L1-skill",
          "L2-context",
          "L3-workflow",
          "L4-harness"
        ]
      }
    }
  }
}
```

来源：[`packages/self-evolve/tool-self-evolve/src/index.ts`](../packages/self-evolve/tool-self-evolve/src/index.ts)

两个工具驱动 self-evolve 能力缝：`self_evolve_inspect_patterns` 读取会话投影出的失败模式，`self_evolve_now` 启动一次显式循环。基础提供方仅面向 L1-skill 与 L2-context；L3-workflow 与 L4-harness 请求暂不产生提案。

<a id="deepseek-aidsh-tool-session-query"></a>

## `@deepseek-ai/dsh-tool-session-query`

### `session_event_read`

从一个已获授权的会话中读取一个完整且未删节的事件，以及可选的相邻原始事件概述。

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    },
    "seq": {
      "type": "integer",
      "description": "Target event sequence number."
    },
    "before": {
      "type": "integer",
      "description": "Number of preceding raw events to summarize. Omit for none."
    },
    "after": {
      "type": "integer",
      "description": "Number of following raw events to summarize. Omit for none."
    }
  },
  "required": [
    "seq"
  ]
}
```

来源：[`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_event_search`

在一个已获授权的会话中搜索先前事件；如果搜索当前会话，则排除执行此次调用的步骤。

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    },
    "query": {
      "type": "string",
      "description": "Literal full-text query over the target session."
    },
    "seq_from": {
      "type": "integer",
      "description": "Inclusive event sequence lower bound."
    },
    "seq_to": {
      "type": "integer",
      "description": "Inclusive event sequence upper bound."
    },
    "time_from": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time lower bound."
    },
    "time_to": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time upper bound."
    },
    "event_types": {
      "type": "array",
      "description": "Event types to include.",
      "items": {
        "type": "string"
      }
    },
    "surfaces": {
      "type": "array",
      "description": "Event surfaces to include.",
      "items": {
        "type": "string",
        "enum": [
          "current",
          "shadowed",
          "log-only"
        ]
      }
    }
  },
  "required": [
    "query"
  ]
}
```

来源：[`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_event_trace`

读取已获授权会话中某个事件的所有直接替换关系，以及该事件与其引用的来源事件之间的关系。

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    },
    "seq": {
      "type": "integer",
      "description": "Target event sequence number."
    }
  },
  "required": [
    "seq"
  ]
}
```

来源：[`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_search`

搜索调用方工作区中的先前会话，并从每个会话返回匹配度最高的事件。

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Literal full-text query over prior session history."
    },
    "session_ids": {
      "type": "array",
      "description": "Optional session ids to include.",
      "items": {
        "type": "string"
      }
    },
    "created_at_from": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 creation-time lower bound."
    },
    "created_at_to": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 creation-time upper bound."
    },
    "parent_session_ids": {
      "type": "array",
      "description": "Optional direct parent session ids.",
      "items": {
        "type": "string"
      }
    },
    "include_root_sessions": {
      "type": "boolean",
      "description": "Include sessions with no parent in the parent filter."
    },
    "availability": {
      "type": "array",
      "description": "Require at least one selected source availability.",
      "items": {
        "type": "string",
        "enum": [
          "live",
          "persisted"
        ]
      }
    },
    "event_seq_from": {
      "type": "integer",
      "description": "Inclusive event sequence lower bound."
    },
    "event_seq_to": {
      "type": "integer",
      "description": "Inclusive event sequence upper bound."
    },
    "event_time_from": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time lower bound."
    },
    "event_time_to": {
      "type": "string",
      "description": "Inclusive timezone-qualified ISO 8601 event-time upper bound."
    },
    "event_types": {
      "type": "array",
      "description": "Event types to include.",
      "items": {
        "type": "string"
      }
    },
    "event_surfaces": {
      "type": "array",
      "description": "Event surfaces to include.",
      "items": {
        "type": "string",
        "enum": [
          "current",
          "shadowed",
          "log-only"
        ]
      }
    }
  },
  "required": [
    "query"
  ]
}
```

来源：[`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

### `session_trace`

读取围绕一个会话的已授权会话谱系，包括完整可见的祖先和后代关系。

```json
{
  "type": "object",
  "properties": {
    "session_id": {
      "type": "string",
      "description": "Target session id. Omit for the current session."
    }
  }
}
```

来源：[`packages/session-query/tool-session-query/src/index.ts`](../packages/session-query/tool-session-query/src/index.ts)

这 5 个只读工具会隐藏提供方游标，并根据不可变的调用 agent 会话为每个结果授权。该包需要选择启用；需要强制截止时间或限制行内输出的组合还会挂载通用超时或 spill 策略。

<a id="deepseek-aidsh-tool-subagent"></a>

## `@deepseek-ai/dsh-tool-subagent`

### `list_subagent_models`

发现 subagent 可用的 LLM 路由，不更改当前 Agent。无参数调用会列出已注册提供方；提供 `provider` 时会列出其公布的模型；同时提供 `provider` 和 `model` 时会检查该精确模型及其推理强度。目录条目只提供建议：adapter 可能接受未列出的模型 id。把返回的 id 用于委派工具的 `provider`、`model` 与 `reasoning_effort` 字段。

```json
{
  "type": "object",
  "properties": {
    "provider": {
      "type": "string",
      "description": "Registered LLM provider id. Omit to list providers."
    },
    "model": {
      "type": "string",
      "description": "Exact model id to inspect. Requires provider; omit to list that provider's advertised models."
    }
  }
}
```

来源：[`packages/subagent/tool-subagent/src/list-models.ts`](../packages/subagent/tool-subagent/src/list-models.ts)

### `subagent`

将一项自包含任务委派给 subagent（在自身上下文中工作的独立 agent），用它卸载聚焦且独立的工作，例如研究、限定范围的实现或分析，以免消耗当前对话的上下文。subagent 会返回结果，但不会返回中间步骤。请提供完整、独立的提示词，因为它看不到当前对话。此调用默认等待结果。设置 `run_in_background: true` 可返回 job id；使用 `job_output` 收集结果，使用 `job_kill` 停止任务。

```json
{
  "type": "object",
  "properties": {
    "description": {
      "type": "string",
      "description": "A short (3-5 word) description of the delegated task, for display."
    },
    "prompt": {
      "type": "string",
      "description": "The complete, self-contained task for the subagent. It does not share this conversation's context, so include everything it needs."
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Whether to run as a background job and return its id. Defaults to false; collect with job_output or stop with job_kill."
    }
  },
  "required": [
    "description",
    "prompt"
  ]
}
```

来源：[`packages/subagent/tool-subagent/src/index.ts`](../packages/subagent/tool-subagent/src/index.ts)

注册的委派工具名称取决于加载时 `toolName` 配置（默认为 `subagent`）；上述默认 schema 关闭模型选择，而发现 schema 则展示为已启用 Session 中可用的固定配套工具。Web preset 会在每个新顶层 Session 创建时读取插件页偏好，并为其子 Session 保留该决定；`subagent_fork` 始终使用固定路由。每个实例通过 `modelSelectionSettings`、`backgroundMode` 与 `enableRunInBackground` 独立控制是否读取模型选择设置及其后台行为。

<a id="deepseek-aidsh-tool-subagent-control"></a>

## `@deepseek-ai/dsh-tool-subagent-control`

### `interrupt_agent`

按 agent id 请求取消一个后台 agent 的当前轮次。目标可以是你的直接子 agent，也可以是你之下更深层的 agent。只有当前轮次会停止：已为该 agent 排队的消息会停在原地，直到之后某次 send_message；它启动的 agent 继续运行；该 agent 本身仍可接受后续消息。本调用在被接受时即返回，因此目标可能还会短暂运行；对已经结束的 agent 发出中断会被当作无操作接受。

```json
{
  "type": "object",
  "properties": {
    "agent_id": {
      "type": "string",
      "description": "The agent id of the running agent to interrupt."
    }
  },
  "required": [
    "agent_id"
  ]
}
```

来源：[`packages/subagent/tool-subagent-control/src/index.ts`](../packages/subagent/tool-subagent-control/src/index.ts)

### `list_agents`

按持久 id 与 label 列出你创建的可继续后台 subagent。用它回忆自己启动过哪些，而不要用它轮询完成情况——某个 subagent 结束时你会收到通知。状态来自实时注册表：running 表示该 agent 此刻正在工作；inactive 表示当前没有轮次在执行，无论该子 agent 已加载还是需要恢复。inactive 不描述任务完成、成功、失败，也不表示在等待其他 agent。`send_message` 对 running 子 agent 在其最近的步骤边界施加 steering（中途引导），对 inactive 子 agent 启动或恢复一个轮次；直接子 agent 在任何状态下都是 `send_message` 的候选对象。这份快照不是投递承诺——`send_message` 会做权威检查，仍可能失败。读取失败的子 agent 仅在 `descendants` 范围下作为诊断报告出来。`descendants` 范围会按稳定的前序遍历你之下的整棵树，并为每个条目标注其持久的直接父 Session id 与深度。`send_message` 只适用于深度 1 的条目；更深的条目只能作为 `interrupt_agent` 的候选。

```json
{
  "type": "object",
  "properties": {
    "scope": {
      "type": "string",
      "description": "children (default) lists direct children only; descendants walks the complete tree below you.",
      "enum": [
        "children",
        "descendants"
      ]
    }
  }
}
```

来源：[`packages/subagent/tool-subagent-control/src/list-agents.ts`](../packages/subagent/tool-subagent-control/src/list-agents.ts)

### `send_message`

按 agent id 向直接的可继续子 agent 发送一条消息。如果你是常驻的可继续子 agent，也可以向你的直接父 agent 发送。目标仍在工作时，消息会引导它最近的步骤；目标处于 inactive 时，消息会启动或恢复一个轮次。本调用不会返回该 agent 的答复——只确认消息已投递。失败意味着消息**没有**投递。

```json
{
  "type": "object",
  "properties": {
    "agent_id": {
      "type": "string",
      "description": "The agent id of your direct continuable child, or your direct parent when you are a resident continuable child."
    },
    "message": {
      "type": "string",
      "description": "The message to deliver to the agent."
    }
  },
  "required": [
    "agent_id",
    "message"
  ]
}
```

来源：[`packages/subagent/tool-subagent-control/src/index.ts`](../packages/subagent/tool-subagent-control/src/index.ts)

这些是控制可继续后台 subagent 的全局命名工具：绑定提供方的 `tool-subagent` 实例注册不同的委派工具；本包只注册一次 `send_message` 与 `interrupt_agent`，另由单独加载的 `/list-agents` 插件提供 `list_agents`，其目录行使用 sessionProjections 与实时 Agent 注册表。

<a id="deepseek-aidsh-tool-jobs"></a>

## `@deepseek-ai/dsh-tool-jobs`

### `job_kill`

根据 job id 请求取消正在运行的后台任务。此调用立即返回；任务的工作真正停止后，会以 killed 状态结算。

```json
{
  "type": "object",
  "properties": {
    "job_id": {
      "type": "string",
      "description": "Job id returned by the tool that started the background work."
    },
    "reason": {
      "type": "string",
      "description": "Optional short reason, recorded in the log and forwarded to the job."
    }
  },
  "required": [
    "job_id"
  ]
}
```

来源：[`packages/jobs/tool-jobs/src/index.ts`](../packages/jobs/tool-jobs/src/index.ts)

### `job_list`

列出你的后台任务（包括正在运行和已完成的任务）及其 id、种类和状态。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/jobs/tool-jobs/src/index.ts`](../packages/jobs/tool-jobs/src/index.ts)

### `job_output`

读取后台任务。流式任务只返回自上次读取以来的输出；最终输出任务会在结算后返回结果。每个响应都以 `[status: ...]` 结尾。读取默认不阻塞；设置 `wait: true` 后，最长等待到配置的上限。

```json
{
  "type": "object",
  "properties": {
    "job_id": {
      "type": "string",
      "description": "Job id returned by the tool that started the background work."
    },
    "wait": {
      "type": "boolean",
      "description": "Block until the job reaches a terminal status or the timeout expires. A timed-out wait returns [status: running] and leaves the job alive."
    },
    "timeout_ms": {
      "type": "number",
      "description": "Max wait in milliseconds (only meaningful with wait: true). Defaults to the configured wait timeout; capped by the configured maximum."
    }
  },
  "required": [
    "job_id"
  ]
}
```

来源：[`packages/jobs/tool-jobs/src/index.ts`](../packages/jobs/tool-jobs/src/index.ts)

与任务种类无关的后台任务控制器：后台 bash 命令、PTY 发送和 subagent 都通过相同的 3 个工具读取、列出和终止。加载该插件会挂接控制器，从而启用生产方的 `ctx.jobs.start()`。

<a id="deepseek-aidsh-experimental-tool-agent-team"></a>

## `@deepseek-ai/dsh-experimental-tool-agent-team`

### `interrupt_agent`

中断一名 teammate 的当前轮次，同时保留其待处理 inbox。仅 Team Lead 可用。

```json
{
  "type": "object",
  "properties": {
    "target": {
      "type": "string",
      "description": "Teammate target returned by spawn_teammate or list_agents."
    }
  },
  "required": [
    "target"
  ]
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `list_agents`

列出 Lead 与所有持久 teammate，以及各自可寻址的 target 与当前可用性。inactive 表示当前没有轮次在执行，而不是任务结果。provisioning 和 failed 描述成员创建过程。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `send_message`

向另一名 Team member 发送一条持久消息。running target 会在最近的步骤边界收到消息；inactive target 会启动或恢复一个轮次。

```json
{
  "type": "object",
  "properties": {
    "target": {
      "type": "string",
      "description": "Member target returned by spawn_teammate or list_agents, including lead."
    },
    "message": {
      "type": "string",
      "description": "Self-contained message for the target."
    }
  },
  "required": [
    "target",
    "message"
  ]
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `spawn_teammate`

创建一名具名、持久的 teammate。只有 Team Lead 可以调用此工具。

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Unique lower-kebab-case teammate name."
    },
    "description": {
      "type": "string",
      "description": "Short description of the delegated responsibility."
    },
    "prompt": {
      "type": "string",
      "description": "Complete initial task for the teammate."
    },
    "context": {
      "type": "string",
      "description": "fresh starts without Lead history; fork inherits completed Lead turns. Defaults to fresh.",
      "enum": [
        "fresh",
        "fork"
      ]
    }
  },
  "required": [
    "name",
    "description",
    "prompt"
  ]
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `team_task_create`

在共享 Team 任务板上创建一个无 owner 的 pending task。

```json
{
  "type": "object",
  "properties": {
    "subject": {
      "type": "string",
      "description": "Concise task title."
    },
    "description": {
      "type": "string",
      "description": "Complete task details and acceptance criteria."
    },
    "blocked_by": {
      "type": "array",
      "description": "Task ids that must complete first.",
      "items": {
        "type": "string"
      }
    },
    "write_scopes": {
      "type": "array",
      "description": "Advisory workspace-relative file or directory prefixes this task expects to modify.",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "subject",
    "description"
  ]
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `team_task_get`

在修改或执行共享任务前，读取其完整的最新值。

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "Shared task id."
    }
  },
  "required": [
    "task_id"
  ]
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `team_task_list`

列出共享任务，包括 readiness、owner、revision、blocker 与 write-scope warning。

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "description": "Optional exact status filter.",
      "enum": [
        "pending",
        "in_progress",
        "completed"
      ]
    },
    "owner": {
      "type": "string",
      "description": "Optional member target from spawn_teammate or list_agents, matching ownerName; use unowned for tasks without an owner."
    },
    "ready": {
      "type": "boolean",
      "description": "Optional readiness filter."
    },
    "cursor": {
      "type": "integer",
      "description": "Zero-based result offset. Defaults to 0."
    },
    "limit": {
      "type": "integer",
      "description": "Number of rows, 1 through 100. Defaults to 50."
    }
  }
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `team_task_update`

使用 team_task_get 或 team_task_list 返回的最新 revision，对共享任务操作执行 compare-and-set。

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "Shared task id."
    },
    "expected_revision": {
      "type": "integer",
      "description": "Current task revision used as the CAS precondition."
    },
    "action": {
      "type": "string",
      "description": "Task transition to apply.",
      "enum": [
        "claim",
        "release",
        "edit",
        "set_dependencies",
        "complete",
        "reopen",
        "reassign",
        "delete"
      ]
    },
    "subject": {
      "type": "string",
      "description": "Replacement title for edit."
    },
    "description": {
      "type": "string",
      "description": "Replacement details for edit."
    },
    "blocked_by": {
      "type": "array",
      "description": "Complete blocker list for set_dependencies.",
      "items": {
        "type": "string"
      }
    },
    "write_scopes": {
      "type": "array",
      "description": "Replacement advisory write scopes for edit.",
      "items": {
        "type": "string"
      }
    },
    "owner": {
      "type": "string",
      "description": "Member target from spawn_teammate or list_agents for Lead-only reassign; omit to unassign."
    }
  },
  "required": [
    "task_id",
    "expected_revision",
    "action"
  ]
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `wait_agent`

等待本次调用开始后下一次 teammate 状态、mailbox 或共享任务变更。它绝不会唤醒 inactive member；若没有其他 member 正在 running 或 provisioning，则立即返回 noProgress。唤醒或超时后应重新列出状态，而不是轮询。

```json
{
  "type": "object",
  "properties": {
    "timeout_ms": {
      "type": "integer",
      "description": "Wait duration in milliseconds, from 10000 through 3600000. Defaults to 30000."
    }
  }
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

这 9 个工具限定于隐式 Team Lead 与持久 teammate 作用域。随产品发布的 dsh-base bundle 默认禁用该包；文档中的 Agent Teams profile patch 会启用它，并禁用旧 continuable child 的同名控制工具。

<a id="deepseek-aidsh-tool-todo"></a>

## `@deepseek-ai/dsh-tool-todo`

### `todo_write`

记录并更新当前工作的结构化任务列表。每次调用都要发送**完整列表**，它会**替换**之前的列表，不支持局部更新或逐项编辑。请用它规划多步骤工作并展示进度：开始前为每个具体步骤添加一项 todo。将当前正在处理的每项 todo 标记为 `in_progress`；确实并行运行时（例如并发 subagent 或后台命令）可同时标记多项，顺序工作则标记 1 项。只要工作尚未完成，就应至少有一项任务为 `in_progress`。某项 todo 完成后立即标记为 `completed`，不要批量标记完成；只有全部工作完成后，才可以没有 `in_progress` 项。简单的单步骤任务无需使用列表。状态：`pending`（未开始）、`in_progress`（正在处理）、`completed`（已完成）。可选地为属于某类别的任务附加简短的 `tags`（1-3 个小写类别或组件名，如 `docs`、`release`）；没有增益时省略。

```json
{
  "type": "object",
  "properties": {
    "todos": {
      "type": "array",
      "description": "The COMPLETE task list, replacing any previous list.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "content": {
            "type": "string",
            "description": "What the task is — a short imperative line."
          },
          "status": {
            "type": "string",
            "description": "pending (not started) | in_progress (now) | completed (done).",
            "enum": [
              "pending",
              "in_progress",
              "completed"
            ]
          },
          "tags": {
            "type": "array",
            "description": "Optional short category labels (1-3, lowercase), e.g. [\"docs\"].",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "content",
          "status"
        ]
      }
    }
  },
  "required": [
    "todos"
  ]
}
```

来源：[`packages/todo/tool-todo/src/index.ts`](../packages/todo/tool-todo/src/index.ts)

todo_write 是会话所有的状态；UI 将最新的 todo/write 事件渲染为检查清单。`allowParallelInProgress` 是没有默认值的必填项，因此本目录明确选择 `true`，对应描述允许同时存在多个 `in_progress` 项。选择 `false` 的部署会获得同一工具，但描述会要求只能有 1 个活动任务。

<a id="deepseek-aidsh-methodology"></a>

## `@deepseek-ai/dsh-methodology`

### `triz`

- TRIZ 发明问题解决理论：40 条发明原理与 39×39 Altshuller 矛盾矩阵
- 无参数调用时列出全部 39 个工程参数与 40 条原理
- 传入 improving 与 worsening 参数编号（1-39）读取对应矩阵单元格及其推荐原理
- 用于技术矛盾、权衡与专利规避设计

```json
{
  "type": "object",
  "properties": {
    "improving": {
      "type": "integer",
      "description": "Improving engineering parameter number (1-39). Omit it together with worsening to list the full catalog."
    },
    "worsening": {
      "type": "integer",
      "description": "Worsening engineering parameter number (1-39). Provide it only together with improving."
    }
  }
}
```

来源：[`packages/patent/methodology/src/index.ts`](../packages/patent/methodology/src/index.ts)

triz 在无参数时列出 40 条发明原理与 39 个工程参数，并在给定 improving/worsening 参数对时读取对应的 39×39 矛盾矩阵单元格；registerSection（默认 true）只切换常驻的 tool:triz 提示词区段。

<a id="deepseek-aidsh-tool-literature"></a>

## `@deepseek-ai/dsh-tool-literature`

### `paper_download`

- 按 `db` + `id`（来自 `paper_search`）下载一篇学术论文的 PDF
- 优先使用源的直链（arXiv extra.pdf / OpenAlex pdf_url / Semantic Scholar openAccessPdf），经 PDF 魔数与最小字节数校验
- 直链失败（403/404/HTML 壳页）时，回退为 browser-use 打开记录页并提取 PDF 链接
- 保存为 `<outputDir>/<id>.pdf`（默认 `<cwd>/论文原文/YYYY-MM-DD/<id>.pdf`）

使用说明：
  - 先调用 `paper_search` 获取 `db` id 与论文 `id`
  - `pdfUrl` 覆盖连接器解析的链接（诊断 / 手动重试）

```json
{
  "type": "object",
  "properties": {
    "db": {
      "type": "string",
      "description": "Database id (from paper_list_sources)"
    },
    "id": {
      "type": "string",
      "description": "Paper id from a paper_search hit"
    },
    "pdfUrl": {
      "type": "string",
      "description": "Direct PDF link override (skips connector resolution)"
    },
    "outputDir": {
      "type": "string",
      "description": "Output directory; default <cwd>/论文原文/YYYY-MM-DD"
    },
    "timeoutMs": {
      "type": "number",
      "description": "Whole-call timeout (ms); default 60000, max 300000"
    }
  },
  "required": [
    "db",
    "id"
  ]
}
```

来源：[`packages/patent/tool-literature/src/index.ts`](../packages/patent/tool-literature/src/index.ts)

### `paper_list_sources`

- 列出可通过 `paper_search` 检索的学术文献数据库
- 返回每个源的 id、名称与描述
- 先调用它发现应传给 `paper_search` 的 `db` id

```json
{
  "type": "object",
  "properties": {
    "domain": {
      "type": "string",
      "description": "Optional domain filter (currently only 'literature')"
    }
  }
}
```

来源：[`packages/patent/tool-literature/src/index.ts`](../packages/patent/tool-literature/src/index.ts)

### `paper_search`

- 检索学术文献数据库（arXiv、OpenAlex、Semantic Scholar、Crossref）——免费，无需 API key
- 传入 `db` id（来自 `paper_list_sources`）与 `query`
- 返回归一化命中：id、标题、摘要与 URL
- 适用于学术论文、预印本、DOI 元数据与研究文献

使用说明：
  - 先调用 `paper_list_sources` 发现可用的 `db` id
  - arXiv 与 OpenAlex 支持字段化查询（如 `ti:transformer AND cat:cs.LG`）
  - 本工具只读，不修改文件

```json
{
  "type": "object",
  "properties": {
    "db": {
      "type": "string",
      "description": "Database id to search (from paper_list_sources, e.g. 'arxiv', 'openalex', 'semantic-scholar', 'crossref')"
    },
    "query": {
      "type": "string",
      "description": "Search query in the database's native syntax. Be specific; arXiv supports fielded syntax like `ti:transformer`."
    },
    "limit": {
      "type": "number",
      "description": "Max results (1-50, default 10)"
    }
  },
  "required": [
    "db",
    "query"
  ]
}
```

来源：[`packages/patent/tool-literature/src/index.ts`](../packages/patent/tool-literature/src/index.ts)

paper_list_sources 与 paper_search 是对四个免 key 公开源（arXiv、OpenAlex、Semantic Scholar、Crossref）的无状态查询；连接器开关属于配置，只会收窄可用的 `db` id。

<a id="deepseek-aidsh-document-deliver"></a>

## `@deepseek-ai/dsh-document-deliver`

### `document_deliver`

登记一份文档交付物：声明成品文件、导出格式与质量门结果（P0/P1 自检项）。质量门通过后、向用户交付前调用一次；文件必须在工作区中存在。

工具会自己读成品并做确定性核验：残余占位符（{{变量}}、[TBD] 等）、本文档未声明的锚点、空章节、所选风格（style）的禁用词、以及声明的字数预算（char_budget）。这些结论与 P0/P1 自检项一并写入会话日志，交付物面板同时展示二者。命中禁用级问题（未填变量、风格禁用词）时调用会被拒绝并列出问题，修复后重新登记。

```json
{
  "type": "object",
  "properties": {
    "files": {
      "type": "array",
      "description": "本次交付的全部成品文件与格式（至少一个）；path 为工作区相对路径（或绝对路径），如 out/report.html",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "path": {
            "type": "string",
            "description": "工作区相对路径（或绝对路径）"
          },
          "format": {
            "type": "string",
            "description": "成品导出格式",
            "enum": [
              "markdown",
              "html",
              "pdf",
              "docx",
              "pptx",
              "other"
            ]
          }
        },
        "required": [
          "path",
          "format"
        ]
      }
    },
    "gate": {
      "type": "object",
      "description": "质量门结果：P0 全过才允许登记",
      "additionalProperties": false,
      "properties": {
        "p0": {
          "type": "array",
          "description": "已通过并核验的 P0 自检项（每项一句话）",
          "items": {
            "type": "string"
          }
        },
        "p1": {
          "type": "array",
          "description": "已满足的 P1 自检项（无则省略）",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "p0"
      ]
    },
    "brief_ref": {
      "type": "string",
      "description": "本次交付依据的 brief 文件路径（如 brief.md），可省略"
    },
    "style": {
      "type": "string",
      "description": "核验所用的书写风格名（如 assistant-neutral、patent-standard）；省略时用本部署配置的默认风格"
    },
    "char_budget": {
      "type": "integer",
      "description": "全文声明的字数预算（非空白字符数），用于核验篇幅；省略则不核验篇幅"
    }
  },
  "required": [
    "files",
    "gate"
  ]
}
```

来源：[`packages/document/document-deliver/src/index.ts`](../packages/document/document-deliver/src/index.ts)

document_deliver 把交付文件（path + format）、P0/P1 质量门状态与 brief 引用记录进会话日志；文件缺失即报错，工具本身不写任何文件。交付工作室把该调用折叠进交付物清单与质量门徽标。

<a id="deepseek-aidsh-patent-tools"></a>

## `@deepseek-ai/dsh-patent-tools`

### `add_patent_figure_references`

为已有 SVG 附图追加专利参考标号：按组件文本匹配标注，输出 *_annotated.svg（不改动原图）。默认在匹配文本末尾内嵌「 (标号)」；leader_lines=true 时改用引线模式，标号置于组件外侧并以引线相连（仅 Graphviz/同构节点组 SVG 支持）。用户提供了自绘流程图/框图或已渲染 SVG，需要补标记、与说明书标号对齐时使用。

匹配规则：子串匹配（大小写不敏感）；每个文本元素至多命中一个参考；同名组件出现在多个位置时全部同号标注；未命中的参考列为警告返回。

标号形式：非阿拉伯数字标号（如 S101）按《专利审查指南》第一部分第一章 4.3「附图标记应当使用阿拉伯数字编号」返回警告（照常标注）。

引线模式：标号置于组件轮廓外侧，引线避开图内已绘的边线与箭头，并在越出画布时扩展画布使之完整可见；无可放置位置或缺轮廓时退化为内嵌标号并警告。

```json
{
  "type": "object",
  "properties": {
    "svg_path": {
      "type": "string",
      "description": "SVG 图片路径（工作区相对或绝对路径）"
    },
    "references": {
      "type": "array",
      "description": "参考标号表",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "label": {
            "type": "string",
            "description": "图内组件文本（子串匹配）"
          },
          "numeral": {
            "type": "string",
            "description": "参考标号（如 20、101）"
          }
        },
        "required": [
          "label",
          "numeral"
        ]
      }
    },
    "output_filename": {
      "type": "string",
      "description": "输出文件名（不含扩展名，默认 <原名>_annotated）"
    },
    "leader_lines": {
      "type": "boolean",
      "description": "true 时改用引线模式（标号置于组件外侧并以引线相连）；默认 false 内嵌「 (标号)」"
    }
  },
  "required": [
    "svg_path",
    "references"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `analyze_patent_figure`

分析专利说明书附图（多模态）：把图片随请求发送给配置的附图模型（imageModel，须声明图片输入），识别附图类型（结构图/流程图/电路图/方框图/示意图/分解图/剖视图）、提取组件与连接关系、核对附图标记并生成专利格式的附图说明文字。当用户提供附图图片并要求撰写附图说明、理解附图内容、核对附图标记一致性时使用。可传入权利要求或技术方案文本作为上下文，提升图文对齐准确率。

```json
{
  "type": "object",
  "properties": {
    "image_path": {
      "type": "string",
      "description": "附图图片路径（工作区相对或绝对路径，支持 jpg/png/gif/webp）"
    },
    "figure_number": {
      "type": "number",
      "description": "附图编号（默认 1，用于附图说明「图N」）"
    },
    "claim_context": {
      "type": "string",
      "description": "权利要求或技术方案文本（图文对齐，可显著提高组件识别准确率）"
    },
    "invention_name": {
      "type": "string",
      "description": "发明名称（用于附图说明模板，如「一种供热管道电位采集装置」）"
    }
  },
  "required": [
    "image_path"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `claim_chart_build`

构建权利要求对照表（claim chart）：把权利要求拆分为编号要素，逐要素映射到对比文件或产品证据（每行 pin-cite 引用），并输出 gap list（证据薄弱的要素）。适用于撰写（可专利性布局）、OA 答复、无效/复审、侵权比对等场景。mode=infringement 时另给出确定性结论段：被控产品的全面覆盖四态判定、等同认定与图表映射的矛盾；提供 risk（抗辩成立可能性与补救比例等可复核事实）时按五维权重给出风险等级。

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "description": "场景模式：infringement=侵权（被控产品，支持 doe）/invalidity=无效/oa-response=审查意见答复/reexamination=复审/patentability=撰写前可专利性",
      "enum": [
        "infringement",
        "invalidity",
        "oa-response",
        "reexamination",
        "patentability"
      ]
    },
    "claim_text": {
      "type": "string",
      "description": "权利要求原文（需拆分的权利要求，可含多条）"
    },
    "targets": {
      "type": "array",
      "description": "映射目标列表（对比文件/被控产品材料），每项 {id, kind: prior-art|accused-product, title?, source_path?}",
      "items": {}
    },
    "case_id": {
      "type": "string",
      "description": "案卷 ID（提供时结果落盘 data/cases/<case_id>/outputs/）"
    },
    "risk": {
      "description": "侵权模式的评分事实（可选）：{defenses: (high|medium|low)[], remedyExposureRatio: 0–1, estoppelApplied?, dedicationApplied?, equivalents?: 等同三要素认定记录[]}。不提供时不计算风险等级；评分只用这些可复核事实，工具不接受直接给出的分数或等级。"
    }
  },
  "required": [
    "mode",
    "claim_text",
    "targets"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `draft_claims`

根据技术交底书或技术方案撰写权利要求书草案（机械/电学/化学/软件四领域）。当用户要求撰写权利要求、写权利要求书时使用，避免自行手写权利要求文本。输出独立权利要求 + 从属权利要求 + 形式校验报告。

```json
{
  "type": "object",
  "properties": {
    "invention_name": {
      "type": "string",
      "description": "发明名称"
    },
    "tech_domain": {
      "type": "string",
      "description": "技术领域（为空时自动识别）",
      "enum": [
        "mechanical",
        "electrical",
        "chemical",
        "software",
        "general"
      ]
    },
    "patent_type": {
      "type": "string",
      "description": "专利类型：发明或实用新型（默认 invention）。实用新型按细则 A23 校验 10 条上限。",
      "enum": [
        "invention",
        "utility_model"
      ]
    },
    "technical_features": {
      "type": "array",
      "description": "必要技术特征列表（用于独立权利要求）",
      "items": {
        "type": "string"
      }
    },
    "optional_features": {
      "type": "array",
      "description": "附加/可选技术特征列表（用于从属权利要求）",
      "items": {
        "type": "string"
      }
    },
    "prior_art": {
      "type": "string",
      "description": "最接近现有技术描述（可选，用于前序部分）"
    }
  },
  "required": [
    "invention_name",
    "technical_features"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `draft_specification`

根据技术交底书或技术方案撰写符合要求的专利说明书草案（技术领域/背景技术/发明内容/附图说明/具体实施方式五部分）。当用户要求撰写说明书、写专利申请文件时使用，避免自行手写说明书文本。

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "description": "发明名称（不超过 25 字）"
    },
    "tech_domain": {
      "type": "string",
      "description": "技术领域（为空时自动识别）",
      "enum": [
        "mechanical",
        "electrical",
        "chemical",
        "software",
        "general"
      ]
    },
    "patent_type": {
      "type": "string",
      "description": "专利类型：发明或实用新型（默认 invention）",
      "enum": [
        "invention",
        "utility_model"
      ]
    },
    "technical_problem": {
      "type": "string",
      "description": "要解决的技术问题（可选）"
    },
    "technical_solution": {
      "type": "string",
      "description": "技术方案描述（可选）"
    },
    "beneficial_effects": {
      "type": "string",
      "description": "有益效果（可选）"
    },
    "background": {
      "type": "string",
      "description": "背景技术/现有技术描述（可选）"
    },
    "drawing_descriptions": {
      "type": "array",
      "description": "附图说明（可选，如 \"图1为本发明实施例的整体结构示意图\"）",
      "items": {
        "type": "string"
      }
    },
    "figure_analysis": {
      "type": "array",
      "description": "附图智能分析结果（可选，未提供 drawing_descriptions 时自动生成附图说明）",
      "items": {}
    },
    "embodiments": {
      "type": "array",
      "description": "具体实施方式（可选，可多个实施例）",
      "items": {
        "type": "string"
      }
    },
    "has_drawings": {
      "type": "boolean",
      "description": "是否有附图（实用新型必须有附图）"
    }
  },
  "required": [
    "title"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `evaluate_evidence`

对专利证据做确定性三性判定（相关性/合法性/真实性）与类型特定检查（电子证据/互联网公开/使用公开四要件/域外证据/公知常识），输出综合评分、举证责任分配与实际适用的证据规则。在 OA 答复、无效宣告论证引用证据前调用，可提前发现证据缺陷。

```json
{
  "type": "object",
  "properties": {
    "snippet": {
      "type": "string",
      "description": "待判定证据描述（原文摘录）。"
    },
    "sourceUri": {
      "type": "string",
      "description": "来源 URI，如 web:https://example.com/page、patent:CN123、file:///path。判定平台可信度与证据类型。"
    },
    "docVersion": {
      "type": "string",
      "description": "证据日期，如 2023-01-02、2023年1月、20230102、Jan 15, 2023。"
    },
    "contentHash": {
      "type": "string",
      "description": "内容哈希（真实性/完整性校验）。"
    },
    "direction": {
      "type": "string",
      "description": "证据方向。",
      "enum": [
        "supporting",
        "contradicting",
        "neutral"
      ]
    },
    "claimRefs": {
      "type": "array",
      "description": "绑定的结论 id 列表。",
      "items": {
        "type": "string"
      }
    },
    "evidenceType": {
      "type": "string",
      "description": "显式证据类型（缺省按 sourceUri 推断）。",
      "enum": [
        "general",
        "foreign_language",
        "overseas",
        "electronic",
        "witness_testimony",
        "expert_opinion",
        "common_knowledge",
        "notarial_certificate",
        "burden_of_proof",
        "standard_of_proof",
        "prior_art_date",
        "procedural",
        "internet_publication",
        "public_use",
        "design_comparison"
      ]
    },
    "filingDate": {
      "type": "string",
      "description": "专利申请日（公开日是否早于申请日）。"
    },
    "caseType": {
      "type": "string",
      "description": "案件类型：invalidation / infringement / new_product_method。"
    },
    "notarized": {
      "type": "boolean",
      "description": "域外证据已公证（EVI-011 条件）。"
    },
    "legalized": {
      "type": "boolean",
      "description": "域外证据已认证（EVI-011 条件）。"
    },
    "translated": {
      "type": "boolean",
      "description": "外文证据已附中文译本（EVI-011 条件）。"
    },
    "witnessDisclosed": {
      "type": "boolean",
      "description": "证人利害关系已披露（EVI-012 条件）。"
    },
    "isWellKnown": {
      "type": "boolean",
      "description": "待证事实为公知常识（EVI-013 条件）。"
    },
    "isUncontested": {
      "type": "boolean",
      "description": "待证事实无争议（EVI-013 条件）。"
    },
    "deadlineDefined": {
      "type": "boolean",
      "description": "举证期限已定义（EVI-051 条件）。"
    },
    "submissionWithinDeadline": {
      "type": "boolean",
      "description": "证据在期限内提交（EVI-051 条件）。"
    },
    "collectionLegal": {
      "type": "boolean",
      "description": "证据收集主体/程序/形式合法（EVI-002 条件）。"
    },
    "supportingCount": {
      "type": "number",
      "description": "支持性证据已计数（EVI-030 证明标准条件）。"
    },
    "contradictingCount": {
      "type": "number",
      "description": "矛盾证据已计数（EVI-030 证明标准条件）。"
    },
    "custodyChainTraceable": {
      "type": "boolean",
      "description": "证据保管链可追溯（EVI-050 条件）。"
    },
    "integrityVerified": {
      "type": "boolean",
      "description": "证据完整性已核验（EVI-050 条件）。"
    }
  },
  "required": [
    "snippet"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `flexible_plan`

专利案件的灵活计划（阶段级 HITL）。create：构建计划（可选根据交底书文本推断 IPC 技术领域）。run：通过原子注册表以 LLM + 在先技术检索执行未确认阶段（pending + rolled_back），与 patent_workflow_run 完全一致。confirm / rollback：冻结或重做某一阶段；add / remove / reorder：运行期编辑阶段；complete / abandon：结束计划。计划按 caseId 跨调用持久化（区别于无状态的 patent_plan_task）。已确认阶段被冻结，因此 confirm 固定输出；autoConfirm=true 在一次运行结束时确认全部成功阶段。

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "description": "Operation: create | get | run | confirm | rollback | add | remove | reorder | complete | abandon.",
      "enum": [
        "create",
        "get",
        "run",
        "confirm",
        "rollback",
        "add",
        "remove",
        "reorder",
        "complete",
        "abandon"
      ]
    },
    "caseId": {
      "type": "string",
      "description": "Plan key (required for every operation; persists by this id)."
    },
    "caseType": {
      "type": "string",
      "description": "Orchestration type, e.g. invalidation / infringement / drafting (create)."
    },
    "inputText": {
      "type": "string",
      "description": "Case input text (create persists it for later runs; run can override it)."
    },
    "technicalField": {
      "type": "string",
      "description": "Explicit technical field (create; else inferred from inputText)."
    },
    "stages": {
      "type": "array",
      "description": "Stage definitions (create).",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string"
          },
          "name": {
            "type": "string"
          },
          "goal": {
            "type": "string"
          },
          "strategy": {
            "type": "string",
            "enum": [
              "chain",
              "react",
              "sub_agent"
            ]
          },
          "atom": {
            "type": "string",
            "description": "Atom name to auto-execute this stage. Available atoms: approval-gate (params.review_context), claim-chart (params.chart_mode: infringement|invalidity|oa-response|reexamination|patentability), compare, coverage, draft-claims, extract (params.extraction_type, output_key), groundedness, grounds (params.ground_program: invalidation|reexamination|design), keywords, merge, novelty, oa-parse, reasoning, search, slop-gate."
          },
          "params": {
            "type": "object",
            "description": "Static params passed to the stage handler.",
            "additionalProperties": true
          },
          "artifacts": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "constraintIds": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "articleJudgments": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "id",
          "name",
          "goal",
          "strategy"
        ]
      }
    },
    "stage": {
      "type": "object",
      "description": "Single stage definition (add).",
      "additionalProperties": false,
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "goal": {
          "type": "string"
        },
        "strategy": {
          "type": "string",
          "enum": [
            "chain",
            "react",
            "sub_agent"
          ]
        },
        "atom": {
          "type": "string",
          "description": "Atom name to auto-execute this stage. Available atoms: approval-gate (params.review_context), claim-chart (params.chart_mode: infringement|invalidity|oa-response|reexamination|patentability), compare, coverage, draft-claims, extract (params.extraction_type, output_key), groundedness, grounds (params.ground_program: invalidation|reexamination|design), keywords, merge, novelty, oa-parse, reasoning, search, slop-gate."
        },
        "params": {
          "type": "object",
          "description": "Static params passed to the stage handler.",
          "additionalProperties": true
        },
        "artifacts": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "constraintIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "articleJudgments": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "id",
        "name",
        "goal",
        "strategy"
      ]
    },
    "stageId": {
      "type": "string",
      "description": "Target stage id (confirm / rollback / remove)."
    },
    "stageIds": {
      "type": "array",
      "description": "New stage order (reorder, must include all ids).",
      "items": {
        "type": "string"
      }
    },
    "reason": {
      "type": "string",
      "description": "Abandon reason, kept for audit (abandon)."
    },
    "maxResults": {
      "type": "number",
      "description": "Max prior-art search results for run (default 5)."
    },
    "autoConfirm": {
      "type": "boolean",
      "description": "When true, run confirms all successful (non-degraded) stages at the end."
    }
  },
  "required": [
    "action",
    "caseId"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `generate_patent_figure`

生成专利风格附图：流程图（方法步骤）、状态图（状态+转移条件）、系统框图（组件+连接）、组件层级图，以及直接绘制 SVG 的电路图、曲线图/坐标图、剖视图（含剖面线与剖切符号）、时序图、外观设计六面视图排布；另有内置模板与原始 DOT，输出 SVG/PNG/PDF 到工作区 patent/figures/，返回参考标号映射表与「图N是…；图中：…」格式的附图说明文字。撰写权利要求/说明书需要配图时使用。

标号体系：每图独立 100 系列（FIG.1=100-199、FIG.2=200-299，默认步进 2，可调）；同一组件跨图出现时用 numerals 显式传入沿用同号，或声明 figure_family 自动续号（同名组件沿用既有标号、新组件取空闲号；缺省每图独立编号）。

图型推断：figure_type 缺省时从唯一结构输入推断（steps→流程图、states→状态图、blocks→框图、tree→层级图、dot→原始 DOT、template→模板）；同时提供多个结构输入或全空时须显式指定 figure_type。

多面板：panels 一次生成 FIG.1A/1B 等多张面板（每面板独立文件 figN+后缀，如 A → fig1A.svg），全部面板组件共享一条连续标号系列，附图说明合并输出。

色彩策略：默认 grayscale（黑白线条，符合《专利审查指南》第一部分第一章 4.3「附图一般使用黑色墨水绘制」）；semantic 模式允许按块类型填充颜色，仅当色彩承载技术内容时使用；target_office="pct" 时 semantic 被拒绝（PCT 实施细则 11.13(a) 规定附图不得着色）。

落版：给定 target_office（cnipa/pct/uspto）时，按该法域的 A4 幅面与页边距把图形落版为固定幅面附图页——图号按法域写法（图1 / Fig. 1 / FIG. 1）画在图形正下方（附图两幅以上才编号，单幅不编号），页码按法域写法（中国「2」、PCT/USPTO「2/3」）画在版心底部；同时返回落版缩放比、落版尺寸与字高（含缩小至三分之二后的字高）并核算合规项。仅 SVG 输出支持落版；fit_to_page=false 时只核算尺寸、不改写画布。

引线标号：框图/层级图 SVG 默认以「数字+引线指向部件」标注（leader_lines 可关闭），流程图默认保留步骤内嵌 NNN. 前缀；非 SVG 格式不支持引线，返回警告并保持内嵌标号。引线与标号随图面一起落在画布内，并避开图内已绘的边线与箭头；无引线空间时退化为内嵌标号。

图面用语检查：生成后按《专利法实施细则》第二十一条与《专利审查指南》第一部分第一章 4.3 检查图面词语与标号——非必需注释（注释前缀/正文引用/尺寸标注/句末标点）、非中文词语（缩写与数字符号除外）、非阿拉伯数字标号各出一条警告；只提示，不改写输入。

本机未安装 Graphviz 时返回 setup_required 与安装引导。

```json
{
  "type": "object",
  "properties": {
    "figure_type": {
      "type": "string",
      "description": "图型；缺省时从唯一结构输入推断（steps→flowchart、states→state_diagram、blocks→block_diagram、tree→component_hierarchy、circuit/plot/sections/sequence/appearance_views→同名图型、dot→raw_dot、template→template），多输入或无输入须显式指定",
      "enum": [
        "flowchart",
        "state_diagram",
        "block_diagram",
        "component_hierarchy",
        "circuit",
        "plot",
        "cross_section",
        "sequence_diagram",
        "appearance_view",
        "raw_dot",
        "template"
      ]
    },
    "steps": {
      "type": "array",
      "description": "流程图步骤（figure_type=flowchart 时必填）",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "description": "步骤标识（[A-Za-z0-9_-]，自动清洗）"
          },
          "label": {
            "type": "string",
            "description": "步骤显示文本"
          },
          "shape": {
            "type": "string",
            "description": "box（默认）/ellipse/diamond/parallelogram/cylinder",
            "enum": [
              "box",
              "ellipse",
              "diamond",
              "parallelogram",
              "cylinder"
            ]
          },
          "next": {
            "type": "array",
            "description": "后继：字符串 id，或 {id,label}（判断分支必须带边标签）",
            "items": {
              "oneOf": [
                {
                  "type": "string"
                },
                {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "id": {
                      "type": "string"
                    },
                    "label": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "id",
                    "label"
                  ]
                }
              ]
            }
          }
        },
        "required": [
          "id",
          "label",
          "next"
        ]
      }
    },
    "states": {
      "type": "array",
      "description": "状态图状态（figure_type=state_diagram 时必填）",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string",
            "description": "状态标识（[A-Za-z0-9_-]，自动清洗）"
          },
          "label": {
            "type": "string",
            "description": "状态名（initial 伪状态填空串）"
          },
          "kind": {
            "type": "string",
            "description": "normal（默认，圆角框）/initial（实心小圆，无标号）/final（双圆框）",
            "enum": [
              "normal",
              "initial",
              "final"
            ]
          }
        },
        "required": [
          "id",
          "label"
        ]
      }
    },
    "transitions": {
      "type": "array",
      "description": "状态转移（state_diagram；端点必须存在于 states）",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "from": {
            "type": "string"
          },
          "to": {
            "type": "string"
          },
          "label": {
            "type": "string",
            "description": "转移条件（简短词语，可选）"
          }
        },
        "required": [
          "from",
          "to"
        ]
      }
    },
    "circuit": {
      "type": "object",
      "description": "电路图输入（figure_type=circuit 时必填）：元件按网格行列放置，连线正交走线，T 形结点画实心连接点",
      "additionalProperties": false,
      "properties": {
        "components": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "id": {
                "type": "string"
              },
              "kind": {
                "type": "string",
                "description": "电气符号种类",
                "enum": [
                  "resistor",
                  "capacitor",
                  "inductor",
                  "diode",
                  "battery",
                  "ground",
                  "switch",
                  "lamp",
                  "npn_transistor",
                  "voltage_source"
                ]
              },
              "label": {
                "type": "string",
                "description": "元件名（简短词）"
              },
              "col": {
                "type": "integer",
                "description": "网格列（0 起）"
              },
              "row": {
                "type": "integer",
                "description": "网格行（0 起）"
              }
            },
            "required": [
              "id",
              "kind",
              "col",
              "row"
            ]
          }
        },
        "connections": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "from": {
                "type": "string"
              },
              "to": {
                "type": "string"
              },
              "label": {
                "type": "string"
              }
            },
            "required": [
              "from",
              "to"
            ]
          }
        },
        "cell_width_mm": {
          "type": "number",
          "description": "单元格宽（毫米），默认 18"
        },
        "cell_height_mm": {
          "type": "number",
          "description": "单元格高（毫米），默认 14"
        }
      },
      "required": [
        "components",
        "connections"
      ]
    },
    "plot": {
      "type": "object",
      "description": "曲线图/坐标图输入（figure_type=plot 时必填）：坐标轴 + 刻度 + 单位 + 多条序列（用标记形状区分，不用颜色）",
      "additionalProperties": false,
      "properties": {
        "series": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "name": {
                "type": "string"
              },
              "points": {
                "type": "array",
                "items": {
                  "type": "array",
                  "items": {
                    "type": "number"
                  }
                }
              },
              "marker": {
                "type": "string",
                "enum": [
                  "none",
                  "circle",
                  "square",
                  "triangle"
                ]
              }
            },
            "required": [
              "points"
            ]
          }
        },
        "x_label": {
          "type": "string"
        },
        "y_label": {
          "type": "string"
        },
        "x_unit": {
          "type": "string"
        },
        "y_unit": {
          "type": "string"
        },
        "x_range": {
          "type": "array",
          "items": {
            "type": "number"
          }
        },
        "y_range": {
          "type": "array",
          "items": {
            "type": "number"
          }
        },
        "tick_count": {
          "type": "integer",
          "description": "每轴刻度数（2..11），默认 5"
        },
        "show_grid": {
          "type": "boolean",
          "description": "是否画网格线，默认 false"
        },
        "width_mm": {
          "type": "number",
          "description": "画布宽（毫米），默认 120"
        },
        "height_mm": {
          "type": "number",
          "description": "画布高（毫米），默认 80"
        }
      },
      "required": [
        "series",
        "x_label",
        "y_label"
      ]
    },
    "sections": {
      "type": "object",
      "description": "剖视图输入（figure_type=cross_section 时必填）：零件轮廓 + 45° 剖面线（相邻件方向相反或间距不等）+ 剖切位置符号",
      "additionalProperties": false,
      "properties": {
        "outline": {
          "type": "array",
          "description": "外轮廓顶点对数组（[[x,y],…]）",
          "items": {
            "type": "array",
            "items": {
              "type": "number"
            }
          }
        },
        "parts": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "label": {
                "type": "string"
              },
              "outline": {
                "type": "array",
                "description": "零件闭合轮廓（[[x,y],…]，至少 3 点）",
                "items": {
                  "type": "array",
                  "items": {
                    "type": "number"
                  }
                }
              },
              "hatch": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "angle_deg": {
                    "type": "number",
                    "description": "剖面线倾角（度），默认 45"
                  },
                  "spacing_mm": {
                    "type": "number",
                    "description": "剖面线间距（毫米），默认 3"
                  },
                  "direction": {
                    "type": "string",
                    "description": "相邻零件取相反方向或不同间距以区分",
                    "enum": [
                      "forward",
                      "backward"
                    ]
                  }
                }
              }
            },
            "required": [
              "outline"
            ]
          }
        },
        "cutting_marks": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "id": {
                "type": "string",
                "description": "剖切标记字母（如 A）"
              },
              "from": {
                "type": "array",
                "items": {
                  "type": "number"
                }
              },
              "to": {
                "type": "array",
                "items": {
                  "type": "number"
                }
              },
              "arrow": {
                "type": "string",
                "description": "投射方向",
                "enum": [
                  "left",
                  "right",
                  "up",
                  "down"
                ]
              }
            },
            "required": [
              "id",
              "from",
              "to",
              "arrow"
            ]
          }
        },
        "padding_mm": {
          "type": "number",
          "description": "画布留白（毫米），默认 4"
        }
      },
      "required": [
        "parts"
      ]
    },
    "sequence": {
      "type": "object",
      "description": "时序图输入（figure_type=sequence_diagram 时必填）：参与者生命线 + 消息箭线",
      "additionalProperties": false,
      "properties": {
        "participants": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "id": {
                "type": "string"
              },
              "label": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "label"
            ]
          }
        },
        "messages": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "from": {
                "type": "string"
              },
              "to": {
                "type": "string"
              },
              "label": {
                "type": "string"
              },
              "kind": {
                "type": "string",
                "description": "默认 sync",
                "enum": [
                  "sync",
                  "return",
                  "async"
                ]
              },
              "activate": {
                "type": "boolean",
                "description": "是否在目标生命线上画激活条，默认 false"
              }
            },
            "required": [
              "from",
              "to",
              "label"
            ]
          }
        },
        "box_width_mm": {
          "type": "number",
          "description": "参与者盒宽（毫米），默认 30"
        },
        "message_spacing_mm": {
          "type": "number",
          "description": "消息垂直间距（毫米），默认 10"
        },
        "padding_mm": {
          "type": "number",
          "description": "画布留白（毫米），默认 5"
        }
      },
      "required": [
        "participants",
        "messages"
      ]
    },
    "appearance_views": {
      "type": "object",
      "description": "外观设计视图排布输入（figure_type=appearance_view 时必填）：把调用方提供的六面视图片段按第一角投影排布并统一比例、逐视图标注视图名称",
      "additionalProperties": false,
      "properties": {
        "views": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "name": {
                "type": "string",
                "description": "视图名（六面正投影视图）",
                "enum": [
                  "主视图",
                  "后视图",
                  "左视图",
                  "右视图",
                  "俯视图",
                  "仰视图"
                ]
              },
              "body": {
                "type": "string",
                "description": "调用方提供的视图片段（毫米坐标 SVG 片段）"
              },
              "width_mm": {
                "type": "number"
              },
              "height_mm": {
                "type": "number"
              },
              "note": {
                "type": "string",
                "description": "备注（写入结果 warnings，不落图面；如省略视图的原因）"
              }
            },
            "required": [
              "name",
              "body",
              "width_mm",
              "height_mm"
            ]
          }
        },
        "extras": {
          "type": "array",
          "description": "额外单元格（立体图/使用状态参考图）",
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "name": {
                "type": "string"
              },
              "body": {
                "type": "string"
              },
              "width_mm": {
                "type": "number"
              },
              "height_mm": {
                "type": "number"
              }
            },
            "required": [
              "name",
              "body",
              "width_mm",
              "height_mm"
            ]
          }
        },
        "cell_mm": {
          "type": "number",
          "description": "单元格最大边长（毫米），默认 60"
        },
        "caption_gap_mm": {
          "type": "number",
          "description": "视图名与图形的间距（毫米），默认 3"
        },
        "caption_font_mm": {
          "type": "number",
          "description": "视图名字高（毫米），默认 3.5"
        },
        "padding_mm": {
          "type": "number",
          "description": "画布留白（毫米），默认 8"
        },
        "first_angle": {
          "type": "boolean",
          "description": "默认 true：按中国第一角投影排布；false 为第三角"
        }
      },
      "required": [
        "views"
      ]
    },
    "blocks": {
      "type": "array",
      "description": "框图块（figure_type=block_diagram 时必填）",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string"
          },
          "label": {
            "type": "string",
            "description": "块名（\\n 换行）"
          },
          "type": {
            "type": "string",
            "description": "input/output/process/storage/decision/default",
            "enum": [
              "input",
              "output",
              "process",
              "storage",
              "decision",
              "default"
            ]
          }
        },
        "required": [
          "id",
          "label"
        ]
      }
    },
    "connections": {
      "type": "array",
      "description": "框图连接（block_diagram）",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "from": {
            "type": "string"
          },
          "to": {
            "type": "string"
          },
          "label": {
            "type": "string",
            "description": "数据流说明（可选）"
          }
        },
        "required": [
          "from",
          "to"
        ]
      }
    },
    "tree": {
      "type": "array",
      "description": "组件层级树（component_hierarchy，任意深度）",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "id": {
            "type": "string"
          },
          "label": {
            "type": "string"
          },
          "children": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        },
        "required": [
          "id",
          "label"
        ]
      }
    },
    "template": {
      "type": "string",
      "description": "内置模板（figure_type=template 时必填）：simple_flowchart/system_block/method_steps/component_hierarchy",
      "enum": [
        "simple_flowchart",
        "system_block",
        "method_steps",
        "component_hierarchy"
      ]
    },
    "dot": {
      "type": "string",
      "description": "原始 Graphviz DOT（figure_type=raw_dot）；须自包含：不接受 image/shapefile/fontpath 等文件引用属性"
    },
    "panels": {
      "type": "array",
      "description": "多面板模式：一次生成多张共享标号系列的面板（fig1A/fig1B…）；与顶层结构输入互斥，列表不可为空",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "suffix": {
            "type": "string",
            "description": "面板后缀（字母/数字/下划线/连字符；写入 figN+后缀，如 A → fig1A.svg）"
          },
          "figure_type": {
            "type": "string",
            "description": "面板图型；缺省从该面板唯一结构输入推断",
            "enum": [
              "flowchart",
              "state_diagram",
              "block_diagram",
              "component_hierarchy",
              "raw_dot",
              "template"
            ]
          },
          "steps": {
            "type": "array",
            "description": "面板流程步骤",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "id": {
                  "type": "string",
                  "description": "步骤标识（[A-Za-z0-9_-]，自动清洗）"
                },
                "label": {
                  "type": "string",
                  "description": "步骤显示文本"
                },
                "shape": {
                  "type": "string",
                  "description": "box（默认）/ellipse/diamond/parallelogram/cylinder",
                  "enum": [
                    "box",
                    "ellipse",
                    "diamond",
                    "parallelogram",
                    "cylinder"
                  ]
                },
                "next": {
                  "type": "array",
                  "description": "后继：字符串 id，或 {id,label}（判断分支必须带边标签）",
                  "items": {
                    "oneOf": [
                      {
                        "type": "string"
                      },
                      {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                          "id": {
                            "type": "string"
                          },
                          "label": {
                            "type": "string"
                          }
                        },
                        "required": [
                          "id",
                          "label"
                        ]
                      }
                    ]
                  }
                }
              },
              "required": [
                "id",
                "label",
                "next"
              ]
            }
          },
          "states": {
            "type": "array",
            "description": "面板状态图状态",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "id": {
                  "type": "string",
                  "description": "状态标识（[A-Za-z0-9_-]，自动清洗）"
                },
                "label": {
                  "type": "string",
                  "description": "状态名（initial 伪状态填空串）"
                },
                "kind": {
                  "type": "string",
                  "description": "normal（默认，圆角框）/initial（实心小圆，无标号）/final（双圆框）",
                  "enum": [
                    "normal",
                    "initial",
                    "final"
                  ]
                }
              },
              "required": [
                "id",
                "label"
              ]
            }
          },
          "transitions": {
            "type": "array",
            "description": "面板状态转移",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "from": {
                  "type": "string"
                },
                "to": {
                  "type": "string"
                },
                "label": {
                  "type": "string",
                  "description": "转移条件（简短词语，可选）"
                }
              },
              "required": [
                "from",
                "to"
              ]
            }
          },
          "blocks": {
            "type": "array",
            "description": "面板框图块",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "id": {
                  "type": "string"
                },
                "label": {
                  "type": "string",
                  "description": "块名（\\n 换行）"
                },
                "type": {
                  "type": "string",
                  "description": "input/output/process/storage/decision/default",
                  "enum": [
                    "input",
                    "output",
                    "process",
                    "storage",
                    "decision",
                    "default"
                  ]
                }
              },
              "required": [
                "id",
                "label"
              ]
            }
          },
          "connections": {
            "type": "array",
            "description": "面板框图连接（blocks 面板）",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "from": {
                  "type": "string"
                },
                "to": {
                  "type": "string"
                },
                "label": {
                  "type": "string",
                  "description": "数据流说明（可选）"
                }
              },
              "required": [
                "from",
                "to"
              ]
            }
          },
          "tree": {
            "type": "array",
            "description": "面板组件层级树",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "id": {
                  "type": "string"
                },
                "label": {
                  "type": "string"
                },
                "children": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "additionalProperties": true
                  }
                }
              },
              "required": [
                "id",
                "label"
              ]
            }
          },
          "template": {
            "type": "string",
            "description": "面板内置模板",
            "enum": [
              "simple_flowchart",
              "system_block",
              "method_steps",
              "component_hierarchy"
            ]
          },
          "dot": {
            "type": "string",
            "description": "面板原始 DOT（须自包含：不接受 image/shapefile/fontpath 等文件引用属性）"
          },
          "numerals": {
            "type": "object",
            "description": "面板显式标号（组件 id → 标号；标号可为字符串或数字，其他类型会被拒绝；优先于顶层 numerals）",
            "additionalProperties": true
          }
        },
        "required": [
          "suffix"
        ]
      }
    },
    "figure_number": {
      "type": "integer",
      "description": "图号，默认 1（决定标号系列起点）"
    },
    "invention_name": {
      "type": "string",
      "description": "发明名称（附图说明模板句）"
    },
    "numerals": {
      "type": "object",
      "description": "显式标号（组件 id → 标号；标号可为字符串或数字，其他类型会被拒绝；跨图同件同号续接）",
      "additionalProperties": true
    },
    "numeral_start": {
      "type": "integer",
      "description": "自动标号系列起点覆盖"
    },
    "numeral_step": {
      "type": "integer",
      "description": "标号步进，默认 2"
    },
    "figure_family": {
      "type": "string",
      "description": "发明家族标识（跨图续号）：声明后同名组件沿用既有标号、新组件续接空闲号；缺省每图独立编号"
    },
    "style": {
      "type": "string",
      "description": "色彩策略，默认 grayscale",
      "enum": [
        "grayscale",
        "semantic"
      ]
    },
    "filename": {
      "type": "string",
      "description": "输出文件名（不含扩展名）"
    },
    "format": {
      "type": "string",
      "description": "输出格式，默认 svg",
      "enum": [
        "svg",
        "png",
        "pdf"
      ]
    },
    "engine": {
      "type": "string",
      "description": "布局引擎，默认 dot",
      "enum": [
        "dot",
        "neato",
        "fdp",
        "circo",
        "twopi",
        "sfdp"
      ]
    },
    "page_size": {
      "type": "string",
      "description": "页面尺寸（提交规格）；默认取部署配置",
      "enum": [
        "a4",
        "letter"
      ]
    },
    "orient": {
      "type": "string",
      "description": "页面方向；默认 portrait，取部署配置",
      "enum": [
        "portrait",
        "landscape"
      ]
    },
    "dpi": {
      "type": "integer",
      "description": "渲染分辨率（png 栅格生效）；默认取部署配置"
    },
    "margin": {
      "type": "number",
      "description": "页边距（厘米，四边同值）；默认取部署配置"
    },
    "leader_lines": {
      "type": "boolean",
      "description": "引线标号（数字置于部件外侧并以引线相连，仅 SVG 生效）；默认框图/层级图开启、流程图关闭"
    },
    "target_office": {
      "type": "string",
      "description": "目标法域：给定时按该法域的 A4 幅面、页边距、图号写法（图1/Fig. 1/FIG. 1）把图形落版为固定幅面附图页，并核算落版字高与色彩合规；仅 SVG 生效",
      "enum": [
        "cnipa",
        "pct",
        "uspto"
      ]
    },
    "figure_count": {
      "type": "integer",
      "description": "本案附图总数（默认 1）：两幅以上才逐幅标注图号（中国指南 4.3、PCT 11.13(k)、37 CFR 1.84(u)）"
    },
    "sheet_index": {
      "type": "integer",
      "description": "附图页序号，默认 1"
    },
    "sheet_total": {
      "type": "integer",
      "description": "附图页总数，默认 1（PCT/USPTO 页码写作「序号/总数」）"
    },
    "caption": {
      "type": "string",
      "description": "图号文字覆盖（缺省按目标法域生成；panels 模式自动追加面板后缀，如 图1A / Fig. 1A）"
    },
    "fit_to_page": {
      "type": "boolean",
      "description": "默认 true：把图形落版到目标法域幅面（仅 SVG）；false 时只核算尺寸、不改写画布"
    },
    "persist_index": {
      "type": "boolean",
      "description": "默认 true：写入附图索引（供 search_patent_figure 检索）"
    }
  }
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `generate_structure_figure`

从 3D 模型生成专利结构线稿附图：用本机 FreeCAD（TechDraw）把 STEP/IGES/BREP 投影为多视图黑白线稿 SVG（等轴测/三视图等），件号以引线锚定到真实顶点投影，输出到工作区 patent/figures/，返回标号映射表与「图N是…的结构示意图」附图说明。需要机械结构真实投影（而非示意框图）时使用。

默认关闭：结构线稿依赖本机 FreeCAD，需先设 Config.structureFigureEnabled=true；未开启或未安装 freecadcmd 时返回 setup_required 与配置/安装引导。

视图：views 缺省 iso/front/top/right，可选 iso/front/rear/top/bottom/left/right；scale 为 TechDraw 投影比例；show_hidden 开启时绘制隐藏线（虚线）。

件号锚定：callouts 传 [{numeral, point3d:[x,y,z], label?}]，把参考标号绑定到模型 3D 坐标，脚本投影到每个视图的真实 2D 位置并以引线标注；标号应为阿拉伯数字，非数字标号与部件名会触发图面用语告警。

批量：model_path 传目录时，对目录内每个受支持模型生成一图，图号自 figure_number 起递增；批量模式不支持 callouts（件号 3D 锚点仅对单个模型有效）。

产物为纯几何片段，不含模板边框、标题栏与图号，符合《专利审查指南》第一部分第一章 4.3 对线条与版面的要求；给定 target_office 时按该法域的 A4 幅面与页边距落版，并可在图形正下方落图号。

```json
{
  "type": "object",
  "properties": {
    "model_path": {
      "type": "string",
      "description": "模型文件路径（STEP/IGES/BREP），或其目录（批量）"
    },
    "views": {
      "type": "array",
      "description": "请求视图，缺省 iso/front/top/right",
      "items": {
        "type": "string",
        "enum": [
          "iso",
          "front",
          "rear",
          "top",
          "bottom",
          "left",
          "right"
        ]
      }
    },
    "scale": {
      "type": "number",
      "description": "TechDraw 投影比例（正数）；缺省取部署配置或 1"
    },
    "show_hidden": {
      "type": "boolean",
      "description": "绘制隐藏线（虚线），默认 false"
    },
    "callouts": {
      "type": "array",
      "description": "件号锚定 [{numeral, point3d:[x,y,z], label?}]；仅单模型（不与目录批量同用）",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "numeral": {
            "type": "string",
            "description": "参考标号（阿拉伯数字字符串）"
          },
          "point3d": {
            "type": "array",
            "description": "锚定的模型 3D 坐标 [x,y,z]（毫米，与模型单位一致）",
            "items": {
              "type": "number"
            }
          },
          "label": {
            "type": "string",
            "description": "可选部件名称（写入标号表/manifest，不进图面像素）"
          }
        },
        "required": [
          "numeral",
          "point3d"
        ]
      }
    },
    "figure_number": {
      "type": "integer",
      "description": "图号（正整数），默认 1（批量时作为起始图号）"
    },
    "invention_name": {
      "type": "string",
      "description": "发明名称（附图说明模板句）"
    },
    "target_office": {
      "type": "string",
      "description": "目标法域：给定时把每个视图 SVG 落版到该法域的 A4 幅面与页边距，并返回落版尺寸（仅 SVG 产物生效）",
      "enum": [
        "cnipa",
        "pct",
        "uspto"
      ]
    },
    "sheet_index": {
      "type": "integer",
      "description": "附图页序号，默认 1"
    },
    "sheet_total": {
      "type": "integer",
      "description": "附图页总数，默认 1"
    },
    "caption": {
      "type": "string",
      "description": "图号文字（如「图1」）；缺省不落图号——多视图如何编号由调用方按整案附图顺序决定"
    },
    "fit_to_page": {
      "type": "boolean",
      "description": "默认 true：落版到目标法域幅面；false 时只核算尺寸"
    },
    "persist_index": {
      "type": "boolean",
      "description": "默认 true：写入附图索引（供 search_patent_figure 检索）"
    }
  },
  "required": [
    "model_path"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `knowledge_note_save`

把项目专利产出（OA 答复要点、无效分析结论、检索心得）沉淀为知识笔记，后续检索可召回。用于定稿后建议沉淀：如 knowledge_note_save({title, content, project})。同一内容重复保存会自动跳过（幂等）。

注意：dsh 的知识库写 API（knowledge.db personal_note 层）尚未接入，当前落为案卷目录下的笔记文件。

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "description": "笔记标题（≤200 字符，作为检索索引词）"
    },
    "content": {
      "type": "string",
      "description": "笔记正文（≤20,000 字符）"
    },
    "project": {
      "type": "string",
      "description": "来源项目标签（可选，参与幂等与检索过滤）"
    }
  },
  "required": [
    "title",
    "content"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `parse_office_action`

确定性解析审查意见通知书（不调用模型）：识别驳回类型（专利法 22.2 新颖性、22.3 创造性、26.3 公开不充分、26.4 不清楚或不支持、33 条修改超范围、形式缺陷；未识别到具体条款时为 other）、引用文献与相关性类别（X/Y/A/E/P，本文书自身号码不计）、涉及的权利要求（权利要求1至3 与 第1-5项 两类区间展开为逐个编号）、审查员论点。用于答复前先拿到结构化事实：先按主驳回类型定答复主策略，再逐条处理。输出只反映通知书原文的措辞，不判断驳回是否成立，也不起草答复。文献未标注相关性类别时不推断类别。

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "description": "审查意见通知书正文（含驳回条款与引用文献的原文）。"
    }
  },
  "required": [
    "text"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `patent_analysis_report`

生成标准化的专利分析报告：从权利要求抽取技术特征（类型/重要性），进行 IPC 分类，给出清晰度与完整性等确定性评分，并结合 LLM 对新颖性与技术强度补分，输出创新性洞察与专家考量。适合在评估提案、对比现有技术或提交人工复核前生成结构化分析基线。

```json
{
  "type": "object",
  "properties": {
    "patent_id": {
      "type": "string",
      "description": "专利号（可选）"
    },
    "title": {
      "type": "string",
      "description": "发明名称"
    },
    "abstract": {
      "type": "string",
      "description": "摘要"
    },
    "claims": {
      "type": "array",
      "description": "权利要求（权 1 起）",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "claims"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `patent_case_search`

检索本地专利判例全文（无效复审决定/专利判决，knowledge.db，FTS5 BM25 优先）。用于无效宣告分析、OA 答复时检索相似在先决定的理由论证与证据认定。支持 doc_type（case=无效决定/judgment=判决）与 court（法院）过滤。默认排除 wiki 审查标准卡片（审查标准请用 patent_wiki_search）。

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "检索关键词（如 创造性 三步法、技术启示、区别特征 预料不到的效果）"
    },
    "doc_type": {
      "type": "string",
      "description": "文档类型过滤：case=无效复审决定，judgment=专利判决（缺省全部）",
      "enum": [
        "case",
        "judgment"
      ]
    },
    "court": {
      "type": "string",
      "description": "审理法院过滤（子串匹配，如 最高人民法院）"
    },
    "limit": {
      "type": "number",
      "description": "返回条数上限（默认 5，最大 10）"
    },
    "include_content": {
      "type": "boolean",
      "description": "是否附命中片段（默认 true，截断约 800 字）"
    }
  },
  "required": [
    "query"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `patent_eval`

评估专利相关产出的质量（报告/检索/流程/引用/综合）。返回结构化评分和通过/失败判定。支持 5 种评估模式（report/retrieval/workflow/citations/comprehensive），在提交人工复核前使用可提前发现质量问题。

```json
{
  "type": "object",
  "properties": {
    "mode": {
      "type": "string",
      "description": "评估模式: report(分析报告质量) / retrieval(检索覆盖度) / workflow(流程完整性) / citations(引用合规性) / comprehensive(全面评估)",
      "enum": [
        "report",
        "retrieval",
        "workflow",
        "citations",
        "comprehensive"
      ]
    },
    "content": {
      "type": "string",
      "description": "待评估的内容文本（报告正文/检索关键词列表/工作流步骤/引文列表等）"
    },
    "required_citations": {
      "type": "array",
      "description": "要求必须包含的法条引用列表（如 [\"第二十二条第二款\", \"第二十二条第三款\"]）",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "mode"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `patent_kg_query`

查询专利知识图谱节点（判例/审查规则/法条/概念）。三种模式：① query 关键词检索（FTS5，附相似/引用关系标注）；② id 按节点 id 展开详情与相似/引用邻居；③ node_type 按类型浏览（Case/SupremeCourtJudgment/RegionalCourtJudgment/GuidelineRule/Clause/WikiCard/Concept，支持 Judgment/LawArticle 别名）。与 patent_wiki_search（wiki 卡片正文）和 law_search（法条原文）互补。

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "关键词检索（如 创造性 三步法、Bolar例外、禁止反悔）；与 id 二选一"
    },
    "id": {
      "type": "string",
      "description": "节点 id（如 CASE_005）；返回节点详情 + 相似/引用邻居；与 query 二选一，id 优先"
    },
    "node_type": {
      "type": "string",
      "description": "按节点类型浏览（Case/SupremeCourtJudgment/RegionalCourtJudgment/GuidelineRule/Clause/WikiCard/Concept；Judgment=最高法院+地方法院判决，LawArticle=法条条款）"
    },
    "expand": {
      "type": "boolean",
      "description": "关键词命中后是否做关系扩展（相似/引用），默认 true"
    },
    "include_content": {
      "type": "boolean",
      "description": "是否附节点正文片段（默认 false，截断约 600 字）"
    },
    "limit": {
      "type": "number",
      "description": "返回条数上限（默认 5，最大 10）"
    }
  }
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `patent_legal_status`

- 查询专利法律状态（有效 Active / 失效 Expired / 放弃 Abandoned）与预计到期日，数据来自 Google Patents
- 批量：一次传入 1-20 个专利号；单个失败按专利逐个报告，不中断整批
- 返回标题、状态、预计到期日、申请/授权日、申请人、发明人及状态事件历史

使用说明：
  - 只读；每篇专利发起一次网络请求（默认并发 4）
  - 中国（CNIPA）法律状态事务请改用 cnipa-query skill

```json
{
  "type": "object",
  "properties": {
    "patents": {
      "type": "array",
      "description": "Patent numbers (1-20), e.g. ['US11452699B2', 'US2668287A']",
      "items": {
        "type": "string"
      }
    },
    "maxConcurrency": {
      "type": "number",
      "description": "Max concurrent requests (default 4)"
    }
  },
  "required": [
    "patents"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `patent_metadata`

- 按专利号（如 US11452699B2）从 Google Patents 获取专利元数据
- 返回结构化数据：标题、发明人、受让人、日期、法律状态、预计到期日、摘要、PDF URL、分类号、引用
- 自动校验并归一化专利号；CN 申请号保留 12 位形态（CN202122978405.0 → CN202122978405），全角字符、空白与 - / : 分隔符一并折叠
- 用于专利尽职调查、在先技术详情查询、法律状态核查

使用说明：
  - 只读；每篇专利发起一次网络请求
  - 必须带国家码；裸申请号（202122978405）会被拒绝——请补 CN 或改用公开号
  - 未找到（专利不存在）以 success:false 的数据返回，而非错误
  - 上游瞬时失败（HTTP 503、连接被断开）会重试两次后才失败
  - 页面结构变化留下的空字段以非致命解析告警的形式列在渲染结果的「警告」段

```json
{
  "type": "object",
  "properties": {
    "patent": {
      "type": "string",
      "description": "Patent number, e.g. 'US11452699B2'. Validated and normalized (uppercase, no spaces, no - / : separators; a CN application check digit is dropped)."
    },
    "timeout": {
      "type": "number",
      "description": "Request timeout in ms (default 30000)"
    },
    "returnAbstract": {
      "type": "boolean",
      "description": "Include abstract (default true)"
    },
    "returnLegal": {
      "type": "boolean",
      "description": "Include legal status (default true)"
    }
  },
  "required": [
    "patent"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `patent_pdf_download`

从 Google Patents 批量下载专利 PDF：优先经用户 ego-browser（ego lite）做浏览器内下载拦截（复用登录态），拦截不可用或失败时回退为提取 CDN PDF 链接后用 HTTP 直接下载落盘。输入 patents 为公开号列表（CN123456789A、US11452699B2、EP1234567A1、WO2023123456A1…），保存为 `<outputDir>/<patent>.pdf`。每篇结果为 status=ok（带 path 与 method 说明落盘方式）或 status=failed（带 error，且保留 pdfUrl 供手动重试）；失败不中断其余专利。

Usage notes:
  - 重复执行命中 MANIFEST 断点续传（size 匹配即跳过，method=skip），force=true 强制重下
  - record=true 可额外截图留证（输出 `<outputDir>/evidence/`）
  - HTTP 兜底对瞬时失败/限流（429/503）自动重试并按 Retry-After 退避；重试后仍 429 时 error 会注明限流与建议等待时长（并可结合 retryAfterMs），此时应等待后再重试而非立即重试

```json
{
  "type": "object",
  "properties": {
    "patents": {
      "type": "array",
      "description": "专利公开号列表（1-50 篇）",
      "items": {
        "type": "string"
      }
    },
    "outputDir": {
      "type": "string",
      "description": "输出目录（绝对或相对当前工作目录）；默认 <cwd>/专利原文/YYYY-MM-DD"
    },
    "pageTimeoutSec": {
      "type": "number",
      "description": "每页打开超时（秒），默认 20"
    },
    "downloadTimeoutMs": {
      "type": "number",
      "description": "每篇下载拦截超时（毫秒），默认 60000"
    },
    "timeoutMs": {
      "type": "number",
      "description": "整体执行超时（毫秒）；默认按每篇 25s 推算并夹在 60000–180000 之间，上限 300000"
    },
    "record": {
      "type": "boolean",
      "description": "是否截图留证（默认 false）"
    },
    "force": {
      "type": "boolean",
      "description": "忽略 MANIFEST 断点续传，强制重下全部（默认 false）"
    }
  },
  "required": [
    "patents"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `patent_plan_task`

专利任务的人工在环计划状态机。transition：白名单校验的状态迁移（planning → awaiting_approval → executing → awaiting_feedback → replanning → finished）。sync：把计划步骤转为带 blockedBy 依赖的有序任务。replan：对已完成步骤做哈希比对，支持增量续跑。非法迁移与缺失语义前置条件均失败关闭（executing 需要 tasks，replanning 需要 feedback）。无状态：每次调用传入当前状态。

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "description": "Operation: transition | sync | replan.",
      "enum": [
        "transition",
        "sync",
        "replan"
      ]
    },
    "currentState": {
      "type": "string",
      "description": "Current state (required for transition)."
    },
    "to": {
      "type": "string",
      "description": "Target state (required for transition)."
    },
    "planSteps": {
      "type": "array",
      "description": "Plan steps (sync/replan).",
      "items": {
        "type": "string"
      }
    },
    "previousTasks": {
      "type": "array",
      "description": "Previous task list (replan, optional: preserve completed steps).",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "tasks": {
      "type": "array",
      "description": "Current task list (transition to executing, required: sync first).",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "feedback": {
      "type": "string",
      "description": "Feedback driving replanning (transition to replanning, required)."
    }
  },
  "required": [
    "action"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `patent_search`

- 按关键词或布尔表达式检索 Google Patents（如 (phase change OR PCM) AND thermal、assignee:(Samsung) after:20200101）
- 返回结构化命中：专利号、标题、受让人、公开日、摘要、URL
- 用于在先技术检索、新颖性预筛、竞争对手/受让人分析

使用说明：
  - 只读；查询语法遵循 Google Patents 检索语法
  - 命中详情请继续用 patent_metadata 获取
  - 网络失败以错误报告；真正的零结果检索返回空命中
  - 非致命告警（家族去重、页面结构变化留下的空字段）列在渲染结果的「警告」段

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query in Google Patents syntax: keywords, phrases, boolean (AND/OR/NOT), fielded (assignee:/inventor:), date ranges (after:/before:)."
    },
    "limit": {
      "type": "number",
      "description": "Max hits (1-50, default 10)"
    }
  },
  "required": [
    "query"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `patent_wiki_search`

检索专利 wiki 知识卡片（说明书/权利要求/撰写/附图四目录），用于撰写说明书、权利要求书时查询充分公开、实施例、数值范围、以说明书为依据等撰写标准。支持 dir 目录过滤（specification/claims/drafting/figures）与 include_body 正文片段。

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "检索关键词（卡片标题/概念/领域子串匹配；空串 = 按目录列出卡片，条数受 limit 约束）"
    },
    "dir": {
      "type": "string",
      "description": "目录过滤：specification=说明书、claims=权利要求、drafting=撰写、figures=附图（缺省全部）",
      "enum": [
        "specification",
        "claims",
        "drafting",
        "figures"
      ]
    },
    "limit": {
      "type": "number",
      "description": "返回条数上限（默认 5，最大 10）"
    },
    "include_body": {
      "type": "boolean",
      "description": "是否附带卡片正文片段（默认 false）"
    }
  },
  "required": [
    "query"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `patent_worker_validate`

按声明契约（必填字段）校验专利 worker 产出。缺失硬契约字段将输出标记为降级（绝不中断）；软契约缺口单独报告。返回通过/降级判定及缺失的硬/软字段清单。用于专利产物的契约级质量审查（技术分析、检索报告、新颖性/创造性分析、OA 答复、质检报告）。

```json
{
  "type": "object",
  "properties": {
    "workerName": {
      "type": "string",
      "description": "Worker name from the built-in catalog (e.g. patent-technical-analyzer, patent-novelty-analyzer, quality_checker)."
    },
    "outputText": {
      "type": "string",
      "description": "Output text to validate against the worker contract."
    }
  },
  "required": [
    "workerName",
    "outputText"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `patent_workflow`

运行声明式专利工作流（recap 模式）：校验 manifest，把各阶段输出组装为带降级标记与摘要的结构化结果，并持久化记录。内置 manifest：patent_novelty_v1、patent_disclosure_v1、patent_inventiveness_v1、patent_patentability_v1、patent_oa_response_v1、patent_invalidation_v1、patent_reexamination_v1、patent_infringement_v1。按阶段 id 提供 outputs；缺失阶段标记为降级。不调用 LLM——本工具只收尾 agent 已产出的文本。用于以单一可验证结果记录收尾多阶段专利分析（新颖性 / 公开充分 / 创造性 / ……）。

```json
{
  "type": "object",
  "properties": {
    "manifestId": {
      "type": "string",
      "description": "Workflow manifest id. Defaults to 'patent_novelty_v1'."
    },
    "caseId": {
      "type": "string",
      "description": "Optional case id for result records; when provided the run persists under `<caseDir>/workflow-runs/`."
    },
    "outputs": {
      "type": "array",
      "description": "Per-stage outputs keyed by stage id. Missing stages are marked degraded.",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "stageId": {
            "type": "string"
          },
          "text": {
            "type": "string"
          }
        },
        "required": [
          "stageId",
          "text"
        ]
      }
    }
  }
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `patent_workflow_run`

自动执行声明式专利工作流（原子阶段）或领域图。Manifest 路径：8 个内置 manifest——patent_disclosure_v1（PFE 抽取 → 在先技术检索 → 逐特征新颖性 → 复核门 → 权利要求草稿）、patent_novelty_v1、patent_inventiveness_v1（三步法）、patent_patentability_v1、patent_oa_response_v1（通知书解析 → 权利要求对照表 → 答复草稿）、patent_invalidation_v1（无效理由 → 对照表 → 新颖性与创造性）、patent_reexamination_v1（驳回理由 → 对照表 → 新颖性与创造性）、patent_infringement_v1（对照表 → 全面覆盖/等同核验 → 报告）。图路径（graph=novelty|inventiveness|enablement|citation-check）：一次调用运行完整领域图（LLM 节点 + 专利检索 + 确定性规则门）；citation-check 为确定性纯函数图，校验结论文本（inventiveness_conclusion/novelty_report/text）中的每个 `D<id>`/专利号引用均出现在 priorArt（以 JSON 数组传入）中。以 input 提供材料；当权利要求文本不应混入该材料时，另以 claims 单独传入。复核门会暂停运行；再次调用时以 resumeCheckpointId（图路径）或 approveStageIds（manifest 路径）继续。提供 caseId 时，运行结果、Mermaid 图与图检查点持久化于 `<caseDir>/workflow-runs/`。需要模型端口。

```json
{
  "type": "object",
  "properties": {
    "manifestId": {
      "type": "string",
      "description": "Workflow manifest id. Defaults to 'patent_disclosure_v1'."
    },
    "graph": {
      "type": "string",
      "description": "Domain graph to run end-to-end (takes precedence over manifestId).",
      "enum": [
        "novelty",
        "inventiveness",
        "enablement",
        "citation-check"
      ]
    },
    "resumeCheckpointId": {
      "type": "string",
      "description": "Graph checkpoint id from a previous interrupted run; resumes from it."
    },
    "approveCheckpointId": {
      "type": "string",
      "description": "Graph checkpoint id to grant and resume past (approves the gate)."
    },
    "approveStageIds": {
      "type": "array",
      "description": "Manifest stage ids of already-approved approval gates (e.g. ['review_gate']); skipped on rerun.",
      "items": {
        "type": "string"
      }
    },
    "caseId": {
      "type": "string",
      "description": "Optional case id enabling run/checkpoint persistence."
    },
    "input": {
      "type": "string",
      "description": "Initial material consumed by the extract atoms."
    },
    "claims": {
      "type": "string",
      "description": "Claims text, when supplied separately from `input` (e.g. the office action as input plus the claims under review); element-level atoms then read the claims instead of the initial material."
    },
    "chartTargets": {
      "type": "string",
      "description": "claim-chart target objects JSON (default empty)."
    },
    "maxResults": {
      "type": "number",
      "description": "Max prior-art search results (default 5)."
    },
    "priorArt": {
      "type": "string",
      "description": "Existing prior-art evidence entries as a JSON array (graph path; citation-check grounds citations against these)."
    }
  },
  "required": [
    "input"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `recognize_chemical_structure`

识别化学式/化学结构：从化学结构图（图片模式，多模态模型两步分析 + RDKit 校验）或文档文本（文本模式，正则候选 → LLM 复核/化合物名称转 SMILES → RDKit 校验）中提取多候选 SMILES、分子式与化合物名称。当交底书/说明书/权利要求含化学结构式（含 Markush 广义结构）、分子式或化合物名称需要转 SMILES 时使用。注意：本工具不直接解析 PDF——图片模式输入须为已导出的图片（jpeg/png/gif/webp），文本模式可传 PDF 文本层提取结果。

本构建未接入化学识别引擎：识别流水线（VLM 两步法、name→SMILES、RDKit 校验）属后续工作，调用返回 needHumanReview=true 的不可用结果。需要化学结构解析时改走人工复核或外部工具链，不要靠本工具产出 SMILES。

```json
{
  "type": "object",
  "properties": {
    "image_path": {
      "type": "string",
      "description": "化学结构图图片路径（工作区相对或绝对路径，支持 jpg/png/gif/webp；PDF 页请先导出为图片）"
    },
    "text": {
      "type": "string",
      "description": "文档文本片段（说明书/权利要求）或单独的化合物名称（name→SMILES）"
    },
    "mode": {
      "type": "string",
      "description": "识别模式：image 走图片两步法；text 走文本三级流水线；auto 按输入分派（默认）",
      "enum": [
        "image",
        "text",
        "auto"
      ]
    },
    "claim_context": {
      "type": "string",
      "description": "权利要求或技术方案文本（图文对齐，可提高识别准确率）"
    }
  }
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `rule_check`

对给定文本运行确定性成文规则检查（关键词黑名单 / 模式 / 结构 / 引用范围 / 同义词匹配），返回带严重级别、处置建议与法条依据的违规项。在发布合规敏感输出（如专利结论、法律意见）前使用。范围：patent（通用专利合规）、patent-electrical（H 部电学规则 + 通用合规）、patent-full（全部随包资产：通用合规 + nuo 镜像 + 手写并入规则，需激活评审）、作业 scope patent-oa-response / patent-invalidation / patent-reexamination / patent-infringement（把 patent-full 资产按该作业的规则域收窄：本作业的文书域加上它必须答复或论证的条款所在的域），或 pack（由项目 manifest .sati/rules.yaml 组装的分层规则包：base + domains + overrides）。

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "description": "The text to check."
    },
    "scope": {
      "type": "string",
      "description": "Rule set scope. Defaults to 'patent' (bundled patent compliance rules). A job scope ('patent-oa-response' / 'patent-invalidation' / 'patent-reexamination' / 'patent-infringement') evaluates the full assets filtered to that job's rule domains. 'pack' loads the layered rule pack declared by .sati/rules.yaml."
    }
  },
  "required": [
    "text"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `search_patent_figure`

检索已分析的专利附图（索引由 analyze_patent_figure 分析时写入 .sati/figures-index.json）：按技术特征、部件名称或附图标记关键词返回最相关附图及其分析结果——附图编号、类型、组件与标号、附图说明。撰写说明书/具体实施方式时用于确认技术特征对应的附图与标记。索引为空时返回提示，需先调用 analyze_patent_figure 分析附图。当前仅关键词检索（向量/语义检索未接入）。

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "检索关键词（技术特征/部件名/附图标记；空串 = 按附图编号列出已分析附图，条数受 limit 约束）"
    },
    "limit": {
      "type": "number",
      "description": "返回条数上限（默认 5，最大 10）"
    }
  },
  "required": [
    "query"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `validate_specification`

验证专利说明书是否符合撰写要求（确定性规则，无 LLM 调用）。
- 结构完整性：技术领域 / 背景技术 / 发明内容 / 附图说明 / 具体实施方式五部分章节
- 发明名称长度（≤25 字）与摘要长度（≤300 字）、摘要关键词与摘要附图
- 模糊表述、附图说明与图引用一致性、实施例存在性
- 权利要求-说明书特征覆盖（A26.4）、数值范围端点与中间值实施例
- 独立权利要求之间的单一性（A31.1，传 claim_units 时）
- 权项—实施例覆盖矩阵（A26.3/A26.4，传 coverage_entries 时；覆盖度由 features 与 embodiment_refs 计算，不接受调用方给定的覆盖度结论）
- 效果数据定量性、化学领域产物表征数据（tech_domain=chemical 时）

用法：说明书初稿完成后调用；传入 text（说明书全文）即可，另可传 title / abstract / claims / tech_domain / figure_analysis / claim_units / coverage_entries 启用相应校验。

注意：SMILES 合法性抽检依赖 RDKit（本环境未内置），自动跳过，不影响其余规则。

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "description": "说明书全文（markdown，含章节标题）"
    },
    "title": {
      "type": "string",
      "description": "发明名称（可选，单独校验长度）"
    },
    "abstract": {
      "type": "string",
      "description": "摘要（可选，校验长度/关键词/摘要附图）"
    },
    "claims": {
      "type": "string",
      "description": "权利要求书全文（可选，用于特征覆盖比对）"
    },
    "tech_domain": {
      "type": "string",
      "description": "技术领域（chemical 时附加化学表征数据校验）",
      "enum": [
        "mechanical",
        "electrical",
        "chemical",
        "software",
        "general"
      ]
    },
    "figure_analysis": {
      "type": "array",
      "description": "附图智能分析结果（可选）：提供时执行图文一致性校验",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "usable": {
            "type": "boolean",
            "description": "分析结果是否可用（组件提取成功）"
          },
          "components": {
            "type": "array",
            "description": "识别的组件列表",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "properties": {
                "refNumber": {
                  "type": "string",
                  "description": "附图标记号（与图面标号一致）"
                }
              },
              "required": [
                "refNumber"
              ]
            }
          }
        },
        "required": [
          "usable"
        ]
      }
    },
    "claim_units": {
      "type": "array",
      "description": "结构化权利要求（可选）：提供时执行独立权利要求单一性自检（A31.1）",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "number": {
            "type": "number",
            "description": "权利要求编号（与权利要求书一致）"
          },
          "kind": {
            "type": "string",
            "description": "独立或从属权利要求（仅独立权利要求进入单一性比较）",
            "enum": [
              "independent",
              "dependent"
            ]
          },
          "preamble": {
            "type": "string",
            "description": "前序部分，如\"一种智能门锁\""
          },
          "characterized": {
            "type": "string",
            "description": "\"其特征在于\"之后的特征部分"
          }
        },
        "required": [
          "number",
          "kind",
          "preamble"
        ]
      }
    },
    "coverage_entries": {
      "type": "array",
      "description": "权项—实施例覆盖条目（可选）：提供时计算覆盖矩阵，逐特征判定是否有实施例支持",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "claim_id": {
            "type": "string",
            "description": "权利要求标识，形如 claim_1"
          },
          "features": {
            "type": "array",
            "description": "该权利要求的技术特征",
            "items": {
              "type": "string"
            }
          },
          "embodiment_refs": {
            "type": "array",
            "description": "支持该权利要求的实施例原文片段",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "claim_id",
          "features",
          "embodiment_refs"
        ]
      }
    }
  }
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

### `workbench_link_patent_case`

把专利案件目录桥接进个人工作台任务树（幂等）：确保 patent_* 类型字典项；找到或创建根任务（标题=案号，source=patent，workspace_path=案件目录）与 L1–L5 五个阶段子任务；读取案件目录的 _matter-log.md，把阶段进展投影为子任务状态。投影优先级：显式 stages 入参 > _matter-log 解析 > 保持现状。_matter-log 解析为行级启发式：一行同时含 L1–L5 阶段码与完成词（完成/通过/✅/已交付/归档）记 done，含进行词（进行/开始/推进/启动）记 doing，后行覆盖前行；一行多阶段共用该行判定。只经工作台 HTTP API 写任务；不写案件目录任何文件；不修改根任务状态（避免级联完成子任务）。工作台插件未挂载或 web 服务不可用时失败（setup_required）。dryRun 只算投影不写。

```json
{
  "type": "object",
  "properties": {
    "caseNumber": {
      "type": "string",
      "description": "案件编号（同时是案件目录名与根任务标题）。"
    },
    "caseRoot": {
      "type": "string",
      "description": "案件根目录覆盖（默认取插件配置 workbenchCaseRoot）。"
    },
    "stages": {
      "type": "array",
      "description": "显式阶段状态（可选，优先于 _matter-log 解析）。",
      "items": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "dryRun": {
      "type": "boolean",
      "description": "只计算投影，不写入（默认 false）。"
    }
  },
  "required": [
    "caseNumber"
  ]
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

Sati 专利领域工具集：检索/元数据/法律状态/判例/wiki/知识图谱查询，权利要求对照表、撰写、分析报告、说明书校验、证据判定、规则检查、附图分析、PDF 下载、化学结构识别、知识笔记，以及工作流/计划状态机。render_patent_document 由 @deepseek-ai/dsh-patent-document 提供。

<a id="deepseek-aidsh-patent-document"></a>

## `@deepseek-ai/dsh-patent-document`

### `render_patent_document`

从内置的中文 HTML 模板把专利代理交付物（可专利性意见、检索报告、OA 答复、权利要求对照表、无效意见、补正书、复审请求书、侵权比对意见或诉讼文书）渲染为磁盘文件。选择模板 id 与 outputName；以 id → innerHTML 记录的形式传入 sections 填充模板插槽。写出 HTML 文件，默认还通过无头 Chrome 生成 PDF（format：html、pdf 或 both，默认 both）。返回写入的文件路径及任何告警或 PDF 失败原因（PDF 失败时 HTML 仍存在）。

```json
{
  "type": "object",
  "properties": {
    "template": {
      "type": "string",
      "description": "Template id to render (one of the nine shipped patent templates).",
      "enum": [
        "patentability-opinion",
        "search-report",
        "oa-response",
        "claims-spec",
        "invalidation-opinion",
        "rectification-response",
        "re-examination-request",
        "infringement-opinion",
        "litigation-pleading"
      ]
    },
    "outputName": {
      "type": "string",
      "description": "Output filename stem (no extension); letters, digits, underscore, hyphen, dot, and Chinese characters (a Chinese draft name is accepted as written). No path separators, no \"..\"."
    },
    "caseId": {
      "type": "string",
      "description": "Optional case id; when given the result lands in data/cases/<caseId>/outputs/ instead of the default directory."
    },
    "outputDir": {
      "type": "string",
      "description": "Optional explicit output directory (overrides caseId and the default directory)."
    },
    "format": {
      "type": "string",
      "description": "Output format: html, pdf, or both (default both).",
      "enum": [
        "html",
        "pdf",
        "both"
      ]
    },
    "sections": {
      "type": "object",
      "description": "Record of element id -> HTML innerHTML content to inject into the template.",
      "additionalProperties": true
    },
    "brand": {
      "type": "object",
      "description": "Optional inline brand overrides (keys map to the --sati-doc-* CSS variables, e.g. firm, accent).",
      "additionalProperties": true
    },
    "brandPath": {
      "type": "string",
      "description": "Optional path to a theme.json whose documents.patent namespace supplies brand overrides."
    }
  },
  "required": [
    "template",
    "outputName"
  ]
}
```

来源：[`packages/patent/patent-document/src/index.ts`](../packages/patent/patent-document/src/index.ts)

render_patent_document 从内置 HTML 模板渲染专利交付物（权利要求书/说明书/检索报告/OA 答复/无效意见），可选通过 ctx.subprocess 调用无头 Chrome 生成 PDF。

<a id="deepseek-aidsh-patent-deadline"></a>

## `@deepseek-ai/dsh-patent-deadline`

### `patent_deadlines`

- 计算一件中国专利案件的法定与指定期限：优先权期限及其恢复、增加或改正优先权要求、申请费、实质审查请求、主动修改、办理登记手续与分案申请、专利权期限、各年度年费及其六个月补缴窗口、PCT 进入中国国家阶段、复审、审查意见与无效宣告答复，以及专利权期限补偿请求。
- 期限自送达日起算。依 2023 年修订的专利法实施细则第4条与 2023 版专利审查指南，电子送达的送达日为进入当事人认可电子系统之日、无更晚证据时以发文日推定，裁判因之期限自发文日起算且不再加 15 日；邮寄送达以当事人举证的实际收到日为准，否则为自发出之日起满15日；直接送交以交付日为准；公告送达自公告之日起满1个月。
- 默认适用专利法实施细则第5条：期限开始的当日不计算在期限内；以年或月计算的，以其最后一月的相应日为届满日（该月无相应日的以该月最后一日为届满日）；届满日为法定休假日或移用周休息日的，顺延至其后第一个工作日。将 restDayRule 设为 "omit" 即改用不顺延口径，只报每个期限自身届满日；两种口径下均同时返回两个日期，rawDueDate 为未顺延者。
- 本案主张优先权时，实审请求期限自优先权日起算，否则自申请日起算。是否主张优先权为显式输入，不由是否存在优先权日推断。
- 由通知送达起算的期限（授权、驳回、审查意见、复审、无效）在提供该通知送达日期前以待补项返回，并点名所缺输入；本工具不以申请日近似这些期限。

使用说明：
  - 日期格式为 YYYY-MM-DD。按案件实际收到的通知传入，并注明每份通知的送达方式。
  - 只读且离线；不发起网络请求。
  - 结果为决策辅助而非递交指令：行动前请对照通知书与现行《专利审查指南》核验。

```json
{
  "type": "object",
  "properties": {
    "patentType": {
      "type": "string",
      "description": "Patent category",
      "enum": [
        "invention",
        "utility-model",
        "design"
      ]
    },
    "filingDate": {
      "type": "string",
      "description": "Application date (international filing date for a PCT case)"
    },
    "claimsPriority": {
      "type": "boolean",
      "description": "Whether the case claims priority, as stated by the agent or the human handling the case"
    },
    "priorityDate": {
      "type": "string",
      "description": "Earliest priority date; required when claimsPriority is true"
    },
    "isPctNationalPhase": {
      "type": "boolean",
      "description": "Whether the case is a PCT application entering the Chinese national phase"
    },
    "authorizationPublicationDate": {
      "type": "string",
      "description": "Grant publication date (授权公告日)"
    },
    "marketingApprovalDate": {
      "type": "string",
      "description": "Date the drug obtained marketing approval in China"
    },
    "notices": {
      "type": "array",
      "description": "Notices received, with their delivery",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "kind": {
            "type": "string",
            "description": "Which document was delivered",
            "enum": [
              "office-action-first",
              "office-action-subsequent",
              "substantive-exam-notice",
              "rejection-decision",
              "grant-notice",
              "reexamination-notice",
              "invalidation-transfer"
            ]
          },
          "mode": {
            "type": "string",
            "description": "How it was delivered; omitted means electronic (dispatch date is the delivery date)",
            "enum": [
              "electronic",
              "postal",
              "personal",
              "publication"
            ]
          },
          "dispatchDate": {
            "type": "string",
            "description": "Dispatch date on the notice (electronic/postal)"
          },
          "enteredDate": {
            "type": "string",
            "description": "Day it entered the electronic system, when evidenced later than dispatch"
          },
          "actualReceiptDate": {
            "type": "string",
            "description": "Actual receipt date, when evidenced"
          },
          "handedOverDate": {
            "type": "string",
            "description": "Hand-over date for direct delivery"
          },
          "publicationDate": {
            "type": "string",
            "description": "Announcement date for service by publication"
          },
          "designatedMonths": {
            "type": "number",
            "description": "Months the notice itself designates"
          }
        },
        "required": [
          "kind"
        ]
      }
    },
    "restDayRule": {
      "type": "string",
      "description": "apply (default) rolls an end date off a rest day; omit reports the period's own end date",
      "enum": [
        "apply",
        "omit"
      ]
    }
  },
  "required": [
    "patentType",
    "filingDate",
    "claimsPriority"
  ]
}
```

Source: [`packages/patent/patent-deadline/src/index.ts`](../packages/patent/patent-deadline/src/index.ts)

patent_deadlines 报告一件中国专利案件的法定与指定期限，适用专利法实施细则的期限与送达规则，并把落在节假日的届满日顺延至其后第一个工作日；由通知起算的期限以待补项返回，并点名所缺的送达记录。

<a id="deepseek-aidsh-writing-patterns"></a>

## `@deepseek-ai/dsh-writing-patterns`

### `query_writing_patterns`

- 取回适合当前撰写或答复场景的专利与法律撰写模式，并编译为 <writing_skills> 块
- 每个模式覆盖一个场景，含有序步骤与应当遵循或避免的规则：权利要求撰写、说明书撰写、交底书撰写、IPC 策略、具体实施方式撰写，以及针对创造性、新颖性、清楚性的审查意见答复
- 选择方式：传 `query` 按关键词检索；否则用 `features` 把案件特征与模式名称、摘要、步骤名做匹配；否则按 `category` 列出该类目；不带任何参数时按 `limit` 上限列出模式库
- 选择是词法且离线的：工具只挑选模式，不对案件作判断。把返回的步骤应用到正在撰写的段落上

Source: [`packages/patent/writing-patterns/src/index.ts`](../packages/patent/writing-patterns/src/index.ts)

```json
{
  "type": "object",
  "properties": {
    "category": {
      "type": "string",
      "description": "Pattern category: oa_inventiveness (OA 答复-创造性), oa_novelty (OA 答复-新颖性), oa_clarity (OA 答复-不清楚), claim_drafting (权利要求撰写), spec_drafting (说明书撰写), disclosure (技术交底书), invalidation (无效请求), ipc_strategy (IPC 策略), embodiment (具体实施方式)",
      "enum": [
        "oa_inventiveness",
        "oa_novelty",
        "oa_clarity",
        "claim_drafting",
        "spec_drafting",
        "disclosure",
        "invalidation",
        "ipc_strategy",
        "embodiment"
      ]
    },
    "query": {
      "type": "string",
      "description": "Search keywords; when set, the call searches by keyword instead of matching case features"
    },
    "features": {
      "type": "array",
      "description": "Technical features or keywords of the case, e.g. [\"创造性三步法\", \"功能性限定\"]",
      "items": {
        "type": "string"
      }
    },
    "limit": {
      "type": "integer",
      "description": "Maximum number of patterns to return; defaults to 5"
    }
  }
}
```

query_writing_patterns 按类目、关键词或案件特征从随包语料中挑出撰写与答复模式，返回匹配到的模式与编译后的 <writing_skills> 块；同一个块也作为系统提示段注入，使撰写纪律无需调用即可生效。

<a id="deepseek-aidsh-doc-template"></a>

## `@deepseek-ai/dsh-doc-template`

### `list_doc_templates`

- 列出本部署可渲染的文档模板及其变量，供随后调用 `render_doc_template` 时按需填充
- 过滤器可选且可叠加：category、domain、language，以及对名称、标题、说明与适用场景文本的大小写不敏感检索
- 每个模板同时报告其支持的格式；未列出 `docx` 的模板不能渲染为 DOCX

使用说明：
  - 只读且离线；读取随包模板资产与已配置的覆盖目录。
  - 在调用 `render_doc_template` 之前先调用本工具：必填变量及其类型只在这里报告。

```json
{
  "type": "object",
  "properties": {
    "category": {
      "type": "string",
      "description": "Exact category filter, e.g. claims"
    },
    "domain": {
      "type": "string",
      "description": "Exact domain filter, e.g. patent"
    },
    "language": {
      "type": "string",
      "description": "Exact language filter, e.g. zh-CN"
    },
    "query": {
      "type": "string",
      "description": "Case-insensitive substring over name, title, description, and use-when"
    }
  }
}
```

Source: [`packages/document/doc-template/src/index.ts`](../packages/document/doc-template/src/index.ts)

### `render_doc_template`

- 用给定变量渲染一个文档模板，返回文档本体、未填充的占位符与变量警告
- 先用 `list_doc_templates` 取得模板名与其变量。每个必填变量都必须提供：缺一个即调用失败并点名该变量，而不是返回一份带缺口的文档
- `format` 默认取模板的兜底格式；模板只渲染它声明的格式。`markdown` 与 `html` 返回文本，`docx` 把包体以 base64 放在 `content`；解析后的 Markdown 正文始终在 `markdown` 中返回
- 模板未声明的变量被忽略；未提供值的占位符保留在文档中并在 `residual` 中报告，而不是被抹掉。每次成功渲染都会返回残余占位符与警告：把文档当作成品之前先读它们

使用说明：
  - 离线；渲染随包模板资产、已配置的覆盖目录与随包样式。
  - 声明了书写风格的模板，在本部署启用免责声明时把该风格的免责声明带进渲染结果。

```json
{
  "type": "object",
  "properties": {
    "template": {
      "type": "string",
      "description": "Template name from list_doc_templates"
    },
    "variables": {
      "type": "object",
      "description": "Variable values keyed by variable name, without the {{}} wrapping; values are strings",
      "additionalProperties": true
    },
    "format": {
      "type": "string",
      "description": "Output format: markdown, html, or docx (default markdown)",
      "enum": [
        "markdown",
        "html",
        "docx"
      ]
    },
    "title": {
      "type": "string",
      "description": "Document title override; defaults to the template title"
    },
    "author": {
      "type": "string",
      "description": "Author or attorney, written into the HTML metadata"
    },
    "date": {
      "type": "string",
      "description": "Document date, written into the HTML metadata"
    },
    "filename": {
      "type": "string",
      "description": "Suggested file name stem without extension; defaults to the template name"
    }
  },
  "required": [
    "template"
  ]
}
```

Source: [`packages/document/doc-template/src/index.ts`](../packages/document/doc-template/src/index.ts)

list_doc_templates 报告随包文档模板及其变量与支持格式，render_doc_template 用给定变量把其中一个渲染为 Markdown、HTML 或 DOCX，并返回文档本体、残余占位符与变量警告。部署还可以在 `styleGuide` 中指定一个已加载的书写风格，该风格指南会作为系统提示词段落注入。

<a id="deepseek-aidsh-patent-teams"></a>

## `@deepseek-ai/dsh-patent-teams`

### `patent_teams_add_member`

Add a durable continuable member. By default it snapshots the captain's current LLM route and effort. Supply provider/model only for an explicitly requested role-specific route; a changed provider or model automatically uses the target model's default effort. Set reasoning_effort only to request one of the target model's supported ids explicitly (or "default" to force its default). The member waits for messages, works on assigned tasks, and can message the team.

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Unique member name inside the team."
    },
    "role": {
      "type": "string",
      "description": "Role of the member (e.g. case-manager, researcher, drafter, technical-expert, adversarial-reviewer, applicant-counsel, formal-examiner, invalidity-petitioner, patentee-defender, adjudicator, defendant-counsel, tech-investigator, document-specialist)."
    },
    "provider": {
      "type": "string",
      "description": "Optional LLM provider route. Use only when the user explicitly requests a different provider; requires model."
    },
    "model": {
      "type": "string",
      "description": "Optional model override. Omit for the captain's current model (or the configured memberModel default)."
    },
    "reasoning_effort": {
      "type": "string",
      "description": "Optional reasoning effort override: one of the target model's supported effort ids, or \"default\" to force its default. When omitted, the captain's effort is inherited only for the same provider/model; a changed route uses the target default."
    }
  },
  "required": [
    "name"
  ]
}
```

Source: [`packages/patent/patent-teams/src/index.ts`](../packages/patent/patent-teams/src/index.ts)

### `patent_teams_archive`

List this workspace's archived teams (kept by patent_teams_delete), or show one archived team's members and tasks in detail. Read-only.

```json
{
  "type": "object",
  "properties": {
    "team_id": {
      "type": "string",
      "description": "Optional archived team id to show in detail; omit to list archived teams."
    }
  }
}
```

Source: [`packages/patent/patent-teams/src/index.ts`](../packages/patent/patent-teams/src/index.ts)

### `patent_teams_claim_task`

Claim one ready task for a member (or yourself). A member cannot own a second unfinished task. The returned attempt_id is required for that member's updates and becomes stale after retry/reassignment.

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "The task id to claim."
    },
    "assignee": {
      "type": "string",
      "description": "Member to claim for (captain only; defaults to the task's assignee). Member names only — \"captain\" is not a member; omit it to claim as the captain."
    }
  },
  "required": [
    "task_id"
  ]
}
```

Source: [`packages/patent/patent-teams/src/index.ts`](../packages/patent/patent-teams/src/index.ts)

### `patent_teams_create`

Create a new PatentTeams team: you (the calling agent) become the captain. A captain leads one team at a time; create tasks and members afterwards with patent_teams_add_member and patent_teams_create_task.

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Name for the new team (used as its stable id)."
    },
    "description": {
      "type": "string",
      "description": "Team purpose / the goal the team will work on."
    }
  },
  "required": [
    "name"
  ]
}
```

Source: [`packages/patent/patent-teams/src/index.ts`](../packages/patent/patent-teams/src/index.ts)

### `patent_teams_create_task`

Create a task in your team's task list. Tasks can depend on other tasks (dependencies): a task is only claimable once every dependency is completed. Optionally assign it to a member, who still claims it before working.

```json
{
  "type": "object",
  "properties": {
    "subject": {
      "type": "string",
      "description": "Brief title for the task."
    },
    "description": {
      "type": "string",
      "description": "What needs to be done, in detail."
    },
    "dependencies": {
      "type": "array",
      "description": "Task ids this task depends on (must be completed before this task can be claimed).",
      "items": {
        "type": "string"
      }
    },
    "assignee": {
      "type": "string",
      "description": "Optional member name this task is intended for. Member names only: the captain is not a member, so never pass \"captain\" here — use reassign_task(assignee=\"captain\") to move a task to the captain."
    },
    "worker": {
      "type": "string",
      "description": "Optional worker contract the task output is validated against on completion (e.g. patent-search-commander, patent-oa-writer)."
    }
  },
  "required": [
    "subject"
  ]
}
```

Source: [`packages/patent/patent-teams/src/index.ts`](../packages/patent/patent-teams/src/index.ts)

### `patent_teams_delete`

End your team: interrupts all members (best effort) and archives the team's state directory (team file, tasks, mailboxes). Use when the team's work is done or abandoned.

```json
{
  "type": "object",
  "properties": {}
}
```

Source: [`packages/patent/patent-teams/src/index.ts`](../packages/patent/patent-teams/src/index.ts)

### `patent_teams_reassign_task`

Atomically retry, reassign, or let the captain take over any unfinished/failed task. The old attempt is revoked before its member is interrupted, so late updates cannot overwrite the new owner. Use assignee="captain" for captain takeover.

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "Task to retry/reassign."
    },
    "assignee": {
      "type": "string",
      "description": "Active member name, or \"captain\" for captain takeover."
    },
    "reason": {
      "type": "string",
      "description": "Why the task is being retried or reassigned."
    }
  },
  "required": [
    "task_id",
    "assignee"
  ]
}
```

Source: [`packages/patent/patent-teams/src/index.ts`](../packages/patent/patent-teams/src/index.ts)

### `patent_teams_remove_member`

Remove a member safely: revoke its current attempts, return all unfinished owned tasks to the shared pending pool, interrupt its live turn, and mark it removed.

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "description": "Name of the member to remove."
    }
  },
  "required": [
    "name"
  ]
}
```

Source: [`packages/patent/patent-teams/src/index.ts`](../packages/patent/patent-teams/src/index.ts)

### `patent_teams_send_message`

Send a message to the captain or to a teammate. Messages go straight into the recipient's mailbox; when the captain agent is online the plugin also schedules live delivery (member recipients get the message as their next turn; a running captain sees it at the nearest model step). No relay is involved: teammates talk to each other directly.

```json
{
  "type": "object",
  "properties": {
    "to": {
      "type": "string",
      "description": "Recipient: \"captain\" or a member name."
    },
    "content": {
      "type": "string",
      "description": "The message text."
    },
    "from": {
      "type": "string",
      "description": "Sender (defaults to the caller: the captain, or the calling member)."
    }
  },
  "required": [
    "to",
    "content"
  ]
}
```

Source: [`packages/patent/patent-teams/src/index.ts`](../packages/patent/patent-teams/src/index.ts)

### `patent_teams_status`

Team snapshot: members with live activity and tasks with status/assignee/dependencies/output. Captains also see every team mailbox; members see only their own inbox. Poll this to watch progress.

```json
{
  "type": "object",
  "properties": {}
}
```

Source: [`packages/patent/patent-teams/src/index.ts`](../packages/patent/patent-teams/src/index.ts)

### `patent_teams_update_task`

Update a task status/output. Members must supply the current attempt_id returned by claim_task; stale attempts are rejected after takeover/reassignment. Terminal results are immutable. A captain must use reassign_task(assignee="captain") before updating member-owned work.

```json
{
  "type": "object",
  "properties": {
    "task_id": {
      "type": "string",
      "description": "The task id to update."
    },
    "status": {
      "type": "string",
      "description": "New status. Legal moves: pending→claimed, claimed→in_progress, in_progress→completed. A claimed task must enter in_progress before it can be completed; terminal statuses (completed/failed/cancelled) have no way out.",
      "enum": [
        "in_progress",
        "completed",
        "failed",
        "cancelled"
      ]
    },
    "output": {
      "type": "string",
      "description": "Result summary; set when completing or failing."
    },
    "attempt_id": {
      "type": "string",
      "description": "Current execution capability returned by claim_task (required for members when present on the task)."
    }
  },
  "required": [
    "task_id"
  ]
}
```

Source: [`packages/patent/patent-teams/src/index.ts`](../packages/patent/patent-teams/src/index.ts)

The durable multi-agent team service for the patent domain: create a team (you become captain), add continuable subagent members by role, break the goal into dependency-aware tasks, and let the shared-task scheduler wake idle members. Member spawn and messaging use the captain as the direct parent, so a team survives harness restarts.

<a id="deepseek-aidsh-tool-workflow"></a>

## `@deepseek-ai/dsh-tool-workflow`

### `workflow`

运行用于大规模编排 subagent 的 JavaScript 工作流脚本。当工作会分散到许多相互独立的部分时，请使用此工具，例如审查大量文件、执行迁移、开展多角度研究或对发现进行对抗式验证；此时应将编排写成脚本，而不是逐轮委派。

工作流的身份通过 `meta` 参数以 JSON 形式传入：必填的 `name`（简短 kebab-case）和 `description` 字符串，以及可选的 `whenToUse` 字符串和 `phases` 数组（`{title, detail?, provider?, model?}`）。`script` 参数只能是纯 JavaScript **函数体**，不能是 TypeScript，也不能包含 `export const meta` 语句；meta 是参数而非代码。脚本支持顶层 await；请以 `return <value>` 结尾，该值必须可以 JSON 序列化，并作为此工具的结果。

脚本函数体提供以下钩子：

- `agent(prompt, opts?): Promise<any>`：运行一个 subagent 直至完成。不提供 `opts.schema` 时，解析为子级最终文本；提供 `opts.schema` 时，它必须是以对象为根、且**只能**使用 type/properties/required/additionalProperties/items/enum/const/oneOf 的 JSON Schema，不支持 pattern/format/数值边界，此时解析为通过校验的对象。子级失败时解析为 `null`，可使用 `.filter(Boolean)` 过滤。其他选项包括 `label`（显示名称）、`phase`（进度组），以及相互独立的 `provider`／`model` LLM（大语言模型）目标覆盖项，两者可单独提供。其他任何选项（`effort`／`isolation`／`agentType`）都会明确报错。
- `pipeline(items, ...stages): Promise<any[]>`：让每个条目分别经过各阶段，阶段之间**没有**屏障；多阶段工作优先使用它。每个阶段接收 `(prev, item, index)`。普通的阶段异常会将该**条目**变为 `null`，并跳过它的剩余阶段。
- `parallel(thunks): Promise<any[]>`：并发运行零参数函数并等待**全部**完成。它会形成屏障，仅当某个阶段确实需要汇总全部先前结果时使用。抛出异常的 thunk 解析为 `null`。
- `phase(title)`：开始一个进度阶段；`log(message)`：说明进度；`args`：工具调用的 `args` 输入，原样提供。

如果误用钩子（参数错误、未知选项、不受支持的 schema、触发上限），抛出的错误**总会**终止脚本，绝不会退化为单个条目的 `null`。

约束：并发上限和 agent 总数上限均会生效；不提供文件系统、网络、定时器或 Node.js API。具体工作由 agent 完成，脚本只负责编排。该运行默认在前台执行：整个脚本完成后，调用才会返回。长时间运行时请设 `run_in_background: true`：调用立即返回一个 job id，运行继续在后台编排，其返回值随该 job 的完成通知送达（用 `job_output` 查看、用 `job_kill` 停止）。

```json
{
  "type": "object",
  "properties": {
    "script": {
      "type": "string",
      "description": "The plain-JS workflow script body (top-level await allowed; NO `export const meta` statement; end with `return <json-value>`)."
    },
    "meta": {
      "type": "object",
      "description": "The workflow identity block (plain JSON — never code).",
      "additionalProperties": true,
      "properties": {
        "name": {
          "type": "string",
          "description": "Short kebab-case workflow name."
        },
        "description": {
          "type": "string",
          "description": "One-line description of what the workflow does."
        },
        "whenToUse": {
          "type": "string",
          "description": "Optional guidance on when this workflow applies."
        },
        "phases": {
          "type": "array",
          "description": "Optional phase declarations matched by phase() calls.",
          "items": {
            "type": "object",
            "additionalProperties": true,
            "properties": {
              "title": {
                "type": "string",
                "description": "The phase title phase() calls match by exact string."
              },
              "detail": {
                "type": "string",
                "description": "Optional one-line description of the phase."
              },
              "provider": {
                "type": "string",
                "description": "Optional provider override this phase is expected to use."
              },
              "model": {
                "type": "string",
                "description": "Optional model override this phase is expected to use."
              }
            },
            "required": [
              "title"
            ]
          }
        }
      },
      "required": [
        "name",
        "description"
      ]
    },
    "args": {
      "type": "object",
      "description": "Optional JSON input exposed to the script as the `args` global (wrap a bare list as a field, e.g. {\"files\": [...]}).",
      "additionalProperties": true
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Run as a background job: return a job id immediately instead of waiting; the return value arrives with the completion notice."
    }
  },
  "required": [
    "script",
    "meta"
  ]
}
```

来源：[`packages/workflow/tool-workflow/src/index.ts`](../packages/workflow/tool-workflow/src/index.ts)

<a id="deepseek-aidsh-tool-workspace-dependencies"></a>

## `@deepseek-ai/dsh-tool-workspace-dependencies`

### `load_workspace_dependencies`

获取捆绑的 Python 与库目录的绝对路径，以及捆绑的 Python 发行版版本。payload 提供时也会返回 Node.js 与 pnpm 的路径。Python 包含 numpy、pandas、python-docx、python-pptx、openpyxl、Pillow、lxml 和 XlsxWriter。除非用户或工作区指令选择了其他环境，否则请用这些库处理 Office 文件。返回 Node.js 与 pnpm 路径时，请使用该 Node 可执行文件与 pnpm 脚本路径运行 pnpm。本工具不会修改 PATH 或包管理器设置。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/skill/tool-workspace-dependencies/src/index.ts`](../packages/skill/tool-workspace-dependencies/src/index.ts)

<a id="deepseek-aidsh-tool-web"></a>

## `@deepseek-ai/dsh-tool-web`

### `web_fetch`

获取指定 HTTP(S) URL 的内容，并将其解码为文本后返回。

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "The HTTP(S) URL to fetch."
    }
  },
  "required": [
    "url"
  ]
}
```

来源：[`packages/web/tool-web/src/index.ts`](../packages/web/tool-web/src/index.ts)

### `web_search`

在 Web 上搜索最新信息。在必填的 `queries` 数组中提供 1–4 个查询。返回可选的摘要答案和来源 URL 列表。

```json
{
  "type": "object",
  "properties": {
    "queries": {
      "type": "array",
      "description": "Required search queries; accepts 1–4 items and merges their results.",
      "items": {
        "type": "string"
      }
    }
  },
  "required": [
    "queries"
  ]
}
```

来源：[`packages/web/tool-web/src/index.ts`](../packages/web/tool-web/src/index.ts)

web_search 和 web_fetch 将提供方选择置于 ctx.web 之后，使模型可见 schema 在更换后端时保持稳定。

<a id="deepseek-aidsh-macos-tools"></a>

## `@deepseek-ai/dsh-macos-tools`

### `macos_app`

按名称、包 ID 或绝对/`~` 开头的 .app 路径启动、激活或退出 macOS 应用。启动与退出需用户审批；激活只是把已运行的应用带到前台。

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "description": "launch starts the application; activate brings a running application to the front; quit asks a running application to quit.",
      "enum": [
        "launch",
        "activate",
        "quit"
      ]
    },
    "name": {
      "type": "string",
      "description": "Application name (Safari), bundle id (com.apple.Safari), or .app path."
    }
  },
  "required": [
    "action",
    "name"
  ]
}
```

来源：[`packages/desktop/macos-tools/src/index.ts`](../packages/desktop/macos-tools/src/index.ts)

### `macos_clipboard_get`

读取当前 macOS 剪贴板文本。剪贴板可能存有敏感内容，因此每次读取都先向用户请求一次性审批。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/desktop/macos-tools/src/index.ts`](../packages/desktop/macos-tools/src/index.ts)

### `macos_clipboard_set`

用给定文本替换 macOS 剪贴板内容，覆盖原有内容。

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "description": "Text to place on the clipboard."
    }
  },
  "required": [
    "text"
  ]
}
```

来源：[`packages/desktop/macos-tools/src/index.ts`](../packages/desktop/macos-tools/src/index.ts)

### `macos_notify`

发送一条带标题、可选正文与可选提示音的 macOS 系统通知。

```json
{
  "type": "object",
  "properties": {
    "title": {
      "type": "string",
      "description": "Notification title."
    },
    "message": {
      "type": "string",
      "description": "Notification body (optional)."
    },
    "sound": {
      "type": "boolean",
      "description": "Play a notification sound (default false)."
    }
  },
  "required": [
    "title"
  ]
}
```

来源：[`packages/desktop/macos-tools/src/index.ts`](../packages/desktop/macos-tools/src/index.ts)

### `macos_open_path`

用默认 macOS 应用打开文件或文件夹，或在 Finder 中显示。打开会把路径交给默认应用并请求用户审批；显示只是在 Finder 中选中。

```json
{
  "type": "object",
  "properties": {
    "path": {
      "type": "string",
      "description": "Absolute or ~-rooted file or folder path."
    },
    "reveal": {
      "type": "boolean",
      "description": "true to select the path in Finder instead of opening it (default false)."
    }
  },
  "required": [
    "path"
  ]
}
```

来源：[`packages/desktop/macos-tools/src/index.ts`](../packages/desktop/macos-tools/src/index.ts)

### `macos_open_url`

在用户的默认浏览器中打开网址。裸域名默认补 https；仅允许 http 与 https。

```json
{
  "type": "object",
  "properties": {
    "url": {
      "type": "string",
      "description": "URL to open, e.g. https://example.com or example.com."
    }
  },
  "required": [
    "url"
  ]
}
```

来源：[`packages/desktop/macos-tools/src/index.ts`](../packages/desktop/macos-tools/src/index.ts)

### `macos_speak`

用 macOS 语音合成（say 命令）朗读文本。

```json
{
  "type": "object",
  "properties": {
    "text": {
      "type": "string",
      "description": "Text to speak."
    },
    "voice": {
      "type": "string",
      "description": "Voice name (e.g. Tingting, Samantha); defaults to the system voice."
    },
    "rate": {
      "type": "integer",
      "description": "Words per minute, between 80 and 500 (default 175)."
    }
  },
  "required": [
    "text"
  ]
}
```

来源：[`packages/desktop/macos-tools/src/index.ts`](../packages/desktop/macos-tools/src/index.ts)

七个基于系统 CLI 的 macOS 原生工具（打开/显示、浏览器网址、剪贴板读写、通知、朗读、应用控制）；每次调用都以参数数组启动绝对路径的可执行文件，绝不使用 shell 字符串。
