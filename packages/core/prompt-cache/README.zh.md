# dsh-prompt-cache

[English](README.md) | 中文

为 `SystemPrompt.assemble()` 提供提示词前缀缓存：`ctx.promptCache` 服务缓存会话的连续 stable 前缀段（内存、TTL 有界），使 `system-prompt` 在后续组装时跳过对 stable providers 的重复求值。服务未挂载时，组装逐字节走既有路径。

## 配置

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `ttlMs` | `86400000` | 内存条目存活时间（毫秒）。 |

## 公共 API

- `ctx.promptCache` 缓存服务：`get(key)` / `set(key, sections)` / `invalidate(scope)`。键的 `signature` 覆盖 stable 段的有序指纹与当前 prompt 变量值，`configFingerprint` 覆盖部署 persona——任一变化都会重算条目。
- `DEFAULT_PROMPT_CACHE_TTL_MS` 默认条目存活时间。

注册变化会使全部条目失效：服务监听 `system-prompt/change` 并清空所有 scope，因为任一 prompt provider 变化都会改变每个 scope 的 stable 签名。

## 与 provider 端缓存的关系

本缓存节省的是重复计算，不是 provider 成本：provider 端 KV 缓存是字节寻址的，stable 前缀字节相同的请求无论来自哪个 scope 都会命中。字节一致的前缀是两者共同生效的前提，这正是 `system-prompt` 显式声明 `stable` 段而非缓存一切的原因。
