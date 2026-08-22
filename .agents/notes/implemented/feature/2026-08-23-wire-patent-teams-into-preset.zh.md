# Agent Note: 将 dsh-patent-teams 接入 patent preset 并统一工具名

Status: implemented

[English](2026-08-23-wire-patent-teams-into-preset.md) | 中文

## 问题

`dsh-patent-teams`（`packages/patent/patent-teams`）作为完整且已通过测试的 workspace 包迁入，却从未挂载：它不在 `apps/cli/package.json`、不在 patent preset 的 `agent.cordis.yml`，也不在 `docs/tool-catalog.md`。与此同时 patent preset 的 `persona` 与 `patent-team-composition` 技能仍按上游 `@nanmicoder/dsh-agent-teams` 插件的 `agent_teams_*` 工具名与「当环境提供…时」的措辞描述团队工作流——但该插件在当前工作区并无安装，因此 preset 宣称的团队工作流实际上从未能被触发。持久多智能体团队能力在组合层处于「未通电」状态。

## 决策

把迁入的包接为 preset 的团队后端，并把每处上游工具引用改成它实际注册的专利域名称：

- **依赖**：在 `apps/cli/package.json` 增加 `@deepseek-ai/dsh-patent-teams`（`workspace:^`）；用 `--no-frozen-lockfile` 刷新 `pnpm-lock.yaml`。
- **挂载**：在 `apps/cli/config/agent-presets/patent/agent.cordis.yml` 的 `patent` group 里加一行 `patent-teams`，并在该 group 的 `isolate` 增加 `patentTeams: true`。该 group 已隔离其它专利服务；preset 服务必须位于 `isolate` realm 之后，否则 `dsh-agent-presets` 会在挂载时拒绝（`packages/preset/agent-presets/src/mount.ts` 的 `leakedServices`）。
- **工具名**：把 `persona` 行、`patent-team-composition/SKILL.md`、以及两份 preset README 改为 `patent_teams_*` 与 `@deepseek-ai/dsh-patent-teams`，把「当环境提供…时」的悬置措辞改为「本会话挂载 dsh-patent-teams」（仅当插件被禁用时才回退 `subagent_fork`）。
- **目录**：在 `scripts/gen-tool-catalog.ts` 的 `TOOL_PACKAGES` 增加 `@deepseek-ai/dsh-patent-teams`，用与其它 subagent 包相同的 `SubagentRuntime`+mock provider 配方引导，使十个 `patent_teams_*` 工具进入 `docs/tool-catalog.md`（EN + 手工维护的 ZH），并保持目录生成器的完备性守卫满足。
- **成员工具访问**：在 `patent-teams/tests/members.spec.ts` 中断言成员 `toolFilter.deny` 含队长专属的 `patent_teams_*` 管理工具，但不含 `patent_search` 等专利能力工具——成员经共享工具注册执行真实专利作业。

`patentTeams` 服务键、`patent-teams/*` 事件名、`.patent-teams/` 状态目录保持不变（已在 `gen-cordis-catalog.ts` / `gen-doc-graphs.ts` 注册）。

## 备选方案

**只在 apps/cli 注册 `patent-teams`、不进 preset。** 否决：没有 preset 行，任何专利会话都不会挂载它；仅有依赖并不够。preset 行加 isolate realm 才使该能力可达。

**保留 `agent_teams_*` 名称，并手改技能/persona 指向不存在的插件。** 否决：pre-release 立场下工具集已重定名为 `patent_teams_*`（见迁入 Agent Note），preset 与技能必须写明实际注册的内容。

**在挂载级测试中引导整个 patent preset。** 否决：preset 只能在完整 host 栈（shell/fs/jobs/web/sandbox/…）上组合，孤立挂载测试无法运行；`verify-cordis-config` 是 preset 的组合门禁，`patent-teams` 自身的 Loader/HMR/coverage 套件覆盖插件本身。

## 后果

- `apps/cli` 现依赖 `dsh-patent-teams`；`pnpm-lock.yaml` 记录该链接。
- patent preset 在 `isolate.patentTeams` 之后挂载 `dsh-patent-teams`，使每个专利会话可用 `patent_teams_*` 工具与 `ctx.patentTeams`，且不泄漏进 root realm。
- `docs/tool-catalog.md`（EN）重生成并列出全部十个 `patent_teams_*` 工具；`docs/tool-catalog.zh.md` 镜像新段落（译文保留 JSON-schema 的 `description` 字段为英文，遵循目录配对惯例）；`docs/tool-catalog.i18n.yaml` 哈希重录。
- `packages/core/tools/tests/gen-tool-catalog.spec.ts` 期望工具列表更新以纳入新收割名称；`patent-teams/tests/members.spec.ts` 扩展以钉住成员保留专利能力工具。
- 后续接线（角色→Worker 契约映射、任务→manifest 承接、成员产出质量门禁）仍延后，且各自依赖本次挂载先落地。

## 非归因失败（待对方窗口收尾）

以下仓库级门禁在本工作区呈红，但**不归因于本次改动**；其失败项全部指向并发进行中的 `self-evolve` 窗口的包（`docs/sati-as-dsh-plugins-plan.md` §13.2 已记录这些为对方窗口未提交的共享文件改动）。本次改动未触及其中任何一处，patent preset 也不在任何失败清单里。待 `self-evolve` 窗口落地后应重新校验；请勿把它们当作此处接线的回归：

- `verify-cordis-config` — 仅 `packages/bundle/web-app/cordis.patch.yml` 的 `@deepseek-ai/dsh-host-synapse` / `@deepseek-ai/dsh-client-synapse` 无法经 `tsconfig.base.json` paths 解析。
- `verify-config-catalog` — `docs/config-catalog.md` 过期（新增 `dsh-host-synapse` / `dsh-client-synapse` / `dsh-self-evolve-eval` 行）。
- `verify-doc-graphs` — `docs/event-producer-consumer.md` 过期（`synapse` / `self-evolve` / `self-evolve-basic` 行）。
- `verify-package-readme-model-experience` — `packages/client/synapse`、`packages/test-support/self-evolve-eval`、`packages/web/synapse` 缺少完整 model-context 章节。

本次改动可归因的检查全部通过（`tsc -b packages/patent/patent-teams`、`patent-teams` 套件、`gen-tool-catalog.spec.ts`、`verify-tool-catalog`、`verify-md-links`、`verify-md-wrap`、`verify-package-paths`、Agent Note 门禁、翻译配对）。
