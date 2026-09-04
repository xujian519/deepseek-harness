---
description: "**`tool-self-evolve`** 包是 `ctx.selfEvolve` 面向模型的 Consumer。它注册两个工具——`self_evolve_inspect_patterns` 与 `self_evolve_now`——以及一个稳定的提示片段，用于告诉模型何时使用它们。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-self-evolve

[English](README.md) | 中文

## 概述

**`tool-self-evolve`** 包是 `ctx.selfEvolve` 面向模型的 Consumer。它注册两个工具——`self_evolve_inspect_patterns` 与 `self_evolve_now`——以及一个稳定的提示片段，用于告诉模型何时使用它们。

不发布运行时不变式伴生；工具消费者只新增一个 prompt 段与两个工具，不持有事件序列或可变数据，loop 括号由接缝持有。


## 目录

- [角色](#role)
- [工具](#tools)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

<a id="role"></a>
## 角色

| 包 | 角色 |
|---|---|
| `@deepseek-ai/dsh-self-evolve` | Service Definition：抽象 `SelfEvolveEngine` + 持久事件 |
| `@deepseek-ai/dsh-self-evolve-basic` | Service Provider：基于投影的 idle 压力策略 |
| `@deepseek-ai/dsh-tool-self-evolve`（本包） | Consumer：面向模型的工具与提示片段 |

<a id="tools"></a>
## 工具

| 工具 | 用途 |
|---|---|
| `self_evolve_inspect_patterns` | 读取会话投影出的失败模式状态，使模型能够针对真实模式而非猜测进行定位。 |
| `self_evolve_now` | 为请求的编辑面启动一次显式的 self-evolve 循环（默认 `L1-skill` + `L2-context`）。`L3-workflow` 与 `L4-harness` 为向前兼容而接受，但基础提供方目前不会为这些层级生成提案。 |

<a id="model-experience"></a>
## Model Experience

### 稳定的 self-evolve 引导与工具

#### 模型看到什么

一个提示片段解释 self-evolve 能力处于实验状态，指示模型在调用 `self_evolve_now` 之前先调用 `self_evolve_inspect_patterns`，说明基础提供方只实现 L1/L2，且提案验证依赖 held-in 双 verifier（其中 workspace 半边仅在 profile 为基础提供方配置 `workspaceVerifier.buildCommand` 时生效；未配置时循环退化为保守弱路径，不会发生提交），并警告不要编造模式。当组合加载本包时，这两个工具会出现在工具列表中。`self_evolve_inspect_patterns` 返回面向任务的投影——模式 id、层级、verifier 分级、摘要、出现次数与支撑的会话 seq——而不含支撑该模式的 owner 特定 verifier 载荷与内部因果签名。

#### Token 效果

每次工具调用及其 JSON 响应都会以 tool-result 行的形式渲染到对话中。稳定的提示片段为每次系统提示增加固定长度的文本。

#### KV Cache 效果

只要消费者处于加载状态，稳定提示片段就是每轮请求前缀的一部分。

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- **受 provider 面限制** — 工具暴露接缝，但提案广度受所加载 provider 限制（当前为 L1/L2）。
- **无 keyed 端到端验证** — `self_evolve_now` 运行由单元测试覆盖；实机循环运行需要 keyed 环境。

### 开发备注

无。
