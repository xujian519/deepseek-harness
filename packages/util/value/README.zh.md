---
description: "共享的未知值原语：面向解析与配置边界的对象守卫和 fail-loud 正整数断言。"
kind: "package-library"
---

# @deepseek-ai/dsh-value

[English](README.md) | 中文

## 概述

`dsh-value` 收纳每个解析器、配置加载器和 wire 解码器都要重写的最小未知输入处理:`isRecord` 把值分类为非 null、非数组的对象,`assertPositiveInteger` 拒绝非整数或小于 1 的值并把 `unknown` 收窄为 `number`,`assertPositiveFinite` 对正有限数做同样的断言与收窄。这份零依赖库拥有谓词与失败消息,让诊断文案在全 harness 逐字一致,而不是按插件各自分叉。

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

在从 `unknown` 值上读属性之前用 `isRecord`;在配置边界上遇到必须是正整数的数值选项时用 `assertPositiveInteger`,遇到必须是正有限数的选项时用 `assertPositiveFinite`。

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

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

这个库建立在一个边界上:谓词与失败消息属于共享库,标签属于调用方。

### 源码地图

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `isRecord`, `assertPositiveInteger`, `assertPositiveFinite` |
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

- **只看形状的对象守卫** — `isRecord` 接受类实例与 `Date`;需要原型判别的消费方自己拥有该检查。
- **只覆盖正值** — 断言只管 `>= 1` 与正有限数;区间、上限与 1 以外的非整数下界留在各归属能力内。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

None.

</details>
