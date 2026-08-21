# Agent Note: 浏览器后端级联与论文 PDF 下载

Status: implemented

English | [中文](2026-08-21-browser-backend-cascade-and-paper-download.zh.md)

## Problem

Sati 的检索/下载方案移植进 harness 后，两条能力缺口仍未闭合：**学术论文没有 PDF 下载工具**（Sati 与 harness 均无）；**浏览器后端级联**（Sati `src/browser/backend/`：ego lite → BrowserOS neo → browser-use → @playwright/mcp 的探测、能力位与冷决策路由）既未移植，也未接入任何生产下载工具——`patent_pdf_download` 当时直接走 ego-browser 拦截 + fetch CDN 兜底，browser-use 一类浏览器兜底通道不存在。

## Decision

1. **新 group `browser/` + 新包 `@deepseek-ai/dsh-browser-backend`**（`packages/browser/browser-backend/`）：移植 Sati 的 `BrowserBackend` 抽象（`probe()` + 六能力位：下载拦截/录屏/人机交接/站点经验包/登录态/反爬），`buildBackendCandidates`（默认级联 ego → browseros-neo → browser-use → playwright，`prefer`/`exclude`）、`resolveBrowserBackend`（冷决策：任务开始前解析一次，运行中不切换）、`probeAllBackends`。依赖方向：`patent-*` / `tool-literature` → `browser-backend`，反向不成立（EgoBackend 独立探测，不依赖 patent-data 的 EgoBrowserSession）。
2. **`BrowserUseExtractor`**（browser-backend 包内）：运行本机 browser-harness `browser-use` CLI（heredoc Python 脚本，helpers 预导入），打开页面并用 `js(...)` 表达式提取值，stdout 打 `BU_EXTRACT:<值>` 标记。下载工具的浏览器兜底通道统一走"打开页面 → 提取 PDF 链接 → fetch 校验落盘"，与 nuo-patent 的 `fetchHtmlWithEgoBrowser` 标记提取模式同构。
3. **`patent_pdf_download` 接冷决策**：工具 deps 增加可选 `resolveRunner`（缺省保持旧行为）；生产接线解析后端——`ego` → 现有 ego-browser 下载拦截；`browser-use` → 提取 CDN 链接 + 现有 fetch 兜底落盘；`browseros-neo` 与 `playwright` **只参与探测矩阵，不参与下载**（无拦截/提取执行，解析到即报 setup_required 引导）。
4. **新工具 `paper_download`**（`tool-literature`）：直链优先（arXiv `extra.pdf`、OpenAlex `best_oa_location.pdf_url`/`open_access.oa_url`、Semantic Scholar `openAccessPdf.url`，经 PDF 魔数 + 最小字节数校验）→ 直链失败（403/404/HTML 壳页）→ browser-use 提取记录页 PDF 链接 → fetch 落盘。输出 `<cwd>/论文原文/YYYY-MM-DD/<id>.pdf`。连接器 `extra` 统一暴露 `pdf_url`。
5. **`dsh --profile headless browsers` 探测命令**（bundle/headless）：输出四后端可用性矩阵（对齐 Sati `sati browsers`），含安装引导与冷决策说明。
6. **快照决策**：`paper_download` 是新的模型可见工具，但**跟随专利工具族现有先例**（`patent_search`/`patent_pdf_download`/`paper_search` 均无 runnable-example keyless 场景，靠包级测试 + loader-composition 覆盖装配），本变更不新增 example 场景；装配路径由 `tool-literature` 的 loader-composition 测试覆盖。

## Alternatives considered

**browser-use 走 Track A（原子工具直出）或补 CDP 下载拦截封装。** 否决：browser-use 无原生下载拦截命令，按 Sati POC 映射其下载走"提取链接 + fetch"（~65%→80% 兼容率的 CDP 封装留待 Python 侧扩展）；提取链接 + fetch 复用现有校验落盘链路，改动最小且确定性。

**论文下载的浏览器兜底也接入 ego 通道。** 否决（延期）：ego 提取执行在 patent-data（`EgoBrowserSession`），`tool-literature` 依赖它会把文献包绑到专利数据 seam；本期论文兜底只用 browser-use，ego 通道对论文下载记为 Known Limitation。

**为 `paper_download` 建 runnable example 快照。** 否决：patent 工具族无该先例，且装配已被 loader-composition 覆盖；示例场景留待工具族整体建快照时一并补齐。

## Consequences

- 新文件：`packages/browser/browser-backend/`（types/ego/browseros-neo/browser-use/playwright 后端 + 路由 + extractor + invariant）、`patent-tools/src/tool/patent-pdf-download-browser-use.ts`、`tool-literature/src/tool/paper-download.ts`、`bundle/headless/src/browsers.ts`。
- 改动：`tsconfig.host.json`（新包 reference）、`packages/README.md`（新 group 行）、三个消费包的 package.json（新增 `@deepseek-ai/dsh-browser-backend` 依赖）、`patent-pdf-download.ts`（`resolveRunner`）、`tool-literature` 连接器（`extra.pdf_url`）与 apply（注册 `paper_download`）、`headless` startup（`browsers` 子命令）。
- 测试：browser-backend 100% 覆盖（79 用例）；patent-tools 下载路由 4 新用例；tool-literature `paper_download` 21 用例 + 连接器 pdf 字段 5 用例；headless `browsers` 3 用例。全仓 `typecheck`/`lint`/相关包测试绿。
- 本机冒烟：`pnpm dsh --profile headless browsers` 输出四后端矩阵（ego/browser-use/playwright ok，BrowserOS neo missing 带安装引导）。
- 不改 agent-loop、`SessionEventMap` 或会话格式；无 TS/Python SDK 预期输出同步，不 bump `SESSION_FORMAT_VERSION`。
