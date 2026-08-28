---
description: "为 harness 提供由外部上下文数据库支撑的长期记忆的插件。每个集成各自拥有一个外部数据平面（检索、捕获、提交、工具面），并作为进程内生命周期与提示词扩展点的消费方；此处不改动 `agent-loop` 代码。除非组 README 另有说明，所有包均需主动启用。"
kind: "package-group"
---

# memory/ — 外部记忆与上下文数据库集成

[English](README.md) | 中文

为 harness 提供由外部上下文数据库支撑的长期记忆的插件。每个集成各自拥有一个外部数据平面（检索、捕获、提交、工具面），并作为进程内生命周期与提示词扩展点的消费方；此处不改动 `agent-loop` 代码。除非组 README 另有说明，所有包均需主动启用。

| 包 | 职责 | ctx key |
|---|---|---|
| [`openviking/`](openviking/README.zh.md) | OpenViking 上下文数据库集成：自动召回、会话捕获/提交与 OpenViking 工具面 | `ctx.openviking`（规划中） |

外部服务保留自身契约：组 README 链接上游实现及其消费的线端点。
