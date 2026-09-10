# Agent Note: 桌面组合不再挂载工作台侧边栏

Status: implemented

[English](2026-09-10-desktop-without-workspace-sidebar.md) | 中文

## 问题

桌面应用的会话标题栏上有三个面板控件：固定在视口右上角的两个按钮（底栏开关与右侧栏开关，同属 `@deepseek-ai/dsh-better-sidebar` 的 toggle cluster），以及更靠后、位于标题栏右侧角落的一个按钮（`@deepseek-ai/dsh-client-ui-sidebar-right` 的展开控件，仅在该右侧栏收起时渲染）。点击右侧栏开关会打开侧边栏的 `文件` 工作台——explorer、editor、terminal、git、side-chat、subagent 与 browser 标签页。

被报告的是 cluster 上的两个按钮：桌面产品不需要这份界面元素。它们无法单独隐藏——它们是进入所开面板的唯一入口，而面板自身的关闭控件只在面板已经打开时存在，因此隐藏开关的产品会留下一批再也打不开的面板。

## 决定

桌面组合（`apps/desktop-host` 加上在 `web-app` bundle 之上的 `desktop.cordis.patch.yml` overlay）不再插入 `@deepseek-ai/dsh-better-sidebar`；该行被有意从 patch 中略去，略去处带有一条注释，说明这是有意为之并给出本 note 的路径。

- 桌面应用不再挂载该侧边栏：没有底栏、没有右侧工作台面板、没有 `/sidebar/*` 宿主路由，也没有其宿主半侧注册的任何 agent 工具（`sidebar_open`，以及默认关闭的 `terminal_*` 工具集）。`交付物` 的产出文件 chip 回落到默认的 deliverables 行为，因为侧边栏的 `conversation.chat.turnTail` 拦截不再注册。
- `apps/desktop-host/package.json` 保持上游对 `@deepseek-ai/dsh-better-sidebar` 的声明不变：无端口接缝启动测试（`apps/desktop-host/tests/desktop-boot.spec.ts`）仍把它作为注册路由的 fixture 导入，而桌面包集合无论如何都会安装它——该集合分别以 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-desktop-host` 为根的生产依赖闭包之并集，且 `apps/cli` 的清单声明了它。已安装但不挂载，它不贡献任何界面。
- `ui-sidebar-right` 的展开控件保留。它属于另一个包，其右侧栏承载 docking 表层、文档预览与工作区文件标签页类型；报告指出的是侧边栏自己的那一对按钮，该控件属于另一项产品决定。
- 无端口 webServer 仍然是承重件。宿主的请求分发把 `/api/*` 直接交给 connection 处理器，其余路径交给 `PortlessWebServer` 的路由表，而 `@deepseek-ai/dsh-client-modules` 在那里注册它的 `/plugins` 前缀路由。
- 本仓库维护官方桌面应用（`apps/desktop` 基于 `apps/desktop-host`），其余部分跟随上游组合。被略去的那一行是它唯一有意为之的分歧。

## 备选方案

**在桌面应用中隐藏这两个开关按钮，并保持插件挂载。** 否决：开关消失后，底栏与右侧栏面板完全没有入口（它们自身的关闭控件只在面板打开时存在），于是这些面板只能通过在侧边栏设置页翻转"默认打开"偏好来进入。

**从 profile patch 禁用该行（`- id: better-sidebar` 配 `disabled: true`）。** 否决：桌面 profile 是 `$DSH_HOME/profiles/desktop` 下由安装持有的状态，发布激活会用 seed 替换它，因此写在那里的开关不是随产品发布的行为。组合 overlay 才是本仓库定义桌面应用承载内容的地方。

**从仓库中删除该包。** 否决：报告要求的是这些面板不在桌面应用中出现，而不是让该能力从代码库消失；组合成员关系的变化不影响该包、它的测试，以及它对 Web 侧的价值。

**在同一改动中一并移除 `ui-sidebar-right`。** 延后：报告中的箭头与其后续截图（点击右侧栏开关打开了 `文件` 工作台）指向侧边栏的那一对按钮，而展开控件属于一个其右侧栏承载文档预览的包。移除它属于另一项决定，需要各自的证据。

## 后果

- 左侧导航失去侧边栏客户端的条带处理：把外部的个人工作台入口移动到「新建会话」之后的提升逻辑、以及隐藏定时任务入口的逻辑，如今运行在实际挂载的侧边栏外壳（`@deepseek-ai/dsh-client-ui-sidebar`）中，因此桌面应用保留该位置。
- 不再有任何随仓库发布的组合在无端口面上注册流式路由：三处注册都属于该侧边栏。`PortlessWebServer.registerStream` 与网关那条被保留的升级路由继续存在，因为组合插件可能注册其中任一种。
- 本决定相对上游的分歧只有四处：被略去的行、该行处的注释、改名的启动测试，以及本 note。`apps/desktop-host/package.json` 与 `pnpm-lock.yaml` 与上游完全一致，因此上游同步只会遇到很小的冲突面，并必须重新决定这次略去。
- 让出的能力是桌面应用内的代码工作区：在会话内查看与编辑产出文件、运行命令、检查 git 状态，以及开启 side 对话与 subagent。重新引入它意味着再次在 `apps/desktop-host/config/desktop.cordis.patch.yml` 中插入该行。

## 测试

没有测试断言桌面组合的行集合：单元测试中无法完整启动该组合，因为 profile 的插件集合只会被提升进 pnpm 部署的项目，而 `packages/bundle/*` 是相互独立的工作区。`apps/desktop-host/tests/desktop-boot.spec.ts` 继续以该侧边栏为 fixture 插件覆盖无端口接缝，因此接缝的分发、流式与路由注销行为仍被钉住。随产品发布后的"缺席"本身只能在构建好的应用标题栏上观察。

## 相关

- [第一方引入 better-sidebar](2026-08-28-adopt-better-sidebar-first-party.zh.md)——该包为何是一方的，以及它如何进入桌面发行版。
- [桌面无端口 webServer 接缝](2026-09-09-desktop-portless-webserver-seam.zh.md)——曾用于服务侧边栏路由的接缝。
- [把个人工作台入口提升进侧边栏顶部条带](2026-09-04-promote-personal-workbench-entry.zh.md)——条带位置处理，现由实际挂载的侧边栏外壳持有。
