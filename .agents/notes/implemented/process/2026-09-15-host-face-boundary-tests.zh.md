# Agent Note：把边界测试列入 host 编译面

Status: implemented

[English](2026-09-15-host-face-boundary-tests.md) | 中文

## Problem

`tsconfig.host.json` 是 host 聚合面：它逐个列出包与应用 tsconfig 不拥有的 TypeScript 文件——`apps/web/tests/*` 一条一个文件，外加 `apps/cli/tests`、`apps/desktop/tests`、`benchmarks`、`packages/*/*/tests`、`scripts` 与 `website` 的 glob。清单里漏了两个装有测试的目录——`apps/desktop-host/tests/**` 与 `examples/*/tests/**`——于是五个文件不属于任何 TypeScript 程序：类型感知的 Oxlint 把它们的导入读成 `error` 类型值并报出 62 个 `no-unsafe-*` 发现，而 `tsc -b tsconfig.host.json` 根本不会读它们。

这些发现在首次把一个新的 `apps/web/tests` e2e 文件列入清单的那次运行中出现，且每一条都指向上面两个目录里的文件；把那一行去掉，它们又消失，而那五个文件依旧在所有程序之外。该 pass 如何对待「无项目归属的文件」并不是重点：从没有任何编译面读过这五个文件，因此其中任何类型错误都无从报出。

## Decision

`tsconfig.host.json` 在 `apps/desktop/tests/**/*.ts` 旁列出 `apps/desktop-host/tests/**/*.ts`，在 `benchmarks/**/*.ts` 旁列出 `examples/*/tests/**/*.ts`；examples 的 glob 与 e2e 车道对同一目录已用的写法一致。

这类文件只能归入该聚合面：`apps/desktop-host/tsconfig.json` 只 include `src`，`examples/` 压根没有 tsconfig，而一个导入 host 面自身模块的测试也不可能被 client 聚合面认领。

把五个文件纳入后，暴露出两处从未被任何门禁读过的类型错误，都在 `apps/desktop-host/tests/portless-webserver.spec.ts`：一个路由处理器的 `req` 参数未被使用；一个 host 头被记入 `Array<string | undefined>`，而请求头映射把该头类型定义为 `string | string[] | undefined`。两者在同一次改动中修好，所有断言比较的仍是同一批值。

## Verification

| Check | Result |
| --- | --- |
| `pnpm exec tsx scripts/run-oxlint.ts .` | 4542 个文件 0 警告 0 错误；此前为 62 个 `no-unsafe-*` 错误 |
| `pnpm exec tsc -b tsconfig.host.json` | 退出码 0；修复前 `portless-webserver.spec.ts` 有 2 个错误 |
| `pnpm exec tsc -b tsconfig.client.json` | 退出码 0 |
| `pnpm exec vitest run apps/desktop-host/tests` | 3 文件 / 14 通过 |
| `pnpm exec vitest run --config vitest.e2e.config.ts examples/opendesign` | 1 文件 / 2 通过 |

## Alternatives considered

- **把新列入的那个 e2e 条目从 host 面拿掉。** 实测同样能清掉那 62 个发现，但否决：该文件被列入是因为它导入 `scaffold.ts` 与 `support.ts`,而这两个模块归 host 面所有；拿掉它，另外五个文件仍是和原来一样无人检查。
- **把这两个目录加进 Oxlint 忽略清单。** 否决：该清单收的是「刻意置于程序之外」的文件，例如构建配置。这些是测试，而那 62 个发现是「整个目录无人检查」的唯一信号。
- **给 `apps/desktop-host` 单独做一个同时 include `src` 与 `tests` 的聚合面。** 否决：今天所有应用都把测试交给 host 聚合面，`apps/cli` 与 `apps/desktop` 也不例外；为一个应用换个形状，会让「这个测试归哪个程序」取决于是哪个应用。

## Consequences

五个文件首次进入类型检查，两处错误正是由此暴露。此后 desktop-host 或 example 测试里的类型错误会在 host 类型检查与 lint 处失败，而不是继续隐形；`apps/*/tests` 或 `examples/*/tests` 下再添目录，也无需再改 tsconfig 即可进入程序。

## Related

- [让会话视图按 slot id 与 target 对齐而激活](../architecture/2026-09-15-conversation-view-slot-id-is-target.zh.md)（它新增的 e2e 条目让这些发现浮出水面）
- `vitest.e2e.config.ts`（已对 `examples/*/tests` 取 glob 的车道）
- `tsconfig.host.json`、`.oxlintrc.json`
