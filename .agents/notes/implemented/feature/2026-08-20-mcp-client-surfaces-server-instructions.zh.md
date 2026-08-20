# Agent Note: mcp-client 将服务器 instructions 表面化为提示 section

Status: implemented

[English](2026-08-20-mcp-client-surfaces-server-instructions.md) | 中文

## 问题

`@deepseek-ai/dsh-mcp-client` 之前只桥接工具：MCP 服务器在 initialize 响应中声明的 `instructions`（协作规则，例如"所有变更都通过工具进行；只在任务线程上回复"）被静默丢弃。AgentRQ 集成直接记录了后果——其插件不得不手动贡献 `agentrq:protocol` 系统提示 section，因为"harness 不会把 MCP 服务器的 instructions 表面化给模型"——未来每个基于 MCP 的集成都不得不重复这一层。

## 决策

`dsh-mcp-client` 现在把服务器的 instructions 表面化为提示 section：

- **捕获**：连接成功后读取 `client.getInstructions()`（SDK 1.29），作为当前世代的值保留；重连时替换。
- **注册**：启用 `surfaceInstructions`（默认 `true`）时，该值注册为 `mcp:<serverName>:instructions` section，order 155，位于工具指引带（100–199）内，避开其他 harness 包使用的 order（subagent 116/116.5、report 117、SDK code-mode 150）。
- **动态文本**：section 的 text 是 provider，每次组装时重新读取当前世代，因此重连返回不同 instructions 时无需重新注册即可反映；缺失或空值不渲染任何内容（渲染阶段会丢弃空 section）。
- **配置**：`surfaceInstructions` 是两个传输变体上的校验字段，部署若在自己的 persona 中声明了相同协议可以关闭。
- **依赖**：`inject` 从 `['tools']` 扩展为 `['tools', 'systemPrompt']`；`@deepseek-ai/dsh-system-prompt` 加入 peer 与 dev 依赖。`systemPrompt` 是 harness 核心服务（agent-loop 依赖它），因此强制要求它会在加载时 fail loud，而不是静默渲染不出 section。

## 备选方案

**维持现状，让每个 MCP 集成各自贡献 section。** 否决：服务器自己声明的协议才是规范副本，强迫每个集成手写渲染既重复劳动又容易漂移。

**通过 `ctx.get()` 访问 `systemPrompt` 并容忍缺失。** 否决：harness 中 `systemPrompt` 始终存在；可选查找会静默禁用该功能而非 fail loud，且想关闭的部署已有 `surfaceInstructions: false`。

## 影响

- `packages/mcp/mcp-client`：`connection.ts` 在连接句柄上暴露 `instructions`；`index.ts` 注册 section；新增 5 个 apply.spec 用例覆盖注册、空值渲染、关闭开关、dispose 与按 `serverName` 命名空间隔离。单测（107）与真实协议 e2e（22）全部通过。
- 生成的配置目录（`docs/config-catalog.md`，doc-sync）反映 `Requires: tools, systemPrompt` 与新字段。
- 不改 agent-loop、`SessionEventMap` 或会话格式，因此无需同步 TS/Python SDK 预期输出，也不 bump `SESSION_FORMAT_VERSION`。
- AgentRQ 插件自己的 `agentrq:protocol` section 保留为其渲染的工具名映射；其服务器的原始 instructions 现在独立到达，且当它只需要原始副本时可设 `guidance: false`。
