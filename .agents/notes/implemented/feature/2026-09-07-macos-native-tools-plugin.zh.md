# Agent Note: macOS 原生工具插件 —— CLI 驱动的模型工具与分级审批

Status: implemented

[English](2026-09-07-macos-native-tools-plugin.md) | 中文

## Problem

Harness 的工具覆盖了文件、shell 与网络，却没有任何工具能让 Agent 作用于用户的桌面：无法为用户打开结果、读写剪贴板、发送完成通知或切换应用。社区项目 `Starmadebydata/deepseek-harness-macos` 用 `dsh-macos-tools` 证明了需求——一个零依赖的 Node 插件，通过 macOS 系统 CLI 暴露十项此类操作——但它没有权限门、限制写死、模型可见文本为中文，官方包无法照单全收。

## Decision

`@deepseek-ai/dsh-macos-tools`（desktop 组）注册七个模型工具，全部以参数数组启动绝对路径的 macOS 系统可执行文件（`open`、`osascript`、`pbcopy`、`pbpaste`、`say`），绝不使用 shell 字符串：`macos_open_path`、`macos_open_url`、`macos_clipboard_get`、`macos_clipboard_set`、`macos_notify`、`macos_speak`、`macos_app`。desktop-app bundle 以 `disabled: !!js process.platform !== 'darwin'` 挂载该插件，因此只有 macOS 上的官方桌面应用可见这些工具；web profile 保持不变。

影响超出会话的操作——用默认应用打开路径、读取剪贴板、启动或退出应用——在 `execute` 内、任何执行发生之前经 `ctx.approval` 解一次性审批；审批服务缺失、无 agent 调用或任何非授权结果都一律拒绝，沿用共享的沙箱升级序列。Finder 显示、浏览器网址、剪贴板写入、通知、朗读与应用激活免审批；URL scheme 固定为 http/https，路径必须是绝对路径或 `~` 开头并通过存在性预检，嵌入 AppleScript 的文本剥离控制字符、反斜杠与双引号。限制项（超时、剪贴板与文本上限）是经校验的 `Config` 字段；模型可见文本为英文。

## Alternatives considered

**为什么不原样吸收社区插件？** 它的每个工具都以用户完整权限立即执行——模型可以静默读取密码管理器的剪贴板或启动任意应用——且 `MAX_*` 常量违反"禁止硬编码可调参数"规则。把工具集移植到 harness 审批接缝之后，保留了被验证的能力面，同时补上安全缺口。

**为什么这些工具不用 Swift 助手二进制？** 七项操作都有第一方 CLI；真正需要原生代码的是 Vision、ScreenCaptureKit 与设备端语音，它们继续搁置，等产品决策引入。

**为什么不挂载到 web-app bundle 层？** web 层会让 Mac 上每个 `dsh web` 会话都看到这些工具。首版选择更保守的 desktop-app 层；日后下移一层只是一行 bundle 改动。

**为什么不做成能力接缝（Service Definition + 提供方）？** 包不变量规则只在实现可能分化时要求接缝角色；这里只有唯一实现（本地系统 CLI），也没有远程提供方的迹象。

**为什么不做声明式的逐工具权限字段？** `ToolDefinition` 没有策略字段，仓库先例（bash 升级、fs 沙箱升级）都在 `execute` 内经 `ctx.get('approval')` 解审批；为一个包发明新的声明式机制只会重复它。

## Consequences

桌面工具 schema 增加七个工具（每个桌面会话的提示词开销），通知依赖宿主进程的通知授权，未挂审批应答者的组合中四个受控操作以明确报错拒绝——这是无人值守运行的设计姿态。换来的收益是：Agent 获得安全的桌面存在感，高风险操作逐次征得用户同意，包保持纯 TypeScript、具备跨平台单测与 darwin 专属 CLI 回环，仓库不引入任何原生构建。

## Testing

单测套件以 fake 运行器、fake 审批通道与 fake 存在性预检，经真实工具运行时驱动全部七个工具，覆盖 argv 矩阵、校验失败、全部审批结果与配置拒绝；三个源文件的单文件覆盖率为 100%。darwin 专属测试用真实 `pbcopy`/`pbpaste` 做剪贴板回环。手工编写的 keyless 场景 `snapshots/session/macos-tools-validation/` 在所有平台回放三条确定性失败路径——URL scheme 拒绝、rate 越界拒绝、`never` 策略下的审批审计对与剪贴板拒绝。
