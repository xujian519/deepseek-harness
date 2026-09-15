# Agent Note: 提取 ACP 游标编解码与 PTC 的两个簇（Issue #86）

Status: implemented

[English](2026-09-14-acp-ptc-cluster-extraction.md) | 中文

## Problem

两个入口模块都带着与身旁 handler 不共用任何符号的模块级代码。`packages/acp/acp/src/index.ts` 长到 543 行、`apply` 占 341 行，而 `session/list` 的 keyset 游标——一个不透明的 base64url token、它的解码/编码对，以及按字节稳定的排序比较——与 ACP 握手、准入、teardown 共处同一模块作用域。`packages/core/tools/src/ptc.ts` 长到 678 行，其中 `run_code` 各语言的 schema 文本（按运行时语言索引的 flavor 表，加读取已挂载运行时的解析器）与完成值的 JSON 呈现都位于 `createRunCodeTool` 之外，旁边是从不调用它们的代码。

[拆分计划](../../implemented/simplification/2026-09-14-god-file-split-plan.zh.md)把这两者都列为批次 1 的项。批次 1 的切法按构造保持行为：无实例状态、无新接口、行为不变，且入口模块再导出被搬走的东西。本 note 记录这两刀实际产出了什么。

## Decision

入口模块原先内联的代码现在归三个模块，两个入口模块导出的名字与之前完全同名。

| 模块 | 行数 | 归属 |
| --- | --- | --- |
| `packages/acp/acp/src/session-list-cursor.ts` | 75 | `interface SessionListCursor`，以及围绕它的四个纯函数：`decodeSessionListCursor`、`encodeSessionListCursor`、`isAfterSessionListCursor`、`compareSessionIds`。 |
| `packages/core/tools/src/run-code-flavor.ts` | 110 | `interface RunCodeFlavor`、`TYPESCRIPT_FLAVOR`、模块私有的 `PYTHON_FLAVOR` 与 `RUN_CODE_FLAVORS`、`type CodeSdkLanguage`，以及 `resolveFlavor`。 |
| `packages/core/tools/src/json-render.ts` | 103 | `JSON_INDENT`、`MAX_JSON_INDENT_CHARS`、模块私有的 `JsonRenderTask` 与 `renderJsonValue`，以及导出的 `renderValue`。 |

`packages/acp/acp/src/index.ts` 现为 503 行，`packages/core/tools/src/ptc.ts` 现为 492 行。

### ACP 这一刀搬走了什么

游标符号本就是模块私有的——`SessionListCursor` 与四个函数都不带 `export`——所以这一刀搬动它们而没有放宽任何接口面：包的公开 API（`name`、`inject`、`AcpConfig`、`Config`、`apply`）与模块自身的导出列表都未变。`node:buffer` 的 `Buffer` 导入随它们迁入新模块，而在两者之中只有新模块读它。

`resolveSessionListPageSize` 与 `DEFAULT_SESSION_LIST_PAGE_SIZE` 留下：它们校验来自 `Config` 的、由部署方持有的分页上限，属于配置准入而非游标编解码。`apply` 里的 handler 从新模块导入它仍然要花的五个符号。

### PTC 这一刀搬走了什么

flavor 簇整体搬迁，因此该语言的 `description` 与 `code` 参数说明仍共用同一个真值源，而让它与 `SDK_RENDERERS` 保持同步的 `satisfies Record<CodeSdkLanguage, RunCodeFlavor>` 检查也随之一同搬走。`resolveFlavor` 补上了导出函数 JSDoc 门禁要求的 `@param`/`@returns`/`@throws`；其函数体与 `ptc.ts` 中原有的逐字节一致。

`CodeSdkLanguage` 是唯一带 `export` 的搬迁符号。它不是包公开面——`core/tools/src/index.ts` 以 `import type` 消费它且不再导出——所以入口的导出列表未变，而那一处 import 现在改指 `./run-code-flavor.ts`。指向 `ptc.ts` 作为 flavor 表所在地的 `SDK_RENDERERS` JSDoc 在同一次编辑里更新。

