---
description: "面向模型的 **macOS 原生工具**：打开/在 Finder 中显示路径、用浏览器打开网址、读写剪贴板文本、发系统通知、朗读文本、启动/激活/退出应用——全部通过系统 CLI 以参数数组方式调用，会话之外的宿主效果由一次性审批把关。"
kind: "package-reference"
---

# @deepseek-ai/dsh-macos-tools

[English](README.md) | 中文

## 概述

面向模型的 **macOS 原生工具**：打开/在 Finder 中显示路径、用浏览器打开网址、读写剪贴板文本、发系统通知、朗读文本、启动/激活/退出应用——全部通过系统 CLI 以参数数组方式调用，会话之外的宿主效果由一次性审批把关。

每个工具都以绝对路径启动系统可执行文件（`/usr/bin/open`、`osascript`、`pbcopy`、`pbpaste`、`say`）并传参数数组，绝不使用 shell 字符串，因此模型文本只能以单个参数或 stdin 字节的形式到达系统。影响超出会话的动作——用默认应用打开路径、读取剪贴板、启动或退出应用——在执行前先经 `ctx.approval` 解一次性审批，无审批通道应答时一律拒绝；其余动作直接执行。desktop bundle 仅在 darwin 上挂载本包。

No runtime invariant companion is published; the package owns no independently divergent observations — its effects are one-shot system commands whose outcomes the tool results already record, and approval behavior is owned by `@deepseek-ai/dsh-user-approval`.

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>

## 使用本包

在需要 Agent 使用 macOS 工具的组合中挂载本插件；desktop bundle 将该行限定在 darwin（`disabled: !!js process.platform !== 'darwin'`）：

```yaml
- id: macos-tools
  name: '@deepseek-ai/dsh-macos-tools'
```

配置（全部可选；非法值使插件加载失败）：

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `commandTimeoutMs` | `15000` | 每次系统 CLI 调用的超时。 |
| `clipboardReadMaxChars` | `20000` | 单次剪贴板读取的字符上限。 |
| `clipboardWriteMaxChars` | `1000000` | 单次剪贴板写入的字符上限。 |
| `speakMaxChars` | `4000` | 单次朗读文本的字符上限。 |
| `notifyMaxChars` | `4000` | 通知标题加正文的字符上限。 |

<a id="understand-the-implementation"></a>

## 理解实现

`src/index.ts` 校验并补全配置、装配生产接缝、注册工具；`src/tools.ts` 定义七个工具、审批门与参数校验；`src/runner.ts` 是基于 `execFile` 的运行器，承载超时、取消信号与 stdin 传递。

| 工具 | 系统调用 | 审批 |
| --- | --- | --- |
| `macos_open_path` | `open [-R] <path>` | 打开：要；reveal：免 |
| `macos_open_url` | `open <url>` | 免 |
| `macos_clipboard_get` | `pbpaste` | 要 |
| `macos_clipboard_set` | `pbcopy`（stdin） | 免 |
| `macos_notify` | `osascript -e 'display notification …'` | 免 |
| `macos_speak` | `say [-r N] [-v voice] <text>` | 免 |
| `macos_app` | `open [-a] <name>` / `tell application … to activate/quit` | launch 与 quit：要；activate：免 |

审批门沿用沙箱升级序列：审批服务缺失、无 agent 的调用、或任何非授权结果都会在命令执行前抛错，由工具注册器转为该次调用的错误结果。路径必须是绝对路径或 `~` 开头并通过存在性预检；URL 限定 `http`/`https`（裸域名默认补 `https`）；嵌入 AppleScript 字面量的文本会剥离控制字符、反斜杠与双引号。相对路径被拒绝，模型给出的字符串因此永远不会按后端进程的工作目录解析。

<a id="model-experience"></a>

## 模型体验

### 工具 schema

#### 模型看到什么

插件挂载时，模型看到生成的 [`macos_*` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-macos-tools)：七条英文工具描述与规范化 JSON 输出。被审批拦截的调用以该调用的错误结果呈现，模型无需额外提示即可得知结果。

#### Token 影响

插件挂载处的每个请求承担固定的 schema 开销；darwin 上的桌面 profile 每个请求都会带上这七条 schema。

#### KV Cache 影响

无；本包既不组装也不发送模型请求。

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延期工作

- **仅限 darwin** — 插件在挂载它的任何平台都会注册工具，但 bundle 行将其限定在 darwin，因为所有可执行文件都是 macOS 专属；CLI 运行器本身有基于 `/bin/echo`、`/bin/cat`、`/usr/bin/false` 的跨平台测试。
- **通知需要系统授权** — 只有 macOS 允许宿主进程（终端、Electron 应用或 `dsh` 二进制）发通知时，`display notification` 横幅才会出现；未授权时命令静默成功。
- **无审批通道时一律拒绝** — 在没有挂载审批应答者的组合中（例如无人值守的 headless 运行），四个受控动作以明确报错拒绝而不是执行；这是设计行为，不是缺陷。
- **剪贴板读取涉及隐私** — 剪贴板可能存有密码或令牌，因此每次读取都要一次性审批；读取量受 `clipboardReadMaxChars` 限制。
- **暂缓项** — 截图（屏幕录制 TCC 权限绑定宿主进程，且该工具需要图片内容块支持）、Apple Music 控制与音量控制在第一版中有意不做。

<a id="dev-note"></a>

### 开发备注

无。
