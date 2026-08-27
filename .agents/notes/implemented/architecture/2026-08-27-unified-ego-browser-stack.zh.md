# Agent Note: 浏览器下载统一到 ego 栈（ego lite）

Status: implemented

[English](2026-08-27-unified-ego-browser-stack.md) | 中文

## 问题

`patent_pdf_download` 与 `paper_download` 都会回退到浏览器打开页面并提取 PDF 链接。在 macOS 上，用户的 ego lite / ego-browser 安装从终端用得很好，但 harness 从不选择它：可用性探测与执行会话对"可用"的判断标准不一致，平台 gate 与 PATH 假设又把 ego 锁死在 darwin。结果即使 ego 就在那里，智能体仍把下载路由到 browser-use。

## 决策

浏览器下载通道统一到 ego 栈：

- **探测与执行一致。** `createEgoBackend`（dsh-browser-backend）现在以与 `EgoBrowserSession`（dsh-patent-data）相同的方式解析 CLI：先 `<homeDir>/.local/bin`，再沿各 PATH 段，并做 Windows 扩展名感知查找。探测不再依赖裸 `which`。
- **平台 gate 放宽。** 探测与 `EgoBrowserSession.checkAvailability` 都接受 `darwin` 与 `win32`（ego lite 支持 Windows）；其他平台报告不可用。
- **Windows PATH 分隔符。** `EgoBrowserSession.buildEnv` 与 `isCommandExecutable` 在 Windows 上用 `;` 拼接、切分 PATH，而不是硬编码 `:`。
- **下载只路由到 ego。** `createDownloadRunnerResolver` 解析 `exclude: ['browseros-neo', 'playwright', 'browser-use']` 并恒返回 ego runner；browser-use 链接提取 + fetch 不再是下载通道兜底。
- **`paper_download` 改用 ego 提取。** `PageExtractor` 接口抽象"打开 URL、提取一个 js 表达式值"；`BrowserUseExtractor` 与新 `EgoExtractor` 实现之。`paper_download` 默认用 `EgoExtractor`（经浏览器任务空间/登录态以 `EGO_EXTRACT:<值>` cliLog 标记输出），而非 browser-use 提取器。

四后端级联仍保留为探测矩阵（供 `browsers` 诊断命令）；只有下载通道是 ego-only。harness 仍以子进程方式调用 ego CLI——这不是进程内 SDK 嵌入，也不是 ego-lite 的 fork。

## 备选方案

**fork ego-lite 并嵌入其源码。** 否决：ego-lite 与 dsh 同为 JS/TS 栈（无需跨语言桥），MIT 许可，且自带 `installEgoSdk` 进程内 API，因此"深度融合"目标可用 git/npm 依赖 + 一层薄适配达成，而非分叉一个彼此分家。同时它迭代很快（13.9k stars、每日推送），fork 会背上长期 inter-merge 成本；下载工具所需（开页、截图、提取链接、下载、共享登录态）已被其 SDK 接口覆盖，无需改内核。

**为 Windows 采用 browserOS neo（或作 macOS 兜底）。** 本次否决：browseros-neo 后端仅探测（无下载执行），其探测把端口上任何非 404 的 HTTP 响应都判 ok，且 MCP 端点无鉴权。级联顺序本就 ego 在前，因此 Windows 上 ego 后端无需偏好覆盖即优先。

**把 browser-use 保留为下载兜底。** 否决：统一栈让 ego 成为唯一下载通道，而"探测/执行词汇分裂"正是"不被优选"瑕疵的根源。`BrowserUseExtractor` 与 `createBrowserUseDownloadRunner` 仍保留给显式想要 browser-use 的调用方。

## 后果

买到：只要 ego 存在，macOS 或 Windows 上它都成为被选后端；探测与实际执行一致；`paper_download` 共享 ego 的任务空间/登录态。单一后端拥有下载路径，能力位不再决定下载路由。

付出：`browseros-neo`、`playwright`、`browser-use` 不再承担下载（仍参与探测）；下载 resolver 仅保留 `resolve` 选项供测试注入；工具与两个提取器之间多了一层 `PageExtractor` seam。ego CLI 仍每次调用都 spawn，因此保留了子进程隔离（崩溃边界），代价是一次进程 spawn 且无进程内类型安全。
