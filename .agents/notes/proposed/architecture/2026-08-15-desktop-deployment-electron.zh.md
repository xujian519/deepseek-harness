# Agent Note: 基于 Electron 的桌面端部署

Status: proposed

[English](2026-08-15-desktop-deployment-electron.md) | 中文

## Problem

DeepSeek Harness 需要一个 macOS 与 Windows 上的正式桌面应用，要求：

- 用户无需预先安装 Node.js；
- 复用现有 `apps/web` 与 `packages/client/*` 构建的浏览器 UI；
- 同时支持在线模型提供方与未来的离线/本地模型提供方；
- 提供桌面级能力：应用菜单、Dock/任务栏托盘、全局快捷键、原生文件对话框、文件拖放、系统通知；
- 未压缩包体控制在 4 GB 以内；
- 不需要提交应用商店。

当前产品是一个 Node.js Cordis 应用，通过 `dsh --profile web` 启动服务，再由浏览器访问。桌面版必须保留这一 host/client 架构，同时增加一个本地原生外壳。

## Proposal

### 运行时架构

桌面应用是现有 dsh host/client 组合之外的 Electron 外壳：

- **Electron Main 进程**负责应用生命周期，启动一个私有的 dsh Node.js 子进程，并向渲染进程暴露最小化的、白名单控制的 IPC 接口。
- **dsh 后端子进程**在动态选定的本地端口上运行标准的 `dsh --profile desktop`（或带桌面覆盖层的 `--profile web`）。它与浏览器版使用的服务完全一致，因此所有工具、能力缝隙和会话行为都得以保留。
- **Electron Renderer 进程**加载 `http://127.0.0.1:<port>` 并渲染现有 React UI。它没有 Node.js 集成，所有原生访问都通过 preload 脚本完成。

这样桌面产品就与 Web 产品保持相同架构，并让 Cordis 继续负责组合、插件与能力缝隙。

### 新增包布局

新增一个应用入口、一个 Cordis 包，以及少量桌面专用 host 插件：

```
apps/desktop/                          # Electron entry and build scripts
  src/
    main.ts                            # app lifecycle + dsh child process
    preload.ts                         # allow-listed IPC bridge
    renderer.ts                        # mounts AppWebEntry with desktop hooks
  resources/                           # assembled by the build
    backend/                           # pnpm deploy of apps/cli + node_modules
    node/                              # platform Node.js binary
  electron-builder.yml
  package.json

packages/bundle/desktop-app/           # Cordis bundle: web-app + desktop plugins
  cordis.patch.yml

@deepseek-ai/dsh-desktop-shell/                # registers desktop host services
  src/
    index.ts
    menu.ts                            # menu + Dock/tray abstraction
    dialog.ts                          # native file/folder dialogs
    shortcut.ts                        # global shortcuts
    notification.ts                    # system notifications
    drag-drop.ts                       # file drop ingestion
```

每个 `packages/desktop/*` 插件注册到 Cordis 上下文，并通过现有 API proxy 或新增的 renderer IPC 桥与 Electron Main 进程通信。渲染进程接收桌面事件，再通过浏览器 UI 所用的 HTTP/WebSocket 通道转发给 host。

### 后端打包

由于用户没有安装 Node.js，Electron 应用必须自带运行时与 dsh 后端：

1. `pnpm run build:desktop` 构建 host lib、web dist 与 desktop shell。
2. `pnpm run package:desktop:prepare` 为打包主机 OS 运行 `scripts/desktop-package.ts`，产物在 `apps/desktop/resources/<os>/`：
   - `pnpm --filter @deepseek-ai/dsh deploy --legacy --prod` 物化独立后端。deploy 会把 workspace state 改写为 production/filter 上下文，因此脚本会再跑一次普通 `pnpm install`，恢复后续 pnpm 命令所期望的状态。
   - 脚本把虚拟存储中的每个包提升到顶层 `node_modules`（launcher 从自身安装目录解析 Cordis 插件名，而 deploy 布局只链接直接依赖）。提升的链接使用相对路径，打包副本在安装后仍能解析。
   - `materializeExternalLinks` 把每个解析到部署树之外的符号链接（vendored 的 `cosmokit`/`schemastery` pnpm `link:` 依赖，它们指回仓库、打包后会悬空）替换为真实副本；vendored 包之间的循环链接改指向树内副本。
   - 在 Windows 上所有链接都替换为真实目录副本，而非相对链接：junction 会被归一化为构建机的绝对路径，安装后会悬空。复制把链接展开为真实目录，并用"已复制目标"表打破 vendored 包链接循环；对已复制目标的再次引用，在顶层遍历时复制首份副本（此时首份已复制完成），在副本内部则跳过（解析会向上找到提升后的顶层副本）。
   - 脚本校验所需插件树。
