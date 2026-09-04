---
description: "dsh web GUI 的类 VSCode 右侧边栏：explorer、editor、terminal、git、side chat、subagent 与 browser 标签页按会话隔离，桌面组合默认挂载，其他客户端插件可通过 ctx.betterSidebar 标签页与文件查看器注册表扩展。"
kind: "package-reference"
---

# @deepseek-ai/dsh-better-sidebar

[English](README.md) | 中文

## 概述

`dsh-better-sidebar` 为 dsh web GUI 提供类 VSCode 的右侧工作区：文件 explorer、CodeMirror editor、按会话隔离的终端、git 面板、side chat 子会话、实时的 subagent 预览以及内嵌浏览器，全部作用于当前打开的会话。每个文件、git 与终端操作都通过与 `/api` 网关相同信任围栏的宿主路由执行，作用目录是当前会话的工作目录——切换会话即切换整个工作区；终端、标签页与草稿都留在各自会话中。本包是双面孔：宿主半侧挂载带围栏的 `/sidebar/*` 路由、node-pty 终端与默认关闭的 `terminal_*` 工具，浏览器半侧渲染面板并发布一个客户端服务，供其他客户端插件注册侧边栏标签页与文件查看器。桌面组合默认挂载该插件；浏览器 `dsh web` 组合不挂载。本包自 omdsh-dev 的 MIT 许可 `dsh-better-sidebar` 0.17.1 一方收编为第一方，MIT LICENSE 文件保留。

不发布运行时不变式伴生；侧边栏不持有自身的服务状态或事件协议——每条路由都挂在宿主 webServer 护栏下，pty 生命周期、存储语义与路由护栏各自经由其能力间隔观测。


## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

侧边栏是桌面默认项：[桌面组合 patch](../../bundle/desktop-app/cordis.patch.yml) 插入 `better-sidebar` 行，面板随即出现在会话旁，无需任何接线。其他组合想启用时自行插入同一行；桌面部署不想要它时，在自己的 profile patch 中禁用该行。

### 何时选择它

当会话旁需要一个工作区时选择侧边栏：查看与编辑已产出文件、运行命令、检查 git 状态，或在不离开会话的情况下开一段 side 对话。headless 组合跳过它（没有 web GUI 时它不注册任何内容）；当另一个右面板占据该槽位时也跳过：在 `aionui-panel` 的设置命名空间中选择其 provider 会让侧边栏保持不挂载。

### 最小配置

桌面默认无需任何配置。浏览器或自定义组合用 insert 行挂载插件；profile 可以禁用桌面默认行，禁用在 desktop-app 层之后生效：

```yaml
# Mount in a composition without the desktop bundle:
- insert:
    - id: better-sidebar
      name: '@deepseek-ai/dsh-better-sidebar'

# Opt out of the desktop default from a profile patch:
- id: better-sidebar
  disabled: true
```

宿主限制放在该行的 `config` 块中：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `readLimit` | 512 KiB | 单个文本文件的读取上限（字节）；更大的文件返回截断标记 |
| `mediaLimit` | 20 MiB | `/sidebar/file` 媒体上限（字节）；更大的二进制文件被拒绝 |
| `uploadLimit` | 128 MiB | `/sidebar/upload` 上限（字节）；更大的文件被拒绝 |
| `listLimit` | `1000` | 每级目录的 explorer 行数 |
| `terminalsPerSession` | `3` | 每个会话的终端标签页数 |
| `reconnectGraceMs` | `30000` | 断开的终端等待重连的存活时长 |
| `shell` | `''`（自动） | UI 标签页与 `terminal_*` 工具共用的终端 shell；留空按平台自动解析 |
| `shellArgs` | `[]` | 附加 shell 参数；非空时替换平台默认参数 |

生成的[配置目录](../../../docs/config-catalog.zh.md)是每个受接受字段的穷尽来源。

