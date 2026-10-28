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

## 影响

同步分支携带该版本与 fork 的各个表面，无密钥快照层恢复为绿（`pnpm run test:snapshot`：243 通过、2 跳过）。该版本新增的 `pi-ai-malformed-tool-arguments` 场景现在固定确定性的重试延迟，不再因抖动偶发失败。

有三处缺口被明确列出而非就地关闭：

- **五个 fork 独有客户端包的字典一致性被豁免。** `ui-document-studio`、`ui-patent-teams`、`ui-plugin-catalog`、`ui-todo-board` 和 `better-sidebar` 目前只有英文文案；`scripts/locale-dictionary-parity.spec.ts` 通过显式 `PENDING_LOCALE_PACKAGES` 集合跳过它们的源文件。完整翻译是单独的改动，该豁免仅作用于测试，因此门禁仍覆盖所有已带字典的包。
- **拆分后的 Python PTC 运行时仍缺文件限制。** 把该版本的 sandbox 支持吸收进 `config`／`supervisor` 是另一项改动；在此之前运行时继续拒绝 `sandboxPolicy`，只读场景也继续不进入语料。
- **该版本的 plan-mode 披露改变了请求工具目录。** 固定工具模式的场景现在固定的是「未进入 plan mode 时不包含 `exit_plan_mode`」的目录；其旁车文件已重录，因此固定结果描述的是已发布行为，而不是此前常驻注册的工具。

## 备选方案

- **保留 fork 的内联分发并把该版本的执行器适配到它之上。** 否决：该版本的执行器正是 `agent-loop` 与 PTC 运行时已经在调用的接缝消费方；同时保留两条路径会翻倍分发表面，并让未挂载执行器的组合在运行时处于未定义状态。
- **放宽作业 id 的正则以接受短数字后缀，而不是传递整份日志的词元。** 尝试后否决：`-\d+` 也会匹配 `inspect-client-1` 这类普通标识符，随后被 `redactSessionSnapshotIds` 词元化，破坏四个场景的身份不动点检查。整份日志的映射修掉了真正的缺陷，且不扩大「什么算 id」的范围。
- **在快照归一器里抹掉 `delayMs`。** 否决：延迟是真实的重试策略选择，仓库已有的答案是组合里固定零抖动（`empty-response-retry`）。抹掉该字段会掩盖重试策略本身的回归。
- **针对 fork 的运行时重录该版本的 Python 只读场景。** 否决：录下来的结果会把未受限的工作区写入固化为受支持行为。按上一次同步的决定，在限制能力落地前移除该场景。
- **在本次同步内翻译五个 fork 独有的客户端字典。** 否决：那是不属于合并的产品文案改动，会把「未翻译表面」的决定与版本升级混在一起。

## 测试

`pnpm run typecheck` 通过五个聚合检查（client 与 host 两个编译面）并以 0 退出。`pnpm run test:snapshot` 在 session、SDK、ACP 三条通道回放 243 个无密钥用例，另有 2 个跳过。`packages/test-support/session-snapshot` 在作业词元传递之后对 `normalize.ts` 与 `suite.ts` 保持 100% 逐文件覆盖率，其 370 个单元用例通过。`pnpm run test` 覆盖合并后的代码树；剩余失败是宿主机环境相关的 watcher 用例，它们在高负载下单独运行才能通过，与上一次同步记录的情况一致。