3. `scripts/desktop-download-node.ts` 下载经校验和验证的 Node 二进制（v24.19.0）到 `apps/desktop/resources/<os>/node`（darwin 为 `bin/node`，win32 为 `node.exe`）。Node 二进制与后端的原生 addon 均与 OS 相关，因此每个打包命令在目标 OS 上运行；在 macOS 上可用 `--platform win-x64` 交叉下载 Node 二进制用于构建链路验证，但该包不可分发。
4. `electron-builder`（v26，`apps/desktop/electron-builder.yml`）把每个目标各自的资源目录作为 extraResources 打包。其复制过滤器会丢弃根级 `node_modules` 目录，因此后端分两趟复制（`node_modules` 子树单独一趟，其余一趟）。

运行时 Main 进程启动：

```
<resources>/node/bin/node <resources>/backend/lib/bin.js --profile desktop --port 0
```

子进程通过 stdout 的 `dsh web:` 就绪行告知绑定的 URL。Main 进程等待该行出现后，再加载渲染进程 URL。

使用**独立的标准 Node.js 二进制**而不是 Electron 内置 Node，可以避免 `landlock-run` 原生插件的 ABI 不匹配，并让后端在独立进程中运行。

### 渲染进程安全模型

渲染进程被视为不可信的浏览器页面，即使它加载的是本地服务：

- `nodeIntegration: false`
- `contextIsolation: true`
- `sandbox: true`
- `allowRunningInsecureContent: false`
- `webSecurity: true`

preload 脚本只暴露一个有类型的、白名单控制的 API。每个 IPC 通道都在 Main 进程中校验参数，再调用 Electron 或 Node API。不会泄露原始 `ipcRenderer`；通道声明为闭合联合类型，并按 JSON schema 校验。

示例 preload 接口：

| 通道 | 方向 | 用途 |
| --- | --- | --- |
| `desktop:selectDirectory` | invoke | 打开原生目录选择器 |
| `desktop:showSaveDialog` | invoke | 保存文件对话框 |
| `desktop:fileDrop` | on | 窗口接收到文件拖放 |
| `desktop:serverReady` | on | 后端 URL 就绪 |
| `desktop:toggleTray` | invoke | 显示/隐藏托盘图标 |
| `desktop:sendNotification` | invoke | 系统通知 |

### 原生能力映射

| 桌面功能 | 实现方式 |
| --- | --- |
| 应用菜单 / Dock 菜单 | Main 中使用 `Menu.setApplicationMenu` + `Menu.buildFromTemplate`；菜单动作通过渲染进程调用 host 命令，或直接启动新 dsh 会话 |
| 托盘图标 | Main 中使用 `Tray`；左键显示/隐藏窗口，右键显示上下文菜单 |
| 全局快捷键 | Main 中使用 `globalShortcut`；动作作为 host 命令转发 |
| 原生文件/目录对话框 | Main 中使用 `dialog.showOpenDialog` / `dialog.showSaveDialog`；结果返回给渲染进程 |
| 文件拖放 | Main 通过 `BrowserWindow` 拦截 `drop-files`，经 `desktop:fileDrop` 发送路径；渲染进程转发到 host 的 `ctx.attachments` 或 workspace picker |
| 通知 | Main 中使用 `Notification`；渲染进程通过 `desktop:sendNotification` 请求 |
| 窗口外观 | 由 Main 控制无边框或原生标题栏；渲染进程通过 IPC 请求最小化/最大化/关闭 |
| 系统主题 | Main 中的 `nativeTheme` 以媒体查询/CSS 变量形式暴露给渲染进程 |

