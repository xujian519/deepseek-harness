# Agent Note: 桌面层 patch 修复浏览器交接与工作区选择

Status: implemented

[English](2026-08-25-desktop-surface-patch-handoff-and-picker.md) | 中文

## 问题

`packages/bundle/desktop-app/cordis.patch.yml` 叠加在 `dsh-web-app` 之上，并按 id 复述两条 web-runtime 行。Cordis patch 行命中已有 id 时会替换该行的 `config` 与可交换字段——但这两条复述背后藏着两个缺陷：

- `web-runtime` 复述丢掉了 `openBrowser`。web-app 层从 `--no-open` 喂入该值（`openBrowser: !!js ctx.webStartup.openBrowser`）；桌面复述漏掉了该键，于是 web-runtime schema 默认值（`z.boolean().default(true)`）生效，后端在 Electron 窗口已加载 URL 之后，又把该地址交给系统浏览器打开一次。
- `directory-picker` 复述试图靠覆盖 `name` 来替换 provider。但 `applyEntryPatches`（vendor/include/src/index.ts:116-119）把 patch 行的 `name` 当作身份校验：`name` 与目标行不同的行会收到 "name mismatch" 警告并整行跳过。Electron provider 从未挂载；桌面保留了 web-app 的 `directory-picker-auto` 选择器，它在桌面主机上（127.0.0.1、无 SSH、macOS）解析为 `native` 后端——而 native 选择由打包自带的 Node 子进程跑 `osascript`，这正是桌面架构否决的老路（原生对话框应当走 Electron Main 的 `dialog.showOpenDialog`）。"添加工作区"入口其实渲染了（auto 挂载了 native 客户端表面），但在打包 app 里选取文件夹失败。

## 决策

`desktop-app/cordis.patch.yml` 两处修改，外加 host RPC 一处：

- 在桌面 `web-runtime` 复述上钉死 `openBrowser: false`。Electron 窗口即 UI 表面；桌面不论调用参数如何都不得把 URL 交给系统浏览器（调用方的 `--no-open` 无法跨子进程边界可靠依赖）。因此手动 `dsh --profile desktop` 也不再自动打开浏览器——这正是 desktop 表面应有的语义。
- 禁用 auto 行并显式钉死 Electron 对偶，因为 provider 无法靠覆盖 `name` 换掉：

  ```yaml
  - id: directory-picker
    disabled: true
  - insert:
      - id: directory-picker-desktop
        name: '@deepseek-ai/dsh-desktop-directory-picker'
      - id: ui-directory-picker
        name: '@deepseek-ai/dsh-client-ui-directory-picker-native'
  ```

  Electron provider 用新 id 插入（被禁用的 auto 行保留其 id，复用会造成后续按 id 的 patch 与查找歧义）。客户端表面复用现有 `ui-directory-picker-native` 浏览器半面——它只驱动 `directoryPicker/pick` 动词，不按 capability kind 分支，故桌面复用它来占用两个 directory-flow 洞。
- Host 的 pick 动词改为按 capability 自身提供的动词而非 `native` 字面量判定：`if (!('pick' in capability))`。该缝是 merge-extensible，`electron` kind 只在桌面程序里声明合并，Host 类型检查器看不到它；存在性检查对仅浏览类与未知 kind 保守拒绝，同时同等服务 native 与 electron。Remote 迁移废除 `host.pickDirectory` 后，该动词现位于 `DirectoryPickerController.requireCapability`（`packages/api/workspace-controller/src/directory-picker.ts`）；该次迁移引入的回归及现在守住它的用例见 [2026-09-01](2026-09-01-directory-picker-verb-gating-regression.zh.md)。

## 备选方案

**保留带 `name` 的 patch 行来覆盖 provider。** 否决：`applyEntryPatches` 跳过任何 `name` 与目标不同的行——它是身份校验，不是改名。

**复用 `directory-picker` id 插入 Electron 行。** 否决：被禁用的 auto 行保留在列表里，同 id 插入会让后续按 id 的操作与查找出现歧义。

**新增 `ui-directory-picker-electron` 客户端表面。** 否决：native 浏览器表面只驱动 `host.pickDirectory`，不按 capability kind 分支，Electron 交互无需新增副本。

## 后果

桌面现在启动 Electron 目录选择器（构造的 Main 进程 `dialog.showOpenDialog`，经 bridge），而非失败的 osascript 路径。auto 选择器自身的 native 后端与客户端表面随之关闭，因此不会有重复的 `ctx.directoryPicker` 注册。`host.pickDirectory` 现以与 native 相同的形状服务注入的 `electron` capability。配套打包簿记随之更新：`scripts/desktop-package.ts` 的 `REQUIRED_BACKEND_PATHS` 及其 spec 镜像新增两个 patch 层 specifier（patch 层名字不会被静态 import，`findUnresolvableBackendImports` 无法证明它们），`tsconfig.base.json` 也新增了显式 `dsh-client-ui-directory-picker-native` 路径条目（通用 `@deepseek-ai/dsh-*` 通配符会把它错误解析到一个不存在的目录）。
