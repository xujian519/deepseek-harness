# Agent Note: upstream dsh-v0.2.1-rc.3 sync

Status: implemented

[English](2026-10-24-upstream-dsh-v0.2.1-rc.3-sync.md) | 中文

## Problem

fork 从上游的 `dsh-v0.2.1-rc.2` tag 前进到 `dsh-v0.2.1-rc.3`：6 个提交（5 个非合并提交）、640 个文件、+5,682/−1,021 行。merge base 是上一次同步落地的 rc.2 release commit，因此一次 `git merge` 即到达该 tag。合并产生 29 个冲突：6 个位于可执行源码、manifest 或 tsconfig，1 个位于生成的包引用，5 个位于双语 README 记录，6 个位于生成文档，10 个位于预期快照与 web golden，1 个位于 `pnpm-lock.yaml`。

本次发布带有行为变更。`llm-deepseek` 在 DeepSeek API-key 路由上改为跟随官方 `/models` 列表，替代内置表。`ui-entry-customization` 新增一个客户端包，让用户自定义侧栏与会话视图条目，并可从这些条目创建插件。侧栏与会话视图的固定项现在与选中状态分离，并渲染菜单图标；分析事件记录导航条目与预设选择。发布提交把 DSH 家族提升到 `0.2.1-rc.3`。

## Decision

- **本同步分支对 release tag 做 merge-forward。** `sync/upstream-dsh-v0.2.1-rc.3` 从 fork `master` 的 tip 出发并合并 `dsh-v0.2.1-rc.3`；以 first parent 为 `master` 的 merge commit 落地，把上游提交与该 tag 保留在 fork 的提交图中。
- **预设席位采用结构化的 apply 结果，并保留 fork 的拒绝反馈。** `packages/client/ui-agent-preset/src/client/seat-store.ts` 使用上游的 `AgentPresetApplyOutcome`，在没有当前 Session 时返回 `{ kind: 'staged' }`，在 Session 已启动时返回 `{ kind: 'refused', reason: SEAT_PRESET_LOCKED }`，使 chip 继续解释锁定状态，而不是静默丢弃选择。`apply.client.spec.ts` 把“Session 已启动”和“Session 已在运行该预设”拆成两条断言，分别陈述两种结果。
- **bundle 保留两个条目。** `packages/bundle/web-app/package.json` 保留 `@deepseek-ai/dsh-client-ui-document-studio`，并加入 `@deepseek-ai/dsh-client-ui-entry-customization`；`cordis.patch.yml` 注册两者。
- **agent-preset 的 tsconfig 保留两个项目引用。** `packages/client/ui-agent-preset/tsconfig.json` 同时保留上游的 `product-analytics` 引用与 fork 的 `../../util/value` 引用，因为该包同时导入 `@deepseek-ai/dsh-client-product-analytics` 与 `@deepseek-ai/dsh-value`。
- **llm-deepseek manifest 保留 fork 的已排序依赖列表。** `packages/llm/llm-deepseek/package.json` 维持按字母排序的 devDependencies，并在末尾追加上游的 `@types/semver`。
- **tool-lsp manifest 保留 fork 的字面 em dash。** `packages/lsp/tool-lsp/package.json` 保留 fork 的 description，只提升版本号。
- **生成文档重新生成，不做手工合并。** `gen-plugin-packages` 重写技能中的包引用，`gen-config-catalog` 重写中英两份配置目录，`gen-doc-graphs` 重写中英两份模块图与事件生产者/消费者文档。
- **合并后的 README 重新记录双语哈希。** 两侧都带上上游章节后，`verify-translation-pairing --write` 重新记录 `packages/client`、`ui-agent-preset`、`ui-conversation`、`ui-sidebar` 与 `llm-deepseek`。
- **预期 web 快照跟随实际渲染的 tab 行。** 六份浏览器 golden 在测试 profile 挂载的位置列出 fork 的 Board、Deliverables、Teams，随后是上游的 `More conversation views` 按钮。`DSH_SNAPSHOT=refresh` 从运行中的应用重写这些 golden，回放确认一致。
- **版本在 fork 自有面上统一钉住。** 根 manifest、50 份 fork manifest、`SIDEBAR_SERVICE_VERSION` 以及 9 份 ACP `agentInfo.version` golden 一并前进到 `0.2.1-rc.3`。`scripts/release/verify.ts --family dsh` 在该版本下解析出 394 个家族成员，无未排序的 peer 声明。
- **rescope 门禁登记新的预设 id 位置。** `scripts/rescope-vendor.ts` 列出 rc.3 中 7 个把 `'cordis'` 用作 agent-preset id 的文件，与既有同 id 的跳过记录一致。
- **导出 JSDoc 基线清零。** 6 个法律与专利文件补齐缺失的 `@param`、`@returns`、属性与返回类型注解。同步前门禁报告 33 处缺项，同步前的 `master` 为 47 处；`doc-sync` 现在 51 项全部通过。
- **Synapse 开关跟随新的 tab 行 DOM，并避开右侧栏。** `ui-conversation` 用 `data-conversation-tab-row` 标记完整行；synapse 插件锚定该行，在两帧之间重建时重试，并在没有 tab 行的空白 Session 上停在会话头部下方。此前的窗口角落回退位置会盖住右侧栏的文件打开控件。
- **新的 entry-customization e2e 去掉重复的目录选择器 overlay。** `launchWebScaffold` 已经固定应用内目录选择器；再叠加 `pin-browse-picker.overlay.yml` 会重复相同的 insert 行，fork 的 loader 会以重复 entry id 拒绝。
- **陈旧的 blank-cache golden 改为记录归一化后的 workspace 标题。** `snapshots/web/workspace-management/new-session.expected.md` 现在使用 `{{workspace}}`，即 `captureStableAria` 从 scaffold 目录生成的 token；此前的字面量无法由该场景复现。

