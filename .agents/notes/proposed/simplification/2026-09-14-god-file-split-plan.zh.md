# Agent Note: 拆分七个上帝文件（Issue #86）

Status: proposed

[English](2026-09-14-god-file-split-plan.md) | 中文

## Problem

Issue #86 要求拆分 `packages/` 下体量过大的文件。它的清单列了十二个文件（生成文件已由 issue 自身排除），并按体量从大到小给出了顺序：

| 文件 | 行数 | 形态 | 本计划 |
| --- | --- | --- | --- |
| `packages/client/connection/src/client/fixture.ts` | 4052 | 随包发布的浏览器模式 provider（不是测试夹具） | 在 |
| `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx` | 3208 | 多组件文件，含两段内联 JSX | 在 |
| `packages/typert/generator/src/analyzer.ts` | 3235 | 纯构建期库 | 在 |
| `packages/experimental/code-runtime-python/src/index.ts` | 1801 | 单个类，单个超大方法 | 在——试点已落地 |
| `packages/core/session/src/index.ts` | 1256 | 四个关切共用一个模块 | 在 |
| `packages/core/tools/src/ptc.ts` | 678 | 单个 386 行的工具工厂 | 在 |
| `packages/acp/acp/src/index.ts` | 543 | 单个 341 行的 `apply` | 在 |
| `packages/client/better-sidebar/src/client/state.ts` | 1900 | 克隆中心 | 不在 |
| `packages/client/better-sidebar/src/client/Sidebar.tsx` | 1775 | 克隆中心 | 不在 |
| `packages/core/tools/src/index.ts` | 1913 | ToolRuntime 加五个职责 | 不在 |
| `packages/self-evolve/self-evolve-basic/src/index.ts` | 1857 | 自审计以来持平 | 不在 |
| `packages/subagent/subagent/src/continuation.ts` | 550 | 已从 1483 收敛 | 不在——issue 自行销案 |

五个条目在本计划之外，各有一条明写的理由，而不是被略过。`continuation.ts` 已收敛，且 issue 自身建议销案。`better-sidebar` 的 `state.ts` 与 `Sidebar.tsx` 被 issue 点为克隆中心：它们的正解是去重，而切割两个本就互为镜像的文件，只会把一处文件内克隆变成一处跨文件克隆——那项工作属 M1 去重族，不在这里。`core/tools/src/index.ts` 与 `self-evolve-basic/src/index.ts` 已到或低于 issue 记录的行数，而本计划自己的标准——每一刀都要由「某个测试变得可行」「某个接口变得显式」「某个方法变得可读」之一来证成——对它们尚无答案；它们留在 issue 上，而不是在没有理由的情况下进入某个批次。行数为 2026-09-14 实测，即试点之后。

对在范围的七个文件的结构调研发现：**体量并不是它们难以拆分的原因**。每一个都有肉眼可见的切口——模块级纯函数、已经抽出的辅助函数、读者能看到的段落边界。它们真正缺的，是**切口边界该归谁**这个问题的定论；而且其中几个带着明确的契约，粗暴拆分会让它们悄无声息地失效：

- `fixture.ts`、`code-runtime-python`、`analyzer.ts` 含有 `/* jscpd:ignore-start */` 块，其注释声明这些块的存在是为了与某个兄弟实现保持形状平行。只切一侧就打破了声明的对称。
- `fixture.ts` 故意重新实现宿主行为而不去 import，以免一个 Web 客户端包染上宿主依赖。任何靠 import 来「去重」的拆分，都会把宿主包拖进客户端 bundle——正是这个文件被写出来要避免的退步。
- `code-runtime-python` 没有 `src/types.ts`，因此切出来的碎片本应共享的词汇无家可归；而给它安家会撞上 Issue #99 已经记录在案的例外。`ui-trajectory` 本来也没有，并在其批次 1 那一刀中新建了一个，与 `analyzer` 的做法相同。
- 测试经由源码路径导入内部符号（`code-runtime-python/tests/runtime.spec.ts` 从 `../src/index.ts`；`ui-trajectory/tests/table.client.spec.tsx` 从 `../src/client/TrajectoryTable.tsx`），所以拆分必须让入口模块保持今天这份再导出。

