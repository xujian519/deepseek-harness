# Agent Note: 注册表条目共用一份发布状态机

Status: implemented

[English](2026-09-14-entry-lifecycle-primitive.md) | 中文

## Problem

`dsh-agent` 与 `dsh-session` 各自持有同一份条目生命周期状态机。`AgentEntry` 与 `SessionEntry` 都带 `announced`/`announcing`/`detachRequested`——session 侧还多一个 `appending`——且两侧注册表都跑同样四步：把条目插入为存活状态、公告它的创建、把在创建派发仍在调用监听器期间到达的移除延后、只对已公告的条目发出配对的销毁边。两份副本连抛出的句子都相同：`` `<kind> "<id>" was already announced` ``。

两侧已经开始分叉。`dsh-session` 在它的 append 发布打开期间延后移除，这是 agent 注册表没有对应物的第二个派发窗口；两侧各自的一次性 detach 闭包又用自己的措辞重述了延后规则（[`core/agent/src/index.ts`](../../../../packages/core/agent/src/index.ts) 用 `entry.announcing`，[`core/session/src/index.ts`](../../../../packages/core/session/src/index.ts) 用 `entry.announcing || entry.appending`）。对顺序规则的任何修正都必须落地两次，这正是[防御模式](../../../../docs/defensive-patterns.zh.md)所称「在两侧都遵守契约」的漂移温床。

## Decision

- **一份原语：`@deepseek-ai/dsh-entry-lifecycle`。** `EntryLifecycle` 持有公告认领、打开中的派发计数与延迟移除请求。`announce(subject)` 认领唯一的创建边并打开它的派发；`endAnnouncement()` 与 `endDispatch()` 关闭一个窗口，并通过返回 true 报告调用方现在必须移除条目；`detachCapability(remove)` 把移除包装成两个注册表都会交出的那个一次性能力；发布方在开启自己的窗口前读 `hasOpenDispatch` 作为守卫。
- **打开中的派发计数泛化了两侧的旗标。** 窗口是任何仍需观察该条目的同步监听器派发。`dsh-session` 的 `appending` 变成围绕其 append 发布的一对 `beginDispatch`/`endDispatch`，它的重入守卫只读 `hasOpenDispatch`——与 `appending` 旗标表达的条件相同，因此在 `session/created` 监听器内部追加的行为与之前一致。
- **所有权仍留在注册表侧。** 存储成员关系、`scopeTarget` 载体、事件名与 payload、session 的 `attachments` 映射，以及 `agent/disposed` / `session/disposed` 的发出都留在各自包内；原语只持有发布状态。它的拒绝文案由调用方提供的 subject（例如 `` agent "<id>" ``）拼出，于是共用的句子移入原语，而 kind 与 id 仍归调用方。
- **原语是 `util/` 库。** 没有服务、没有事件、没有运行时依赖，落在已经持有 H7 派发原语、并声明了支援级兼容预期的那个组里。
- **消费方边是普通依赖，按包级归类。** 当提供方的完整运行期入口对重复安装安全时，来自 Host 入口的运行期值导入归 `dependencies`。`EntryLifecycle` 实例自包含，没有任何地方跨包比较它们的身份，模块也没有模块级状态，因此本包进 [`scripts/package-dependency-policy.ts`](../../../../scripts/package-dependency-policy.ts) 的 `duplicateSafePackages`，而不是在受评审约束的 `safeHostDependencyExports` 表里开导出级例外。

## Alternatives considered

- **把原语寄宿到 `dsh-scope`，与 `NamedEntries`、`ScopedLayers` 并列。** 否决：那些是 scope 感知的注册表表结构，而这份状态机与 scope 毫无关系；`dsh-scope` 还是稳定的核心包，而共享的机械原语应落在支援级的 `util/` 组。
- **保留两份副本，改为写一份裁定。** 否决：两侧都没有对方不需要的契约。唯一真实差异是派发窗口的个数——一个对两个——而计数正是泛化它的手段。
- **只暴露纯转换，让每个注册表保留自己的一次性闭包。** 否决：幂等的 detach 能力是两侧都记录在案的契约之一，而那两个闭包逐字重复，正是本次要消除的复制。
- **让原语在窗口关闭时自行执行移除。** 否决：转换保持纯布尔返回，各注册表保留只有它能做的动作——删除存储条目、发出销毁边——而决定*何时*的规则集中在一处。

## Consequences

两个注册表各失去三到四个旗标字段、延迟移除分支与一次性闭包；`dsh-session` 的 `SessionEntry` 只把 `detach` 留作 `Session.append` 到服务之间的桥。行为不变：条目最多被公告一次，在创建派发或 append 派发期间请求的移除在该派发结束之后执行，销毁只对已公告的条目发出。公告句子与之前逐字节相同，`hasOpenDispatch` 守卫也保留了既有的 append 重入拒绝——即不得重入的发布方。

## Testing

`packages/util/entry-lifecycle/tests/entry-lifecycle.spec.ts` 钉住这状态机：唯一一次认领及其逐字拒绝、无派发时的立即移除、跨公告的延后、跨一个派发的延后、跨两个嵌套派发的延后、以及嵌套在公告内部的派发的延后，外加一次性能力与被消费的请求。两个注册表自身的套件是本次收敛的行为证据。

## Related

- [受控派发下沉](2026-08-30-contained-emit-loop-sink.zh.md)——本次跟随的同族 `util/` 原语。
- [本地助手副本只有携带自己的契约才能存活](2026-09-14-local-helper-copy-rulings.zh.md)——同一条裁定应用于状态机而非助手函数。
- [受控派发](../../../../packages/util/contained-emit/README.zh.md)——与本包并排在 `util/` 的包。
