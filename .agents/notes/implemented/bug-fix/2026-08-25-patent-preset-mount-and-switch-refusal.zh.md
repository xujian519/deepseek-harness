# Agent Note：将专利预设挂到隔离 realm 之下，并让预设切换拒绝可见

Status: implemented

[English](2026-08-25-patent-preset-mount-and-switch-refusal.md) | 中文

## 问题

两个缺陷让桌面用户无法到达专利预设。其一，`apps/cli/config/agent-presets/patent/agent.cordis.yml` 把 `patent-rule` 声明为独立行，而 `dsh-patent-rule` 提供 `patentRuleGate` 服务，于是该服务被发布到 root realm 成为 process-global。`dsh-agent-presets` 拒绝任何把服务泄漏出 isolate realm 的行，导致该预设无法挂载，每次 `agentPresets.select('patent')` 都被拒绝——无论会话是空白还是已开始。其二，新会话的 chip 在当前会话已开始时会选择预设：`AgentPresetSeatController.apply()` 提前返回并静默丢弃暂存，使点击看起来毫无反应。

## 决策

`agent.cordis.yml` 现在把 `patent-rule` 嵌套进既有 `patent` group，并在其 `isolate` 映射里加上 `patentRuleGate: true`，使该服务落入该 standing mount 的私有 realm——`patent-teams`（`ctx.get('patentRuleGate')`）已在其中解析它。该 group 的工具/守卫注册仍能到达 host registries，因为只有被声明的服务被隔离。`seat-store` 保留"不往返"的提前返回，但不再静默丢弃：在已开始的会话上，它设置语义化的 `SEAT_PRESET_LOCKED` 错误并把标签回退到会话实际运行的预设，chip 渲染本地化文案（`seatLocked`）告知用户新建会话。

## 曾考虑的替代方案

**每次都询问 host。** 否决：chip 已知已开始会话会被拒绝，往返会多一次请求和一个客户端本可预见的失败。

**保持静默丢弃。** 否决：静默丢弃读起来像坏掉的点击，用户无从得知切换为何未发生。

**把该 gate 服务移到 host 组合。** 否决：预设拥有自己的 agent plane；把服务提升到 host-plane 会削弱按预设的封装，且不改变挂载失败本身。

## 后果

专利预设现在可挂载，`agentPresets.select('patent')` 在空白会话上成功；已开始会话的选择会显示 `seatLocked` 信息而非毫无反应。`SEAT_PRESET_LOCKED` 标记只在 chip 内翻译，绝不流向 wire。`seatLocked` 在 en/zh 保持语言配对。
