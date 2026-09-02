<!-- 英文源文件由 scripts/gen-tool-catalog.ts 生成；本中文文件是通过双语配对维护的经评审对侧。
     更新时先运行 `pnpm run gen-tool-catalog` 更新英文，再更新本文件并运行 `pnpm run verify-translation-pairing --write docs/tool-catalog.md` 重新记录配对。 -->

# 工具 Schema 目录

[English](tool-catalog.md) | 中文

已发布插件向 `ctx.tools` 提供的所有面向模型的工具：模型通过系统提示词组装获得的 `name`、`description` 和 JSON Schema `parameters`。本目录是[子系统页面](subsystems/core.zh.md)（类型及每页生成的 `cordis-surface` 接线区域）的补充；本页列出的是向 agent（智能体）提供的*工具*。

英文源文件由系统**生成**，并通过 `pnpm run verify-tool-catalog`（`doc-sync`（文档同步门禁）的一部分）验证新鲜度；本中文文件作为经评审对侧通过双语配对维护。与 Cordis 目录（纯源码 AST 处理）不同，英文生成器会在真实上下文中**启动**每个工具插件并读取 `ctx.tools.schemas()`，因为工具 schema 无法通过静态分析完全确定，例如运行时展开的枚举、拼接的描述、由配置决定的名称以及使用原始 JSON Schema 的 MCP 工具。完整性守卫会 glob 匹配 `packages/*/tool-*`；如果生成器的启动 manifest（元数据清单）遗漏任何包，检查就会失败，因此新工具不会在无人察觉的情况下缺少文档。参见[工具 schema 目录 Agent Note](../.agents/notes/implemented/process/2026-07-02-tool-schema-catalog.zh.md)。

范围：`packages/*/tool-*` 下已发布的产品工具，每个工具均使用其**默认**配置启动；但如果某个 Config 字段是**必填项**且没有默认值，生成器就必须作出选择，对应包的说明会记录本页展示的是哪个分支。注册的工具**名称**可以是加载时配置，例如 `tool-subagent` 的 `toolName`，因此部署可能以不同名称或额外名称提供某个包；如果存在随产品发布的别名，对应包的说明会予以记录。`examples/` 中的演示工具（例如 `echo`）不在范围内，这与 Cordis 目录仅涵盖包的范围一致。

<a id="tool-package-map"></a>

## 工具包映射

下表将模型可见的工具名称与其背后的插件包和服务 seam 对应起来。各包章节随后给出确切的 JSON Schema。

