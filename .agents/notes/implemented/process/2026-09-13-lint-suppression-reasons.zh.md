# Agent Note: lint 抑制须说明理由，块标题可以承担它

Status: implemented

[English](2026-09-13-lint-suppression-reasons.md) | 中文

## 问题

Issue #94 报告仓库里有少数 `oxlint-disable` / `eslint-disable` / `@ts-expect-error` 指令完全没写理由，并要求就「一条注释最多能覆盖多大范围」作出裁定。它的证据两个方向上都已过期：

- 点名的三处里，`packages/compaction/compaction-basic/src/region.ts:130` 与 `packages/core/tools/src/testing.ts:30` 所在块内确实没有任何理由；`packages/session-query/session-query/tests/observation.spec.ts:115` 有理由，只是它位于同一函数体内、该指令上方 28 行处。
- 该 Issue 还称 region.ts 其余十处同类抑制多为无理由、`:102` 与 `:547` 的理由只解释了 `no-deprecated`。两者都不成立：那十处都带有注释，两条双规则指令也各有一行对应各自规则的理由。

按解析器口径对受 lint 约束的语料重新计数，共 400 条抑制指令，因此残留其实很小。但没有任何机制让它保持小：`reportUnusedDisableDirectives` 问的是相反的问题（这条指令是否还有必要），而一条没写理由的指令可以通过所有门禁。

## 决策

**每条指令都要说明自己为何安全，形式有三种。** 行内（`// oxlint-disable-next-line <rule> -- 理由`）；TypeScript 自身解析的 `@ts-expect-error <理由>` 尾随文本；或以注释充当该指令所在空行分隔块的标题。标题这一形式是有意保留的：`defineTool` 的七处 `unbound-method` 提取共享 `options` 的同一个性质，`patent-teams` 的三处保存原方法共享同一个 dispose 事实，逐行重复同一句话只会增加噪音而非信息。JSDoc 文档块说明的是它前面的声明，因此永远不算抑制理由。一条关掉多条规则的指令需要为每条规则各给一个理由；这属于评审层的规则，因为理由本身是散文。

**三处无理由的点现已写明各自的事实。**

- `region.ts:130`——上方的空 surface 提前返回与长度检查共同保证索引 0 在范围内。
- `core/tools/src/testing.ts:30`——对象字面量形式的 fixture 体从不读 `this`，且被提取的引用以显式参数调用。
- `observation.spec.ts:115`——stub 原样转发注入的失败值，而用例会注入非 Error 值来验证包容性。

**新增门禁守住这条线。** `scripts/verify-suppression-reasons.ts` 报告每一条未写理由的指令，并以 `suppression-reasons` 为 id 注册进 `ciSharedStaticGates`。按 `scripts/AGENTS.md` 的要求，发现是语法感知的：`scripts/oxlint-contract.spec.ts` 有意把指令文本写在字符串字面量里，逐行正则会把它们报成无理由。扫描对语料设防（文件列表为空、找不到任何指令即失败），并跳过完全不含这三族指令的文件不做解析。该叶门只落在静态聚合：静态与 hygiene 两份列表本就大量重复，再注册一处会让其中一段公共行拉长到越过 jscpd 的克隆阈值，`duplication` 会报出一个克隆。

## 考虑过的替代方案

- **要求理由写在指令上或紧邻的上一行。** 否决：目前 400 条里有 75 条依赖块标题，严格相邻规则会把它们全部改写，而读者查找理由的距离依然只有几行。
- **校验多条规则的指令为每条规则各写了一处理由。** 否决：理由是散文，门禁分不清哪一句对应哪条规则；一条双规则指令只写了对应其中一条的一句话也会被判通过。
- **把残留交给评审处理。** 否决：region.ts 缺理由一事此前已作为 P2-3 提出，到 2026-09-11 复测时仍未补。
- **在同一门禁里一并禁掉 `@ts-ignore` 与 `@ts-nocheck`。** 超出范围——仓库中两者均为零，门禁只接纳实际在用的这三族指令。
- **把该门禁放进快速文档聚合，让本 fork 的 CI 直接运行它。** 否决：它是源码门禁而非文档门禁，且其 spec 的全仓用例已经在每个执行单元测试套件的泳道里运行。

## 后果

仓库对抑制注释有了一条统一规则，未写理由的指令现在会挂门禁，而不是通过评审。被接纳的标题形式以空行分隔块为界、而非以相邻为界，因此长函数体仍可能用一个离指令很远的标题满足门禁——`observation.spec.ts` 的 stub 就是现成例子。要堵住它就得采用上面否决掉的严格相邻规则；块边界是有意的取舍。

## 测试

`pnpm run verify-suppression-reasons`（400 条抑制，零发现）。`npx vitest run scripts/verify-suppression-reasons.spec.ts`——15 个用例覆盖每一处被接纳与被排除的形式：行内理由、`@ts-expect-error` 尾随文本、裸 `@ts-expect-error`、上一行注释、跨语句的块标题、被空行隔开的块标题、JSDoc 块、多行块指令、`-line` 形式、字符串与模板字面量里的指令文本、只是提到指令的散文、`oxlint-enable`，以及全仓扫描。负控制：在一个探针 spec 里放一条裸指令，门禁以退出码 1 报出 `file:line`；随后删除该探针。`pnpm run lint`、`pnpm run typecheck`、`npx vitest run scripts/run-gates.spec.ts`。

## 相关

- [类型感知 lint 清理](2026-08-29-type-aware-lint-cleanup.zh.md)——把抑制注释称为承重文档，并为每处 jsdom 防御配对它对应的指令。
- [以同仓库 Issue 跟踪技术债](2026-09-11-tech-debt-issue-tracking.zh.md)——Issue #94 的登记处。
