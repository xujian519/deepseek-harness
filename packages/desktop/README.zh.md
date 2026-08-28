---
description: "desktop 组地图：Desktop OS 集成服务定义、Electron shell 提供方与目录选择桥，让渲染进程保持沙箱的同时，对话框、通知与托盘保持原生。"
kind: "package-group"
---

# packages/desktop

[English](README.md) | 中文

## 概述

desktop 组拥有 Desktop OS 集成接缝（`ctx.desktop`）：`desktop` 包声明服务，`apps/desktop` 的 Electron main 进程持有原生侧（对话框、通知、菜单、全局快捷键、托盘、拖放），`shell` 通过本地 JSON-RPC socket 把两侧桥接起来，渲染进程因此保持沙箱。`directory-picker` 在同一桥的后端半侧注册 Electron 工作区目录选择器。桌面 profile 经 `desktop-app` bundle 组装这些包；本组不接触网络。

## 目录

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | Service |
|---|---|---|
| [`desktop/`](desktop/README.zh.md) | `Desktop` 服务定义：对话框、通知、菜单、快捷键、托盘契约。 | `desktop` |
| [`shell/`](shell/README.zh.md) | Electron 侧提供方：经本地 socket 把原生能力桥接到后端。 | (provider) |
| [`directory-picker/`](directory-picker/README.zh.md) | 在后端桥上注册 Electron 工作区目录选择器。 | (provider) |

## Related documentation

- [Desktop subsystem](../../docs/subsystems/desktop.zh.md) — 桥协议、生命周期与打包契约。

## Dev Note

无。