| 工具包 | 模型可见名称 | 依赖 | 写入／影响 | 随产品发布的别名 | 部署说明 |
| --- | --- | --- | --- | --- | --- |
| `@deepseek-ai/dsh-tool-ask-user` | `ask_user_question` | `ctx.tools`、`ctx.userQuestions` | `tool/call`、`tool/result after a UI/provider answers the question` | - | ask_user_question 会暂停工具调用，直到当前 UI 提供方返回人类答案。 |
| `@deepseek-ai/dsh-tools` | `run_code` | `ctx.tools`、`ctx.codeRuntime (execution time)`、`ctx.systemPrompt` | `tool/call`、`one tool/code-dispatch-start + tool/code-dispatch pair per bridged sub-call`、`tool/result` | - | 在 `mode: ptc`／`mode: both` 下，它由工具注册表所有，作为可过滤能力层之外的保留传输机制（参见 PTC mode Agent Note）。在 `ptc` 下，它是注册表对协议格式（wire format）的唯一贡献；其他可见能力在使用已加载运行时语言生成的 SDK 章节中声明。程序通过 binding 调用这些能力，调用按照原生并发约定调度：启动顺序和策略遵循提交顺序，并发安全的函数体最多重叠执行 `maxParallelSubCalls` 个。调用会重新进入完整且受守卫保护的工具流水线，并将每个嵌套执行关联到此外层结果。 |
| `@deepseek-ai/dsh-plan-mode` | `exit_plan_mode` | `ctx.tools`、`ctx.systemPrompt`、`ctx.userQuestions (execution time, opportunistic)` | `tool/call`、`plan/mode inactive on an approved review`、`tool/result` | - | 规划未激活时，exit_plan_mode 仍保留在面向模型的 schema 中，这样状态转换不会在规划策略变更之外额外造成工具目录变动。其执行路径会拒绝规划模式之外的调用；在规划模式下，它通过用户交互 seam 提交计划（批准／根据反馈继续规划），批准后会在步骤边界记录规划模式已停用。 |
| `@deepseek-ai/dsh-tool-bash` | `bash` | `ctx.tools`、`ctx.shell`、`ctx.systemPrompt`、`ctx.shellEnv`、`ctx.jobs at call time for run_in_background` | `tool/call`、`tool/result` | - | bash 工具是 bash 执行器 seam 面向模型的消费方。使用 `run_in_background` 的运行会注册到通用 `ctx.jobs` 运行时，并通过 `job_*` 工具（来自 `@deepseek-ai/dsh-tool-jobs`）收集／停止；禁用 `enableRunInBackground` 配置（默认为 true）后，该参数会被完全移除。 |
| `@deepseek-ai/dsh-tool-pwsh` | `pwsh` | `ctx.tools`、`ctx.shell`、`ctx.systemPrompt`、`ctx.shellEnv`、`ctx.jobs at call time for run_in_background` | `tool/call`、`tool/result` | - | pwsh 工具是 Windows 组合中 bash 执行器 seam 的 PowerShell 方言消费方（由 `@deepseek-ai/dsh-pwsh-local` 等 PowerShell 执行器为 `ctx.shell` 提供后端）；除沙箱接口外，它逐项对应 bash 工具调用。使用 `run_in_background` 的运行会注册到通用 `ctx.jobs` 运行时，并通过 `job_*` 工具收集／停止；托管的 `DSH_*` 环境来自 `@deepseek-ai/dsh-shell-env`。每次调用都在新进程中运行，不使用持久 PTY 会话。路径采用原生 `C:\...` 形式，变量采用 `$env:NAME`。 |
| `@deepseek-ai/dsh-tool-cordis` | `cordis_define`、`cordis_inspect_list`、`cordis_inspect_query`、`cordis_inspect_self`、`cordis_run`、`cordis_stop`、`cordis_undefine` | `ctx.tools`、`ctx.dynamicCordisRunner` | `tool/call`、`tool/result`、`process-local dynamic package lifecycle` | - | 不在任何随产品发布的树中，需要显式选择启用；动态 Package 代码可以访问真实运行时，见 .agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md。该工具集注入 `@deepseek-ai/dsh-cordis-host-runner` 提供的 `ctx.dynamicCordisRunner`，后者拥有定义注册表和 vm 沙箱；组合缺少它时这些工具不会激活。运行中的 Package 在停止、undefine 或 DSH 重启前可以注册**额外的**模型可见工具；发生这类工具集变化时，系统会记录完整且有变动的请求头。 |
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
| `@deepseek-ai/dsh-experimental-tool-agent-team` | `followup_task`、`interrupt_agent`、`list_agents`、`send_message`、`spawn_teammate`、`team_task_create`、`team_task_get`、`team_task_list`、`team_task_update`、`wait_agent` | `ctx.tools`、`ctx.systemPrompt`、`ctx.agentTeams`、`an exact live Team member Agent` | `tool/call`、`team/member`、`team/message/queued`、`team/message/delivered`、`team/task`、`tool/result` | - | 这 10 个工具限定于隐式 Team Lead 与持久 teammate 作用域。随产品发布的 dsh-base bundle 默认禁用该包；文档中的 Agent Teams profile patch 会启用它，并禁用旧 continuable child 的同名控制工具。 |
| `@deepseek-ai/dsh-tool-todo` | `todo_write` | `ctx.tools`、`owning Agent session` | `tool/call`、`todo/write`、`tool/result` | - | todo_write 是会话所有的状态；UI 将最新的 todo/write 事件渲染为检查清单。`allowParallelInProgress` 是没有默认值的必填项，因此本目录明确选择 `true`，对应描述允许同时存在多个 `in_progress` 项。选择 `false` 的部署会获得同一工具，但描述会要求只能有 1 个活动任务。 |
| `@deepseek-ai/dsh-methodology` | `triz` | `ctx.tools`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | triz 在无参数时列出 40 条发明原理与 39 个工程参数，并在给定 improving/worsening 参数对时读取对应的 39×39 矛盾矩阵单元格；registerSection（默认 true）只切换常驻的 tool:triz 提示词区段。 |
| `@deepseek-ai/dsh-tool-literature` | `paper_download`、`paper_list_sources`、`paper_search` | `ctx.tools` | `tool/call`、`tool/result` | - | paper_list_sources 与 paper_search 是对四个免 key 公开源（arXiv、OpenAlex、Semantic Scholar、Crossref）的无状态查询；连接器开关属于配置，只会收窄可用的 `db` id。paper_download 直链优先下载论文 PDF，直链失败时走 browser-use 兜底。 |
| `@deepseek-ai/dsh-document-deliver` | `document_deliver` | `ctx.tools`、`ctx.fs` | `tool/call`、`tool/result` | - | document_deliver 把交付文件（path + format）、P0/P1 质量门状态与 brief 引用记录进会话日志；文件缺失即报错，工具本身不写任何文件。交付工作室把该调用折叠进交付物清单与质量门徽标。 |
| `@deepseek-ai/dsh-patent-teams` | `patent_teams_add_member`, `patent_teams_claim_task`, `patent_teams_create`, `patent_teams_create_task`, `patent_teams_delete`, `patent_teams_reassign_task`, `patent_teams_remove_member`, `patent_teams_send_message`, `patent_teams_status`, `patent_teams_update_task` | `ctx.tools`, `ctx.subagents`, `ctx.systemPrompt`, `a calling Agent as captain (member spawn/follow-up)` | `tool/call`, `tool/result`, `patent-teams/* session events` | - | The durable multi-agent team service for the patent domain: create a team (you become captain), add continuable subagent members by role, break the goal into dependency-aware tasks, and let the shared-task scheduler wake idle members. Member spawn and messaging use the captain as the direct parent, so a team survives harness restarts. |
| `@deepseek-ai/dsh-patent-tools` | `add_patent_figure_references`、`analyze_patent_figure`、`claim_chart_build`、`draft_claims`、`draft_specification`、`evaluate_evidence`、`flexible_plan`、`generate_patent_figure`、`knowledge_note_save`、`patent_analysis_report`、`patent_case_search`、`patent_eval`、`patent_kg_query`、`patent_legal_status`、`patent_metadata`、`patent_pdf_download`、`patent_plan_task`、`patent_search`、`patent_wiki_search`、`patent_worker_validate`、`patent_workflow`、`patent_workflow_run`、`recognize_chemical_structure`、`rule_check`、`search_patent_figure`、`validate_specification` | `ctx.tools` | `tool/call`、`tool/result` | - | Sati 专利领域工具集：检索/元数据/法律状态/判例/wiki/知识图谱查询，权利要求对照表、撰写、分析报告、说明书校验、证据判定、规则检查、附图分析、PDF 下载、化学结构识别、知识笔记，以及工作流/计划状态机。render_patent_document 由 @deepseek-ai/dsh-patent-document 提供。 |
| `@deepseek-ai/dsh-patent-document` | `render_patent_document` | `ctx.tools`、`ctx.subprocess` | `tool/call`、`tool/result` | - | render_patent_document 从内置 HTML 模板渲染专利交付物（权利要求书/说明书/检索报告/OA 答复/无效意见），可选通过 ctx.subprocess 调用无头 Chrome 生成 PDF。 |
| `@deepseek-ai/dsh-tool-workflow` | `workflow` | `ctx.tools`、`ctx.workflowEngine`、`ctx.systemPrompt`、`a calling Agent (exec.agent parents the script children)` | `tool/call`、`tool/result` | - | - |
| `@deepseek-ai/dsh-tool-web` | `web_fetch`、`web_search` | `ctx.tools`、`ctx.web`、`ctx.systemPrompt` | `tool/call`、`tool/result` | - | web_search 和 web_fetch 将提供方选择置于 ctx.web 之后，使模型可见 schema 在更换后端时保持稳定。 |

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

