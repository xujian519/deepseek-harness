---
description: "共享的未知值原语：面向解析与配置边界的对象守卫、fail-loud 正数断言、文件系统 errno 测试、抛出值规范化与渲染及循环安全的深冻结。"
kind: "package-library"
---

# @deepseek-ai/dsh-value

[English](README.md) | 中文

## 概述

`dsh-value` 收纳每个解析器、配置加载器和 wire 解码器都要重写的最小未知输入处理:`isRecord` 把值分类为非 null、非数组的对象,`isPlainObject` 额外要求 `Object.prototype` 或 null 原型,`assertPositiveInteger` 与 `assertPositiveFinite` 拒绝越界数值并把 `unknown` 收窄为 `number`,`assertResolvedConfig` 在 schema 默认值跑完后钉住插件配置边界,`isENOENT` 与 `isEEXIST` 分类文件系统 errno 错误,`errorMessage` 与 `toError` 在不让敌意 coercion 逃逸的前提下渲染并规范化任意抛出值;`deepFreeze` 从 `dsh-util-values` 转发导出,后者是全 harness 共享深冻结实现的拥有者。这份库拥有谓词与失败消息,让诊断文案在全 harness 逐字一致,而不是按插件各自分叉。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在从 `unknown` 值上读属性之前用 `isRecord`;在配置边界上遇到必须是正整数的数值选项时用 `assertPositiveInteger`,遇到必须是正有限数的选项时用 `assertPositiveFinite`;插件接收到 schemastery 已解析配置时用 `assertResolvedConfig`;需要交付出去的值保持不可变时用 `deepFreeze`。

### 守卫不可信对象

```ts
import { isRecord } from '@deepseek-ai/dsh-value'

declare const value: unknown

if (isRecord(value) && typeof value.type === 'string') {
  // value: Record<string, unknown> — property reads are unknown-typed here.
}
```

`isRecord` 接受一切对象原型——`Date`、`Map`、类实例——拒绝 `null`、数组、原始值和函数。它回答的是"能否像 record 一样索引",而不是"是否为普通对象字面量"。

### 断言正整数

```ts
import { assertPositiveInteger } from '@deepseek-ai/dsh-value'

declare const raw: unknown

assertPositiveInteger('tool-web: maxDepth', raw)
// raw: number here; a non-integer threw TypeError('tool-web: maxDepth must be a positive integer')
```

诊断标签由调用方提供,消息以消费方自己的词汇命名选项。断言把 `unknown` 收窄为 `number`,非数字、非整数、小于 1 的值都会抛 `TypeError`。

### 断言正有限数

```ts
import { assertPositiveFinite } from '@deepseek-ai/dsh-value'

declare const raw: unknown

assertPositiveFinite('bash-local: timeoutMs', raw)
// raw: number here; 0, negatives, NaN, and Infinity all throw TypeError
```

与整数断言共用同一形态:调用方拥有标签,共享库拥有判定与失败消息。数值不必为整数,但必须是有限的且大于 0。

### 断言已解析的配置边界

```ts
import { assertResolvedConfig } from '@deepseek-ai/dsh-value'

interface Config { readonly enabled: boolean; readonly cwd?: string }
declare const config: Config

const resolved = assertResolvedConfig<Config, 'cwd'>('bash-local', config, ['cwd'])
// resolved.cwd stays optional; every other field is typed as required
```

schemastery 在插件看到配置之前就会填好每一个 schema 默认值,但类型系统无法表达这一事实,于是每个插件各自重写一份 resolved 别名加 cast。`assertResolvedConfig` 是唯一断言点:仍为 `undefined` 的带默认值字段——schema 被绕过或漂移——在加载时以字段名抛错,返回值只保留声明为无默认值的键可选。键的存在性不做重建,手工构造的配置仍必须经过 schema。

### 分类普通数据对象

```ts
import { isPlainObject } from '@deepseek-ai/dsh-value'

declare const payload: unknown

if (isPlainObject(payload)) {
  // payload: Record<string, unknown> — arrays, class instances, and null-prototype lookalikes
  // other than true plain objects were rejected.
}
```

`isPlainObject` 是 `isRecord` 的原型严格姊妹:只接受原型为 `Object.prototype` 或 `null` 的对象。在 wire 与协议边界上使用它,让外来类实例不能冒充数据。

### 测试文件系统 errno 错误

