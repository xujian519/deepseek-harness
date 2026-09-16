# Agent Note：桌面 app 不再挂载工作区侧边栏

Status: implemented

[English](2026-09-15-desktop-unmounts-workspace-sidebar.md) | 中文

## Problem

一个桌面 app 报告出现了两个右侧栏。两个都真实存在，也都处于挂载状态：

- web-app bundle 自带的右侧栏：`@deepseek-ai/dsh-client-ui-sidebar-right` 及其文件树标签类型 `@deepseek-ai/dsh-client-ui-sidebar-files`，由 frame 的 `rightbar` 座位注册（`packages/bundle/web-app/cordis.patch.yml`）。
- 工作区侧边栏 `@deepseek-ai/dsh-better-sidebar`，自[重新挂载的决定](2026-09-10-desktop-workspace-sidebar-remount.zh.md)起由桌面叠加层插入（`apps/desktop-host/config/desktop.cordis.patch.yml`）。

两个面板都以 `position: absolute; right: 0` 锚定 frame 右边缘，谁也不为对方让出空间，谁也不知道对方存在。两个折叠面板都在屏幕外，读起来像一个产品；两个展开面板则互相覆盖，各带一套控件。报告的截图直接展示了文件树的重叠。

重叠在面板内容上最严重，因为两者都拥有一棵同一工作区的文件树。原生右侧栏是一个停靠面，其默认页就是文件树——`ui-sidebar-files` 是唯一注册的 guide 条目，所以 `defaultSeed` 解析到它，每次首次展开都落在这里。工作区侧边栏的 explorer 则通过自己的 `/sidebar/*` 路由绘制同一个会话工作区。

互斥闸门只覆盖了两对中的一对：当设置命名空间 `aionui-panel` 解析出 `rightPanel: 'aionui-panel'` 时 `better-sidebar` 拒绝挂载。发货的桌面 app 不带任何 `aionui` 插件，该命名空间因此缺席，`externalDisable()` 为 false，闸门从不触发。没有任何东西保护 `better-sidebar` 不受 `ui-sidebar-right` 影响，而后者在会话头部角落座位里是一个独立的入口。

## Decision

桌面叠加层把 `better-sidebar` 行以停用状态插入，该行的注释写明原因并链接到这里。桌面 app 只挂载 bundle 自带的右侧栏。

用 `disabled: true` 而不是删掉整行：patch 因此读起来是一个带名字的退出声明，解析不到的行会告警而不是静默消失，重新挂载只需改一个词。[归档的移除记录](../../archived/architecture/2026-09-10-desktop-without-workspace-sidebar.md)当初直接删掉了整行；点名保留是唯一的区别。

关掉该行后桌面 app 放弃的东西：代码工作区（explorer、editor、按会话隔离的终端、git 面板、side chat、subagent 预览、内嵌浏览器）、`/sidebar/*` 宿主路由、`sidebar_open` 工具与默认关闭的 `terminal_*` 集合，以及渲染 `交付物` 产出文件芯片的 `conversation.chat.turnTail` 拦截。原生右侧栏保留自己的文件标签页、文档预览，以及会话头部里的展开控件。

## Alternatives considered

- **改为停用 `ui-sidebar-right`、保留工作区。** 否决：文档预览属于原生右侧栏（`ui-sidebar-documentpreview` 通过 `dsh-resource://` 地址渲染文件），工作区侧边栏没有替代品，而产品自带的右侧栏也是浏览器 `dsh web` 部署会得到的那个面。工作区是两者中较小的损失。
- **照 `aionui-panel` 的做法，给 `better-sidebar` 加一个针对 `ui-sidebar-right` 的闸门。** 暂否决：需要一个新的设置命名空间与一个默认值，而「桌面 app 携带什么」在本仓库已经由桌面组合决定。两个不能共存、各自又能被不同所有者打开的面板，是组合问题而不是运行期问题。
- **两个都保持挂载，靠用户自己不把两个都展开。** 否决：展开是彼此独立的，原生右侧栏的首次展开默认就落在文件树，而报告的状态正是这个替代方案要求用户避开的那一种。
- **回滚重新挂载时做的传输修复。** 否决：终端的 `duplex: 'half'` 请求与 `sessionController.inspect` 的 cwd 链修复解决的是任何挂载组合都会遇到的潜在缺陷，浏览器 `dsh web` 同样在内。桌面不挂载并不使它们变错。

## Consequences

- 桌面 app 重新只画一个右侧栏，由会话头部的展开控件进入。
- 两项传输修复保留，且 `packages/client/better-sidebar` 在插入该行的 `dsh web` 部署中仍有一方消费者，因此该包与其 1725 个用例的测试套件仍有主体。
- 该行现在在两个发货组合里都是退出即用。想要工作区的部署，从桌面 patch 去掉 `disabled: true`，或在浏览器组合里插入该行。
- 重新挂载该行而不停用原生右侧栏的人仍会撞上重叠；该行处的注释点名了这一对，所以下一个编辑者在改动点就会遇到这条约束。
- 本决定造成的与 upstream 的分叉是这一行停用插入、它的注释，以及本 note。

## Testing

没有 recorded-session 快照钉住本次改动：keyless 矩阵里没有 profile 挂载工作区侧边栏，且改动属于组合成员资格而非模型或产品用户可见的输出。`npx vitest run apps/desktop-host` 保持引导夹具为绿——`desktop-boot.spec.ts` 直接 import 该插件作为其注册路由的夹具，而不是读 patch，因此不受该行 `disabled` 取值影响。重新挂载时做的传输修复在 `npx vitest run packages/client/better-sidebar` 中保留原有覆盖。

改动针对已安装应用经 CDP 验证：该行停用后，面板宿主 `[data-dsh-panel-host]` 不再携带任何面板与开关簇，frame 的 `rightbarCol` 里只有 bundle 自带的右侧栏。

## Related

- [在桌面重新挂载工作区侧边栏](2026-09-10-desktop-workspace-sidebar-remount.zh.md)——本改动所逆转的挂载，及其保留的传输修复。
- [不带工作区侧边栏的桌面组合](../../archived/architecture/2026-09-10-desktop-without-workspace-sidebar.md)——更早的移除，当时同样推迟了移除 `ui-sidebar-right`。
- [第一方收编 better-sidebar](2026-08-28-adopt-better-sidebar-first-party.zh.md)——该包为何是一方，以及它如何进入桌面发行版。