执行 bash 命令（`bash -c`）并返回 stdout/stderr。每次调用都在新 shell 中运行：调用之间不保留任何状态（cwd、变量、函数），请传入 `workdir`，不要使用 `cd`。非零退出会报告为 `[exit code: N]`。当前 harness 环境信息通过托管的 `$DSH_*` 变量公开，需要时请检查这些变量。命令可能在文件沙箱中运行；被阻止的文件操作报告为 `[sandbox: file access denied under <mode> mode]`，这是策略拒绝，而不是命令缺陷，请勿换一种方式重试。较长的输出会截断，只保留尾部；如可用，完整输出会保存到文件并报告其路径。对于长时间运行的命令，请设置 `run_in_background: true`：调用会立即返回 job id；使用 `job_output` 读取输出，使用 `job_kill` 停止任务。

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
      "description": "Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry."
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

bash 工具是 bash 执行器 seam 面向模型的消费方。使用 `run_in_background` 的运行会注册到通用 `ctx.jobs` 运行时，并通过 `job_*` 工具（来自 `@deepseek-ai/dsh-tool-jobs`）收集／停止；禁用 `enableRunInBackground` 配置（默认为 true）后，该参数会被完全移除。

<a id="deepseek-aidsh-tool-pwsh"></a>

## `@deepseek-ai/dsh-tool-pwsh`

