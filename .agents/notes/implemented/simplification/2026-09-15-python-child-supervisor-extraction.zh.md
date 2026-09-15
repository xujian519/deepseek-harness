# Agent Note：提取 python 后端的子进程监管器（Issue #86）

Status: implemented

[English](2026-09-15-python-child-supervisor-extraction.md) | 中文

## Problem

加载期门禁搬走之后，`packages/experimental/code-runtime-python/src/index.ts` 曾为 1180 行。剩下的是插件本体——`Config` 注册、`teardown`、`run`、binding 校验、每次运行的脚本落盘——外加一个 760 行的 `execute`，它掌管着整整一个子进程：spawn、fd-3 帧读取器与其分发、带回压与积压上限的回复通道、墙钟定时器与中止监听、SIGTERM → 宽限 → SIGKILL 升级，以及要等进程组清空才落地的结算。

[拆分计划](../../implemented/simplification/2026-09-14-god-file-split-plan.zh.md)把这一项记在批次 3，名为「配置门禁与进程监管」；门禁[已先行落地](2026-09-15-python-config-gates-extraction.zh.md)，这里是另一半。

## Decision

`packages/experimental/code-runtime-python/src/supervisor.ts`（899 行）导出 `superviseChildRun`；`index.ts` 为 364 行，其 `execute` 只负责构造这次调用的入参。

| 搬移内容 | 在新模块中的形态 |
| --- | --- |
| `execute` 的 760 行函数体 | `superviseChildRun` 的函数体，逐字搬移 |
| `this.pythonBin`、`this.config`、`this.frameParseCapBytes` | 同名的 `ChildRunDeps` 字段 |
| `this.live` | `ChildRunDeps.liveRuns`，因为函数体里本就有一个局部 `live`：单次运行自己的记录 |
| `request.program`、`request.signal` | `ChildRunDeps` 字段，使监管器完全不读 seam 的请求对象 |
| `ValidatedNamespace`、`LiveRun` | 由监管器导出：命名空间表是它的输入，运行记录是它为 teardown 登记的状态 |
| `MAX_PENDING_REPLIES`、`GROUP_REAP_POLL_MS`、`readProcessStart` | 监管器自己的上限与 pid 复用防护；入口再导出 `readProcessStart`，其测试正是从那里导入 |

入口把 `execute` 保留为十行委派，读者此前看到的方法集（`run` → `execute`）不变，导出清单也不变。依赖方向是单向的：`supervisor.ts` 导入 `config.ts`、`cost.ts`、`frame-reader.ts`、`output-ledger.ts` 与 `protocol.ts`，除入口外没有任何模块导入它。

### 第二处 `jscpd` 标记经实测后撤除

接线那一块连同它的 `/* jscpd:ignore-start */` 标记一起搬了过来，而配置门禁那一刀已经实测出这对标记什么都不压制。在新布局下重测——范围限定为本包 `src` 加兄弟后端的 `src`，移除标记后跑 `jscpd`——结论相同：有无标记都是 0 克隆。因此该压制保护的是空集，该块改为一段注释声明它与兄弟后端共享的平行关系（这部分才值得保留）；今后若某次编辑真的造出克隆，会由 duplication 门禁报出来，而不是被藏住。

另一对标记（入口里的构造／拆卸／run）未动，且仍承重：去掉它就有 24 行、88 token 与兄弟后端的构造与 teardown 相同。

## Verification

| 检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run packages/experimental/code-runtime-python/tests` | 7 文件 / 295 通过、2 跳过——真实子进程套件原样驱动搬移后的函数体 |
| 本包 `src` 的限定范围覆盖率 | 各文件语句、分支、函数、行均 100%，唯 `supervisor.ts` 的 `readProcessStart` 例外：其 `/proc` 读取任何 macOS 宿主都不会执行（由 `process.platform === 'linux'` 决定并带 `v8 ignore`，与它在入口里时完全一致） |
| `pnpm exec tsc -b packages/experimental/code-runtime-python` | 退出码 0 |
| `pnpm exec tsx scripts/run-oxlint.ts packages/experimental/code-runtime-python` | 0 警告、0 错误 |
| `pnpm run duplication` | 2228 个文件、0 克隆 |
| `pnpm run test:docs` | 18/18 |

## Alternatives considered

- **把函数体搬成一个 `ChildRun` 类。** 本刀否决：该函数体闭包住了大量状态，改成类就得让 `settled`、`decided`、`pendingCalls`、`pendingReplies`、`nextCallId`、`draining`、`killing`、`runSent`、`closeDeadline` 各自变成字段，而它依赖的初始化顺序（boot 帧最后写入，因为其失败路径要读墙钟定时器与中止监听）会变成字段初始化顺序。用函数则保住这份被写出并评审过的顺序，显式入参由 deps 清单承担。
- **顺手把回复通道与信号升级拆成独立模块。** 两者都是真实候选——回复通道只触及 fd-3 句柄、结算标志与结算回调——但各自是一个独立的接口决策，应当自带证据，而不是搭这一刀的车。
- **保留接线处的 `jscpd` 标记。** 被上述实测否决：什么都不压制的标记，是读者无法核验的声明。
- **把 `execute` 留在入口，改成把插件交给它。** 否决：入口中没有别的东西读子进程，而 deps 对象正是那条边界。

## Consequences

入口现在只装插件自身的关切——注册、seam 的 binding 校验与脚本落盘——子进程集中在一个模块里。批次 3 的剩余项是 analyzer 的 Remote/RPC 那一块；本包的批次 3 工作已做完。

## Related

- [拆分这七个上帝文件](../../implemented/simplification/2026-09-14-god-file-split-plan.zh.md)（计划；这是批次 3 第七刀落地）
- [提取 python 后端的加载期门禁](2026-09-15-python-config-gates-extraction.zh.md)（本批次项的前一半）
- [提取日志台账](2026-09-14-code-runtime-python-cost-and-ledger.zh.md)（本文件在批次 1 的那一刀）
- `packages/experimental/code-runtime-python/src/supervisor.ts`、`packages/experimental/code-runtime-python/src/index.ts`
