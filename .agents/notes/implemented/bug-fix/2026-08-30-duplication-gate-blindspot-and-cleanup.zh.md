# Agent Note: 重复克隆门禁盲区与全量扫描清理批次

Status: implemented

[English](2026-08-30-duplication-gate-blindspot-and-cleanup.md) | 中文

## 问题

2026-08-30 的全仓扫描（报告见 `.agents/audits/2026-08-30-full-scan.md`）发现 `pnpm run duplication` 在 master 上是红的（28 个克隆），而 CI 全绿：fork workflow 的主 job 跑了 lint、typecheck、测试和文档，却从不跑 duplication，失败无人见证。克隆分三类：better-sidebar 内部 24 处结构性重复；一份 client-connection 信任围栏的派生副本，其文件头仍声称"behaviorally identical"，但两份副本早已漂移；以及 browser-backend 与 patent-data 共用的一对平台命令辅助函数。扫描还发现了 DeepSeek 流翻译器的一个模型可见缺陷：wire id 始终未到达的 tool-call 块会闭合成一个带空 branded id 的 `ContentBlock`，静默毒化下游的工具结果关联，而两个测试把这个行为钉死在原处。

## 决策

- 主 CI job 现在在 lint 之后运行 `pnpm run duplication`，在不改动 master ruleset 所钉 job 名的前提下消除盲区。
- better-sidebar 的 24 处克隆全部清零：提取局部辅助函数、一个共享 props 类型与三个纯模块（`src/client/drag-clear.ts`、`src/loopback-allowlist.ts`、`src/tool-result-text.ts`）；行为、导出与文案不变，由该包 152 个 spec 文件守护。
- 信任围栏副本留在各自包内。被克隆的区域加 `jscpd:ignore` 标记，派生文件头现在如实记录有意的漂移：sidebar 的 Origin 围栏比较 hostname（Edge 151 会把非默认端口 loopback 页面的 Origin 序列化成不带端口），/api 围栏比较 host:port。browser-backend/patent-data 的命令辅助函数同样标记，其共享归宿是未来的 util 组下沉。
- `translate.ts` 现在在闭合 tool-call 块时，若 wire id 缺失或为空则以 `MALFORMED_RESPONSE` 失败。delta 级缺失保持宽容——只有组装完成的块才被判定。两个钉住空 id 组装行为的测试改为断言拒绝，其中之一同时钉住 delta 流本身仍容忍缺失。
- 一并落地的小发现：`compaction-basic/region.ts` 七处无理由 non-null 断言豁免补齐理由；openviking specs 的 24 条未使用 oxlint-disable 指令删除（仍生效的指令保留）；`gatesForMode` 以 `satisfies never` 收尾；包组职责表补 desktop/mcp/patent/self-evolve 四行并修正 util 行的零依赖措辞；`pty-manager.ts` 的 spawn-helper 镜像来源改为 `dsh-subprocess-local`——真正拥有该 postinstall 的包。

## 后果

每个 PR 和 master 推送现在都会运行重复克隆门禁，master 回到零克隆基线；两份有记录的派生副本作为标记过的例外保留，而非沉默的债务。tool-call id 始终未到达的 provider 响应现在在翻译时刻以 `MALFORMED_RESPONSE` 失败，空 branded id 不可能再进入会话日志或工具结果关联；delta 流与一切格式良好的响应行为与之前完全一致。lint 回到零警告，扫描发现的登记缺口——无理由的抑制、过时注释、过时的 note 前提、缺失的四行组表——全部在源头关闭。

## 备选方案

**把两份信任围栏合并回单一导出辅助函数。** 暂不采纳：两包互不依赖，且 Origin 比较方式的差异是安全语义选择（hostname 比较会放行同主机跨端口页面；这正是修复 Edge 151 的取舍）。统一它需要一个覆盖两道围栏的策略决策，不是单侧重构。

**现在就把平台命令辅助函数下沉到 util 组包。** 推迟：它要给 browser-backend 和 patent-data 增加 workspace 依赖，且属于更大范围的 M1 小工具下沉；在那之前 ignore 标记让门禁保持诚实。

**保留翻译器的空 id 兜底，把校验加在别处。** 否决：空 branded id 会进入会话日志与工具结果关联，在那里没有其他环节能恢复身份；assembler 与回放 fixture 消费的正是组装完成的块，闭合时刻是唯一还能对事实做判定的位置。
