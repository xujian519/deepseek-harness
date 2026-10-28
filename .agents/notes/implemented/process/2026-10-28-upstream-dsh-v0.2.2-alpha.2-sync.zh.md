# Agent Note: upstream v0.2.2-alpha.2 sync

Status: implemented

[English](2026-10-28-upstream-dsh-v0.2.2-alpha.2-sync.md) | 中文

## 问题

fork 从上游 `dsh-v0.2.1-rc.3` 标签升到 `dsh-v0.2.2-alpha.2`。该版本带来了工具执行层的重构，fork 的插件、测试夹具和生成目录都建立在其上：工具执行器成为可挂载的接缝（`dsh-tool-executor-native`、`dsh-tool-executor-ptc`），`ctx.tools.execute` 取代了逐次调用分发，共享测试套件新增 `executeToolFixture`。它还让 `exit_plan_mode` 按需披露、给 SDK 增加桌面工具行，并带来新的录制场景（SDK `ptc-turn`／`ptc-cancel`、headless `ptc-python-read-only`、`pi-ai-malformed-tool-arguments`）。

本次合并读到 127 个冲突文件。逐文件解决后，只有在执行器接缝被一致应用之后代码树才能通过类型检查——任何挂载 `ToolRuntime` 却不挂执行器的组合都会在运行时失败，而通过旧夹具派发工具的用例则失去夹具。之后无密钥快照层报告 36 个失败，分布在过期的期望输出、上游新场景，以及刷新路径里两处真正的归一步骤缺陷之间。

## 决策

- **执行器接缝在所有位置被遵循。** `packages/core/tools` 移除内联分发辅助，`agent-loop` 改为调用 `ctx.tools.execute`，所有进程内组合都挂载一个执行器。76 个用例文件改用 `executeToolFixture`，21 个包声明 `@deepseek-ai/dsh-tool-testkit`，9 个真实 Loader 组合在 `ToolRuntime` 旁挂载 `NativeToolExecutor`。
- **刷新与回放用同一种方式归一作业 id。** `dsh-session-snapshot` 从整份日志里提取作业 id 词元，但刷新写回是逐条记录归一的；回显 `bash-<16 位十六进制>` 的 `tool/result` 文本因此保留原始 id，而 `job/registered` 保留词元，下一次回放永远无法匹配。`sessionJobIdTokens` 现在一次性推导整份日志的映射，`stabilizeRefreshLog` 把它传入每次单记录比较，使写回与比较一致。
- **新的畸形参数场景固定零抖动重试策略。** `llm/retry.delayMs` 带抖动，上游录制的值永远无法在回放中重现。`pi-ai-malformed-tool-arguments` 新增 `runtime.cordis.yml`，以 `jitterRatio: 0` 重述回放提供方，与 `empty-response-retry` 在组合中固定的确定性一致。
- **SDK 的 PTC 场景不再插入基础包已拥有的行。** `dsh-base` 已挂载 `ptc-runtime`；该版本的 `ptc-turn`／`ptc-cancel` 运行时补丁又插入同 id 的第二行，Loader 会拒绝。两个补丁现在只携带各自的附加行。
- **`snapshots/session/ptc-python-read-only` 保持删除。** [v0.2.1-alpha.2 同步决策](2026-10-10-upstream-dsh-v0.2.1-alpha.2-sync.zh.md)保留 fork 拆分的 Python PTC 运行时，并暂不吸收该版本的文件限制能力；这个场景恰好演练该限制。该版本重新加入了它，本次同步再次删除。
- **生成类表面由生成器重建，而不是手工合并。** 配置／工具／持久化／插件目录、模块图、CLI 帮助、cordis API 页面和翻译配对记录来自各自的生成器；11 条 fork 持久化记录补上该版本的 `nodes` 表，`2026-10-28-v022-alpha2-sync` 确认合并后的并集。
- **fork 自有表面按该版本的结构恢复。** patent、self-evolve、desktop、better-sidebar、plugin-market 和 document 各包保持自身行为；其测试改用该版本的执行器与投影挂载顺序。
- **Web 预设不再挂载已退役的 `list-agents` 插件行。** 该版本把 `list_agents` 并入 `tool-subagent-control`，并删掉了该包的 `./list-agents` 子路径导出。patent、legal、document 三个预设仍在挂载那一行，因此挂载任一预设都会在首轮之前失败（`tool-subagent-list-agents ... never started`）。根 `tool-subagent-control` 行已经注册该工具，因此删除这三行。
- **profile 模板只有一个来源。** 上游把 `PROFILE_TEMPLATES` 移到 `@deepseek-ai/dsh-official-bundles`，`dsh plugin` 与产品使用门禁都读它，而 fork 此前在 `app-boot` 里扩展该表。`self-evolve` 模板移入官方表、`app-boot` 改为再导出，所有消费方因此提供同一份 profile 列表，启动器也随之在 `dsh --profile self-evolve` 之外提供 `dsh self-evolve`。
- **subagent descriptor 按该版本的导出位置登记。** 该版本把 `snapshotSubagentDescriptor` 保留在 `@deepseek-ai/dsh-subagent` 的根面上，fork 侧边栏的宿主面从那里导入，因此依赖策略登记的是根导出，而不是已退役的 `/client` 条目。
- **Web 快照层在构建模式下运行，其固定文件跟随合并后的代码树。** `apps/web/tests/**/*.snapshot.ts` 只在 `DSH_EXAMPLE_MODE=lib` 下执行，因此无密钥各层从未覆盖它。它的固定文件以及共享的 `fresh-round-trip` 工具模式固定文件都已过期（缺 `market_*` 工具、`todo_write` 的 tags 与按需披露的 `exit_plan_mode`），且 Synapse 存储在销毁后仍保留一次防抖投影写入，导致场景清理失败。固定文件已刷新，存储在销毁时取消该定时器。
- **fork 的 manifest 与展示元数据与版本对齐。** 50 个 fork manifest 随根 manifest 前进到 `0.2.2-alpha.2`，`SIDEBAR_SERVICE_VERSION` 同步。38 个带配置的 fork 插件补齐 `locale/{en,zh,ja,es,fr,de,ru,pt}.json` 展示元数据与 `./locale/*.json` 导出，这是该版本 locale 元数据门禁对所有带配置包的要求。
- **该版本拆出的拉取请求工作流保持归档。** 上游把 Windows 与 Python 的拉取请求分线移到 `ci-windows.yml` 与 `ci-python.yml`。两者在 fork 上都跑不起来：三个 Windows 作业回落到只有上游组织拥有的 `dsh-windows-2025-16core` 托管标签，会一直排队；CI Python 调用 fork 已归档的可复用 `build-exe-for-python-sdk.yml`，GitHub 在派发时直接拒绝该文件。两者移入 `.github/workflows-disabled/`，与其他归档的上游流水线并列，`scripts/ci-workflow.spec.ts`、`scripts/ci-compatible-selfhosted.spec.ts` 与 `scripts/tests/ci-master-platforms.spec.ts` 改为从归档位置读取。

