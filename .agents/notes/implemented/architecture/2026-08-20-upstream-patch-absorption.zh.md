# Agent Note：吸收四个上游社区补丁

Status: implemented

[English](2026-08-20-upstream-patch-absorption.md) | 中文

## 问题

社区桌面项目（deepseek-harness-desktop）携带五个针对上游包的补丁。对照 rc.8 源码级核实后，其中四个修复的是上游仍然存在的缺陷；第五个（workspace drop-target 属性）已被 rc.8 自身的应用内拖放取代，而 electron-builder 公证补丁属第三方工具链，不属于上游。

## 决策

将四个活跃补丁吸收进上游，各自附带所属测试：

- **`dsh-app-boot` 的 `parsePatchList`** 将空文件或纯注释的 patch 文件视为零条 patch，不再 fail loud。bundle 无条件携带 `cordis.patch.yml`；某个发布版可能没有要 patch 的内容。非数组且非 null 的内容仍会抛错。
- **`dsh-client-ui-directory-picker-browse`** 增加宿主无关的 `pickNativeDirectory`/`validateDirectory` props 与原生选择按钮，接桌面 preload 的 `window.__DSH_DESKTOP_PICK_DIRECTORY__`/`__DSH_DESKTOP_VALIDATE_DIRECTORY__`。Windows 限定的桥本身留在桌面壳；选择器包只定义缝隙。
- **`dsh-llm-deepseek` 流式翻译** 将空 wire tool-call id/name 视为缺省，delta 不再输出空 name 字段。
- **`dsh-sandbox-windows-acl`** 在两条 spawn 路径上隐藏受限子进程的 console 窗口（`STARTF_USESHOWWINDOW | SW_HIDE`），并带结构体偏移的 ABI 回环测试。

## 影响

空 patch 文件是合法的"零 patch"状态；目录浏览器可在宿主提供时调用系统选择器；工具调用 delta 不再携带空身份字段；Windows sandbox 不再闪现 console。drop-target 属性与 electron-builder 补丁记为超出范围，而非移植。

## 备选方案

- 移植 drop-target 属性：否决——rc.8 的 `WorkspaceBrowser` 已有功能完整的拖放处理；该属性只是社区皮肤钩子。
- 把 Windows preload 桥收进选择器包：否决——props 保持宿主无关；preload 契约属于桌面壳。
