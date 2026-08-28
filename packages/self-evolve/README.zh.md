---
description: "self-evolve 组地图：基于战役的自我评估与插件演进——持久演进服务、接在 agent loop 上的 basic 提供方、SWE-bench 风格的战役运行器，以及面向模型的工具。"
kind: "package-group"
---

# packages/self-evolve

[English](README.md) | 中文

## 概述

self-evolve 族让 harness 基于记录的证据评估并改进自己的插件组合。`self-evolve` 声明持久演进服务，`self-evolve-basic` 基于 agent loop 的生命周期事件（request run、pre-step 与错误）实现演进记录，`self-evolve-benchmark` 以固定子集 seed、评分、区间与记录式决策 I/O 运行可复现战役，`tool-self-evolve` 暴露面向模型的控制面。战役状态落入 session log，评估产物不进入 workspace 构建。

## 目录

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | Service |
|---|---|---|
| [`self-evolve/`](self-evolve/README.zh.md) | 演进服务定义与生命周期。 | `selfEvolve` |
| [`self-evolve-basic/`](self-evolve-basic/README.zh.md) | 基于 agent loop 生命周期事件的 basic 提供方。 | (provider) |
| [`self-evolve-benchmark/`](self-evolve-benchmark/README.zh.md) | SWE-bench 风格战役运行器：子集 seed、评分、决策记录。 | — |
| [`tool-self-evolve/`](tool-self-evolve/README.zh.md) | 面向模型的演进控制工具。 | (registers on `ctx.tools`) |

## Related documentation

- [Self-evolve subsystem](../../docs/subsystems/self-evolve.zh.md) — 战役、评估与演进契约。

## Dev Note

无。
