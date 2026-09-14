# Agent Note: 提取 fixture provider 的 fx-alpha 历史脚本与消息词汇（Issue #86）

Status: implemented

[English](2026-09-14-fixture-history-module-extraction.md) | 中文

## Problem

`packages/client/connection/src/client/fixture.ts` 达到 4052 行。它不是测试夹具：它是浏览器模式的 `ClientConnectionRpc` provider，在没有服务端的情况下伪造出一个会话，经 `src/client/index.ts` 再导出，由包内两个 spec 消费。它构建的世界之上压着两类互不相干的内容。

第一类是编写好的数据。`buildAlphaLog` 是一个 328 行的脚本，产出 75 个 turn 的会话事件（约 150+ 条消息，按 `PAGE_MESSAGES=50` 分四页），并把它们的 `seq` 重新编号。有十七个样本只为被它渲染而存在：`USER_MARKDOWN_LITERAL`、`sgr` 包装器及被它转义的终端输出样本、两组搜索结果与它们的文本投影、七个 `READ_SAMPLE_*` 片段、`WEB_SEARCH_META`、`WEB_FETCH_META`，以及 `FIXTURE_SYSTEM_PROMPT`。

第二类是 fixture 的消息词汇：四个把内容块包成 `UserMessage`、`AssistantMessage`、`ToolResultMessage` 值的构造器，以及实时世界同样会渲染的样本 —— 历史最后一条 assistant turn 的 Markdown 正文、持久化附件引用、它背后的 base64 PNG，和重放静态消息的 settled-stream 构造器。

这两个区域读取同一份词汇，除此之外没有共同点。想改动实时世界如何渲染图片的读者，必须在历史脚本的终端输出样本与 read 样本之间找到 `FIXTURE_IMAGE_DATA`；而这两个区域与它下面那 2400 行世界构建代码之间也没有任何调用边。

[拆分计划](../../proposed/simplification/2026-09-14-god-file-split-plan.zh.md)把这一刀列为它的批次 2 `fixture.ts` 项。本记录记下这一刀产出了什么。

## Decision

现在由三个模块承载该文件。`src/client/fixture.ts` 为 3475 行。

| 模块 | 行数 | 搬迁 | 承载 |
| --- | --- | --- | --- |
| `src/client/fixture.ts` | 3475（原 4052） | — | 世界本身：`FixtureAssistantStreamFrame`、`FixtureOptions`、`FixtureWorld`、`createFixtureFaces`、`createFixtureConnectionRpc`，以及它们读取的样本（`DEEPSEEK_REASONING`、`OPENAI_REASONING`、`PERMISSION_PRESETS`、token 估算常量） |
| `src/client/fixture-messages.ts` | 138 | 69 | `text`、`userMessage`、`assistantMessage`、`toolResultMessage`、`MARKDOWN_FIXTURE`、`FIXTURE_IMAGE_DATA`、`FIXTURE_IMAGE_REF`、`fixtureUsage`、`fixtureSettledStream` |
| `src/client/fixture-alpha-log.ts` | 519 | 490 | `buildAlphaLog`，以及只被该脚本渲染的十七个模块私有样本：`USER_MARKDOWN_LITERAL`、`sgr`、`TERMINAL_OUTPUT_FIXTURE`、`SEARCH_MATCHES_FIXTURE`、`SEARCH_MATCHES_TEXT`、`SEARCH_PATHS_FIXTURE`、`SEARCH_PATHS_TEXT`、七个 `READ_SAMPLE_*`、`WEB_SEARCH_META`、`WEB_FETCH_META`、`FIXTURE_SYSTEM_PROMPT` |

入口的全部五个导出保持原名，其消费方也保持原 import 路径：`tests/fixture.client.spec.ts` 与 `tests/fixture-commands.client.spec.ts` 仍从 `../src/client/fixture.ts` import，`src/client/index.ts` 仍 import `./fixture.ts`。这三个文件之外没有任何地方 import 两个新模块。

### 共享词汇必须离开入口，因为入口同时 import 两个模块

`fixture.ts` import 了 `buildAlphaLog` 和它读取的词汇，因此两个新模块都不能 import 入口 —— 那正是拆分要避免的环。两个读者共享的九个名字落到了 `fixture-messages.ts`，它们的读者分布是干净的划分：`text`、`userMessage`、`assistantMessage`、`MARKDOWN_FIXTURE`、`FIXTURE_IMAGE_REF`、`fixtureUsage` 被两侧同时读取；`FIXTURE_IMAGE_DATA` 只被世界读取；`toolResultMessage` 与 `fixtureSettledStream` 只被历史脚本读取。

### 共享词汇为何没有落到 `src/types.ts`