这几个问题放着不管，每一次评审都要重新吵一遍，而且答案会在文件之间漂移。按体量排序还指错了方向：最大的那个文件恰恰是最不该先切的安全项之一。

## Proposal

先把四个边界问题一次性定死，再按「一次切割需要保住多少行为」分批推进。

### 贯穿所有批次的四条规则

1. **`jscpd:ignore` 块是双向契约。** 切一侧就必须在同一次改动里切另一侧，或者显式修订那段注释、说明对称为何不再成立。这适用于 `code-runtime-python` ↔ `code-runtime-worker-thread`（构造／teardown／run 形状，以及定时器／abort／live 集合那一块），也适用于其余每个 `jscpd:ignore` 块所指名的兄弟。
2. **`fixture.ts` 是镜像，不是 import。** 它的切割在文件**内部**提取。任何会让它 import 宿主包的改动都在范围之外，无论那样能去掉多少重复。
3. **新的共享词汇落在 `src/types.ts`。** 包缺这个文件时，创建它是第一个需要共享词汇的那个批次的一部分，并在改动中援引 Issue #99 关于运行期值可居于其中的例外。入口模块继续再导出它今天导出的一切。
4. **保不住入口模块导出清单的切口，不是批次 1 的切口。** 搬运入口再导出的符号没问题；丢掉一个不行。

### 批次 1 —— 按构造即保行为的提取

每一项搬运的都是本已自足的代码：无实例状态、无新接口、无行为变更。入口模块保持再导出。

| 包 | 切口 | 行数（估算） |
| --- | --- | --- |
| `code-runtime-python` | 字节计价与截断词汇 → `src/cost.ts`；日志台账 → `class OutputLedger` | ~200、~270——实际落为 131、619 |
| `ui-trajectory` | 记录投影层 → `trajectory-record-model.ts`；六个展示辅助族各自落文件；共享的 record 词汇 → 新建 `src/types.ts` | ~260、~1050 —— 实际落在 248、1045，另加 94 行的 `types.ts` |
| `core/session` | 校验器与头部处理 → `validation.ts` | ~365——实际落为 345 |
| `analyzer` | 节点文本辅助、`package.json` exports 解析、路径工具 | 各 ~250 |
| `acp` | cursor codec 簇 | ~56 |
| `ptc` | JSON 展示簇；flavor 表与解析器 | ~90、~107 |

试点选 `code-runtime-python`，因为它的台账切口握有全仓库最有力的一条证据：兄弟后端 `packages/code-runtime/code-runtime-worker-thread/src/index.ts` 已经有一个抽好的 `OutputLedger`。两者可以对拍同一组边界案例；而且该包只导出 `.` 且为 `private: true`，已发布面不可能移动。试点已落地：[字节计价与日志台账提取 note](../../implemented/simplification/2026-09-14-code-runtime-python-cost-and-ledger.zh.md) 记录了这一刀的产出与代价。

### 批次 2 —— 需要先把接口定形的切割

- `code-runtime-python`：fd-3 帧读取器（需要定义携带原始行长度的帧回调协议）；台账与 `log` 帧分支之间的契约是双向的，因为该分支要回报「已发生截断」。
- `ui-trajectory`：inspector `<aside>` 抽成 `RecordInspector`（~550 行，约 10 个值 + 4 个回调），以及其 pointer-capture 拖拽抽成 `useResizeHandle`。
- `core/tools` 的 `ptc.ts` 与 `acp/acp`：批次 1 的提取把它们缩短之后，那两个超大方法剩下主体。
- `fixture.ts`：先是历史脚本 `buildAlphaLog`，再是投影 fold 家族。
- `typert/generator`：`Remote`/RPC 分析器与类型建模器——前提是能证明它们不扰动 `nodeOrdinals` 的 id 稳定性。

### 批次 3 —— 压在语义上的切割，逐项附证据

这些在能证明自己保住了什么之前不落地。