- **该版本的调度器套件已恢复，该版本未触达的错误路径已固定。** 合并丢失了双方父提交都带有的 `packages/core/agent-loop/tests/tool-calls.spec.ts`；缺少它时 `packages/core/tools/src/batch.ts`、`executor.ts` 与 `agent-loop` 的步骤恢复都没有覆盖，逐文件门禁随之失败。该文件由双方三方合并恢复，并删掉 fork 的双副本调度诊断用例，因为该版本移除了 `TOOL_RUNTIME_SCHEDULER`。另有四条版本路径缺少测试：`forge-github` runner 中 pid 尚未生成时的取消与 Windows 终止分支、`frontend-static` 无 header 的 index 拒绝、创建监听器先摘除 Session 再抛错、Markdown 的 Windows 路径。可达路径补上测试；两条互斥分支（Windows 终止、注入的投影注册表）加上说明原因的 `v8 ignore`。由于该版本新增仅 Windows 的用例，Linux 跳过预算提升到 230。

## 影响

同步分支携带该版本与 fork 的各个表面，无密钥快照层恢复为绿（`pnpm run test:snapshot`：243 通过、2 跳过）。该版本新增的 `pi-ai-malformed-tool-arguments` 场景现在固定确定性的重试延迟，不再因抖动偶发失败。

有三处缺口被明确列出而非就地关闭：

