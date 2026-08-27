# Agent Note：patent-teams 会话事件一律按 ignorable 记录写入

Status: implemented

[English](2026-08-27-patent-teams-ignorable-session-events.md) | 中文

## 问题

`appendTeamEvent` 还带着移植时的过渡性守卫：在运行时探测 harness 的 `KNOWN_SESSION_EVENT_TYPES`，静默丢弃运行构建不认识的每一个 `patent-teams/*` 事件。该守卫写于 `Session.append` 暴露 `ignorable: true` 写入选项（`012e897ace`）之前。在本 fork 内，生成的词汇表已收录全部九个类型，守卫恒放行，探测成了死代码；而作为发布插件装到 upstream harness 构建上时，守卫会把整段团队记录静默丢弃在会话日志之外——两处注释也早已偏离现实。

## 决策

`appendTeamEvent` 现在无条件调用 `session.append(type, data, { ignorable: true })`；词汇表探测、`skippedEventTypes` 集合与 `dshSession` 命名空间导入一并删除。`<workspace>/<stateDir>/` 下的磁盘团队状态仍是权威源；会话事件是信息性监视记录，正是 `ignorable` envelope 字段的设计对象。词汇表早于 `patent-teams/*` 的构建（发布插件装在 upstream 上）会接受日志并丢弃这些记录，而不是拒绝读取；认识这些类型的构建则无论如何都会保留它们。

## 备选方案

**去掉守卫但不加 `ignorable`。** 否决：upstream 构建读取时会拒绝整个会话日志（required-on-read 默认）——比丢失信息性记录更糟。

**把插件事件类型注册进运行时词汇表。** 否决：session-log version 机制笔记已明确否决按插件改写词汇表，否则可读性将取决于恰好加载了哪些插件。

## 后果

团队事件现在在所有部署形态下都以 `ignorable: true` 落入 captain 的会话日志。`tests/events.spec.ts` 不再改动运行时词汇表集合，直接断言该标记。不 bump `SESSION_FORMAT_VERSION`、不触碰 SDK：envelope 字段与 wire schema 早已就绪。
