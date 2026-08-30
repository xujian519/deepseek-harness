# Agent Note: M1 首批下沉——共享的 `dsh-value` 原语

Status: implemented

[English](2026-08-30-m1-value-primitives-sink.md) | 中文

## Problem

技术债台账的 M1 条目记录了跨包小工具复制流行病:每个包各抄一份的 helper,因为只有几行且签名与文案漂移,jscpd 无法标记。全量扫描报告量化了最严重的两个:`isRecord` 26 份、谓词三种变体;`assertPositiveInteger` 16 份、签名漂移(`number` vs `unknown`+收窄)、错误类型不一(`Error` vs `TypeError`)、诊断格式各异。任何一处修 bug 都要靠其他副本自行发现,诊断文案按插件分叉。

## Decision

- 新建零依赖包 `packages/util/value`(`@deepseek-ai/dsh-value`),含三个原语:`isRecord`、`assertPositiveInteger(label, value)`(断言 `number`,抛 `TypeError`)、`assertPositiveFinite(label, value)`。共享库拥有谓词与失败消息;调用方拥有诊断标签,因此每个消费方继续用自己的词汇命名选项、作用域或配置路径。
- 迁移全部 `isRecord` 副本(26 文件,约 25 包)。sdk/client 的公开导出改为保留 JSDoc 的再导出。mcp-client 的 `JsonValue` 类型谓词并入规范守卫——其调用点本就在收窄后显式转换到 `McpContentBlock`。两处副本(core/session 的 `chunk-rows.ts`、session-persistence-sqlite 的 `codec.ts`)原本不拒绝数组;规范版更严的守卫在其调用点行为等价,因为下游键检查会拒绝数组。
- 迁移全部 `assertPositiveInteger` 副本(16 文件,38 个调用点改为传入带前缀的标签)。`tool-skill` 的 `minimum: 3` 变体改为规范断言加显式 `< 3` 范围检查,消息保持原文。
- 迁移三份逐字相同的 `assertPositiveFinite` 副本(bash-local、pwsh-local、web-fetch-http)。两处语义特例有意保留:subagent-acp 的变体钉住 `MAX_TIMER_DELAY_MS` timer 上限(timer 域契约,不属于值分类),session-query-sqlite 的包装抛聚合的 `SessionQueryError`——失败类型不同,不是副本。
- client 组消费方按 client 依赖规则把 `dsh-value` 声明为 peer+dev;其余消费方声明为普通依赖。43 个 tsconfig 增加了工程引用。

## Consequences

对象守卫与两个正数断言现在只有一处定义;修 bug 或改文案一次落地。测试钉住消息的消费方文案逐字未变,其余全部统一为 `${label} must be ...`。两个保留的特例在定义旁记录了各自的域契约。M1 剩余清单缩至 `toError`、`errorMessage`、`isENOENT`、`isPlainObject`、`deepFreeze` 与 abort-race 包装器,台账已记录本次收敛。

## Alternatives considered

**通过加宽共享 API 吸收特例(错误类型参数、上限参数)。** 否决:切换失败类型或上限的参数会让共享断言变成配置面而非原语;特例作为有文档的域契约更清晰。

**同批下沉 `toError`/`errorMessage`。** 推迟:它们的副本带着会影响日志与诊断输出的占位文案分叉,收敛会改变可观察文本,应当独立成一次受审变更。

**按调用点保留 `isRecord` 的类型变体(JsonValue/PropertyKey)。** 否决:所有变体的调用点只读 string 属性或向后转换;变体增加的是类型词汇,不是安全性。
