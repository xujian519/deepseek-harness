# Agent Note: dsh-agent-teams 移植为 dsh-patent-teams 工作区包

Status: implemented

[English](2026-08-19-patent-teams-workspace-package.md) | 中文

## 问题

专利 preset 依赖上游 `@nanmicoder/dsh-agent-teams` 插件（按 profile 安装，源码调研副本在 `~/.sati/调研/DeepSeek-Harness/源码素材-dsh-agent-teams`）提供持久多智能体团队。patent-workbench-tasks.md 阶段 4 决策记录为"安装原插件、preset 层适配、不 fork"；用户随后指示正式工作区包移植（`dsh-patent-teams`），需满足仓库插件纪律：Service Definition/Consumer 分离、100% 覆盖率单测门槛、双语 README、包 invariant、manifest 注册。

## 决策

落地 `packages/patent/patent-teams`（`@deepseek-ai/dsh-patent-teams`）为主机层插件：

- **服务定义**：`ctx.patentTeams`（`PatentTeamsService`）拥有团队增删改查、带 `attempt_id` 撤销与 handoff 静默的任务状态机、成员生命周期（spawn/interrupt/retire）、邮箱持久化、删除即归档、调度器 kick。
- **Consumer**：十个 `patent_teams_*` 工具（由 `agent_teams_*` 改名）经 `ctx.patentTeams` 注册；tools 文件是薄 schema/render 层。
- **领域化**：状态目录默认 `.patent-teams/`，会话事件为 `patent-teams/*`（invariant 校验），成员标签前缀 `patent-teams:`。
- **有意不移植**：上游 Web 活动面板/美术路由与 `client/` 包（v1 仅工具+服务，记录于 Known Limitations）。
- **源码卫生**：移植起点为已精简的上游副本（`isEnoent`/`scanTeams`/scope helper 去重、锁表清理、共享 `stateRootOf`/`teamLockKey`），并适配仓库严格模式（`exactOptionalPropertyTypes` 用条件展开/`delete` 修复）。
- 注册：`tsconfig.host.json` references、`packages/patent/README.md` 行、`--no-frozen-lockfile` 更新 lockfile。

## 备选方案

**继续安装上游 npm 插件。** 用户指令否决；正式包同时消除按 profile 安装步骤，为 harness 提供经过审查的领域化实现。

**拆分为独立 Definition/Provider/Consumer 三包。** 否决：工具是唯一 consumer，成员 provider 是现有 `ctx.subagents` 接缝上的配置值；单包符合"单用途插件一个包"。

**保留 `agent_teams_*` 命名以兼容。** 预发布立场下否决：专利域拥有 `patent_teams_*` 命名；`.agent-teams/` 下既有归档是运行时数据而非线格式。

## 影响

- `tsc -b packages/patent/patent-teams` 与 host 聚合通过。
- `pnpm run verify-translation-pairing`：patent 组 README 与新包 README 配对已记录。
- 单测（每文件 100% 覆盖）经独立子代理在 `tests/` 落地；`pnpm run test:coverage` 为该包 CI 门槛。
- `patent` preset 当前仍挂载上游插件；将 preset 行切换为 `@deepseek-ai/dsh-patent-teams`（并同步 `patent-team-composition` 技能工具名）为后续步骤，归部署窗口所有。
