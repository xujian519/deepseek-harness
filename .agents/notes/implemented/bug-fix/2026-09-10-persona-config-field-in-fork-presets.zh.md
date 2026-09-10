# Agent Note: 恢复 fork preset 的 persona 行到当前字段名

Status: implemented

[English](2026-09-10-persona-config-field-in-fork-presets.md) | 中文

## 问题

自 2026-09-06 拆分单一 `text` 字段的 system-prompt 改动后，`dsh-persona` 的配置为 `prefix`（必填）与 `suffix`（可选）。所有随包发布的 preset 都随该改动更新，只有两个例外：`patent`（本仓库自有 preset）与 `document`。

它们的 persona 行仍设置 `text`。运行时 schema 忽略这个未知键，`prefix` 因而缺失，loader 拒绝该条目，于是 `dsh-agent-presets` 无法挂载该 preset：`agent-presets: preset "patent" failed to mount: failed to apply loader entry persona (@deepseek-ai/dsh-persona): invalid config: $.prefix missing required value`。当 `agent-presets.default: patent` 时，该失败会阻塞每次恢复与每次新建会话，而桌面应用把它呈现为文件面板的读取失败，而非 preset 问题。

## 决策

两个 persona 行改为设置 `prefix:`，文案不变。两行都不设置 `suffix:`。这些 preset 所叠加的配置把 `personaPrefix` 与 `personaSuffix` 留空，因此空 suffix 模板不会遮蔽任何内容。

## 考虑过的替代方案

**在 `dsh-persona` 中继续接受 `text` 作为废弃别名。** 否决：它会恢复上游改动已删除的字段，让同一设置的两种拼写长期并存。

**在这两行设置 `complete: true`。** 否决：`prefix` 仍然必填，条目依旧加载失败，而 `complete` 还会丢弃其余所有提示段与运行时上下文快照。

## 结果

两个 preset 恢复挂载，其 agent 渲染的 persona 文案与改名之前一致。

覆盖缺口：`mount.spec.ts` 只启动 fixture preset（`includeShippedRoot: false`），而 `shipped-root.spec.ts` 只读取 shipped root 的结构，不把条目的配置与具名插件的 schema 做校验。因此，若随包发布的 preset 携带被改名或删除的配置字段，它会在运行中的部署里失败，而不是在 CI 中失败。