- **五个 fork 独有客户端包仍缺额外的随附语言。** `ui-document-studio`、`ui-patent-teams`、`ui-plugin-catalog`、`ui-todo-board` 与 `better-sidebar` 提供英文与中文字典；`scripts/locale-dictionary-parity.spec.ts` 通过 `PENDING_LOCALE_PACKAGES` 只豁免它们缺失的 `ja`／`es`／`fr`／`de`／`ru`／`pt` 字典，其 en／zh 键对齐与占位符仍受检查。完整翻译是单独的改动。
- **拆分后的 Python PTC 运行时仍缺文件限制。** 把该版本的 sandbox 支持吸收进 `config`／`supervisor` 是另一项改动；在此之前运行时继续拒绝 `sandboxPolicy`，只读场景也继续不进入语料。
- **该版本的 plan-mode 披露改变了请求工具目录。** 固定工具模式的场景现在固定的是「未进入 plan mode 时不包含 `exit_plan_mode`」的目录；其旁车文件已重录，因此固定结果描述的是已发布行为，而不是此前常驻注册的工具。

## 备选方案

- **保留 fork 的内联分发并把该版本的执行器适配到它之上。** 否决：该版本的执行器正是 `agent-loop` 与 PTC 运行时已经在调用的接缝消费方；同时保留两条路径会翻倍分发表面，并让未挂载执行器的组合在运行时处于未定义状态。
- **放宽作业 id 的正则以接受短数字后缀，而不是传递整份日志的词元。** 尝试后否决：`-\d+` 也会匹配 `inspect-client-1` 这类普通标识符，随后被 `redactSessionSnapshotIds` 词元化，破坏四个场景的身份不动点检查。整份日志的映射修掉了真正的缺陷，且不扩大「什么算 id」的范围。
- **在快照归一器里抹掉 `delayMs`。** 否决：延迟是真实的重试策略选择，仓库已有的答案是组合里固定零抖动（`empty-response-retry`）。抹掉该字段会掩盖重试策略本身的回归。
- **针对 fork 的运行时重录该版本的 Python 只读场景。** 否决：录下来的结果会把未受限的工作区写入固化为受支持行为。按上一次同步的决定，在限制能力落地前移除该场景。
- **在本次同步内翻译五个 fork 独有的客户端字典。** 否决：那是不属于合并的产品文案改动，会把「未翻译表面」的决定与版本升级混在一起。

## 测试

`pnpm run typecheck` 通过五个聚合检查（client 与 host 两个编译面）并以 0 退出，`pnpm run lint` 无诊断。`pnpm run test:snapshot` 在 session、SDK、ACP 三条通道回放 243 个无密钥用例，另有 2 个跳过。Web 场景在构建模式（`DSH_EXAMPLE_MODE=lib`）下运行，六个适配器回放 22 个用例，其中 `legal-preset` 能挂载其预设、`subagent-fork-schedule` 读取刷新后的工具模式固定文件。`pnpm run hygiene` 通过全部 24 个门禁，包括该版本的 `constraints`、`verify-product-use`、`verify-package-dependencies` 与 `verify-locale-metadata`。`packages/test-support/session-snapshot` 对 `normalize.ts` 与 `suite.ts` 保持 100% 逐文件覆盖率；其单元用例包含一个在没有整份日志词元时失败的刷新写回用例。受影响的套件（app-boot profile、official bundles、CLI profile 初始化、better-sidebar、subagent、synapse）连同新增覆盖一起通过。`pnpm run test` 覆盖合并后的代码树；此前观察到的两个偶发失败是 `scripts/report-structure.spec.ts` 与 `packages/boot/hmr/tests/watch-config.spec.ts`，二者单独运行均通过。断言拉取请求工作流的四个套件针对归档副本通过（`scripts/ci-workflow.spec.ts` 76 个用例、`scripts/ci-compatible-selfhosted.spec.ts` 7 个、`scripts/tests/ci-master-platforms.spec.ts` 17 个、`scripts/client-build-environment.client.spec.ts` 12 个）。该版本遗留未覆盖的每个文件都通过逐文件覆盖门禁：`tools/src/batch.ts`、`tools/src/executor.ts` 与 `agent-loop/src/agent.ts` 由恢复的调度器套件覆盖，`session/src/index.ts`、`forge-github/src/gh.ts`、`host/frontend-static/src/index.ts`、`subagent/src/list-children.ts` 与 `ui-primitives/src/markdown/windows-path-destinations.ts` 由新增断言覆盖。`verify-test-skips` 记录该版本的 230 个 Linux 跳过。