### 离线与在线模型支持

桌面 profile 保留所有现有在线 LLM 提供方。离线支持以可选提供方形式注册到 `ctx.llm`：

- `packages/llm/llm-ollama/` 或 `packages/llm/llm-local/` 连接本地 Ollama/LM Studio 服务。
- 仅当配置了本地端点时才注册该提供方；默认情况下产品仍需要在线服务的 API key。
- 因为 `packages/client/ui-settings-models` 通过同一 `ctx.llm` 缝隙消费模型列表，所以它会自动列出本地提供方。

### 构建与发布流水线

新增根脚本：

- `pnpm run build:desktop` — 构建 host lib、web dist 与 desktop main/preload。
- `pnpm run package:desktop:prepare` — 为主机 OS 组装后端部署与平台 Node 二进制；传 `--platform win-x64` 可交叉下载 Node 二进制。
- `pnpm run package:desktop:mac` — 先执行 prepare，再调用 `electron-builder` 构建 macOS 包。
- `pnpm run package:desktop:win` — 先执行 prepare，再调用 `electron-builder` 构建 Windows 包。

`electron-builder.yml` 目标：

- macOS：`dmg` 与 `zip`，`arm64` 和 `x64`（可选 universal）。
- Windows：`nsis` 安装包与 `portable` 可执行文件，`x64`。

CI 使用 GitHub Actions 矩阵，在 macOS 与 Windows runner 上分别构建并 prepare 各自平台，产物上传为 release assets。不包含自动更新，用户手动下载新版本。

### 验证状态

- macOS 上可干净构建 DMG 与 zip；DMG 需要网络下载 `dmgbuild-bundle`（本地代理或 npmmirror 的 `electron-builder-binaries` 镜像可解除阻塞）。
- 打包后的后端自包含：所有符号链接为相对且指向树内（通过扫描打包树、并把 `.app` 复制到仓库外启动后端验证，后端能通过 HTTP 提供 UI）。相同的 prepare 步骤在任何打包主机上都会产出同样结果。
- Windows 打包把所有链接替换为真实目录副本（win32 下的 `materializeExternalLinks`/`hoistVirtualStore`）：junction 会固化构建机的绝对路径，安装后悬空。该 win32 分支已有单元测试，首次发布前仍需在 Windows 主机上验证。
- Windows 安装包在 Windows 上构建（`pnpm run package:desktop:win`）；部署后端的原生 addon 与主机相关，因此 prepare 必须在 Windows 主机或 CI runner 上运行。
- GUI 窗口本身无法在无显示器的沙箱中渲染；集成冒烟测试需要带显示器的机器（CI 原生 agent 或人工验收）。
- 已知限制：在 Windows 上 `child.kill('SIGTERM')` 是 `TerminateProcess`，会跳过后端的信号处理器，因此退出时可能丢失最后一批 write-behind 会话日志（优雅通道推迟到桌面 shell 桥实现）。preload bundle 保持 `electron` external（沙箱 preload 无法加载内联的 `electron` shim）；桌面 shell 已纳入 host typecheck 聚合，并使用独立的 Vitest 配置。后端就绪等待没有超时；窗口导航/弹窗未限制到后端 origin，也未设置 CSP；`dsh web:` 就绪行正则接受任意 host；部署树携带全平台 node-pty prebuilds（冗余但体积小）。这些加固随桌面 shell 插件一起落地。

### 签名与公证

- **macOS**：macOS 10.15+ 的 Gatekeeper 要求使用 Developer ID Application 证书签名并公证。`electron-builder` 可通过 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 完成公证。
- **Windows**：建议使用代码签名证书以避免 SmartScreen 警告。若无证书，NSIS 安装包仍可在用户确认后运行。

### 测试策略