### `pwsh`

执行 PowerShell 命令（`pwsh -Command`）并返回 stdout/stderr。每次调用都在新的 pwsh 进程中运行：调用之间不保留任何状态（cwd、变量、函数），请传入 `workdir`，不要使用 `cd`。路径采用 Windows 原生形式（`C:\...`）；使用 `$env:NAME` 读取环境变量。非零退出会报告为 `[exit code: N]`。当前 harness 环境信息通过托管的 `$env:DSH_*` 变量公开，需要时请检查这些变量。命令可能在文件沙箱中运行；被阻止的文件操作报告为 `[sandbox: file access denied under <mode> mode]`，这是策略拒绝，而不是命令缺陷，请勿换一种方式重试。较长的输出会截断，只保留尾部；如可用，完整输出会保存到文件并报告其路径。在 Windows 上，被强制终止的命令会以 `[exit code: 1]` 结算且不带信号标记，请将其视为中断，而不是命令失败。对于长时间运行的命令，请设置 `run_in_background: true`：调用会立即返回 job id；使用 `job_output` 读取输出，使用 `job_kill` 停止任务。

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
      "description": "Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry."
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

### `cordis_define`

定义一个不可变的 Cordis Package。新建 Plugin 时使用 kind:"new"，只提供 3 至 6 位小写英文字母组成的语义前缀；Host 返回最终 pluginId 和 packageId。修改现有 Plugin 时使用 kind:"existing" 并传入精确 pluginId，以追加 Package 而不覆盖旧版本。code.host 与 code.client 至少提供一个；每个值都是返回 Cordis Plugin 的 plain JavaScript 函数体，不经过 TypeScript、JSX 或 import 转换。依赖 Service、Event、Builtin、Slot 或 token 前先查询 Inspect。Define 只校验参数和语法并记录源码，不申请审批、不执行 apply，也不改变 currentPackageId。成功后用返回的 ID 调用 cordis_run。

```json
{
  "type": "object",
  "properties": {
    "plugin": {
      "oneOf": [
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "const": "new"
            },
            "idPrefix": {
              "type": "string",
              "description": "Suggested semantic prefix of 3–6 lowercase English letters; the Host adds a unique numeric suffix."
            }
          },
          "required": [
            "kind",
            "idPrefix"
          ]
        },
        {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "kind": {
              "type": "string",
              "const": "existing"
            },
            "pluginId": {
              "type": "string",
              "description": "Exact ID of an existing Plugin; the new Package is appended to that instance."
            }
          },
          "required": [
            "kind",
            "pluginId"
          ]
        }
      ]
    },
    "name": {
      "type": "string",
      "description": "Short, readable Package name."
    },
    "purpose": {
      "type": "string",
      "description": "One-sentence, user-facing description of the Package purpose."
    },
    "code": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "host": {
          "type": "string",
          "description": "Plain JavaScript function body that returns the Host-half Cordis Plugin."
        },
        "client": {
          "type": "string",
          "description": "Plain JavaScript function body that returns the browser Client-half Cordis Plugin."
        }
      }
    }
  },
  "required": [
    "plugin",
    "name",
    "purpose",
    "code"
  ]
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

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

执行 Inspect Provider 显式声明的只读查询。platform、provider 和 method 必须来自 cordis_inspect_list，input 必须符合该方法的 schema。在 cordis_define 前用本 Tool 读取精确 Service 方法、Event mode、Builtin 签名、Tool schema、主题 token，或实时 Slot 树及 props。Host 查询在本地执行；Client 查询等待首个有效页面响应，在页面回答或 Tool 被取消前保持 pending。本 Tool 不能调用业务 Service 方法或修改运行时。查询 Service.listService 和 Event.listEvents 时，先不传 input 浏览紧凑签名目录，再查询精确 service 或 event 获取结构化约定和引用类型。查询 Slots.listSubTree 时，先不传 root 浏览紧凑树，再查询精确 root 获取完整注册约定和 props。

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

### `cordis_inspect_self`

按逐层增加的详细程度检查当前 Session 拥有的动态 Cordis 对象。不传 ID 时只列 Plugin 摘要；只传 pluginId 时返回版本指针、最新 Run 和全部 Package 摘要；只有同时传 pluginId 与 packageId 才返回该不可变 Package 的 Host/Client 源码和运行诊断。packageId 不能单独传入。处理 @pluginId、修复异步失败或定义更新版本前，先查询精确 Package。本 Tool 只读，不执行代码，也不改变版本指针。

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable Plugin ID returned by cordis_define or injected by @pluginId; omit it to list every current Plugin."
    },
    "packageId": {
      "type": "string",
      "description": "Exact immutable Package ID owned by pluginId; when specified, source and diagnostics are returned."
    }
  }
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_run`

