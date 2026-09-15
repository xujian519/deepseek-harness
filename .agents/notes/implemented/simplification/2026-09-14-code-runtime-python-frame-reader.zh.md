# Agent Note: 提取 python 运行期的 fd-3 帧读取器（Issue #86）

Status: implemented

[English](2026-09-14-code-runtime-python-frame-reader.md) | 中文

## Problem

`packages/experimental/code-runtime-python/src/index.ts` 把 fd-3 帧读取器——字节缓冲、两条 oversized 帧拒绝路径、敌意帧丢弃——内联在 `PythonCodeRuntime.execute` 的 promise executor 中，夹在账本接线与帧处理器之间。每一个解码结果都只能靠驱动真实 CPython 子进程写出精确字节来触达，因此非法 UTF-8、unsafe integer token、畸形 JSON、两条 oversized 路径与分片计数封存，各自都要花掉 `tests/runtime.spec.ts` 里一个 40–120 秒的子进程用例。当时不存在任何能让测试直接喂入字节序列的表面。

[拆分计划](../../implemented/simplification/2026-09-14-god-file-split-plan.zh.md)把这一刀列为批次 2 的第一项，并预判它「需要定义携带原始行长度的帧回调协议」。

## Decision

`src/frame-reader.ts` 用一个工厂持有读取器。`src/index.ts` 保留 `if (settled) return` 守卫、post-batch outstanding-call 检查、`handleFrame`、`finish` 与账本接线，现在改为构造读取器，并把 `reader.push(chunk)` 作为 `data` 监听器的最后一条语句。

| 导出 | 持有 |
| --- | --- |
| `FrameReaderOptions` | `frameParseCapBytes`、`onFrame`、`onOversized` |
| `FrameReader` | 唯一的 `push(chunk: Buffer)` 操作 |
| `createFrameReader(options)` | 未组帧缓冲、join 前的字节上限、首帧长度测量、换行循环及其三种丢弃原因、分片计数封存 |

### 两个回调都是箭头包装，且由编译器强制

`handleFrame` 与 `finish` 是同一 executor 作用域中更晚声明的 `const`，因此 `createFrameReader({ onFrame: handleFrame, onOversized: finish })` 无法编译（TS2448/2454）。包装箭头让读取器的构造位置保持在它所引用的消费者之上，而这条顺序正是由该编译错误守住的。运行时前提独立成立：`proto.on('data')` 只注册监听器，Node 不可能在 `execute()` 同步体返回前 emit。

### 没有任何原始行长度跨越回调

计划预判的那个参数没有消费者。两条 oversized 消息插值的都是**上限值**，且由 `onOversized` 回调构造；`log` 帧按账本的序列化文本计价；帧 envelope 在配置期就从上限中扣减。`onFrame` 只接收重建后的 `ChildToHost`，别无其他——一个无消费者的参数会违反本包「要求当前所有者与需求」的规则。

### 搬移的代码携带的三处机械约束

- **`Buffer.concat` 保持属性调用形式。** `tests/runtime.spec.ts` 给全局 `Buffer.concat` 赋值，`tests/stray-fragments.spec.ts` 对它 `vi.spyOn`，两者都靠测量拷贝量区分「封存」与「重新合并」。在模块加载期解构 `concat` 会静默解除这些断言：测试仍然通过。
- **两条 oversized 路径都保持早退 `return`。** 它们是靠 `return` 断开的两条顺序 `if`，不是 `if`/`else` 链。继续往下走会在刚被清空的缓冲上跑首帧扫描、`Buffer.concat` 与 `detachResidual`——行为上不可观测，因为 `finish` 幂等且此时已结算；正因如此，单测才监听 `Buffer.concat` 并断言被拒绝的帧绝不会走到它。
- **`onFrame` 外包不加 `try`/`catch`。** `handleFrame` 抛错就是 `data` 回调里的未捕获异常；包一层会静默改变这一行为。

换行循环在某个帧触发结算后仍会处理同批的其余帧，两种实现都观测不到差异（`handleFrame` 见到 `settled` 立即返回）。读取器不引用任何结算状态，正是保住这一点的原因。

### Testing

`tests/frame-reader.spec.ts` 直接向 `push` 喂入字节序列，覆盖分片累积、残留携带、封存、两条 oversized 路径，以及三种敌意帧丢弃原因。真实子进程用例全部保留：它们是 wire contract 的证据，单测是净增。

这一刀同时删掉了空行 `continue` 上方的 `/* v8 ignore next */`。它给出的理由——空行只可能来自伪造的 `\n\n` 写入——是旧测试装置的限制，而非不可达分支；`push(Buffer.from('\n\n'))` 就能覆盖。

## Alternatives considered

- **直接引用传 `handleFrame` 与 `finish`。** 否决：编译不过；而箭头包装正是保住 executor 所需声明顺序的东西。
- **在读取器内加终止标志位。** 否决：`onOversized` 会经 `finish` 结算本次运行，之后宿主的 `if (settled) return` 守卫就不再喂它，所以读取器侧的标志位不可达，会被 per-file 覆盖率门禁拒绝。
- **在同一刀里抽出 `handleFrame`。** 否决：它自由引用 executor 的每次运行状态（`settled`、`bootAckGate`、`ledger`、`nextCallId`、`bindings`、`pendingCalls`、`config`、`sendReply`、`finish`、`checkDoneValue` 以及 child），照做就要造一个上下文对象；且计划把「账本与 `log` 帧分支的契约」——该函数的 `log` 臂正是其中一半——留给批次 2 的另一项。
- **把 `MAX_PENDING_CHUNKS` 与 `detachResidual` 搬进读取器。** 否决：`src/output-ledger.ts` 明写它们由两个读取器共享，所以任何一个读取器都不该拥有它们。
- **用 class 取代工厂。** 否决：读取器只有一个操作、没有可读状态，`class FrameReader` 只会多出一个构造器；账本用 class 是因为测试要从它读出 `lines`，读取器没有任何对应物。

## Consequences

`index.ts` 少掉 163 行（删除 178 行，其中 15 行是调用点现在携带的接线），读取器的六种解码结果从分钟级变为毫秒级可达：新 spec 跑 206 ms，而子进程用例要 40–120 秒。这一刀新增一个模块与一个 spec 文件；没有快照、fixture 或既有测试需要修改。

有两个脆弱点留在子进程套件里，值得点名。封存的 true 侧靠 `tests/runtime.spec.ts:4696` 与一个依赖管道时序的用例支撑，因此前者是唯一为「必须发生封存」而设计的用例——减少它的写入次数会掉覆盖率。而 `/* v8 ignore next */` 忽略的是**下一行**：随 `settled` 守卫搬移的这条注记必须紧贴其上方，因为没有门禁校验这一对应关系。

## Related

- [拆分七个上帝文件](../../implemented/simplification/2026-09-14-god-file-split-plan.zh.md)（计划；本项是其批次 2 第一项）
- [抽出 python runtime 的 cost 与 log 账本模块](2026-09-14-code-runtime-python-cost-and-ledger.zh.md)（同包的批次 1）
- `packages/experimental/code-runtime-python/tests/runtime.spec.ts`（保留的子进程用例）
