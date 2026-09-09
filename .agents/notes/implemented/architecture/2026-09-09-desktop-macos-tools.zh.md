# Agent Note: 官方桌面组合中的 macOS 原生工具

Status: implemented

[English](2026-09-09-desktop-macos-tools.md) | 中文

## 问题

官方桌面壳（`apps/desktop` 加私有 `apps/desktop-host` 进程）组合的是浏览器 `web-app` bundle 与 host 覆盖补丁，不使用 patent 壳挂载的 `desktop-app` bundle。因此面向模型的 macOS 原生工具包（`@deepseek-ai/dsh-macos-tools`）从未进入官方桌面，尽管桌面 profile 拥有原生壳侧表面，模型本可通过系统 CLI 调用这些工具。

## 决策

把 `@deepseek-ai/dsh-macos-tools` 加入 desktop-host 的包依赖，并在 `desktop.cordis.patch.yml` host 覆盖中插入 `macos-tools` 行，门控到 darwin（`disabled: !!js process.platform !== 'darwin'`）。覆盖已插入 desktop-shell 提供方与原生目录选择器，工具行与其落在同一组合层。macos-tools 生成的每个可执行文件都是 macOS 特有的，门控让非 darwin 桌面构建不加载它。

## 备选方案

**经由 `desktop-app` bundle 挂载。** 官方壳组合 `web-app` 与覆盖，不用该 bundle；复用它会引入 patent 壳的额外行及其 `dsh-desktop-app` bundle 依赖。

**在包级别门控。** 平台检查应属于声明该行的组合层，这样非 darwin 构建从一开始就不会解析该行。

## 影响

在 darwin 上桌面模型能看到七个 `macos_*` 工具（打开/显示、浏览器网址、剪贴板、通知、朗读、应用控制）。会话之外的宿主效果经 `ctx.approval` 一次性审批，没有审批通道时失败关闭，因此无审批服务的组合仍能启动。该 bundle 的 README 中「仅在 darwin 上挂载」现在同样描述了官方桌面。
