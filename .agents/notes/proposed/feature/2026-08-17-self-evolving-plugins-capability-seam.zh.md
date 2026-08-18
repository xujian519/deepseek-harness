# Agent Note: 自进化插件 capability seam

Status: proposed

[English](2026-08-17-self-evolving-plugins-capability-seam.md) | 中文

## 问题

Harness 缺少一个结构化接缝，让插件能够观察自身失败并提出 harness 改进方案。临时性的自我修改会绕过审批流、沙箱边界与回滚机制。我们需要一个 capability seam，用于规范引擎如何挖掘会话失败、提出 harness 变更并在不损害宿主完整性或模型可见历史的前提下完成验证。

## 提案

确立 `ctx.selfEvolve` capability seam 及 L1-L4 级自进化插件的执行边界。该接缝将 Cordis 的时空组合机制映射到三阶段进化循环：弱点挖掘、有界提案生成、提案验证。

该能力遵循标准的三段式接缝：

- **Service Definition**：`SelfEvolveEngine` 声明进化生命周期与触发器。
- **Service Provider**：实现三阶段循环与基于快照隔离的回归测试。
- **Consumer**：`tool-self-evolve` 向模型暴露进化触发与状态查询工具。

引擎通过 `runMaintenance()` 挂载至 Agent Loop，在智能体 idle 状态下异步执行弱点挖掘与验证测试。节流策略限制单会话的自主提案生成频率，以防止 Token 耗尽与多样性坍缩。

### 会话投影与弱点挖掘

弱点挖掘的数据源为 append-only 的会话日志。引擎不在维护阶段遍历全量日志，而是通过 `SessionProjection` 将 `session/event` 事件流增量折叠为失败模式（Failure Patterns）状态树。该投影将挖掘逻辑与底层日志结构隔离，并保证对历史失败的常数时间访问。

### 沙箱执行边界

语言级访问控制与 `cordis-host-runner` 的 5 秒 `vm` 超时无法为模型生成的 L4 Harness 代码提供安全的执行边界。

- L4 Harness 提案必须在 `subprocess`/`landlock` 沙箱内应用与执行。
- 客户端代码更新默认保持人类审批流程。自动化流水线不绕过审批机制（针对 L4 提案，`clientVersionUpdatesApproved` 强制保持 `false`）。

### 可逆效应与数据回滚

当提案验证失败时，Cordis 的可逆效应（`ctx.effect`）负责干净地撤销插件注册、事件监听器及框架级副作用。

可逆效应无法撤销业务数据修改。验证测试框架在 held-in 与 held-out 回归测试期间，负责对文件系统与 SQLite 数据库提供显式的快照隔离与数据回滚机制。

## 考虑过的替代方案

**允许临时性的模型驱动文件编辑。** 不予采纳，因为无界编辑没有隔离、没有回滚、也没有审批关卡；失败的编辑可能损坏运行中的 harness。

**在进程内运行被提案的 harness 代码。** 不予采纳，因为模型生成的 L4 代码不得与宿主进程共享地址空间；现有的 `vm` 超时不是安全边界。

**将进化实现为 harness 外部的独立服务。** 不予采纳，因为外部服务会丢失对会话上下文、Cordis 效应与插件生命周期的直接访问，被迫引入冗余的 wire 协议并使用过时的快照。

## 验收标准

- `SelfEvolveEngine` 通过 Service Definition 暴露进化生命周期与触发器。
- 提供方基于对 `session/event` 增量折叠的 `SessionProjection` 执行弱点挖掘。
- L4 Harness 提案仅在 `subprocess`/`landlock` 沙箱内应用与执行。
- 客户端代码更新默认保持人类审批流程。
- 失败提案通过 Cordis 可逆效应回滚；回归测试对文件系统与 SQLite 状态使用快照隔离。

## 风险

- 自主循环可能耗尽 Token 或导致提案多样性坍缩。通过单会话限速与提案上限缓解。
- 沙箱逃逸仍是宿主级关切；本提案依赖现有 `subprocess`/`landlock` 边界，而非 `vm` 超时。
- 可逆效应无法回滚业务数据，因此 held-in 与 held-out 测试必须自行提供快照隔离。
