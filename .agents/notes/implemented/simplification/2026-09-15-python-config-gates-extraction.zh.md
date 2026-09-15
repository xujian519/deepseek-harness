# Agent Note：提取 python 后端的加载期门禁（Issue #86）

Status: implemented

[English](2026-09-15-python-config-gates-extraction.md) | 中文

## Problem

`packages/experimental/code-runtime-python/src/index.ts` 曾为 1638 行，其中约 450 行属于加载期准入而非运行期：`Config` 接口、门禁所依据的那组固定上限、解释器查找与版本探测，以及一个在注册任何东西之前先跑 168 行门禁与解释器解析的构造函数。真正监督子进程的代码——spawn、fd-3 帧、信号升级、结算——排在这一切之后。

[拆分计划](../../implemented/simplification/2026-09-14-god-file-split-plan.zh.md)把这一项放在批次 3，并点名了使它留在那里的风险：构造函数位于一个 `/* jscpd:ignore-start */` 块内，该块的注释声明其形状与兄弟后端 `code-runtime-worker-thread` 平行，而计划第 1 条要求动该块之前先做出对侧改动或改写注释。

## Decision

`packages/experimental/code-runtime-python/src/config.ts`（510 行）承接加载期准入；`index.ts` 为 1180 行，构造函数只剩四条语句。

| 搬移内容 | 在新模块中的形态 |
| --- | --- |
| `Config`、`ResolvedConfig` | 该模块导出的配置类型；入口原样再导出 `Config` |
| 门禁所检查的上限（`FRAME_PARSE_CAP_BYTES`、`FRAME_ENVELOPE_BYTES`、`MIN_LOG_BYTES`、`CLOSE_REAP_MARGIN_MS`、`OUTPUT_BUDGET_WORST_CASE_ADDRESS_SPACE_MULTIPLE`、`INTERPRETER_BASELINE_BYTES`、`HOST_PARSE_WORST_CASE_MULTIPLE`、`HOST_PARSE_BASELINE_BYTES`、`MIN_CPYTHON`、`PYTHON_PROBE_TIMEOUT_MS`） | 与读取它的那道门禁同址的模块内常量；`CLOSE_REAP_MARGIN_MS` 对外导出，因为结算截止会加上同一余量 |
| 构造函数里的门禁，注释逐字保留 | `resolveRuntimeConfig(config, frameParseCapBytes)`：抛错，或返回已解析配置 |
| `resolvePythonBin`、`validatePythonBin`、解释器错误消息 | `resolveInterpreter(bin)`：解析、拒绝无法解析的名字、探测、返回唯一绝对路径 |
| `hostFrameParseCeiling`、`pythonEnvironment` | 原样保留并导出；入口再导出前者，为 `spawn` 导入后者 |

门禁顺序逐条保留，因为它决定多个配置值同时出错时操作者看到哪条消息，模块文档也如此声明。

### `jscpd` 对称关系：实测而非假定

先后移除两处标记后各跑一次 `jscpd`（范围限定为本包 `src` 加兄弟后端的 `src`）：

| 块 | 移除其标记后 |
| --- | --- |
| 构造函数/拆卸/run | 出现一处克隆：24 行、88 token，对上兄弟后端的构造函数与拆卸 |
| 定时器/中止/live-run 接线 | 无——两个后端的定时器、中止监听与 live-run 记录已不再逐 token 相同 |

因此第一处块仍是承重的，其文本保持原样；第二处今天不压制任何克隆，其注释描述的平行关系检测器看不到。两者此次都不动：第二处的区域是下一刀的主题，是否撤掉标记属于那一刀的判断，且要带同样的实测。仓库级门禁在本次改动下报告 0 克隆。

### 这一刀带来的新测试

`tests/config.spec.ts` 直接调用门禁，这在「只存在于构造函数里」的形态下做不到：一例钉住被准入的配置原样返回，一例钉住 log 预算为浮点、地址空间低于解释器基线两者同时出错时，报告的是前者——即模块文档所声明的门禁顺序。

## Verification

| 检查 | 结果 |
| --- | --- |
| `pnpm exec vitest run packages/experimental/code-runtime-python/tests` | 6 文件 / 293 通过、2 跳过（真实子进程套件，未改动） |
| 本包 `src` 的限定范围覆盖率 | `config.ts` 语句、分支、函数、行均 100%；`index.ts` 唯一未覆盖块是 `readProcessStart` 的 `/proc` 读取，任何 macOS 宿主都不会执行（由 `process.platform === 'linux'` 决定，且它原本就带着 `v8 ignore` 注释） |
| `pnpm exec tsc -b packages/experimental/code-runtime-python` | 退出码 0 |
| `pnpm exec tsx scripts/run-oxlint.ts <两个文件>` | 0 警告、0 错误 |
| `verify-export-jsdoc` | 每个导出名都有文档 |
| `pnpm run duplication` | 2227 个文件、0 克隆 |

## Alternatives considered

- **把门禁留作 `PythonCodeRuntime` 的私有方法。** 否决：它们对 `(config, frameParseCapBytes)` 是纯的、不触及实例状态，做成方法只会留下 168 行的构造函数，并让它们只能通过完整插件加载来测试。
- **把第一处 `jscpd` 标记改写成「已不需要」。** 被上述实测否决：去掉它克隆就重现。
- **在本次改动里撤掉第二处标记。** 否决：它所在的块是 supervisor 那一刀的区域，撤掉一条已声明的平行关系应由那次改动举证。
- **把上限集中到 `limits.ts`。** 否决：每一个上限都只有一个读者——紧邻的那道门禁——除 `CLOSE_REAP_MARGIN_MS` 之外，而它的第二个读者是结算截止；单独一个文件只会把常量和唯一读它们的代码分开。
- **为本包补一个 `types.ts` 承载切分后共享的词汇。** 此处否决：跨新边界的东西只有入口再导出的 `Config` 类型，计划为本包记录的「词汇无处安放」问题并未出现。

## Consequences

插件入口现在读起来就是一个插件：注册、给配置设门、监督运行。本包在批次 3 的剩余项是进程 supervisor——`execute` 的子进程生命周期，约 770 行，仍在 `index.ts`。

## Related

- [拆分这七个上帝文件](../../implemented/simplification/2026-09-14-god-file-split-plan.zh.md)（计划；这是批次 3 第六刀落地）
- [提取 analyzer 的类型图](2026-09-15-analyzer-type-graph-extraction.zh.md)（批次 3 第五刀落地）
- [提取日志台账](2026-09-14-code-runtime-python-cost-and-ledger.zh.md)（本文件在批次 1 的那一刀，也是其门禁上限首次被测量的地方）
- `packages/experimental/code-runtime-python/src/config.ts`、`packages/experimental/code-runtime-python/tests/config.spec.ts`