计划第三条规则把共享词汇放进 `src/types.ts`，批次 1 那一刀也为 `TableRecord` 及该文件承载的标签表照此办理。本刀偏离了它，理由是这些名字是什么。`packages/AGENTS.md` 把 `src/types.ts` 的范围限定为包的接缝词汇 ——「its types plus the runtime values that vocabulary defines」（其类型，以及该词汇所定义的运行期值）。这九个名字不是接缝词汇：它们是 fixture 的内容，由调用 `@deepseek-ai/dsh-llm/message` 构造器的函数体构建，本包 RPC 接缝的任何消费方都看不到它们。本包的 `src/types.ts` 位于包根、服务接缝的两面，而搬迁的名字只属 client 面；analyzer 的 `types.ts` 承载的是 brand 构造器、常量与标签表，不是内容构造器。该文件享有的逐文件覆盖率豁免 —— 声明文件不含可执行代码 —— 对一个人满是构造器的模块同样不成立。

名字是第二个理由。`fixture-messages.ts` 说明了它承载什么；`src/types.ts` 会让下一个读者自己去发现包的接缝词汇文件里还放着一张 PNG。

### 共享模块里有两个导出没有入口侧读者

`toolResultMessage` 与 `fixtureSettledStream` 只被 `fixture-alpha-log.ts` 读取。它们留在了 `fixture-messages.ts`，没有跟着唯一的读者走，因为各自封闭着一组否则会被切开的声明。`toolResultMessage` 是四个连续构造器 —— `text`、`userMessage`、`assistantMessage`、`toolResultMessage` —— 中的第四个，四者只差它们构建的消息类型。`fixtureSettledStream` 与 `fixtureUsage` 成对：一个是计费，一个是重放，是产出 fixture 消息流的两个部件。

这一处不对称被记录而非被解决。若后续某一刀给 `fixture-messages.ts` 带来第二个消费方，那才是这两个导出是否该与历史脚本同处一室获得真实答案的时候。

### 这次搬迁在构造上保持行为不变，并做了机械核对

两个模块是通过切取原文件的行区间生成的，因此逐字节一致是可核对的：559 行搬迁内容全部按与 `HEAD` 版 `fixture.ts` 相同的顺序出现在各自模块中，唯一文本差异是十行声明多了 `export ` 前缀 —— `fixture-messages.ts` 中九行，历史脚本中 `buildAlphaLog` 一行。没有任何名字被改、缩进被调或格式被重排。

入口的 diff 可以解释其余部分：删除 588 行、新增 11 行，而 11 行新增全部是 import 接线。588 行删除中，559 行是搬迁的函数体，13 行是随之离开的 import 块与空行分隔，16 行是被改写而非搬迁 —— 两行 import（`createSystemMessage` 随历史脚本离开，`ToolCallId` 随 `toolResultMessage` 离开）与四行被新模块扩写的文档。

没有任何声明同时留在两处：入口不再提到 `buildAlphaLog`、`sgr`，或十七个样本中的任何一个。

### 本次搬迁必须补的 JSDoc

`verify-export-jsdoc` 扫描 `packages/*/*/src/**/*.ts`，两个新模块都是 `.ts`，因此它们的导出进入了入口 `fixture.ts` 本已满足的那道门禁。`fixture-messages.ts` 补了九个 JSDoc 块：六个函数各一个 `@param`/`@returns` 块，三个常量各一行描述。`fixture-alpha-log.ts` 补了一个：`buildAlphaLog` 原本两行的 doc（说明该脚本的规模）变成了同时带 `@returns` 的块。十七个样本保持模块私有，因此不需要文档；描述它们的注释原样搬迁。

这些 JSDoc，加上两个模块头、import 与空行分隔，就是两个新模块在 559 行搬迁代码之外多出的 98 行。

## Verification

| 检查 | 结果 |
| --- | --- |
| `pnpm run typecheck`（pre-push 门禁） | 通过，构建本包两个编译面 |
| `pnpm exec vitest run packages/client/connection` | 14 文件 / 164 通过 —— 与切割前相同 |
| `pnpm exec vitest run packages/client` | 531 文件 / 7150 通过，5 跳过 |
| `pnpm exec tsx scripts/run-oxlint.ts packages/client/connection/src` | 通过 |
| `pnpm exec tsx scripts/verify-export-jsdoc.ts` | 通过 |
| `pnpm run duplication` | 0 处克隆，覆盖 2207 个文件 |
| `pnpm run test:docs` | 18 通过，0 失败，0 跳过 |
| 逐行比对 | 559 行搬迁内容全部在位且保序；唯一差异是十行声明上的 `export ` 前缀 |
| 出口名比对 | 两侧同为那五个名字 |
| 逐文件覆盖率 | 在包内既有 fixture spec 驱动下，两个新模块的 statements/branches/functions/lines 均为 100% |

本批次的验收标准成立：入口导出同名，没有测试需要新的 import 路径，没有常量、默认值或样本值被改动。

