# Agent Note: PTY 接缝的失败分类与必填的关闭原因

Status: implemented

[English](2026-09-13-terminal-failure-classification.md) | 中文

## Problem

`TerminalErrorCode` 的文档定位是「机器可路由的 PTY 服务失败」，但有三种会话状态在该联合之外上报，且同族失败用了两种错误类。`TerminalSessionService.startSend` 用裸 `Error` 拒绝正在关闭的会话，而紧邻的上一行用 `TerminalError('SEND_ACTIVE')`；[terminal-bash 的会话](../../../../packages/terminal/terminal-bash/src/session.ts)对正在关闭的会话发起发送与信号、以及对已退出的 shell 发起发送，同样抛裸 `Error`。消费者只能靠匹配消息文本，才能区分「等待完全停稳的关闭结束」与「shell 已经不存在」。空入参（`backend.type`、`request.name`）也抛裸 `Error`，消费者无法与服务状态失败区分；且后端类型那条消息写的是 `pty`，而接缝其余部分写 `PTY`。

`kill(owner, id, reason = 'model request')` 硬编码了一个接缝无从知晓的标签：它陈述的是调用方式，而非接缝观察到的事实。其 JSDoc 只写了「诊断用清理原因」，因此最终进入后端 `PTY cleanup failed (…)` 报告的文本，对只读签名的调用方完全不可见。只有 `tool-terminal` 的 `terminal_close` 依赖该默认值；`tool-bash-persistent` 与 `tool-pwsh-persistent` 早已传入自己的标签。

Issue #100 把这一族记为台账 L4。其「同族包一致带消息前缀」的前提未能通过核对：每个同族包的裸消息都多于带前缀的（`terminal-bash` 12/7、`subprocess-local` 31/5、`tool-terminal` 6/1、`fs-local` 0/1），因此「不加前缀」的它并非异类，前缀这一项交付被撤销。

## Decision

- **失败类别取决于谁能为它行动。** 消费者会据以路由的会话或服务状态，携带 `TerminalError` 加一个 `TerminalErrorCode` 成员；调用方传入的参数违规，以 `TypeError` 失败；调用方自身的取消，原样保留调用方的值。`SESSION_CLOSING` 与 `SESSION_EXITED` 加入这个闭合联合，于是每次拒绝都点明导致它的状态，而不只是描述它。
- **`kill()` 的 reason 改为必填。** 该参数不再有默认值，JSDoc 写明：后端自身的清理失败会逐字报告该文本。`tool-terminal` 显式传入 `'model request'`，因此面向模型的关闭工具的诊断文本逐字节不变，而决定权移到了知情的调用方。

## Alternatives considered

- **给接缝的每条消息加上包名前缀。** 否决：前提不成立，照此执行要改写同族包约四十条裸消息，只为让一个接缝去符合一个它们都不遵循的约定。
- **保留 `'model request'` 默认值，只在 JSDoc 里写明。** 否决：它把属于调用方的事实藏进接缝，下一个非模型的调用方会静默上报错误的原因。而依赖该默认值的生产调用点只有一个，且它自己的标签本就是准确的。
- **把正在关闭或已退出的会话按 `SEND_ACTIVE` 上报。** 否决：两种情形的恢复方式不同。已有发送在途时，该发送会自行结算，调用方重试即可；而正在关闭的会话必须经幂等的 `kill()` 等完，已退出的 shell 则需要新会话。
- **改用 `state` 字段或第二个错误类，而不是往联合里加成员。** 否决：接缝已经发布了一个带码的闭合联合错误类型，平行的载体只会重复现有的每个码。
- **只修 `TerminalSessionService`，不动后端自身的拒绝。** 否决：消费者实践中遇到的关闭与退出拒绝由后端会话抛出，只改注册表会让接缝与消费者真正捕获的错误不一致。

## Consequences

每一次 PTY 拒绝现在都可路由，且关闭一族在注册表与后端里的读法一致。`kill()` 新增必填参数，对尚未稳定的接缝构成源码层破坏；五个生产调用点与全部测试调用点已在同一变更中更新。空入参失败改为 `TypeError`，不再长得像会话状态；后端类型那条消息与接缝的 `PTY` 写法对齐。两个持久 shell 工具套件里手写的后端替身，现在抛出与真实后端相同的带码 `SESSION_EXITED`，使那些自称「与真实后端完全一致」的套件保住该声明。前缀一项在 #100 上作为「已撤销」登记，而不是留作开放项。

## Testing

`packages/terminal/terminal`、`packages/terminal/terminal-bash` 与 `packages/terminal/tool-terminal` 覆盖了改类型的拒绝：两处空入参用例断言 `TypeError` 及其消息，关闭与退出两处用 `toThrow(expect.objectContaining({ code }))` 断言 `SESSION_CLOSING` 与 `SESSION_EXITED`。幂等 kill 用例改为断言调用方自己的原因到达后端，而不再断言被删除的默认值。`pnpm run typecheck`、`pnpm run lint` 与两个持久 shell 工具套件全部通过。

## Related

[持久 PTY 会话](../feature/2026-07-16-persistent-pty-sessions.zh.md) 拥有本分类所报告内容的 spawn、发布与 dispose 生命周期。
