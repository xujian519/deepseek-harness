# Agent Note: 桌面无端口推送传输

Status: implemented

[English](2026-09-09-desktop-portless-push-transport.md) | 中文

## Problem

桌面壳的渲染进程无法为自定义 `dsh-app://` scheme 构造 `WebSocket`（Chromium 只接受 `ws`/`wss`/`http`/`https`），因此经 `registerUpgrade` 注册的三条 better-sidebar 传输被保留但从不分发。terminal（双向）、agent-terminals 列表推送、agent-opens 请求推送都依赖该升级路径，因而到不了桌面渲染进程。

## Decision

把三条传输改接到无端口流式面上。给 `PortlessWebServer` 新增 `registerStream` 路由，其 handler 返回一个带 `ReadableStream` body 的 Fetch `Response`，由宿主分发逐块转发（writeHead/end 路由面不变）。插件侧用 `SidebarTransport` 抽象替换 pty 泵与推送挂载里的 WebSocket。

- **terminal** 是单请求全双工：请求体承载客户端→宿主的输入帧（原文，以及 JSON `{type:'resize'|'close'|'park'}`），响应体承载宿主→客户端的输出（transcript 回放、实时数据、退出提示）。失败语义从 WS close code 改为 HTTP 状态码：缺参 400、未知 agent uuid 404、node-pty 退化 503（带 `pty-deps-missing` 标记）、意外解析错误 500。close 帧的立即释放通过 `closeFrameReceived` 标志在 body 结束的 grace 前保住（`scheduleClose` 最后一次调用生效）。
- **agent-terminals** 与 **agent-opens** 推送是单向的换行分界 JSON 流：客户端 POST 一个订阅并逐行读取 NDJSON，一行一个 JSON 载荷，对齐 `/.dsh/remote-stream` 约定。

客户端改用 fetch 消费流：`subscribeSessionPush` 读 NDJSON body，按 2 秒退避重连并在 `FAILURE_LIMIT` 封顶；`TerminalView` POST 输入流并读输出流，把 503 的 deps 标记映射为修复详情拉取、把 4xx/5xx 映射为带重试的原因展示。

## Alternatives considered

**把 terminal 拆成两个单向请求（一个输入 POST 加一个输出流）。** 被否决：单请求全双工才是原 socket 的忠实形态，且桌面传输本就分别流式请求体与响应体，terminal 无需自定义分帧。

**推送复用 `/.dsh/remote-stream`。** 部分被否决：该通道绑定到网关的 `wireStream` 端点，而 sidebar 的推送源来自自身注册表；按插件加 `registerStream` 路由能保留同样的宿主→渲染进程流式模型，却不与网关耦合。

**保留 WebSocket 但换 scheme 探测。** 被否决：Chromium 的 `WebSocket` 构造器拒绝非 `ws`/`wss`/`http`/`https` scheme，因此不存在能承载这些帧的自定义 scheme WebSocket。

## Consequences

桌面渲染进程现在经流式 fetch body 收到三条 sidebar 传输。terminal 是单请求全双工；agent 推送是按原语义重连的 NDJSON 流。`SidebarTransport` 面让 pty 泵行为保持一致（transcript 回放、resize/close/park 帧、重连 grace 倒计时、agent 所有权的终结规则），因此面向模型的 terminal 工具不变。`ws` 依赖退出插件源码。`registerStream` 路由与 writeHead/end 路由在无端口面上共享路径唯一性。
