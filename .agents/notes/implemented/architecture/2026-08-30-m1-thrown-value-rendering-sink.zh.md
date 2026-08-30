# Agent Note: M1 第三批下沉——抛出值渲染(`toError`/`errorMessage`)

Status: implemented

[English](2026-08-30-m1-thrown-value-rendering-sink.md) | 中文

## 问题

M1 最后的机械行是抛出值渲染器。`toError` 有五份:四份朴素的 `instanceof Error ? error : new Error(String(value))` 与 skill 的加固变体——后者的 `instanceof` 探针和字符串 coercion 都包了针对敌意抛出值的防护。`errorMessage`/`renderThrown` 散布在约十几个包,可观察格式漂移出四种——`instanceof Error ? .message : String`(带或不带 try/catch)、纯 `String(error)`、`unknown error` 标签、两种占位拼写(`[unrenderable thrown value]`、`<unprintable thrown value>` / `<unrenderable thrown value>`)。最初的扫描输出被截断,漏掉了 goal-round-driver 的副本,直到第一次全量跑才现形——扫描不加行数上限的教训。

## 决策

- `dsh-value` 新增 `errorMessage(value: unknown): string`——全防御短格式渲染器:`Error` 实例渲染 `.message`,携带 string `message` 属性的非 Error 对象渲染该属性(吸收 core/tools 的探针),其余值字符串化,任何陷阱都得到固定占位符 `[unrenderable thrown value]`;以及 `toError(value: unknown): Error`——skill 的加固规范化器,兜底复用 `errorMessage`。
- 折叠到规范对:skill(两个函数)、typert/loader、subagent-acp、subagent、subagent-dsh-sdk、interaction/commands、session-query(corpus、observation)、session-query-sqlite、sdk/client、workspace-controller、patent-knowledge(单函数的 `shared/errors.ts` 整文件删除)、core/tools、skill-filesystem、schedule、workflow,以及较晚发现的 goal-round-driver。
- 保留本地——是不同契约而非副本:subagent lifecycle(带类名的 `name: message` 行)、workflow-worker-thread realm(栈优先的失败报告,跨 realm)、agent-team(基于 `inspect` 的有界单行描述)、llm adapter-failure(`Error` 入参的 SDK getter 防御)、gateway remote-events 的 `toError(reason, message)`(附加 `cause`),以及 tool-ralph/tool-workflow 的 `?? 'unknown error'`(结果字段缺省值,不是渲染器)。
- 可观察文案变化,各钉点测试随同一变更更新:非 Error 拒绝值现在渲染真实值(session-query 的 `'offline'` 取代 `unknown error`),warn 行去掉冗余的 `Error: ` 类名前缀(commands、skill),三种占位拼写统一为 `[unrenderable thrown value]`。

## 后果

M1 每一行都记录收敛;台账规划的 `util/` 包全部落地。M1 剩余项是 abort-race 家族(五份包装器、三种取消语义),需要在 `dsh-timeout` 里选定单一契约并独立成批。

## 备选方案

**统一用带类名格式(`String(error)`)。** 拒绝:多数消费方把消息嵌进结构化记录,类名由其他字段承载;加前缀会重复。需要类名的消费方在自己的调用点组合 `${name}: ${message}`。

**在共享渲染器里对非 Error 对象采用 `inspect`。** 拒绝:`node:util` 会让零依赖包变成 Node 专属,而 client 组的包在浏览器里消费它;`inspect` 留在 agent-team 的本地描述渲染器里。

**把 patent-knowledge 的 `errors.spec.ts` 改指新导入。** 拒绝:它重复了原语的测试;该行为现在归属 `dsh-value` 并由其自带 spec 覆盖。
