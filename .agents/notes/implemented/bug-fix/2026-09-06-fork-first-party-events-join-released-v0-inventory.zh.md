# Agent Note: 叉分第一方事件并入已发布 v0 冻结清单

状态: implemented

[English](2026-09-06-fork-first-party-events-join-released-v0-inventory.md) | 中文

## 问题

该叉的第一方事件 —— `patent-teams/*` 团队记录与 `self-evolve/reflection` —— 由叉内自身插件生成，且已被当前构建的 `KNOWN_SESSION_EVENT_TYPES` 认识，因此必须保留到 v2。但已发布的 v0 冻结清单（`packages/session/session-format-v0-to-v1/src/dispositions.ts` 中的 `RELEASED_V0_EVENT_DISPOSITIONS`）从未声明它们。v0→v1 恒等边会拒绝每一个未知的 non-ignorable 事件（`assertArtifactCoordinates`），于是任何包含这些类型「非 `ignorable`」实例的真实 session 都无法迁移，桌面端报「历史加载失败」。在 `todo/write` tags 修复之后，这一簇就是仍会阻塞历史加载的 inventory-schema 脱节。

`patent-teams/*` 写入时带 `ignorable: true`（[历史](../../implemented/bug-fix/2026-08-27-patent-teams-ignorable-session-events.zh.md)），但在这个信封约定确立之前落盘的实例，以及 `self-evolve/reflection`，都没有该标记；只要一个 session 含一条这样的必需事件，整条链都会拒绝。

## 决策

把数据中实际存在的叉分事件按确切的 payload 成员集合加入冻结清单，并为每个事件补给一个 payload 语义 case，避免命中校验器「默认抛错」分支。

- **`dispositions.ts`** 新增 `patent-teams/member-added`、`member-removed`、`message-sent`、`task-created`、`task-gated`、`task-updated`、`task-validated`、`team-created` 与 `self-evolve/reflection`。各自的 `required`/`optional` 划分与事件自身类型定义逐项一致。
- **`payload-validation.ts`** 为每个新增事件补一个 `case`，与所有者 invariant 的校验对齐（身份字段为非空字符串，`ts`/`score`/`confidence` 为有限数字，`attempt` 为安全整数，字符串数组，布尔值），且不更严。
- 由于 `RELEASED_V0_EVENT_TYPE_SET` 就是清单的 `Object.keys`，这些事件由此同时被 v0→v1 与 v1→v2 两层坐标校验放行。它们也不再被 `isIgnorableUnknown` 当作「值得丢弃的外部事件」处理：已进清单类型的 `ignorable` 实例会被保留，这对当前构建已知的第一方记录而言是正确的。

`patent-teams/team-deleted` 刻意不加入。存储数据中只有 `ignorable` 实例；作者声明的「可安全省略」语义已然生效，所以「v0→v1 放行 + v1→v2 丢弃」这条路才是正确的，若加进清单反而会错误保留本应丢弃的记录。其余 `self-evolve/*` 事件（`start`、`mined`、`proposed`、`validated`、`commit`、`end`）同样不加入：存储历史中零实例，且其 payload 内嵌尚未完全确认的嵌套对象，加入它们有重蹈初版猜错字段的风险。

## 备选方案

- **放宽校验器以放行未知 non-ignorable 事件。** 弃用：会掩盖真实的 inventory-schema 缺口，并丢失对外部必需事件「响亮失败」的边界。
- **维持 alpha 拒绝。** 弃用：这本身就是 bug —— 含叉分事件的历史 session 完全无法打开。
- **从 `KNOWN_SESSION_EVENT_TYPES` 移除这些事件 / 写入时标记 ignorable。** 弃用：它们是第一方记录，降格为可丢弃会丢失真实状态。
- **一并加入 `team-deleted` 与其余 `self-evolve/*` 事件。** 弃用：没有 non-ignorable 实例支撑保留它们，且未确认的嵌套 payload 使精确清单猜测风险过高。

## 后果

对全部 404 个已存 v0 session 完整回放，现在有 388 个成功迁移到 v2。剩余 16 个是真实数据损坏而非 schema：在 tool-call 中途被打断的 session 留下未闭合的 `tool/call`（`step/end leaves unresolved tool call`）、断裂的序列号间隙、未打开预期 turn 的 `turn/start`，或并非精确 `TOOL_NOT_STARTED` 修复的 `tool/result`。校验器正确地拒绝它们，所以不在本次改动范围内 —— 让迁移接纳它们反而会掩盖真实 bug。`validation.spec.ts` 中关于 `RELEASED_V0_EVENT_TYPE_SET` 长度的断言已同步到扩容后的清单。
