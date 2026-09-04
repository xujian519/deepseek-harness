---
description: "**`BenchmarkEvolveEngine`** 是 `ctx.selfEvolveBenchmark` 的提供方。它为 self-evolve 能力补充一个量化目标维度:benchmark 是一组有界用例,每个用例按私有评分标准(rubric)打分,提供方在严格的 improve-or-rollback 策略下优化 agent 状态,并以整版快照版本化为支撑。这与 `ctx.selfEvolve` 从会话流挖掘失败模式形成互补,给优化循环一个可以追逐的客观分数。"
kind: "package-reference"
---

# @deepseek-ai/dsh-self-evolve-benchmark

[English](README.md) | 中文

## 概述

**`BenchmarkEvolveEngine`** 是 `ctx.selfEvolveBenchmark` 的提供方。它为 self-evolve 能力补充一个量化目标维度:benchmark 是一组有界用例,每个用例按私有评分标准(rubric)打分,提供方在严格的 improve-or-rollback 策略下优化 agent 状态,并以整版快照版本化为支撑。这与 `ctx.selfEvolve` 从会话流挖掘失败模式形成互补,给优化循环一个可以追逐的客观分数。

不发布运行时不变式伴生；provider 的不变式位于其磁盘存储布局（statement/rubric 分离、单调快照版本），而非可观测事件序列。


## 目录

