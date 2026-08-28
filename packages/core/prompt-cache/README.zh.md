---
description: "为 `SystemPrompt.assemble()` 提供提示词前缀缓存：`ctx.promptCache` 服务缓存会话的连续 stable 前缀段（内存、TTL 有界），使 `system-prompt` 在后续组装时跳过对 stable providers 的重复求值。服务未挂载时，组装逐字节走既有路径。"
kind: "package-reference"
---

# dsh-prompt-cache

[English](README.md) | 中文

## 概述

为 `SystemPrompt.assemble()` 提供提示词前缀缓存：`ctx.promptCache` 服务缓存会话的连续 stable 前缀段（内存、TTL 有界），使 `system-prompt` 在后续组装时跳过对 stable providers 的重复求值。服务未挂载时，组装逐字节走既有路径。

## 目录

- [配置](#config)
- [公共 API](#public-api)
- [与 provider 端缓存的关系](#relationship-to-provider-caches)
- [模型体验](#model-experience)
- [已知限制与待办事项](#known-limitations-and-deferred-work)

<a id="config"></a>
## 配置

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `ttlMs` | `86400000` | 内存条目存活时间（毫秒）。 |

<a id="public-api"></a>
## 公共 API

- `ctx.promptCache` 缓存服务：`get(key)` / `set(key, sections)` / `invalidate(scope)`。键的 `signature` 只覆盖 stable 段的有序指纹——缓存文本未插值，变量值不进身份；`configFingerprint` 覆盖部署 persona——任一变化都会重算条目。
- `DEFAULT_PROMPT_CACHE_TTL_MS` 默认条目存活时间。

注册变化会使全部条目失效：服务监听 `system-prompt/change` 并清空所有 scope，因为任一 prompt provider 变化都会改变每个 scope 的 stable 签名。

<a id="relationship-to-provider-caches"></a>
## 与 provider 端缓存的关系

本缓存节省的是重复计算，不是 provider 成本：provider 端 KV 缓存是字节寻址的，stable 前缀字节相同的请求无论来自哪个 scope 都会命中。字节一致的前缀是两者共同生效的前提，这正是 `system-prompt` 显式声明 `stable` 段而非缓存一切的原因。

<a id="model-experience"></a>
## 模型体验

经由 `system-prompt` 间接生效：缓存复用已求值的 stable 前缀文本，使模型请求保持字节一致的前缀，provider 端 KV 缓存得以持续命中。

#### KV 缓存效果

字节一致的 stable 前缀跨请求保持 provider KV 复用；缓存未命中只是重新求值 stable providers，请求字节在命中与未命中两种情况下保持一致。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办事项

- **仅内存** —— 条目只存在于单进程内，重启即失效；没有跨进程或持久化缓存。
- **仅未插值文本** —— 变量插值仍在每次请求时运行，缓存无法跳过最终渲染步骤。
- **stale 前缀暴露面** —— 误声明 `stable` 的 provider（TTL 内输出变化）会产生 stale 前缀；TTL、`system-prompt/change` 显式失效与遥测只是限制损害，而非消除。

### 开发备注

无。