激活动态 Plugin 的一个精确 Package。首次激活、重启 currentPackageId 或回退使用 mode:"run"；已有 current 时，即使 Plugin 当前已停止，切换到其他 Package 也使用 mode:"update"。未授权的 Client Package 创建审批请求并返回 awaiting-approval；已授权的 Package 返回 starting，并在浏览器中异步继续。两种结果都不会在 Tool 内等待最终结局。currentPackageId 只在完整成功后改变；失败时保留旧 current 和目标 next。异步成功、拒绝或技术失败通过状态与 steering 报告。技术失败后，用 cordis_inspect_self 读取诊断，修正同一 Plugin 并自主重试。用户拒绝后不要再次申请审批。

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable Plugin ID returned by cordis_define."
    },
    "packageId": {
      "type": "string",
      "description": "Exact immutable Package ID to activate under that Plugin."
    },
    "mode": {
      "type": "string",
      "description": "Use run for the first activation, restarting current, or rollback; use update to switch from current to a different Package.",
      "enum": [
        "run",
        "update"
      ]
    }
  },
  "required": [
    "pluginId",
    "packageId",
    "mode"
  ]
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_stop`

停止动态 Plugin 的当前 Run，并取消尚未完成的审批或激活请求。保留 Plugin、全部不可变 Package、授权、currentPackageId 和 nextPackageId，以便之后直接运行或更新。停止已处于停止状态的 Plugin 会幂等成功。临时禁用副作用使用本 Tool；永久移除使用 cordis_undefine。

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable dynamic Plugin ID to stop."
    }
  },
  "required": [
    "pluginId"
  ]
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

### `cordis_undefine`

永久移除当前 Session 拥有的动态 Plugin。如果它正在运行或等待审批，先停止并取消请求，再删除全部 Package、授权和版本指针。返回后，其 pluginId、packageIds、@ 引用和 Package 业务视图均失效；历史卡片只保留“Plugin 已移除”记录。需要保留版本以便重启或回退时不要调用本 Tool，应改用 cordis_stop。

```json
{
  "type": "object",
  "properties": {
    "pluginId": {
      "type": "string",
      "description": "Stable dynamic Plugin ID to remove permanently."
    }
  },
  "required": [
    "pluginId"
  ]
}
```

来源：[`packages/extensions/tool-cordis/src/index.ts`](../packages/extensions/tool-cordis/src/index.ts)

不在任何随产品发布的树中，需要显式选择启用；动态 Package 代码可以访问真实运行时，见 .agents/notes/implemented/feature/2026-07-08-self-referential-cordis-toolset.md。该工具集注入 `@deepseek-ai/dsh-cordis-host-runner` 提供的 `ctx.dynamicCordisRunner`，后者拥有定义注册表和 vm 沙箱；组合缺少它时这些工具不会激活。运行中的 Package 在停止、undefine 或 DSH 重启前可以注册**额外的**模型可见工具；发生这类工具集变化时，系统会记录完整且有变动的请求头。

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

<a id="deepseek-aidsh-tool-session-query"></a> /tmp/master-tool-catalog.zh.md

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

根据 agent id 请求取消后台 agent 的当前轮次。目标可以是你的直接子级，也可以是在你下方创建的更深层 agent。只有当前轮次会停止：已经排队发给该 agent 的消息会一直搁置到后续的 send_message；它启动的 agent 会继续运行；该 agent 本身仍可接受后续操作。停止请求被接受后，此调用立即返回，因此目标可能还会短暂运行；中断一个已经完成的 agent 是可接受的空操作。

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

按持久 id 和标签列出你的可继续后台 subagent。用它回忆你启动过哪些 subagent，而不是轮询完成情况——subagent 完成时你会被告知。状态来自实时注册表：running 表示 agent 此刻正在工作；idle 表示已加载但处于轮次之间，可能正在等待它启动的 agent；ready 表示它只存在于存储中——可恢复而非终态，也不表示有结果等待收集；`send_message` 会在运行中 child 的最近 step 边界 steer 消息，或为 idle、ready child 启动轮次，且无论处于哪种状态，直接子级都仍可作为 `send_message` 的目标。该快照并非投递承诺；`send_message` 会执行权威检查，仍可能失败。无法读取的子级会作为诊断信息报告，而不会被静默丢弃。`descendants` 作用域会按稳定的前序顺序遍历你下方的整棵树，并为每个条目标注其持久的直接父会话 id 和深度。只有深度为 1 的条目可以使用 `send_message`；更深的条目只能作为 `interrupt_agent` 的候选目标。

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

根据 agent id 向直接可继续 child 发送消息。如果你是驻留的可继续 child，也可以把自己的直接 parent 作为目标。如果目标仍在工作，消息会 steer 其最近的 step；如果目标处于 idle，消息会启动一个轮次。此调用不会返回该 agent 的答案，只会确认消息已投递。调用失败表示消息**未**投递。

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

这些是控制可继续后台 subagent 的全局命名工具：绑定提供方的 `tool-subagent` 实例注册不同的委派工具；本包注册一次 `send_message` 和 `interrupt_agent`，另由 `list_agents` 通过单独加载的 `/list-agents` 插件提供，其目录行使用 sessionProjections 和实时 Agent 注册表。

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

### `followup_task`

向另一名 Team member 发送持久 follow-up task，并在需要时启动一个 turn。

```json
{
  "type": "object",
  "properties": {
    "target": {
      "type": "string",
      "description": "Team member name, or lead."
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

### `interrupt_agent`

中断一名 teammate 的当前 turn，同时保留其待处理 inbox。仅 Team Lead 可用。

```json
{
  "type": "object",
  "properties": {
    "target": {
      "type": "string",
      "description": "Teammate name."
    }
  },
  "required": [
    "target"
  ]
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `list_agents`

列出 Lead 与所有持久 teammate，以及各自当前的运行时状态。

```json
{
  "type": "object",
  "properties": {}
}
```

来源：[`packages/experimental/tool-agent-team/src/index.ts`](../packages/experimental/tool-agent-team/src/index.ts)

### `send_message`

向另一名 Team member 发送持久信息，但不启动 idle member。

```json
{
  "type": "object",
  "properties": {
    "target": {
      "type": "string",
      "description": "Team member name, or lead."
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
      "description": "Optional member-name filter; use unowned for tasks without an owner."
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
      "description": "Member name for Lead-only reassign; omit to unassign."
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

这 10 个工具限定于隐式 Team Lead 与持久 teammate 作用域。随产品发布的 dsh-base bundle 默认禁用该包；文档中的 Agent Teams profile patch 会启用它，并禁用旧 continuable child 的同名控制工具。


<a id="deepseek-aidsh-tool-todo"></a>

## `@deepseek-ai/dsh-tool-todo`

### `todo_write`

记录并更新当前工作的结构化任务列表。每次调用都要发送**完整列表**，它会**替换**之前的列表，不支持局部更新或逐项编辑。请用它规划多步骤工作并展示进度：开始前为每个具体步骤添加一项 todo。将当前正在处理的每项 todo 标记为 `in_progress`；确实并行运行时（例如并发 subagent 或后台命令）可同时标记多项，顺序工作则标记 1 项。只要工作尚未完成，就应至少有一项任务为 `in_progress`。某项 todo 完成后立即标记为 `completed`，不要批量标记完成；只有全部工作完成后，才可以没有 `in_progress` 项。简单的单步骤任务无需使用列表。状态：`pending`（未开始）、`in_progress`（正在处理）、`completed`（已完成）。

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

<a id="deepseek-aidsh-document-deliver"></a>

## `@deepseek-ai/dsh-document-deliver`

### `document_deliver`

登记一份文档交付物：声明成品文件、导出格式与质量门结果（P0/P1 自检项）。质量门通过后、向用户交付前调用一次；文件必须在工作区中存在。调用会写入会话日志，交付物面板据此展示文件与质量门状态。

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

分析专利说明书附图：识别附图类型（结构图/流程图/电路图/方框图/示意图/分解图/剖视图）、提取组件与连接关系、核对附图标记并生成专利格式的附图说明文字。当用户提供附图图片并要求撰写附图说明、理解附图内容、核对附图标记一致性时使用。可传入权利要求或技术方案文本作为上下文提升识别准确率。

当前为文本态最小路径：图片多模态分析引擎尚未接入，分析基于附图编号与权利要求/技术方案上下文推断，结果置信度与可用性相应降低。


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

构建权利要求对照表（claim chart）：把权利要求拆分为编号要素，逐要素映射到对比文件或产品证据（每行 pin-cite 引用），并输出 gap list（证据薄弱的要素）。适用于撰写（可专利性布局）、OA 答复、无效/复审、侵权比对等场景。


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
            "description": "Atom name to auto-execute this stage (e.g. extract)."
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
          "description": "Atom name to auto-execute this stage (e.g. extract)."
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

生成专利风格附图：流程图（方法步骤）、系统框图（组件+连接）、组件层级图、内置模板或原始 DOT，输出 SVG/PNG/PDF 到工作区 patent/figures/，返回参考标号映射表与「图N是…；图中：…」格式的附图说明文字。撰写权利要求/说明书需要配图时使用。

标号体系：每图独立 100 系列（FIG.1=100-199、FIG.2=200-299，默认步进 2，可调）；同一组件跨图出现时用 numerals 显式传入沿用同号，或声明 figure_family 自动续号（同名组件沿用既有标号、新组件取空闲号；缺省每图独立编号）。

图型推断：figure_type 缺省时从唯一结构输入推断（steps→流程图、blocks→框图、tree→层级图、dot→原始 DOT、template→模板）；同时提供多个结构输入或全空时须显式指定 figure_type。

多面板：panels 一次生成 FIG.1A/1B 等多张面板（每面板独立文件 figN+后缀，如 A → fig1A.svg），全部面板组件共享一条连续标号系列，附图说明合并输出。

色彩策略：默认 grayscale（黑白线条，符合《专利审查指南》第一部分第一章 4.3「附图一般使用墨色墨水绘制」）；semantic 模式允许按块类型填充颜色，仅当色彩承载技术内容时使用。

引线标号：框图/层级图 SVG 默认以「数字+引线指向部件」标注（leader_lines 可关闭），流程图默认保留步骤内嵌 NNN. 前缀；非 SVG 格式不支持引线，返回警告并保持内嵌标号。

本机未安装 Graphviz 时返回 setup_required 与安装引导。

```json
{
  "type": "object",
  "properties": {
    "figure_type": {
      "type": "string",
      "description": "图型；缺省时从唯一结构输入推断（steps→flowchart、blocks→block_diagram、tree→component_hierarchy、dot→raw_dot、template→template），多输入或无输入须显式指定",
      "enum": [
        "flowchart",
        "block_diagram",
        "component_hierarchy",
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
      "description": "原始 Graphviz DOT（figure_type=raw_dot）"
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
            "description": "面板原始 DOT"
          },
          "numerals": {
            "type": "object",
            "description": "面板显式标号（组件 id → 标号；优先于顶层 numerals）",
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
      "description": "显式标号（组件 id → 标号；跨图同件同号续接）",
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
    "persist_index": {
      "type": "boolean",
      "description": "默认 true：写入附图索引（供 search_patent_figure 检索）"
    }
  }
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
- 自动校验并归一化专利号
- 用于专利尽职调查、在先技术详情查询、法律状态核查

使用说明：
  - 只读；每篇专利发起一次网络请求
  - 未找到（专利不存在）以 success:false 的数据返回，而非错误
  - 页面结构变化时的非致命解析告警通过 parseWarnings 返回

```json
{
  "type": "object",
  "properties": {
    "patent": {
      "type": "string",
      "description": "Patent number, e.g. 'US11452699B2'. Validated and normalized (uppercase, no spaces)."
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
      "description": "整体执行超时（毫秒），默认 180000，上限 300000"
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
  - 网络失败以错误报告；真正的零结果检索返回空命中并附 warnings

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
      "description": "检索关键词（卡片标题/概念/领域子串匹配；空串 = 按目录列出全部卡片）"
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

运行声明式专利工作流（recap 模式）：校验 manifest，把各阶段输出组装为带降级标记与摘要的结构化结果，并持久化记录。内置 manifest：patent_novelty_v1、patent_disclosure_v1、patent_inventiveness_v1、patent_patentability_v1、patent_oa_response_v1、patent_invalidation_v1、patent_infringement_v1。按阶段 id 提供 outputs；缺失阶段标记为降级。不调用 LLM——本工具只收尾 agent 已产出的文本。用于以单一可验证结果记录收尾多阶段专利分析（新颖性 / 公开充分 / 创造性 / ……）。

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

自动执行声明式专利工作流（原子阶段）或领域图。Manifest 路径：patent_disclosure_v1（PFE 抽取 → 在先技术检索 → 逐特征新颖性 → 复核门 → 权利要求草稿）及其他内置 manifest。图路径（graph=novelty|inventiveness|enablement|citation-check）：一次调用运行完整领域图（LLM 节点 + 专利检索 + 确定性规则门）；citation-check 为确定性纯函数图，校验结论文本（inventiveness_conclusion/novelty_report/text）中的每个 `D<id>`/专利号引用均出现在 priorArt（以 JSON 数组传入）中。以 input 字段提供输入。复核门会暂停运行；再次调用时以 resumeCheckpointId（图路径）或 approveStageIds（manifest 路径）继续。提供 caseId 时，运行结果、Mermaid 图与图检查点持久化于 `<caseDir>/workflow-runs/`。需要模型端口。

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

当前环境未安装 RDKit（可选原生依赖），本工具暂不可用，调用将返回 needHumanReview=true 的不可用结果。


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

对给定文本运行确定性成文规则检查（关键词黑名单 / 模式 / 结构 / 引用范围 / 同义词匹配），返回带严重级别、处置建议与法条依据的违规项。在发布合规敏感输出（如专利结论、法律意见）前使用。范围：patent（通用专利合规）、patent-electrical（H 部电学规则 + 通用合规）、patent-full（通用合规 + nuo 完整专利规则集，需激活评审）、pack（由项目 manifest .sati/rules.yaml 组装的分层规则包：base + domains + overrides）。

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
      "description": "Rule set scope. Defaults to 'patent' (bundled patent compliance rules). 'pack' loads the layered rule pack declared by .sati/rules.yaml."
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
      "description": "检索关键词（技术特征/部件名/附图标记；空串 = 按附图编号列出全部已分析附图）"
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
- 效果数据定量性、化学领域产物表征数据（tech_domain=chemical 时）

用法：说明书初稿完成后调用；传入 text（说明书全文）即可，另可传 title / abstract / claims / tech_domain / figure_analysis 启用相应校验。

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
    }
  }
}
```

来源：[`packages/patent/patent-tools/src/index.ts`](../packages/patent/patent-tools/src/index.ts)

Sati 专利领域工具集：检索/元数据/法律状态/判例/wiki/知识图谱查询，权利要求对照表、撰写、分析报告、说明书校验、证据判定、规则检查、附图分析、PDF 下载、化学结构识别、知识笔记，以及工作流/计划状态机。render_patent_document 由 @deepseek-ai/dsh-patent-document 提供。

<a id="deepseek-aidsh-patent-document"></a>

## `@deepseek-ai/dsh-patent-document`

### `render_patent_document`

从内置的中文 HTML 模板把专利代理交付物（可专利性意见、检索报告、OA 答复、权利要求对照表或无效意见）渲染为磁盘文件。选择模板 id 与 outputName；以 id → innerHTML 记录的形式传入 sections 填充模板插槽。写出 HTML 文件，默认还通过无头 Chrome 生成 PDF（format：html、pdf 或 both，默认 both）。返回写入的文件路径及任何告警或 PDF 失败原因（PDF 失败时 HTML 仍存在）。

```json
{
  "type": "object",
  "properties": {
    "template": {
      "type": "string",
      "description": "Template id to render (one of the five shipped patent templates).",
      "enum": [
        "patentability-opinion",
        "search-report",
        "oa-response",
        "claims-spec",
        "invalidation-opinion"
      ]
    },
    "outputName": {
      "type": "string",
      "description": "Output filename stem (no extension); only letters, digits, underscore, hyphen, and dot."
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

<a id="deepseek-aidsh-tool-workflow"></a> /tmp/master-tool-catalog.zh.md

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
      "description": "Role of the member (e.g. case-manager, researcher, drafter, technical-expert, adversarial-reviewer, applicant-counsel, formal-examiner, invalidity-petitioner, patentee-defender, adjudicator, defendant-counsel, tech-investigator)."
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
      "description": "Member to claim for (captain only; defaults to the task's assignee)."
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
      "description": "Optional member name this task is intended for."
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
      "description": "New status (in_progress, completed, failed, cancelled).",
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

约束：并发上限和 agent 总数上限均会生效；不提供文件系统、网络、定时器或 Node.js API。具体工作由 agent 完成，脚本只负责编排。该运行在前台执行：整个脚本完成后，调用才会返回。

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
    }
  },
  "required": [
    "script",
    "meta"
  ]
}
```

来源：[`packages/workflow/tool-workflow/src/index.ts`](../packages/workflow/tool-workflow/src/index.ts)

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