```ts
import { isENOENT, isEEXIST } from '@deepseek-ai/dsh-value'

declare const filename: string
declare const open: (path: string) => Promise<void>

try {
  await open(filename)
} catch (error) {
  if (!isENOENT(error)) throw error // every non-ENOENT failure surfaces
}
```

测试只接受携带 code 的真实 `Error` 实例,伪造的同形值永远不能冒充缺失或已存在。

### 就地冻结值

```ts
import { deepFreeze } from '@deepseek-ai/dsh-value'

declare const request: { signal: AbortSignal }
declare const defaults: Record<string, unknown>

const snapshot = deepFreeze({ request, defaults })
// every nested object is frozen; the request's AbortSignal is deliberately left unfrozen
```

遍历为迭代式且循环安全,任意深度的值都能冻结而不触及调用栈。`AbortSignal` 对象被刻意跳过:它们是存活的取消通道,冻结会破坏 abort。

### 渲染抛出值

```ts
import { errorMessage } from '@deepseek-ai/dsh-value'

declare const payload: { dispatch(): Promise<void> }
declare const ctx: { logger: { warn(message: string): void } }

try {
  await payload.dispatch()
} catch (error) {
  ctx.logger.warn(`dispatch failed: ${errorMessage(error)}`)
}
```

渲染是全防御的:`Error` 实例渲染 `.message`,携带 string `message` 属性的非 Error 对象渲染该属性,其余值走字符串化,而陷阱式的敌意值会得到固定的 `[unrenderable thrown value]` 占位符。诊断因此全 harness 单一格式,而不是按插件分叉。

### 规范化抛出值

```ts
import { toError } from '@deepseek-ai/dsh-value'

function settle(caught: unknown): Error {
  return toError(caught) // real Errors pass through; everything else becomes one
}
```

真实 `Error` 实例保持原身份;其余被捕获值都变成携带渲染消息的 `Error`。`instanceof` 探针本身也有防护,陷阱值不能从 handler 内部抛出而掩盖原始失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

这个库建立在一个边界上:谓词与失败消息属于共享库,标签属于调用方。

### 源码地图

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `isRecord`, `isPlainObject`, `assertPositiveInteger`, `assertPositiveFinite`, `assertResolvedConfig`, `isENOENT`, `isEEXIST`, `errorMessage`, `toError`, `deepFreeze` |
| [`src/invariant.ts`](src/invariant.ts) | 不变量伴随(无运行时不变量;谓词代数由单元测试覆盖) |

### 为什么守卫只看形状

每个消费方都在收窄同一个运行时测试——对象类型、非 null、非数组——然后从结果上读属性。原型判别会按消费方分叉谓词,因此共享守卫保留副本们已经依赖的形状契约。

### 为什么断言接收标签

各副本的差异只在消息里烘焙的诊断前缀。传入标签让共享的失败保持精确,同时让每个消费方命名自己的选项、作用域或配置路径。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Brand ids](../brand/README.zh.md) — 编译期姊妹篇:跨边界标识符的名义类型。
- [Timeout library](../timeout/README.zh.md) — 本包沿用的共享数值校验先例(`clampTimeout`)。

-----

<a id="model-experience"></a>
## 模型体验

间接体验,经由那些在畸形输入到达请求前就拒绝它的解析器与配置加载器。

#### KV 缓存影响

无直接失效;执行校验的消费方拥有任何请求前缀变化。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些边界定义库刻意不做的事。它们是当前包约束,不是任务清单。

- **只看形状的对象守卫** — `isRecord` 接受类实例与 `Date`;需要原型判别的消费方改用 `isPlainObject`。
- **只覆盖正值** — 断言只管 `>= 1` 与正有限数;区间、上限与 1 以外的非整数下界留在各归属能力内。
- **冻结只管具名属性** — `deepFreeze` 无法让 TypedArray 元素或内部槽(如 `Date` 的时间值)不可变;依赖这些的值需要属主自行处理。
- **errno 测试从严** — `isENOENT`/`isEEXIST` 刻意拒绝非 `Error` 同形值;携带 `code` 的伪造值会向上浮出而不是被分类。
- **渲染为短格式** — `errorMessage` 产出不带错误类名前缀的 `.message`,面向结构化记录;带类名的行、栈优先的报告与基于 `inspect` 的有界描述留在各属主消费方。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

None.

</details>
