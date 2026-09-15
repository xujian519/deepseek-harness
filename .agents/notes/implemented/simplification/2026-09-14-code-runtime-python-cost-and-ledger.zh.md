# Agent Note: 提取 python 运行期的字节计价与日志台账模块（Issue #86）

Status: implemented

[English](2026-09-14-code-runtime-python-cost-and-ledger.md) | 中文

## Problem

`packages/experimental/code-runtime-python/src/index.ts` 长到 2405 行，装着三个彼此从不共用一行的关切：子进程监管、fd-3 帧读取器，以及运行期在 `logs` 里返回的一切的计价。改一次字节预算或截断标记，都要先读完成进程、升级、teardown 那一段；而要碰一次截断边界，唯一手段是真的拉起一个 python 子进程——台账没有任何测试能调用的面。

[拆分计划](../../implemented/simplification/2026-09-14-god-file-split-plan.zh.md)把这一刀定为批次 1 的首项，也是整个计划的试点，理由是兄弟后端 `packages/code-runtime/code-runtime-worker-thread/src/index.ts` 已经有一个抽好的 `OutputLedger`，两者可以对拍同一组边界案例。本 note 记录这一刀实际产出了什么。

## Decision

入口模块原先内联的代码现在归两个模块，`src/index.ts` 为 1801 行。

| 模块 | 行数 | 归属 |
| --- | --- | --- |
| `src/cost.ts` | 131 | 字节计价与截断词汇：`jsonStringCostUpTo`、`capMessage`，以及两者共用且模块私有的那个截断标记。 |
| `src/output-ledger.ts` | 619 | `class OutputLedger`，外加 fd-3 帧读取器与它共享的片段累积原语。 |

入口模块导出的名字与之前完全同名。`detachResidual` 与 `MAX_PENDING_CHUNKS` 搬了出去但仍从 `src/index.ts` 再导出，因此 `tests/residual-detach.spec.ts` 仍从 `../src/index.ts` 导入。没有任何快照、夹具或测试需要改动。

### 台账的接口面

每个运行期一个实例，持有该运行的 promise 最终解决时带上的 `logs`、每一个日志条目与每一个游离 stdout/stderr 字节共同计入的 `maxLogBytes` 预算，以及各条收尾路径汇入的截断状态。入口模块构造它、把四个 stdout/stderr 监听器接到它上面，并调用五个方法：`log` 帧分支调 `admitFrame(text, open)` 与 `markChildTruncated()`，原先收尾未闭合帧的位置调 `sealOpen()`，管道关闭处调 `flushStdout()`/`flushStderr()`，解决时读 `ledger.lines`。

`admitFrame` 是一个方法，而不是原先 `case 'log':` 分支所分派的三个。那个分支之所以能在*未闭合帧*、*闭合一个已持有帧*、*已闭合帧* 之间选择，靠的是读台账自己的计数器；把判断与状态拆开，就等于把 `openParts`、`openSealed`、`budget` 导出给入口模块。判断留给台账，入口模块只转述帧说了什么。

两处 `/* v8 ignore ... */` 注解随其分支一同搬迁，并保持原有行数：`flushStray` 中段序预算刷写边界那处，以及 `closeOpen` 里防御性的 `!this.truncated` 守卫。

### 共享的片段原语

`MAX_PENDING_CHUNKS`、`Utf8CostState`、`accrueStrayCost`、`detachResidual` 原先同时被台账和留在入口模块的 fd-3 帧读取器使用。它们落在 `src/output-ledger.ts` 而非第三个模块，从而保持依赖单向（`index.ts` → `output-ledger.ts`），并把模块数控制在计划承诺的两个。`detachResidual` 是 fd-3 读取器实际调用的那一个；它在入口模块的再导出保留给从那里导入的测试。

### 验证

`pnpm exec tsc -p packages/experimental/code-runtime-python/tsconfig.json --noEmit` 干净；`pnpm exec vitest run packages/experimental/code-runtime-python` 报 283 passed | 2 skipped，与切割前计数一致；`pnpm exec tsx scripts/run-oxlint.ts packages/experimental/code-runtime-python` 干净；`pnpm exec jscpd --config .jscpd.json packages/experimental` 未发现克隆。两个新模块在覆盖率运行下语句、分支、函数、行均为 100%。`index.ts` 报 98.84% 语句，缺口全部来自 `readProcessStart` 的 Linux `/proc/<pid>/stat` 分支——Darwin 覆盖率泳道无法到达，与切割前该文件既有的缺口同一处。

两个 `jscpd:ignore` 对称块都未被触碰：被搬走的区域不含 `jscpd` 标记，与 `code-runtime-worker-thread` 的配对完好。

## Alternatives considered

- **用闭包工厂而不是类。** 拒绝：计划是以 worker-thread 先例承诺了 `class OutputLedger`，而这个类正是给测试一个可构造的面——传入预算，喂入帧与游离字节，读出 `lines`——且不需要子进程。
- **为共享片段原语加第三个模块（`chunks.ts`）。** 拒绝：引用它们的只有两个模块，依赖方向两种做法都一样是单向；第三个文件的存在只为放置四个符号，而台账模块本来就要导入它们。
- **在同一次切割里把 fd-3 帧读取器也搬走。** 拒绝：它的帧回调携带原始行长，而计划把那个接口留到批次 2 先定形。在这里切它，等于让一次搬运顺手发明出该协议。
- **把三路帧判断留在入口模块，台账只暴露三个方法。** 拒绝：那个判断读的是台账自己的计数器，这么做属于导出状态而非导入行为。
- **把台账抽成接收累积状态作参数的纯函数。** 拒绝：它穿针引线的状态（预算、游离缓冲、未闭合持有、截断标志）是一个运行期的生命周期；让每个调用点都传一遍，等于把文件结构搬进每个调用者。

## Consequences

`index.ts` 短了 604 行、少了一个类，台账不拉子进程即可测试。代价就是本次试点量出来的那笔账：两个新文件，750 新增行对入口模块删除的 625 行，21 行接线——净增长来自模块头、类骨架，以及被搬走的注释变成的方法 JSDoc。没有快照移动。

浮现出一条约束：在类字段缩进下，原先在闭包里能放进一行的两个 `StrayBuffer` 初始化器超过了 140 列 lint 上限，于是改回 `emptyStray()` 工厂。抽进类对格式而言不是行数中性的。

## Related

- [拆分七个上帝文件](../../implemented/simplification/2026-09-14-god-file-split-plan.zh.md)（计划；本条是它的批次 1 试点）
- [收编硬编码可调参数审计](2026-09-14-hardcoded-tunable-closeout.zh.md)（Issue #88；批次 1 的改动规则：不移动任何常量或默认值）
- `packages/code-runtime/code-runtime-worker-thread/src/index.ts`（`OutputLedger` 先例）
