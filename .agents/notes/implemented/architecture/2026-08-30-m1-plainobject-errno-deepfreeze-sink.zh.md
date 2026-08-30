# Agent Note: M1 第二批下沉——`isPlainObject`、errno 测试与 `deepFreeze`

Status: implemented

[English](2026-08-30-m1-plainobject-errno-deepfreeze-sink.md) | 中文

## 问题

M1 小工具台账还剩三行机械项。`isENOENT` 有五份副本——四份宽松的 `(error as NodeJS.ErrnoException)?.code` cast 与一份严格的 `instanceof` 检查——同形的 `isEEXIST` 随之有三次复制。`isPlainObject` 存在三份(台账记了两份):两份 `unknown` 入参的守卫与 api/gateway 一份 `object` 入参的副本,外加 inspector 的 `shared/json.ts` 里一份未被台账记到的导出副本,服务十四处包内导入。`deepFreeze` 比副本数显示的更糟:除 settings 的私有副本外,九个包从 `@deepseek-ai/dsh-llm` 导入它——一个重量级 LLM 包充当了值原语的意外住所。

## 决策

- `dsh-value` 新增四个原语:`isPlainObject`(原型严格的 record 守卫)、`isENOENT`/`isEEXIST`、`deepFreeze`——后者逐字采用 llm 实现:迭代式、循环安全、刻意跳过 `AbortSignal`,因为冻结存活的取消通道会破坏 abort。
- errno 测试采用 fs-local 的严格形式:只有携带 code 的真实 `Error` 实例参与分类,非 Error 同形值向上浮出,而不是被读作缺失或已存在。这是本批唯一的语义差异——四份宽松副本原本会吞掉这种同形值。
- `deepFreeze` 移出 `dsh-llm` 的公开导出面。它的九个工作区导入者(session-title、session-title-llm、compaction-basic、compaction-tool-result-pruner、token-meter、core/session、agent-loop、tools、webhook)改为从 `dsh-value` 导入,随迁的测试与原语同住在 `value.spec.ts`。
- inspector 的 `shared/json.ts` re-export 共享的 `isPlainObject`(sdk/client 先例),十四处导入保持单一来源,重复实现消失。
- settings 的朴素递归副本由共享迭代版替代。settings 值是 JSON 合并的配置数据,不含 signal,可观察行为不变;未来若出现携带 signal 的值,abort 通道会保持可用而不是被冻结。

## 后果

M1 的机械行以零剩余副本收口,每行在台账记录收敛与保留说明。开放的是语义余项:`toError`/`errorMessage`(合并会改变日志中的可观察占位文案)与五份 abort-race 包装器(三种语义待选定单一契约),各自作为独立受审变更跟踪。

## 备选方案

**把 errno 测试参数化为 `hasErrorCode(error, code)`。** 拒绝:具名谓词在调用点读起来直白,code 参数会把原语变成恰好两个固定 errno 值的分发表面。

**为兼容保留 `dsh-llm` 的 `deepFreeze` 再导出。** 拒绝:让值原语绕道 LLM 包会使九处值分类导入与重量级运行时依赖耦合;pre-release 立场偏好更新每一处引用。

**让 inspector 的副本当属主、从那里共享。** 拒绝:inspector 是实验性表面;零依赖 util 包才是其他消费方无需继承 inspector 依赖图就能到达的家。
