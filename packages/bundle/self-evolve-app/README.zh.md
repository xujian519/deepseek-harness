---
description: "dsh 自进化 opt-in bundle。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-base`](../base/README.zh.md) 之上：插入 `self-evolve-basic` provider 与 `tool-self-evolve` consumer 两行。需要该能力接缝的 profile 挂载此 bundle；不挂载则接缝休眠，宿主面不持有任何工具。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-self-evolve-app`

[English](README.md) | 中文

## 概述

dsh 自进化 opt-in bundle。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-base`](../base/README.zh.md) 之上：插入 `self-evolve-basic` provider 与 `tool-self-evolve` consumer 两行。需要该能力接缝的 profile 挂载此 bundle；不挂载则接缝休眠，宿主面不持有任何工具。

base bundle 刻意不携带这两行：`tool-self-evolve` 在挂载上下文注册工具，base 级行会把它们泄漏到宿主面与每个 agent（minimal 预设的双工具契约与"宿主面无工具"不变量都依赖这一点）。因此 standard 与 minimal 预设保持不变；启用是一个显式的组合步骤。

不发布运行时不变式伴生；bundle patch 与胶水插件不持有自身的可变状态，所有贡献都落入各自主管注册表。


## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

Indirectly, through the mounted consumer: this bundle inserts the `tool-self-evolve` row, whose prompt section and `self_evolve_*` tools are the only model-visible surface; the bundle's own glue plugin contributes no prompt text, tool schema, or result of its own. See [`@deepseek-ai/dsh-tool-self-evolve`](../../self-evolve/tool-self-evolve/README.zh.md) for the consumer contract.

#### KV Cache 效果

无。glue 插件只占据组合位置，不组装或发送任何 provider 请求。

## Known Limitations and Deferred Work

- **仅 opt-in** — 默认不启用任何能力；必须由 profile 挂载 `self-evolve-app` bundle。
- **provider 广度** — `self-evolve-basic` 面向 L1-skill 与 L2-context 提案；L3-workflow 与 L4-harness 请求暂不产生提案。
- **无 keyed 端到端验证** — 提案效果是可逆提交，由单元测试覆盖；实机 `dsh --profile` 循环运行需要 keyed 环境。

### 开发备注

无。