## Consequences

fork 带着 rc.3 的行为发布——API-key 路由上的官方 DeepSeek 模型列表、导航条目自定义、导航固定项分离，以及新的分析事件——同时专利、self-evolve、桌面、better-sidebar、法律与 document 各面保持原有行为。合并后的树相对同步前 `master` 改动 719 个文件：640 个上游文件、fork 版本固定点、重新生成的文档、刷新的 web golden，以及 JSDoc 补全。

预设席位的返回类型现在是带标签的结果。Settings 等调用方通过 `outcome.kind === 'refused'` 读取拒绝；已启动的 Session 仍产生 `session-already-started` 标记并由各界面翻译，Session 已在运行该预设时仍为静默的 `unchanged`。

新包 `ui-entry-customization` 属于 Web bundle 与生成的包引用。它的 hooks 与分析接线导入 `@deepseek-ai/dsh-client-product-analytics`，agent-preset 包也引用同一包。重新生成模块图时也补上了同步前图中缺失的 `packages/legal` 分组及其 `tools` 连线。

## Alternatives considered

- **整体采用上游的 `seat-store.ts`。** 否决：上游把已启动的 Session 归入 `unchanged`，会丢掉 fork 的本地化拒绝标记，使 chip 看起来像没有响应。
- **浏览器 golden 只保留上游的 `Deliverables` tab。** 否决：fork 的 bundle 会挂载 Board、Deliverables 与 Teams，记录行必须与实际 tab 条一致。
- **手工合并生成的目录与图文档。** 否决：节点列表、计数与章节哈希都由源码推导，生成器是唯一可靠的解决方式。
- **把既有的 JSDoc 缺项留在同步之外。** 否决：`doc-sync` 是本仓库的完成门禁，而这些缺失标签描述的是既有契约，不改变行为。
- **重命名新位置上的 `cordis` 预设 id。** 否决：它是产品数据，rescope 门禁已为旧位置保留相同跳过记录。

## Testing

`pnpm run typecheck` 通过全部五项门禁——Host Typert、host 与 client 编译器，以及两个 aggregate。`pnpm run build:artifacts` 通过 7/7 门禁，`pnpm run build:check` 在构建产物上通过两个 aggregate 检查。`pnpm run lint` 在 7,344 个文件上报告 0 警告、0 错误。`pnpm run hygiene` 通过 22/22 门禁，`pnpm run doc-sync` 通过 51/51。

完整单元测试套件运行 2,863 个文件、55,677 个测试：55,454 通过、219 跳过、1 个预期失败。三个无关测试在并行负载下失败：`scripts/persistence-schema.spec.ts` 与 `packages/api/workspace-files/tests/changes.spec.ts` 重跑通过，`packages/util/http-proxy/tests/install.spec.ts` 仍因 `origin.test` 的 DNS 查询超过 5 秒上限；该包在本次改动中只有版本号变化。

针对性套件覆盖改动的客户端与 LLM 面：`ui-agent-preset`、`ui-conversation`、`ui-sidebar`、`ui-entry-customization`、`ui-primitives`、`ui-layout` 与 `llm-deepseek` 共 275 个文件、4,392 个测试，另有 53 个 synapse 测试。受 JSDoc 补全影响的法律与专利包新增 112 个文件、2,123 个通过测试。

`pnpm run test:snapshot` 在 session、sdk、acp、web 四个 lane 回放 229 个用例，227 个通过、2 个跳过。六份受影响的浏览器 spec 在刷新后的 golden 上以回放模式通过（13 个测试）。本次发布改动的浏览器流程也端到端通过：entry customization（1）、workspace shortcuts（4）、workspace management（17）、agent-preset selection（10）与 blank preset reuse（3）。
