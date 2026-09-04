---
description: "dsh 桌面表层组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-web-app`](../web-app/README.zh.md) 之上：它为桌面 profile 复述 web 运行时配置、插入本包提供的 `desktop-runtime` 粘合插件、挂载桌面 shell 服务（`@deepseek-ai/dsh-desktop-shell`）、钉死 `openBrowser: false` 使 Electron 窗口成为唯一 UI 表层，并禁用 web 运行时的自动目录选择器，改用 Electron 对话框 provider（`@deepseek-ai/dsh-desktop-directory-picker`）并配对 native client surface（`@deepseek-ai/dsh-client-ui-directory-picker-native`）来驱动 `host.pickDirectory`。桌面 profile（`dsh --profile desktop`）依次叠放 `dsh-base`、`dsh-web-app` 与本组合包。"
kind: "package-bundle"
---

# `@deepseek-ai/dsh-desktop-app`

[English](README.md) | 中文

## 概述

dsh 桌面表层组合包。[`cordis.patch.yml`](cordis.patch.yml) 叠加在 [`dsh-web-app`](../web-app/README.zh.md) 之上：它为桌面 profile 复述 web 运行时配置、插入本包提供的 `desktop-runtime` 粘合插件、挂载桌面 shell 服务（`@deepseek-ai/dsh-desktop-shell`）、钉死 `openBrowser: false` 使 Electron 窗口成为唯一 UI 表层，并禁用 web 运行时的自动目录选择器，改用 Electron 对话框 provider（`@deepseek-ai/dsh-desktop-directory-picker`）并配对 native client surface（`@deepseek-ai/dsh-client-ui-directory-picker-native`）来驱动 `host.pickDirectory`。桌面 profile（`dsh --profile desktop`）依次叠放 `dsh-base`、`dsh-web-app` 与本组合包。

不发布运行时不变式伴生；bundle patch 与胶水插件不持有自身的可变状态，所有贡献都落入各自主管注册表。


## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Model Experience

无，粘合插件只占据组合席位，不贡献模型可见文本；web 表层提示与 `DSH_WEB_URL` 运行时变量由 [`dsh-web-app`](../web-app/README.zh.md) 负责，本组合包在其之上原样叠放。

#### KV Cache effect

无；本包既不组装也不发送任何 provider 请求。

## Known Limitations and Deferred Work

- **桌面桥接表层不完整** —— shell 服务（`ctx.desktop`）与 Electron 目录选择器已落地；Main 进程桥接方法中的菜单、托盘、全局快捷键与通知仍是 stub，推事件链（`desktop/menu-activated`、`desktop/tray-clicked` 等）尚无调用方。其余 `packages/desktop/*` 插件将填补这些席位。

### 开发备注

无。