`pnpm run typecheck` 是证明新模块进入包编译面的那道检查。本包发布 `tsconfig.host.json` 与 `tsconfig.client.json` 两个叶子配置，各自的显式 `files` 清单逐一列出源文件，因此两个新模块登记在 `tsconfig.client.json` 中。包级的 `tsc -p packages/client/connection/tsconfig.json --noEmit` 不能证明这一点：该配置是 `files: []` 的 solution，且没有 `-b`，它不检查任何文件。遗漏是 pre-push 门禁发现的，登记属于本刀的一部分。

逐文件覆盖率门禁无需新增豁免。计划允许为从被豁免文件中切出的模块添加 `vitest.config.ts` 条目，本刀起初也确实加了两条。保留之前先做测量，结果显示它们不必要：撤下这两条后，`--coverage.reporter=json-summary` 报告 `fixture-alpha-log.ts` 与 `fixture-messages.ts` 均为 100/100/100/100，因为包内既有的 fixture spec 已经驱动了两个读者。`vitest.config.ts` 未作改动，那条会掩盖未来回归的豁免条目也不存在。包 README 无需改动：它描述浏览器模式 provider 的行为，不载模块清单，其中没有陈述过期。

## Alternatives considered

- **把 `buildAlphaLog` 留在入口，只搬词汇。** 已否决：该脚本是文件里最大的编写型区域，也是读者打开一个 provider 时最不可能在找的东西，把它留在入口等于保留本刀要移除的问题。
- **按计划第三条规则把共享词汇放进 `src/types.ts`。** 已否决，理由见 Decision 一节：这些名字是 fixture 内容而非接缝词汇，只属 client 面，且一个含函数体的模块放在一个覆盖率豁免以「只有声明」为前提的文件里并不合适。
- **在另两个文件旁新建 `fixture-types.ts`。** 已否决：这九个名字是构造器与样本而非类型，以 `types` 结尾的名字会错误描述它们，同时在一个包内造出第二个词汇归宿。
- **把历史脚本并入 `fixture-messages.ts`。** 已否决：两个模块的读者集合不同 —— 世界读其中一个而不读另一个 —— 而计划这一刀的切口正由该划分定义。
- **把 `toolResultMessage` 与 `fixtureSettledStream` 移去与它们唯一的读者同处。** 已否决，理由见 Decision 一节：那会切开四个构造器组成的连续块，并把 settled-stream 构造器与 `fixtureUsage` 拆散。
- **为两个模块添加 `vitest.config.ts` 豁免条目。** 经实测后已否决：两者本就已达 100% 覆盖率，条目只会掩盖回归，而不是记录债务。
- **导出 `sgr` 与那些样本。** 已否决：历史脚本之外无人读取，导出它们只会为没有调用方的东西撑大两个新模块的出口清单。
- **把样本改成 JSON fixture 文件。** 已否决：这些样本代指的是带类型的工具结果 —— `SEARCH_MATCHES_FIXTURE` 声明为 `{ path: string; matches: { lineNumber: number; line: string }[] }[]` —— JSON 文件会带走这些值，却带不上检查它们的声明。
- **在同一刀里继续拆分历史脚本本身。** 已否决，时机未到：它的主体是一条 `push` 序列，各 turn 引用共享的局部状态（`toolTurn`、`dispatchPair`），因此把结构化样本与 turn 循环分开，需要先决定这个循环是数据还是代码。那不是这一刀该做的决定。

## Consequences

`fixture.ts` 缩短 577 行，只保留世界以及世界读取的样本。记账是：搬迁 559 行，两个新文件 657 行，入口 11 行 import 接线替换掉它不再需要的 import；98 行的增长来自模块头、import、空行分隔，以及导出门禁所要求的 JSDoc。

fixture 的行为未变，而这次切割有一处代价值得点名：历史脚本与消息词汇现在各自住在名字说明其读者的文件里，因此改动 fixture 如何构建消息要从 `fixture-messages.ts` 入手，改动随包发出的日志要从 `fixture-alpha-log.ts` 入手。历史脚本从消息模块 import 八个名字，消息模块不从历史脚本 import 任何东西。

`fixture.ts` 仍有 3475 行。计划在它内部剩余的切口属于世界自身，本刀刻意没有动：`createFixtureFaces` 与 `createFixtureConnectionRpc` 是本包的两个 provider 入口，切分它们的内部需要定下一个这次搬迁不必做的边界决定。

## Related

- [Splitting the seven god files](../../proposed/simplification/2026-09-14-god-file-split-plan.zh.md)（计划；本记录是它的批次 2 `fixture.ts` 项）
- `src/client/trajectory-record-inspector.tsx` 与 `src/client/trajectory-resize-handle.ts`（`ui-trajectory` 里的批次 2 同侪切口，作为独立 pull request 落地）
- [Extracting the trajectory ledger's record model and presentation helpers](2026-09-14-trajectory-ledger-module-extraction.zh.md)（批次 1，`ui-trajectory`；确立了本刀偏离的 `src/types.ts` 归宿）
- `packages/AGENTS.md`（包的接缝词汇所在之处）
