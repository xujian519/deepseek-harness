# Agent Note: 将两套分叉的 patent 预设收敛为 shipped 正本

Status: implemented

[English](2026-08-25-patent-preset-convergence.md) | 中文

## 问题

两组相互分叉的 `patent` 预设并存。被跟踪的 shipped 版位于 `apps/cli/config/agent-presets/patent/`，含 8 个技能、挂载 `dsh-patent-teams`、教授 `patent-team-composition`。用户级副本位于 `~/.dsh/.agent-presets/patent/`，含 11 个技能、使用通用 `agent_teams_*` 后端与一份薄的 `patent-team-workflow` 技能，并额外持有案件管理与双闸门技能（`patent-matter`、`patent-fact-check`、`patent-compliance-review`）以及 docx 交付与 HITL 放行规则。由于桌面 profile-boot 先把 shipped 预设根目录配为首个 root，且 roster 按 id 先到先得，shipped 预设会遮蔽用户级副本——因此用户已验证的阶段 2/3 成果只存在于这个被遮蔽、无效的副本里。二者还在团队后端（`dsh-patent-teams` vs 通用 agent-teams）与团队状态目录（`.agent-teams/` vs `.patent-teams/`）上不一致。

## 决策

唯一正本位于 `apps/cli/config/agent-presets/patent/`（git 跟踪；由 `package:desktop` 部署），承载两者并丢弃被遮蔽的副本：

- **团队后端**：保留 `dsh-patent-teams`（`patent_teams_*`、`ctx.patentTeams`）+ 技能 `patent-team-composition`，如[接入说明](2026-08-23-wire-patent-teams-into-preset.zh.md)所述。通用 agent-teams + `patent-team-workflow` 路线被弃用。
- **并入正本预设**：新增 `patent-matter`、`patent-fact-check`、`patent-compliance-review`（`skills/` 内）；`patent-quality-gate` 增加第 8 项（HITL 放行，交付前 ask_user）与第 9 项（docx：由 md 起草、修订走 tracked changes、原件未改动），并把流程改为放行前 ask_user 确认、交叉引用 patent-fact-check；`patent-workspace-layout` 增加 `_matter-log.md` 与 `.patent-teams/` 行（`.patent-teams/` 取代通用 `.agent-teams/`）；persona「输出纪律」增加 md→docx→tracked changes 交付规则。
- **口径统一**：工作区约定为七个业务子目录（`00-交底书`/`01-检索`/`02-对比文件`/`03-分析`/`04-撰写`/`05-答复`/`99-知识库`）+ `_case-registry.md` 与 `_matter-log.md` 两个跟踪文件；旧的「八级」表述修正为此。
- **归档**：`~/.dsh/.agent-presets/patent/` 移入 `~/.dsh/.agent-presets-archive/patent-<timestamp>/`，移出用户预设根目录，不再遮蔽。

## 备选方案

**以用户级预设为正本（通用 agent-teams + patent-team-workflow）。** 弃用：它未被跟踪，app 优限加载 shipped 根（因此被遮蔽、无效），且放弃了领域化的 `patent_teams_*` 会话事件与设计文档规定的七场景 `patent-team-composition` 模型。

**两者并存并显式化优先级。** 弃用：用户只要一套；两个同 id `patent` 预设、不同团队后端与状态目录，正是本次要消除的歧义。

**并入桌面 resources 构建物而非 `apps/cli`。** 弃用：`apps/desktop/resources/**` 已被 gitignore（打包产物），可持久源码必须落在被跟踪的 `apps/cli/config/agent-presets/patent/`（由 `package:desktop` 部署）。

## 后果

- 正本预设现有 11 个技能并挂载 `dsh-patent-teams`（`isolate.patentTeams`）；阶段 2 的案件管理/双闸门技能与 docx/HITL 交付规则可触达运行中的 app——新部署会加载此预设。
- 用户级分叉副本已归档（保留而非删除）在 `~/.dsh/.agent-presets-archive/`；`verify-cordis-config` 继续作为唯一剩余预设的组合门禁。
- 之前记录的 `fetch: false` 回退（设计防线#2 无法经 `web_fetch` 打开来源页面）留作独立后续项，本次不改。
- `patent-team-workflow` 不再被任何地方教授；`patent-matter` 的状态机是案件管理权威、`patent-team-composition` 是团队组成权威，由 workspace-layout 技能交叉引用。
