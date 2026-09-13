# Agent Note: 会话历史的页大小在读取开始前就已解析

Status: implemented

[English](2026-09-13-session-history-request-spec.md) | 中文

## 问题

`AGENTS.md` 要求默认值是一个显式的 `resolve(request): Spec` 步骤，而不是藏在执行路径里的 `?? default`。`packages/api/session-controller/src/history.ts` 的会话历史入口恰好相反：两处都把 `request.maxMessages ?? DEFAULT_MAX_MESSAGES` 直接塞进 `paginate(...)`，分别位于 `page()` 内第 4 行与 `follow()` 内第 5 行；`follow()` 还在三个地方各自比较 `request.assistantStream === true`。两个方法在开头都看不出调用方实际会拿到的页大小与游标，两条入口也各自可能悄悄漂移而无人察觉。

## 决策

**页大小解析一次，然后才读取。** `resolveMaxMessages(value)` 承担默认值，每个入口各有一个解析器把已校验的请求转成执行路径消费的 spec：

- `resolvePageRequest(request): PageSpec` 携带 `throughSeq`、`beforeSeq`、`maxMessages`，于是 `SessionSeq`/`SessionLogOffset` 的品牌转换发生在解析器里，而不是读取中途。
- `resolveFollowRequest(request): FollowSpec` 携带 `maxMessages` 与 `assistantStream`，请求上那个可选标志只比较一次，而不是三次。
- 两个方法现在都按「校验 → 解析 → 执行」阅读，执行路径只使用已解析的值。

**校验留在各自的请求校验器里。** `validatePageRequest` 与 `validateFollowRequest` 守着 Remote 线上边界，且面对两种不同的请求；默认值不是部署配置，所以解析器只做默认。这正是与 `resolveMaxParallelToolCalls`、`resolveSessionListPageSize` 的差别——那两个之所以连校验一起做，是因为直接 `apply()` 的调用方不经过 schema。

**同包其余用法已复核并保留。** `DEFAULT_MAX_MESSAGES` 是本包唯一的 `DEFAULT_*` 常量，除此之外不再有内联的 `??` 部署默认：

- `session.create` 的 `workspace?.path ?? request.cwd ?? this.defaultCwd` 是一条优先级链，其默认值是显式配置的字段、在方法开头解析；没有任何值被藏进它所喂入的调用里。
- 客户端把页大小写成请求字段（`maxMessages: PAGE_MESSAGES`、`JUMP_PAGE_MESSAGES`），而不是依赖宿主默认值。
- `SESSION_SEARCH_RESULT_LIMIT` 与 `SEARCH_PROVIDER_CALL_LIMIT` 约束的是搜索执行路径；它们是就地生效的上限，不是 `??` 默认。若某天需要按部署变化，它们属于 [Issue #88](https://github.com/xujian519/deepseek-harness/issues/88) 的硬编码可调参数族，而不属于本 issue。

## 考虑过的替代方案

- **保留内联 `??` 并加注释。** 否决：规则管的是「默认发生在哪里」，不是「有没有注释」。
- **只解析 `maxMessages`，不加 spec 类型。** 否决：request/spec 分割正是规则点名的模板，而游标品牌化与 `assistantStream` 谓词属于同一种「从请求字段翻译成读取所需」的工作。
- **把请求校验并进解析器。** 否决：那会让解析器带上一份执行路径看不见的抛错契约，且两种请求除 `maxMessages` 外校验的字段并不同（页请求还有 `throughSeq`、`beforeSeq`，follow 没有）。
- **顺手抽出 `session.create` 的 cwd 优先级链。** 否决：它的默认值在表达式里就有名字（配置字段），把一行本身已显式的代码抽出来只会增加间接层，并不消除任何隐藏默认。

## 后果

每个入口在读取任何东西之前就写明了解析后的页大小与游标，默认值只存在一处。行为不变：同一个默认值、同样的校验顺序（校验仍在解析之前）、同样的错误，包括那些内插 `throughSeq` 的消息。

## 测试

`npx vitest run packages/api/session-controller/tests`——742 通过。逐文件覆盖率仍为 100%（语句/分支/函数/行）：`npx vitest run packages/api/session-controller/tests --coverage --coverage.include='packages/api/session-controller/src/history.ts'`——默认值的两个分支都被覆盖，follow 的用例省略 `maxMessages`，页用例则显式传上限。`pnpm run lint`、`pnpm run typecheck`、`pnpm run duplication`。

## 相关

- [以同仓库 Issue 跟踪技术债](../process/2026-09-11-tech-debt-issue-tracking.zh.md)——Issue #95 的登记处。