用户侧的「Side card」偏好（默认打开、宽度、自动打开开关、终端字体，以及 `agentTerminalTools` 与 `agentOpenTools` 工具开关）存放在 `dsh-better-sidebar` 设置命名空间。侧边栏自己的设置页负责渲染与持久化；浏览器通过插件自带围栏路由 `settings.get`/`settings.update` 访问该命名空间，而不是走白名单制的设置 RPC 域。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释两个半侧的构建方式；可观察行为已在[使用本包](#use-this-package)中说明。

### 双面孔设计

宿主半侧（[`src/index.ts`](src/index.ts) 中的 `apply`，inject `webServer`、`sessions`、`webRuntime` 与 `tools`）把所有路由挂载到 `/sidebar/*` 下，并套用与 `/api` 网关同源的信任围栏——Host 头回环判定或 web runtime 的 `trustedHosts`，逐请求重读。浏览器半侧是一份 `dsh.client` bundle，与所有客户端插件一样经 client-modules roster 提供；它的惰性功能 chunk 是独立脚本，从插件自己的 `/sidebar/bundle` 路由获取，并从 `globalThis.__dshChunks__` 注册表物化，因此 CodeMirror、xterm 与 mermaid 只在首次使用时加载。

### 会话作用域与工作区围栏

每个请求都携带 `sessionId`；权威工作目录先取会话头，再取调用方，再取持久化索引，最后才落到进程 cwd。文件读取、写入、上传与预览都经过锚定在该目录的 real-path 工作区守卫，因此侧边栏永远无法触及当前会话工作区之外的文件。UI 终端以 `${sessionId}:${tab}` 为键，受每会话配额约束；`park` 帧让仅被切走的会话终端保持存活。

### 终端与面向模型的工具

node-pty 惰性加载：原生依赖缺失或损坏时插件进入降级态——终端标签页展示从 `terminal.deps` 获取的修复命令、工具保持未注册——而不是让启动失败。一份 shell 解析同时供两个终端表面使用。`terminal_*` 工具（create、list、send、read、wait_for、resize、signal、close）作用于以 uuid 为键的 agent 专属 pty 注册表；`sidebar_open` 工具把打开请求排队，已连接的侧边栏视图将其应用为 editor、文件夹或 browser 标签页。两组工具只在各自的 Side card 开关打开时注册，一次设置提交即可注销它们并释放其创建的资源。

### Side chat

side 会话是插件自行创建的子会话，种子是父会话截至点击时刻的完整事件日志；进行中的父轮次用合成闭合事件冻结，一段边界 prompt 作为子会话的第一条用户消息，把此前的一切标记为继承的参考上下文。上下文注入消息携带 `dsh-better-sidebar` 插件标记，transcript 因此能从结构上识别它们。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 宿主半侧：`/sidebar/api`、上传、媒体、预览与 WebSocket 路由，pty 生命周期，工具门控 |
| [`src/config.ts`](src/config.ts) | `Config` schema、默认值与 `dsh-better-sidebar` 偏好命名空间 schema |
| [`src/pty-manager.ts`](src/pty-manager.ts) + [`src/agent-pty.ts`](src/agent-pty.ts) | UI 标签页终端管理器与 agent 专属终端注册表 |
| [`src/tools.ts`](src/tools.ts) + [`src/agent-opens.ts`](src/agent-opens.ts) | `terminal_*` 工具与 `sidebar_open` 投递注册表 |
| [`src/sidechat-core.ts`](src/sidechat-core.ts) + [`src/sidechat-routes.ts`](src/sidechat-routes.ts) | side chat 种子构建与路由 |
| [`src/bundle-route.ts`](src/bundle-route.ts) + [`src/client/chunk-loader.ts`](src/client/chunk-loader.ts) | 惰性 chunk 服务与物化 |
| [`src/client/index.tsx`](src/client/index.tsx) + [`src/client/service.ts`](src/client/service.ts) | 客户端 apply、面板挂载与 `ctx.betterSidebar` 注册表 |
| [`tsdown.config.ts`](tsdown.config.ts) | 宿主 ESM 构建、客户端 CJS factory bundle 与各 chunk bundle |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包约定不够用时阅读以下页面：挂载它的组合、提供其客户端 bundle 的 roster，以及本包所属的组。

- [桌面组合 patch](../../bundle/desktop-app/cordis.patch.yml)——让侧边栏成为桌面默认项的 insert 行。
- [客户端模块](../modules/README.zh.md)——`dsh.client` bundle 及其 external 如何组合与提供。
- [客户端组地图](../README.zh.md)——本包所属的浏览器半侧。
- [桌面打包](../../../scripts/desktop-package.ts)——携带本包的部署树完整性清单。

-----

<a id="model-experience"></a>
## 模型体验

### 默认关闭的终端与打开工具

#### 模型看到什么

默认什么都看不到：用户打开某个 Side card 开关之前不注册任何工具。启用 `agentTerminalTools` 后，会话获得作用于 agent 专属终端集合的 `terminal_create`、`terminal_list`、`terminal_send`、`terminal_read`、`terminal_wait_for`、`terminal_resize`、`terminal_signal` 与 `terminal_close`；`agentOpenTools` 增加 `sidebar_open`，把文件、文件夹或 URL 打开为侧边栏标签页。

#### Token 影响

开关关闭时为零。打开后，工具声明加入该会话每个请求的工具列表，`terminal_read` 与 `terminal_wait_for` 返回的 transcript 也像任何工具结果一样增加输出 token。

#### KV Cache 影响

开关保持打开期间，声明位于请求的稳定工具前缀中；切换开关会改变工具列表，并使该请求之后的 provider 缓存失效。side chat 子会话从父会话日志播种，此后维护各自的前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明侧边栏今天不做什么。它们是当前包约束，不是任务积压。

- **仅桌面默认**——浏览器 `dsh web` 组合不挂载侧边栏；启用或退出都靠 patch 行，而不是设置项。
- **终端依赖健康的 node-pty**——原生依赖缺失或损坏时插件降级：终端标签页展示修复命令、`terminal_*` 工具保持未注册，`sidebar_open` 仍可工作。
- **同时只有一个右面板**——当 `aionui-panel` 设置命名空间选择自身为右面板 provider 时，侧边栏不挂载。
- **仅有中英文案**——侧边栏自带 zh/en 双语词典；更多语言属于外部工作，upstream 的第三方词典未随收编带入。
- **I/O 限定在工作区内**——文件、上传与预览路由只解析当前会话工作区内部的路径；触及工作区外的内容不是受支持的能力。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

`dsh-better-sidebar` 设置命名空间与 side chat 注入标记有意保留历史名称：两者都持久存在于跨 profile 共享的用户设置与会话日志中，因此未随包名一并 rescope。收编决策及其放弃的内容记录在[收编 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-28-adopt-better-sidebar-first-party.zh.md)。

</details>