两个簇被有意留下。`RUN_CODE_DESCRIPTION_PARAM_DESCRIPTION` 描述的是 `description` 参数，与语言无关——UI 标签契约对每个运行时都一样——所以它属于静态 spec 身旁，而不属于 flavor 查找。`jsonNormalizeArgs` 把一次绑定调用的参数快照成 lossless JSON 供分发与日志使用；它是参数准入而非呈现，JSON 模块也不会有调用者。`json-render.ts` 只导出 `renderValue`；`renderJsonValue` 保持模块私有，因为两者是一对入口与其非字符串实现。

### 验证

`pnpm exec tsc -p packages/core/tools/tsconfig.json --noEmit` 干净。`pnpm exec vitest run packages/core/tools` 报 12 files / 391 passed；`pnpm exec vitest run packages/acp/acp` 报 11 files / 140 passed。没有任何测试需要新的导入路径——ACP 测试通过 `import * as AcpPlugin from '../src/index.ts'` 触达插件，tools 测试则从未直接导入游标符号或 flavor 表。`pnpm exec tsx scripts/run-oxlint.ts packages/core/tools/src packages/acp/acp/src`、`pnpm run typecheck`、`pnpm exec tsx scripts/verify-export-jsdoc.ts`、`pnpm run verify-tool-catalog`、`pnpm run test:docs`（18 项门禁）全部通过。

导出列表是机器比对而非读文确认的：对 `packages/core/tools/src/index.ts` 与 `packages/acp/acp/src/index.ts` 各跑 `diff <(git show HEAD:<file> | grep -oE '^export.*' | sort) <(grep -oE '^export.*' <file> | sort)`，结果均为空。

没有 `jscpd:ignore` 块被触碰。被搬走的区域不含该类标记，且 `pnpm run duplication` 在 2196 个文件上报 0 克隆——搬走游标代码与 flavor 表，并没有对计划第一条规则所保护的兄弟实现形成跨文件克隆对。

## Alternatives considered

- **为两个 PTC 簇合建一个 `ptc-helpers.ts`。** 拒绝：两者不共用任何符号，合在一起会让「改 schema 文案」与「改缩进渲染」落在同一文件——正是这一刀要消除的耦合。
- **把 flavor 表并入已有的 `ts-types.ts` / `py-types.ts`。** 拒绝：flavor 表把语言映射到 schema 文本，SDK 渲染器把语言映射到类型文本，而 `index.ts` 的 `SDK_RENDERERS` 用各自的 `satisfies` 钉住每种表的键集。合并会让一次编辑同时改动两张表。
- **把 ACP 游标簇搬进 `session.ts`。** 拒绝：`session.ts` 拥有单个会话的生命周期，而游标编码的是 `session/list` 分页，由请求 handler 而非任何会话实例使用。
- **把游标符号导出为包 API。** 拒绝：`listSessions` 是它们唯一的调用者。导出会把一个内部编码变成本就刻意保持不透明的传输的兼容承诺。
- **只搬 `renderJsonValue`，把 `renderValue` 留在 `ptc.ts`。** 拒绝：两者是一对入口与其实现，拆开会让 `ptc.ts` 为一行委托而导入一个模块。
- **为 flavor 词汇新建 `src/types.ts`（计划规则 3）。** 拒绝：那条规则覆盖的是*新的共享词汇*。此处没有新东西——符号只是在既有模块之间搬家——且它们唯一的消费者是同一个包的入口。

## Consequences

`ptc.ts` 短了 186 行，`acp/acp/src/index.ts` 短了 40 行。三个新模块合计 288 行，所以净增长来自模块头，以及导出符号现在必须带的 JSDoc；`resolveFlavor` 与 `renderValue` 是其中仅有两个文档是新增而非搬来的。

批次 1 的「不改变行为」规则成立：没有任何常量、默认值或 schema 值移动，模型可见的 `run_code` 描述与参数文本逐字节相同。`core/tools` 的包 README 源码地图新增两行（双语），该双语对的一致性记录已重新记录。

## Related

- [拆分七个上帝文件](../../implemented/simplification/2026-09-14-god-file-split-plan.zh.md)（计划；本条是它的批次 1 项）
- [提取 python 运行期的字节计价与日志台账模块](2026-09-14-code-runtime-python-cost-and-ledger.zh.md)（批次 1 试点，本 note 沿用其体例）
- `packages/core/tools/src/index.ts`（flavor 键被校验对齐的 `SDK_RENDERERS` 表）
- `packages/acp/acp/src/session.ts`（`listSessions` handler 读取的会话记录）
