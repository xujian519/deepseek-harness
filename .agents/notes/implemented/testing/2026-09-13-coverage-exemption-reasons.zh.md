# Agent Note: 覆盖率豁免写明该文件自己的理由

Status: implemented

[English](2026-09-13-coverage-exemption-reasons.md) | 中文

## Problem

`vitest.config.ts` 把约 98 条源码 glob 排除在逐文件 100% 门禁之外,每条都以注释写明该文件为何在门外。Issue #91 记录了 7 条注释与实际文件不符的条目。`client/modules/src/client/system.ts` 与 `client/hmr/src/client/index.ts` 夹在 inspector 清单与「Web config-tree boot」注释之间,两者都没有归属到任何理由;`ui-input-trigger/src/core/menu.ts`、`ui-input-trigger/src/core/detect.ts`、`test-support/client-runtime/src/translate.ts` 挂在一条声称需要浏览器级 harness 的 client-lane TODO 之下;`packages/extensions/*/src/**/*.ts` 与 `*.tsx` 则完全没有理由。

用 v8 逐文件覆盖率实测这 7 个文件,说明理由本身是有意义的:`client/hmr/src/client/index.ts` 处于 35.18% 语句、11.76% 分支,确实需要注释所说的 harness;其余则是普通的单元测试缺口——`system.ts` 98.34% 行 / 91.66% 分支,`menu.ts` 98.83% 语句,`detect.ts` 96.77% 分支,`translate.ts` 80% 行。相信注释的读者会去找浏览器测试道,而不是去找缺的用例。

## Decision

- **删除 4 条豁免,这些文件现以 100% 处于逐文件门禁之下。**
  - `client/modules/src/client/system.ts`:`tests/loader.client.spec.ts` 中新增 5 个用例,覆盖无 rev 的 bundle URL、图不携带的声明式动态请求、无图行但已注册的 factory、对 bootstrap id 的 `invalidate`,以及对图外 id 的 `invalidate`。同时清掉两处构造。构造函数里的重复 `id` 检查被删除:`parseBootManifest` 已用同一条诊断拒绝重复(`manifest.ts:239`),而该类只经由先做解析的 `createClientModuleSystem` 构造;那条看起来覆盖它的用例实际走的是解析器,现已移入 boot-manifest 一节并改用如实的名字。`BootManifest.modules` 现在写明解析器保证的 id 唯一性。
  - `client/ui-input-trigger/src/core/detect.ts`:`boundaryOk` 的 `char: TriggerChar` 参数,其唯一调用点传的是 `'/'`——反向扫描会跳过其他所有字符,`@` 走共享的 file-reference 文法。该参数及其永不成立的分支 `char === '/'` 一并删除。
  - `client/ui-input-trigger/src/core/menu.ts`:`next === undefined` 守卫是为 `noUncheckedIndexedAccess` 兜底的,而前一行 `pos.length > 0` 使它不可达;它保留一条 `/* v8 ignore next -- … */` 理由,而不是文件级豁免。
  - `test-support/client-runtime/src/translate.ts`:`tests/helpers.client.spec.tsx` 中新增两个用例,覆盖字典顺序、回退到键本身,以及带未知占位符的 `{name}` 插值。
- **`client/hmr/src/client/index.ts` 保留豁免,并写明它自己的理由**:其浏览器半侧驱动系统 SSE 通道与 Loader 的条目替换,jsdom 测试道打不开这条通道。
- **extensions 通配条目合并为一条**,即 `packages/extensions/*/src/**/*.{ts,tsx}`(原两条 glob 选中同样的 42 个文件),理由改为如实陈述:该树从未进入逐文件门禁,`tool-cordis` 自身的 src 由真实组合轮次(`apps/web/tests/cordis-tool-round.e2e.ts`)与录制会话触达,而非其单元套件;两份生成的 API catalog 归 `verify-cordis-api` / `verify-cordis-inspect-catalog` 所有。
- **没有为「每条豁免都带理由」新增门禁。**这里的失效模式是归属——一条理由本属于相邻分组——存在性检查看不见它;而类别型条目(`packages/*/*/src/types.ts`、`bin.ts`、`worker.ts`)本就是不带 TODO 的 glob。

## Alternatives considered

- **把 extensions 通配条目收窄到实际未覆盖的文件。** 否决:该树整体实测 53% 语句,`tool-cordis/src` 在其自有套件下为 0%,未覆盖集合是这 42 个文件中的大部分——一份具体清单等于把通配条目重述一遍,还多了维护面。
- **连 `client/hmr/src/client/index.ts` 也覆盖掉并删除豁免。** 否决:35.18% 语句、11.76% 分支;该文件需要活的 `EventSource`、Loader 条目树与一次 rebuild 帧,这正是 client 各包在等的浏览器测试道,而不是一个单元用例。
- **新增「每条目都要有前置注释」的检查。** 否决理由同上:促使 Issue #91 立项的那几条条目全都有前置注释,该检查会在漂移的清单上原样放行。
- **保留 `system.ts` 的豁免,把 9 处未覆盖登记为债务。** 否决:那是 client 模块表自身错误路径上的 5 个单元用例;而构造函数里的重复检查经查实是对一个由 manifest 解析器拥有的不变量的第二个校验器。

## Consequences

4 个本可静默退化的文件进入门禁,两处冗余构造消失。删除豁免会转移成本:这些文件里新增分支现在需要测试,而不是一句注释。其余豁免保留原有理由,另外约 90 条条目并未逐条重审——别处一条过时的理由仍会读起来像当前事实,台账记录了这一点。

## Testing

在移除豁免的前提下,这 4 个文件在 `v8` 下实测为 100% 语句/分支/函数/行(`npx vitest run … --coverage --coverage.include=<file>`);受影响套件 `npx vitest run` 全绿:29 个文件、556 个用例、1 个预期失败。`pnpm run typecheck`、`pnpm run lint`、`pnpm run verify-module-graph` 通过;extensions glob 的合并与被替换的两条 glob 等价(`node:fs` 的 `globSync` 对两种选法各得 42 个文件)。

## Related

- [在仓内 Issue 中跟踪技术债](../process/2026-09-11-tech-debt-issue-tracking.zh.md)——产出本发现的扫描,记录在 Issue #91。
- [`src/types.ts` 的运行时代码伴随物边界](../architecture/2026-09-13-types-ts-runtime-companion-boundary.zh.md)——同一改动的另一半,修正了 `types.ts` 豁免所依据的那句说法。