- [Role](#role)
- [Configuration](#configuration)
- [Public API](#public-api)
- [On-disk layout](#on-disk-layout)
- [Optimization loop (C1 + C3)](#optimization-loop-c1--c3)
- [Statement/rubric 分离(C2)](#statementrubric-separation-c2)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Role

| 包 | 角色 |
|---|---|
| `@deepseek-ai/dsh-self-evolve` | Service Definition:抽象 `SelfEvolveEngine` + 持久事件 |
| `@deepseek-ai/dsh-self-evolve-basic` | Service Provider:基于 failure-pattern projection 的空闲压力演化 |
| `@deepseek-ai/dsh-self-evolve-benchmark`(本包) | Service Provider:benchmark 驱动的目标演化 + 快照版本化 |

## Configuration

`BenchmarkEvolveConfig` 控制 benchmark 数据存放位置以及公共方法的默认值:

| 字段 | 默认值 | 语义 |
|---|---|---|
| `baseDir` | `~/.dsh/self-evolve-benchmark` | benchmark 存储与快照的数据根目录(`$DSH_HOME` 覆盖 `~/.dsh`)。 |
| `agentStateDir` | `process.cwd()` | agent 状态目录,每轮候选前打快照、被拒绝时恢复。 |
| `runsPerCase` | `1` | 方法未指定时每个用例的 run 次数。 |
| `maxRoundsPerLoop` | `1` | 每次 optimize loop 的默认最大候选轮数。 |
| `targetScore` | 无 | optimize loop 的默认分数目标;缺省禁用提前接受。 |

## Public API

所有工作都经过一个注入 seams 的 `BenchmarkEngineCore`;真实默认 seams 运行在 `fork` subagent provider 之上。

| 方法 | 契约 |
|---|---|
| `runBenchmark(benchmarkId, options)` | 对当前 agent 状态评估每个用例 × `runsPerCase`,并持久化聚合的 `ScoreboardEntry`。 |
| `establishBaseline(benchmarkId, options)` | 单 run 的 benchmark entry,是 optimize loop 必须严格超越的参考。 |
| `optimizeLoop(benchmarkId, options)` | 在严格的 improve-or-rollback 下优化;没有参考 entry(显式或 scoreboard 最新)时 fail loud。 |
| `readScoreboard(benchmarkId)` | 返回某 benchmark 的全部持久化 entry,旧到新。 |

## On-disk layout

```
<baseDir>/
├── benchmarks/<id>/
│   ├── benchmark_config.yaml   # { title }
│   ├── <caseId>/statement      # public task text — the only input a target agent sees
│   ├── <caseId>/rubric         # private scoring standard — a physically separate file
│   └── scoreboard.yaml         # versioned entry history
└── snapshots/v<version>.tar.gz # whole agent-state snapshot, excluding .vault.toml
```

## Optimization loop (C1 + C3)

`optimizeLoop` 的每一轮都会铸造一个新的快照版本(版本只增不减、永不回收),打包当前 agent 状态,只基于公共 statement 面提出一个候选,应用它,评估完整矩阵,并且仅当候选分数严格高于参考时才接受该轮。被拒绝的候选回滚到其快照;被接受的候选成为新的参考,配置了 `targetScore` 时循环提前停止。

<a id="statementrubric-separation-c2"></a>
## Statement/rubric 分离(C2)

用例的 `statement` 是 target 或优化 agent 能看到的唯一 benchmark 内容;`rubric` 是私有的,存为物理上不同的文件。optimizer prompt 声明评分标准不存在,并指示子代理如果看到评分标准就停止并上报污染;`publicBenchmarkView`/`assertNoPrivateLeak` 从面向 optimizer 的面上机械地剔除并守护私有词汇(`rubric`、`rubrics`、`gold`、`goldAnswer`、`expectedAnswer`)。evaluator 是唯一允许接收 rubric 的角色。

## Model Experience

### 默认 seam prompts

#### What the model sees

本提供方不注册稳定的 prompt section 或 tool schema;每个模型可见的贡献都来自其默认 seams fork 出的子请求。每个用例 run 先 fork 一个 executor 子代理,告知它是任务执行者,交给它 `statement` 与 agent 状态目录中的作业规范,并指示它直接产出交付物文本。随后引擎 fork 一个 evaluator 子代理,告知它是 benchmark evaluator,交给它 `statement`、交付物、私有 `rubric`(在这里是合法的,也仅在这里),以及只输出一个带数字 `score` 的 JSON 对象的指令。每轮优化 fork 一个只拿到参考分数和合并后公共 statements 的 optimizer——明确告知上下文不含 rubric——以及一个拿到候选与 agent 状态目录的 applier。

#### Token effect

`runBenchmark` 与 `establishBaseline` 每个用例 run 花费一次 executor 与一次 evaluator 请求。每轮优化花费一次 optimizer 请求、一次 applier 请求,以及每个用例 run 一次 executor 与一次 evaluator 请求,外加一次文件系统快照。

#### KV Cache effect

这些子请求的 prompt 是请求局部的:内容随用例、轮次和参考变化,永远不会成为主请求的稳定前缀。主请求前缀不受本提供方影响。

## Known Limitations and Deferred Work

- **默认 seams 需要活运行时**——执行、评估、提议与应用通过 `ctx.subagents` fork 子代理,需要 `fork` provider 以及通过 `sessionId` 解析出的 live parent agent;没有它们时循环 fail loud 而不是降级。没有 subagent 运行时的调用方必须注入自己的 seams。
- **子代理输出不重试**——子代理在 `completed` 之前结束、或输出非 JSON、字段不合法的内容,都会使整个操作失败;循环不会重新 fork。executor 的交付物是自由文本(无 JSON 包装),只有 evaluator 必须输出 JSON。
- **快照版本永不回收**——单调的 `max + 1` 铸造是刻意的(被拒绝轮的归档留在磁盘上作为证据),所以长期运行的循环会积累归档,直到调用方自行清理。
- **无 UI 或 CLI 面**——这是一个编程接口服务;`dsh` 里还没有任何东西暴露它。
- **无 keyed 端到端验证**——默认 seams 由 mock 掉 subagent 运行时的单元测试覆盖;真实的 `dsh --profile` 循环运行需要 keyed 环境。
- **live parent agent 必须能通过 session id 解析**——引擎通过 seams 传递的是 `sessionId`,不是直接的 agent 引用;持有 `Agent` 的调用方必须先把它映射为 session。

### 开发备注

无。
