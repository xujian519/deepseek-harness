---
description: "[`ctx.desktop`](../desktop/README.zh.md) 能力缝隙的 **Electron 主进程桥接提供方**。`DesktopShell` 是一个 Cordis Service Provider，从环境变量读取 `DSH_DESKTOP_BRIDGE_PATH`，通过 [`BridgeClient`](./src/bridge-client.ts) 经本地 socket 连接到 Electron 主进程，并注册 `ctx.desktop`。如果缺少桥接路径，插件会加载但 `ctx.desktop` 不可用，所有方法都会以 `DesktopError('bridge-disconnected')` 拒绝；这样同一个包可以在无 Electron 的测试中启动。"
kind: "package-reference"
---

# @deepseek-ai/dsh-desktop-shell

[English](README.md) | 中文

## 概述

[`ctx.desktop`](../desktop/README.zh.md) 能力缝隙的 **Electron 主进程桥接提供方**。`DesktopShell` 是一个 Cordis Service Provider，从环境变量读取 `DSH_DESKTOP_BRIDGE_PATH`，通过 [`BridgeClient`](./src/bridge-client.ts) 经本地 socket 连接到 Electron 主进程，并注册 `ctx.desktop`。如果缺少桥接路径，插件会加载但 `ctx.desktop` 不可用，所有方法都会以 `DesktopError('bridge-disconnected')` 拒绝；这样同一个包可以在无 Electron 的测试中启动。

不发布运行时不变式伴生；provider 有意在无 DSH_DESKTOP_BRIDGE_PATH 下装载，以便测试与无头启动组合同一 bundle，断开的桥接在调用边界通过类型化 DesktopError('bridge-disconnected') 失败上报。


## 目录

- [Model Experience](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

## Model Experience

无，因为本包仅将 `ctx.desktop` 调用桥接到 Electron Main，不注册提示文本、工具模式或模型结果。

#### KV Cache 影响

无；本包既不组装也不发送提供方请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **文件拖放延后** — `desktop/file-dropped` 目前没有 Main 侧发射方：窗口级拖放不会到达 Electron Main，且 Web 界面已自行处理应用内拖放（workspace 界面的 `acceptDrop`）。渲染器拖放通道会扩大沙箱 preload 面，随该工作延后。
- **单一后端连接** — 桥接服务端只接受一个并发后端 socket，额外连接会被拒绝；重连由客户端驱动，带指数退避与活动注册重放。

### 开发备注

无。
