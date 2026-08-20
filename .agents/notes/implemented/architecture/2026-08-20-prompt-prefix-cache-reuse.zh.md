# Agent Note: 面向 Provider KV 缓存的提示词前缀复用

Status: implemented

[English](2026-08-20-prompt-prefix-cache-reuse.md) | 中文

## 问题

每次模型请求的**前缀**——系统提示词、工具 schema、运行时上下文快照——都从零重新组装。`agent-loop` 每步调用一次 `ctx.systemPrompt.assemble()`（`packages/core/agent-loop/src/agent.ts`），重新求值全部注册的 section/context/variable/tool provider 并重新插值变量。Provider 端提示词缓存（KV cache）以前缀为键：任何字节变化都使缓存从该字节起失效，长会话因此反复重付前缀的输入 token 成本。

本决策落地时，周边基础已就绪：

- **历史段字节稳定**：会话日志 append-only，`deriveMessages()` 缓存其投影（`packages/core/session/src/index.ts`）——每个 surface 节点只投影一次，`replace` 重写才重建世代。
- **缓存遥测已端到端存在**：`TokenUsage` 已把 `cacheReadTokens`/`cacheWriteTokens` 与 uncached `inputTokens` 分开（`packages/llm/llm/src/types.ts`）；DeepSeek adapter 的 `mapUsage` 已映射 `prompt_cache_hit_tokens`/`prompt_tokens_details.cached_tokens` 并从 `prompt_tokens` 扣除命中（`packages/llm/llm-deepseek/src/translate.ts`）；pi-ai adapter 已映射读写计数；token-meter 的 `tokenUsage` 投影折叠全部四个桶，usage 经 `assistant/chunk` 与 `assistant/message` 进入会话日志。

缺失的是**前缀复用**：无缓存身份、无 TTL、无持久化、派生会话不继承——且 `system-prompt/assemble` 瀑布与每步求值的 variable providers 是主动的前缀变化源。

## 决策

harness 缓存每个会话的**连续 stable 前缀**——从首段起、文本确定性的连续 sections——使后续组装复用已解析文本，而非重新求值 stable providers。

- `PromptSection` 增加 `stable?: boolean`（`packages/core/system-prompt`）：静态字符串天然 stable；函数 provider 必须显式声明 `stable: true` 才能进入缓存。
- `SystemPrompt.assemble()` 通过可选的 `ctx.promptCache` 服务按 `(scope, 签名, configFingerprint)` 解析 stable 前缀。签名覆盖 stable sections 的有序 `(name, order, fingerprint)` 与当前 prompt 变量值；config 指纹覆盖部署 persona。命中返回缓存 sections 并跳过这些 providers；`system-prompt/assemble` 瀑布与每请求的变量插值仍照常运行。首个 unstable section 起的各段保持每次组装求值，既有 order 拼接不变。工具 schema 不入缓存（工具变更是低频、显式的动作；顺序已确定性）。
- 新包 `@deepseek-ai/dsh-prompt-cache`（`packages/core/prompt-cache`）实现缓存：内存 TTL 策略（默认 1 天），经 `dsh-base` 挂载到 `ctx.promptCache`。`system-prompt/change` 事件清空所有 scope 的条目。未挂载策略时，组装与缓存前路径逐字节一致。
- 键是 agent scope（`assembleContextFor` 解析为 `scope: agent`，`packages/core/agent/src/dispatch.ts`），同 agent 的派生会话复用缓存，子代理会话键不同则不共享。无克隆协议：provider 端缓存字节寻址，stable 前缀字节相同的请求无论 scope 都命中。
- 基线脚本（`scripts/token-economy-baseline.ts`，`pnpm run token-economy:baseline`）读取明文会话日志，按每个请求报告的 usage 输出逐轮与总缓存命中率，复用 token-meter 的 `usageOf` 提取逻辑。

压缩（compaction）只重写历史、不改前缀，因此不失效前缀缓存。

明确未落地（未随本决策交付）：持久化（SQLite）策略——内存策略是交付默认；显式 `invalidate` 消费方——当前无任何操作改写前缀；基线脚本的 zstd 压缩日志——支持明文日志。

## 曾考虑的替代方案

- **独立缓存包 + 在 `agent-loop` 接新装配点**：需要改 loop，违背"插件而非 loop 变化"；`system-prompt/assemble` 瀑布运行在 provider 求值之后，无法跳过重算。
- **单一稳定工具分发入口（BitFun 评估后放弃）**：新工具必须出现在请求 payload，reminder 无法表达；低频且由用户驱动——接受缓存未命中。
- **快照 + diff 列表（BitFun 的技能/子代理 diff reminder）**：本项目的运行时上下文是自由文本，无可 diff 的结构；`RuntimeContextProjection` 已在不变化时跳过重复注入，该收益已获得。
- **按 session 键控 + 显式克隆协议（BitFun 的 `clone_prompt_cache`）**：provider 端缓存是字节寻址的，字节相同的 stable 前缀从任何 scope 都命中；显式客户端克隆只增加簿记、不增加 provider 命中。

## 后果

- stable providers 每个缓存条目只求值一次而非每次组装；system-prompt 与 prompt-cache 测试套件用 provider 调用计数断言该行为。
- token 成本取决于 provider 端缓存命中，命中依赖字节稳定而非本客户端缓存；基线脚本度量命中率。
- core 表面变更：`system-prompt` 的 `assemble()` 增加可选缓存分支；未挂载策略时行为逐字节一致（有回归测试），round-trip 不变量（`packages/core/prompt-cache/src/invariant.ts`）钉住缓存契约。
- 误声明 `stable` 的 provider 在 TTL 内产生陈旧前缀；TTL、失效与 round-trip 不变量限制损害，而非静默降级。
- 工具变更仍打断前缀（接受的 gap）：新工具必须存在于请求 payload；低频且显式。
- DeepSeek 无 cache-write 遥测；命中率口径用 hit/(hit+miss)。
