---
description: "面向模型可见下载与抓取工具的浏览器自动化后端级联，自 Sati 浏览器后端层（`src/browser/backend/`）移植。四个后端按固定顺序探测与路由——**ego lite → BrowserOS neo → browser-use → @playwright/mcp**——采用冷决策规则：任务的后端在任务开始前解析一次，运行中不切换。统一 ego 栈让下载通道只认 ego；其余后端参与探测矩阵，但从不承担下载。"
kind: "package-reference"
---

# @deepseek-ai/dsh-browser-backend

[English](README.md) | 中文

## 概述

面向模型可见下载与抓取工具的浏览器自动化后端级联，自 Sati 浏览器后端层（`src/browser/backend/`）移植。四个后端按固定顺序探测与路由——**ego lite → BrowserOS neo → browser-use → @playwright/mcp**——采用冷决策规则：任务的后端在任务开始前解析一次，运行中不切换。统一 ego 栈让下载通道只认 ego；其余后端参与探测矩阵，但从不承担下载。

不发布运行时不变式伴生；后端的 probe 与路由是无状态的只读操作，不持有包级持久状态，消费路由后端的下载工具自行持有执行关系。


## 目录

- [后端与能力位](#backends-and-capabilities)
- [路由](#routing)
- [链接提取器](#link-extractors)
- [已知局限与后续工作](#known-limitations-and-deferred-work)

<a id="backends-and-capabilities"></a>
## 后端与能力位

每个后端暴露只读 `probe()`（默认不 spawn 浏览器、≤5s、无副作用）与能力位掩码。下载工具据此判断后端能否安全承接任务：

| 后端 | 探测 | 下载拦截 | 登录态 | 反爬 |
| --- | --- | --- | --- | --- |
| `ego` | macOS/Windows + `ego-browser` CLI（在 `~/.local/bin` 再沿 PATH 查找；可选 `--doctor` 连接探针） | 是 | 是 | 是 |
| `browseros-neo` | MCP 端点 HTTP 可达性（`127.0.0.1:9010/mcp`，`DSH_BROWSEROS_MCP_URL` 覆盖）+ 监听 pid 归属 | 是 | 是 | 是 |
| `browser-use` | `browser-use --version`（browser-harness CLI） | 否（下载走链接提取 + fetch） | 是 | 是 |
| `playwright` | 全局 `playwright` / `@playwright/mcp` CLI 存在性 | 否 | 否 | 否 |

<a id="routing"></a>
## 路由

- `buildBackendCandidates(options)` — 有序候选列表；`prefer` 把指定后端提到最前，`exclude` 剔除候选。
- `resolveBrowserBackend(options)` — 冷决策：取第一个 probe 为 ok 的候选；全不可用时抛错并给出安装引导。
- `probeAllBackends(options)` — 不短路探测全部候选（供 `browsers` 诊断命令使用）。

ego 的命令查找与执行会话一致（先 `~/.local/bin` 再各 PATH 段，Windows 扩展名感知），因此可用性探测与实际运行的标准一致。

<a id="link-extractors"></a>
## 链接提取器

- `BrowserUseExtractor` 运行 browser-harness 的 `browser-use` CLI（heredoc Python 脚本，helpers 预导入）打开页面并用 `js(...)` 表达式提取值，stdout 打印 `BU_EXTRACT:<值>` 标记。
- `EgoExtractor` 运行 `ego-browser` CLI 打开页面并用 `js(...)` 表达式提取值，经浏览器任务空间/登录态以 `EGO_EXTRACT:<值>` cliLog 标记输出。`paper_download` 将其作为 ego 兜底通道。

两者都是 `PageExtractor` 实现；下载工具任选其一并 fetch 提取到的链接。

<a id="known-limitations-and-deferred-work"></a>
## 已知局限与后续工作

- **仅探测的后端**：`browseros-neo` 与 `playwright` 参与探测与路由，但尚无下载执行——下载工具以引导文案拒绝（二者缺少下载器实现的拦截/提取通道）。
- **下载只认 ego**：统一 ego 栈下，`patent_pdf_download` 与 `paper_download` 只解析 ego 后端；browseros-neo / playwright / browser-use 从不承担下载。
- **browser-use 无下载拦截**：按 Sati POC 映射，其下载走链接提取 + fetch；录屏与人机交接能力位同样为关。
- **browser-use 是本机 CLI 而非 npm 依赖**：CLI 缺失时探测给出安装引导；本包从不假设其已安装。

### 开发备注

无。