- `ptc.ts` 调度池：有序提交车道、独占屏障、背压、唤醒顺序防御全是行为，不是结构。
- `core/session`：三个增量 fold——`SurfaceManager` 在构造时捕获 `this.log` **数组引用**，`deriveMessages` 直接索引它；以及 `Session` 类——它的 `attachments` WeakMap 与 `SessionEntry` 必须同址，且它的类型字符串被某个测试逐字断言。
- `code-runtime-python`：配置门控与进程监管。
- `ui-trajectory`：行渲染器。它捕获约 30 个 `useMemo` 派生值与 15 个回调；显式传递约 45 项 props，而 memo 边界处理不当会让父级每次重渲染都重渲全部可见行，把虚拟滚动的收益还回去。它当前的稳定性是刻意的，`useStableVirtualRowStructure` 这个 hook 就是证据。

## Alternatives considered

- **照 Issue #86 按体量排的顺序做。** 拒绝：最大的文件带着镜像约束，使它成为最不该先切的安全项之一；第二大的是纯构建期库，其风险是快照漂移而非体量。改为按「一次切割需要保住多少行为」排序。
- **把 `fixture.ts` 镜像的宿主实现改成 import 来拆分。** 拒绝：那会给 Web 客户端 bundle 加上宿主包依赖，反转该文件在自己注释里记录的决定。
- **只切一个后端的 `jscpd:ignore` 块。** 拒绝：那些注释声明了与兄弟后端的对称。悄悄打破它，等于把一份成文的契约变成一处无据可查的差异。
- **文件一超过行数阈值就抽走一大块。** 拒绝：体量本身说不出哪个边界安全。`core/session` 不是持久化混杂的文件——持久化早已在自己的包里——把它当成那样的文件来拆，会搬错东西。
- **在 `ui-trajectory` 引入翻译 context 以缩短 props 清单。** 拒绝：该包今天每个组件都把 `t` 当显式 prop 传。为了让一次拆分更省事而加第二套机制，是在分叉这个包的风格。
- **把批次 1 跨六个包一次做完。** 拒绝：上面那四条规则才是本计划真正的交付物，而试点正是检验它们是否立得住的手段。六条并行改动会让规则在任何一个被确认之前就进入六次评审。

## Acceptance criteria

- 每个批次落为各自的 pull request；试点先单独落地，之后批次 1 的其余部分才开始。
- 一个拆分批次算做完，当且仅当：所涉包的入口模块导出与之前同名，没有任何测试需要改导入路径，且该包自身的测试、`pnpm run typecheck`、文档门禁全部通过。
- 批次 1 不改行为：没有任何常量、默认值或 schema 取值被移动。
- 批次 3 全部落地或被逐项显式推迟之后，本 note 移入 `implemented/`。

## Risks

- **对称欠账。** 每个被触碰却没带上对侧的 `jscpd:ignore` 块，都会留下一份未言明的契约。规则要求成对改动或修订注释，但评审者仍须亲自核对。
- **藏在结构收益背后的性能退步。** `ui-trajectory` 的行渲染器是最清楚的一例：拆完看着更干净，却可能开始掉帧。这正是它被放进批次 3 的原因。
- **快照漂移。** 生成的产物快照可能依赖 `analyzer.ts` 里 `nodeOrdinals` 的 id 稳定性；一次重排节点访问顺序的切割，会表现为一处无解释的快照 diff，而不是测试失败。
- **与 Issue #99 的词汇归属冲突。** 创建 `src/types.ts` 解决了「无家可归」，但也重新揭开一个已决问题；每一次这样的改动都必须援引既有例外，而不是重新论证一遍。
- **为拆而拆的空转。** 拆分本身只是搬行，不保证任何东西更好改。每次切割都应由「某个测试变得可行」「某个接口变得显式」「某个方法变得可读」之一来证成——本计划为批次 1 的每一项都点名了理由，并要求批次 2 之前先拿出它。

## Related

- `.agents/audits/2026-09-11-tech-debt-issue-manifest.md` Issue #86
- `docs/TECH_DEBT.md`（M6，以及点名审计遗漏那两个文件的台账条目）
- `packages/code-runtime/code-runtime-worker-thread/src/index.ts`（`OutputLedger` 先例）
- `packages/experimental/code-runtime-python/src/index.ts`、`packages/client/ui-trajectory/src/client/TrajectoryTable.tsx`
