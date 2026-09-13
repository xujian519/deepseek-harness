# Agent Note: 本地小工具副本只有在自带契约时才保留

Status: implemented

[English](2026-09-14-local-helper-copy-rulings.md) | 中文

## Problem

2026-08-28 的清扫把跨包小工具族折叠进 `@deepseek-ai/dsh-value`、`@deepseek-ai/dsh-util-values` 与 `@deepseek-ai/dsh-timeout`,2026-09-12 的几批（#110–#114）又收敛了一批复发的副本。Issue #87 要求按当时的代码树重测这些族:台账两次写下「已收敛 / 0 剩余」而副本仍活着,而它确实测过的四个族(`sleep`、abort race、`hasExactKeys`、`isAbortError`)也已经与叙述不符。

2026-09-14 按 `7a031dcbe8` 复测后,`packages/*/*/src` 内仍有三处真实副本,且都推翻台账: [`ask-question-row.tsx`](../../../../packages/client/ui-tool/src/client/tool/toolviews/ask-question-row.tsx) 的 `isRecord`(09-12 批次漏记)、[`ContextBody.tsx`](../../../../packages/client/ui-chat/src/client/chat/ContextBody.tsx) 的 `asRecord`(所在包早已在兄弟文件里 import 共享版)、以及 [`core/session/src/surface.ts`](../../../../packages/core/session/src/surface.ts) 的 `isDeepEqualJson`——它留下的理由(「替代 `node:util` 的 `isDeepStrictEqual` 以保持本模块浏览器安全」)已不描述任何事实:该模块早已 import `dsh-value` 的 `isRecord`,而 `dsh-util-values` 本就是该包的依赖,且通篇没有 `node:` 导入。

把两份副本并排读还暴露出共享版的一个缺陷。`deepEqualJson` 用 `key in right` 判定键存在,而 `in` 会看见继承来的名字。`JSON.parse('{"__proto__":{}}')` 造出的是**自有** `__proto__` 数据属性,于是把它与 `{"other":1}` 相比时,`right['__proto__']` 读成 `Object.prototype`(一个键、自有可枚举键为 0),递归在空键集上恒真,两份记录被判相等。本地副本用的是 `Object.hasOwn`,没有这个缺陷。

## Decision

- **三处副本收进共享包。** 两处是客户端包,`dsh-value` 进它们的 `devDependencies` 并补 tsconfig reference,与 [`ui-chat`](../../../../packages/client/ui-chat/package.json)、[`file-upload`](../../../../packages/client/file-upload/package.json) 既有的处理一致;`core/session` 本就声明 `dsh-util-values`,而 `deepEqualJson` 正住在那。
- **共享 `deepEqualJson` 按自有可枚举键比较。** `key in right` 改为 `Object.hasOwn(right, key)`,并在 JSDoc 里写明该保证。这不是措辞差异:[`settings`](../../../../packages/settings/settings/src/index.ts) 与 [`settings-file`](../../../../packages/settings/settings-file/src/index.ts) 把该函数当作「配置是否变化」的闸门,误判相等会静默丢弃一次写入。
- **只有自带共享版没有的契约,副本才留。** 保留项在台账表里逐条写明理由:四份 `abortable`(分类后的 abort 值、竞速后再查一次信号、`WEB_ABORTED` 域错误、接受「值或 promise」)、三份 `waitWithAbort`(`Error` 逃逸适配、`SessionQueryError`、`Error` 规整)、`sleep` 的两种分叉形态(dispose 宽限用的 `unref` timer、接受 `AbortSignal` 的那个)、`dsh-subagent` 公开导出的三参 `assertPositiveFinite`(前缀分离传、抛 `Error`)、以及 `session-query-sqlite` 的域错误包装。
- **发布面之外的副本不在范围内。** `apps/` 与 `scripts/` 各有十处 `isRecord`,另有 `scripts/client-build-environment.ts` 的两参 `hasExactKeys`。它们是应用外壳与仓库工具内部的单行收窄谓词;收敛它们要给这两棵树补 workspace 依赖与构建前置,换不到任何共享行为。
- **188 处内联 `instanceof Error ? <expr>.message` 保持原样。** 每一处都在捕获它的 `catch` 块内就地渲染抛出值,收敛要给约百个文件补依赖与项目引用,换来的只有一步语义(带字符串 `message` 的对象渲染成该 `message` 而非 `[object Object]`)与 hostile-proxy 兜底。

## Alternatives considered

- **把 `sleep` 下沉进 `dsh-timeout` 以关掉该族。** 否决:这些实现之间没有需要同步的东西——没有截止、没有取消、没有上限——而四处里有两种分别差在 `unref` 与接受信号上,单一签名就得为一位调用方引入选项。`dsh-timeout` 的身份是截止算术与「超时 vs 取消」的分类,一个裸等待会既无前者也无后者地坐在 `deadline` 旁边。
- **本批一并收敛 `dsh-subagent` 的三参助手。** 推迟:它是被三个 provider 消费的公开导出,收敛会把它们的抛出类型从 `Error` 变成 `TypeError`。这是机械改动,但影响面与「删除私有本地函数」不同,应自成一批评审。
- **保留本地 `isDeepEqualJson`,不动共享比较器。** 否决:有缺陷的是共享版,保留副本等于把误判相等留给 settings 这条影响更大的消费路径。
- **直接删掉冗余副本而不硬化共享版。** 同样否决——那会把 `core/session` 搬到有缺陷的比较上。
- **收敛内联三元族。** 否决,理由见 Decision;台账现在记录该裁定,不再推给 issue 待决。

## Consequences

自此 `core/session`、`settings`、`settings-file`、`llm-pi-ai`、`llm-deepseek` 与 `session-format-v1-to-v2` 都按自有键比较记录。对 JSON 域内的取值,两种判定除上述情形外处处一致,而上述情形此前的答案是错的;比较的其它行为不变。三处收敛的包各少一个本地函数、多一条 import。

`.agents/notes/rejected/simplification/2026-07-26-dependency-swaps-rejected-by-nih-audit.md` 曾否决把这份副本换成 `fast-deep-equal`,理由是那会成为核心包的第一个**外部**运行期依赖。本裁定把副本指向 `core/session` 本就依赖的仓内包,因此没有重开该裁决。

## Testing

`packages/util/values/tests/values.spec.ts` 钉住 `__proto__` 用例与常规记录路径。在旧的 `key in right` 下该用例以 `expected true to be false` 失败,改用 `Object.hasOwn` 后通过;它也是该包拥有的第一个测试套件。改动包的套件、两个编译面、lint、`duplication`、文档聚合门与翻译配对是本次必须保持绿的项目。

## Related

[已发布依赖面](../process/2026-08-26-published-dependency-faces.zh.md) 拥有两个客户端包所遵循的依赖段政策。[以 NIH 审计否决的依赖替换](../../rejected/simplification/2026-07-26-dependency-swaps-rejected-by-nih-audit.zh.md) 是本裁定需保持一致的既有否决。
