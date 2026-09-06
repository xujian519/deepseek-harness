# Agent Note: Session 迁移丢弃 ignorable 未知事件

Status: implemented

[English](2026-09-06-session-migration-drops-ignorable-unknown-events.md) | 中文

## 问题

由仓库外部插件写入的 released v0 Session 携带第一方清单从未声明的事件。真实用户 session `session-1c2e1634-...` 在 seq 217 停在 `checkpoint/snapshot`，由 `dsh-checkpoint-rewind@0.4.0` 生成并带有信封标记 `ignorable: true`。alpha 历史事件策略在 v0->v1 边上拒绝所有未知历史类型，无论是否 ignorable（[alpha 拒绝](2026-08-31-alpha-historical-unknown-event-refusal.zh.md)）；桌面端提示「历史加载失败」，已存历史记录完全无法打开。

同版本 reader 已能在信封携带标记时重新打开此类事件。缺口只在持久化 seam 为到达当前 v2 代际所必须跨越的格式边。

## 决策

迁移链现在在 `v0 -> v1 -> v2` 过程中丢弃显式标记的 ignorable 未知事件，并把拒绝收窄到未知的必需事件。

- **v0->v1 保留它们。** 这条边是恒等提升：它保持每个原始 `seq`，在此丢弃会破坏稠密序号不变量，并强制引入恒等契约不拥有的重排逻辑。现在校验收纳信封标记为 `ignorable: true` 的未知类型——同时通过源坐标与逐事件 payload 校验；非 ignorable 未知事件仍在这条边被拒绝。
- **v1->v2 丢弃它们。** v2 是纯第一方，且这条边已通过其 `oldToNew` 重排 `seq`。丢弃 `ignorable: true` 未知事件的预处理让既有 remap 机制填补空隙。非 ignorable 未知事件仍被 `assertReleasedV1Artifact` 在任何重排前拒绝。
- **源代际永不改变。** v0 文件、字节、inode 及其无后缀路径保持权威且未修改；丢弃只发生在迁移后继上，因此保留的精确 v0 代际不受影响。
- **拒绝被收窄而非解除。** 未知必需事件（缺少标记，或 `ignorable` 不严格等于 `true`）仍跨所有边响亮失败，保留 alpha 对可能携带不透明数值引用的数据的安全规则。

这取代了 [Alpha Session 迁移拒绝所有未知历史事件](2026-08-31-alpha-historical-unknown-event-refusal.zh.md) 中历史迁移的部分。同版本 append 与重载继续遵循 [为外部插件保留 ignorable session 事件](2026-08-30-retain-ignorable-external-session-events.zh.md)，保持不变。

## 后果

由外部信息插件（如 `dsh-checkpoint-rewind`）写入的 Session 现在可以被迁移并打开，因此已存历史不再加载失败。只有 producer 显式把信封标记为 ignorable 的事件会被丢弃；外部插件发出必需持久事件时仍响亮失败迁移，这正是预期的边界。

迁移是把标记在同版本 reader 中已有的含义——「可安全省略」——也应用到格式边。保留的精确源代际逐字节不变，磁盘上无任何持久数据丢失；信息性事件只从*迁移后继*中丢失。

## 备选方案

- **把 ignorable 未知事件原样复制到 v2** —— 表面上不丢失字节，但无法证明不透明数值或生命周期事实在 v1->v2 结构重排后仍有效；这正是 alpha 拒绝自身的论点，也是仍在付出的成本。
- **保持严格拒绝（alpha 现状）** —— 让真实外部插件 session 无法打开；本次报告的 bug 恰是该结果。
- **在 v0->v1 就丢弃** —— 恒等边保留原始 `seq`，在此丢弃会违反稠密序号不变量，并需引入该边不拥有的重排逻辑。
- **动态询问已挂载插件某个未知事件是否安全** —— 使迁移可用性依赖单一部署组合，并在缺席 producer 挂载前失败。