- 单元测试：`scripts/desktop-package.spec.ts`（部署校验、提升、POSIX 与 win32 的链接实体化）、`scripts/desktop-download-node.spec.ts`（下载、校验和、缓存）、`apps/desktop/tests/server-manager.spec.ts`（就绪、释放）、`apps/desktop/tests/preload-bundle.spec.ts`（electron external）。
- 快照测试复用现有 Web 快照，因为渲染进程 UI 未改变。
- 集成测试启动构建后的 Electron 应用，验证它能启动后端、加载 UI、创建空白会话；需要显示器，推迟实施。
- 每次发布前在实体 macOS 与 Windows 机器上做人工验收。

### 分阶段落地

1. **阶段 1 — 骨架**（已完成）：`apps/desktop` 能启动、启动 dsh 后端、加载 Web UI；已端到端验证（ready URL + HTTP 200）。
2. **阶段 2 — 打包**（已完成）：`pnpm deploy` 打包后端、携带 Node 二进制、`electron-builder` 产出未签名安装包；签名/公证推迟到阶段 5 CI。
3. **阶段 3 — 桌面插件**：新增 `@deepseek-ai/dsh-desktop-shell` 与目录选择提供方，然后实现菜单、托盘、对话框、拖放、通知、快捷键（`packages/bundle/desktop-app` 已在阶段 1 创建）。
4. **阶段 4 — 离线提供方**：在 `ctx.llm` 后新增可选本地 LLM 提供方。
5. **阶段 5 — CI/发布**：GitHub Actions 矩阵在 release tag 上构建双平台。

## Alternatives considered

**Tauri + Node.js sidecar。** Tauri 使用系统 WebView，产物更小，但仍需要独立 Node 运行时来跑 dsh。Rust 主进程会引入新的语言栈和额外 IPC 层，而在 4 GB 包体上限下 Electron 的体积成本可接受。已拒绝。

**Wails + Node.js sidecar。** 与 Tauri 类似，但使用 Go。项目本身已全面使用 Node/TypeScript，引入 Go 并不必要。已拒绝。

**Neutralinojs。** 更轻的 C++ 方案，但其生态与跨平台打包成熟度远低于 Electron。出于维护风险拒绝。

**仅 Progressive Web App。** PWA 可完全避免打包，但无法运行本地 dsh Node.js 后端，也无法访问本地文件系统/终端/沙箱。已拒绝。

**React Native for Windows/macOS 或 .NET MAUI/Avalonia。** 这些方案需要重写整个 UI，而不是复用 `apps/web`。由于 UI 复用是硬性要求，已拒绝。

## Acceptance criteria

- `apps/desktop` 在 macOS 与 Windows 上构建并运行，且目标机器无需安装 Node.js。
- 产出的 `.dmg`（macOS）与 `.exe`/NSIS 安装包（Windows）能成功启动现有 Web UI。
- 桌面应用支持菜单栏/托盘、全局快捷键、原生文件对话框、文件拖放、系统通知。
- 未压缩包体低于 4 GB；初期目标低于 1 GB。
- 渲染进程没有 Node.js 访问权限；所有 OS 交互都通过白名单 preload IPC 桥完成。
- macOS 构建经过签名与公证；Windows 构建在有证书时进行签名。

## Risks

- **原生插件 ABI。** `landlock-run` 必须为所携带的标准 Node 二进制编译，而不是 Electron 内置 Node。使用独立 Node 子进程可缓解。
- **macOS 公证延迟。** 公证可能失败或耗时；CI 必须输出可排查的日志。
- **进程生命周期。** dsh 后端可能崩溃或因端口不可用拒绝启动。当前 shell 会弹出错误对话框；指数退避重启与更清晰的用户可见诊断计划随桌面 shell 插件一起落地。
- **渲染进程与浏览器差异。** 拖放、深链接、窗口聚焦等行为与独立浏览器不同，都需要在 Main/preload 中显式处理。
- **构建时间长。** 携带完整 Node 运行时与 `node_modules` 会拖慢 CI 构建；缓存下载的 Node 二进制与部署后的后端目录可改善。
