# Agent Note: 把桌面外壳面重新移植到桌面组合叠加层上

Status: implemented

[English](2026-09-18-desktop-shell-surface-after-the-sync.md) | 中文

## Problem

[上游同步](../process/2026-09-18-upstream-v0.1.6-alpha.2-sync.zh.md)接受了上游的桌面重写，而该重写替换了组合方式：`apps/desktop-host/config/desktop.cordis.patch.yml` 被删除，`runProfile` 以 `patchFiles: []` 调用，`main.ts` 改为围绕一份经认证的回环 Web 文档重建。fork 的外壳面随之消失——`ctx.desktop` 提供者没有 Loader 行，Electron 桥没有服务端（托盘定制、插件菜单、全局快捷键与通知因此都不可达），`print.ts` 既无 IPC 通道也无 preload 暴露，Web UI 的 `window.desktop.printHtmlToPdf` 探测于是退回浏览器打印对话框。

有两个事实约束了这次回植。应用窗口加载的仍是同一套 Web UI，来源是 `dsh-app://app`——一个自定义协议处理器，它读取打包的 dist 并把其余请求转发到宿主已认证的回环地址，因此 `assertDesktopSender(event, ['app'])` 本就接纳该 Web 渲染器。而 profile 解析表只携带锚点包依赖闭包内可达的名字，宿主锚定的是 dsh CLI 包，其闭包不含任何桌面专属挂载。

## Decision

外壳面以「组合叠加层 + Electron 侧接线」的形式回来，而不是复活无端口传输。

- `apps/desktop-host/config/desktop.cordis.patch.yml` 即桌面组合：挂载 `desktop-shell`（`ctx.desktop` 提供者）与 `macos-tools`（限 darwin），并按[侧栏决定](2026-09-15-desktop-unmounts-workspace-sidebar.zh.md)把 `better-sidebar` 保留为具名但禁用。其余每一行都与 Web 面一致：同步前对 `webserver`、`web-runtime`、`web-startup`、`synapse`、`client-hmr` 与目录选择器的禁用属于已被移除的无端口传输，而 `directory-picker-auto` 在「仅回环、非 SSH、有显示会话」的宿主上本就会解析出原生后端。
- `ResolvedProfileRuntime.resolutionAnchor`（可选）用于播种 profile 解析表；`installAnchor` 仍负责定位安装，供 bundle 解析与包操作使用。
- `main.ts` 重新拥有桥：在启动宿主之前先启动 `BridgeServer`，通过子进程环境传递 `DSH_DESKTOP_BRIDGE_PATH`，注册外壳菜单基座与托盘，在托盘拥有应用期间把关闭窗口变为隐藏，并随退出序列释放桥。
- 打印为 PDF 以 `dsh-desktop:print-to-pdf` 通道回归，沿用与目录选择器相同的「拥有者窗口 + `dsh-app://app`」校验，并暴露为 `window.desktop.printHtmlToPdf`。

## Alternatives considered

**原样复用同步前的叠加层。** 否决：它的头几行就禁用了 `web-startup`、`webserver` 与 `web-runtime`，而同步后的宿主必须靠它们才能提供这份应用文档。

**改为把 `installAnchor` 指向 desktop-host 包，而不新增第二个锚点。** 否决：插件管理器把该路径解析为安装清单，并借此解析 bundle 与核心包，桌面 profile 会因此失去核心包解析能力。

**在叠加层里按路径挂载外壳包。** 否决：叠加层命名的是 Loader 行，而让名字可导入的机制正是解析表。

## Consequences

桌面应用重新具备外壳面：插件菜单、托盘项、全局快捷键、通知与原生 PDF 导出。`ctx.desktop` 提供者在缺少 `DSH_DESKTOP_BRIDGE_PATH` 时仍会加载，并以 `DesktopError('bridge-disconnected')` 拒绝每个方法，因此无头与测试启动组合的是同一个叠加层。

单锚点规则新增一处有记录的例外：当应用的叠加层挂载了其安装闭包之外的包时，该应用以自己的包名作为解析锚点。省略该字段的应用保持此前的解析行为不变。

`better-sidebar` 重新成为桌面组合的一行，因此若后续层重新启用它，宿主必须继续声明该包才能解析。
