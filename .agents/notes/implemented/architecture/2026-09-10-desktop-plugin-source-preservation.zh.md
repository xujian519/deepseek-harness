# Agent Note: 在 profile 重建时保留桌面插件的来源

Status: implemented

[English](2026-09-10-desktop-plugin-source-preservation.md) | 中文

## 问题

桌面 profile 用一个 bundle 列表加每个插件一条 manifest 依赖来记录插件，而 `applyRelease` 过去用 `pnpm add <名称>@<版本> --offline` 恢复它们。因此只有 npm registry 恰好发布了该精确版本的插件才能在一次重建后存活。以 `github:` 定位符或本地 `file:` tarball 解析的插件不在 registry 上，它们的恢复会失败，并连带整个安装事务一起失败：shell 无法启动，没有窗口，只能靠 pnpm 诊断信息解释原因。

此外，记录下来的 `file:` spec 是相对 profile 的（`file:./vendor/plugin.tgz`），而恢复在全新的 staging 目录中运行，因此即使定位符本身可解析，也会指向错误的目录。

## 决策

`DesktopPluginRecord` 在名称与已安装版本之外携带 profile 记录的 `spec`；`inspectPlugin` 从 profile manifest 读取它。`applyRelease` 通过 `restorePlugins` 恢复插件，该方法按来源拆分：registry spec 以 `名称@版本 --save-exact --offline` 从打包的 store 安装，其他定位符按其记录的 spec 安装且不带 `--offline`，相对 `file:` 定位符在 staging 接收之前先按活跃 profile 解析。

## 考虑过的替代方案

**在插件无法恢复时降级。** 跳过失败的插件能让应用启动，但会静默丢掉用户安装的插件；桌面 profile 对损坏的组合选择大声失败。

**把非 registry 插件打进 seed。** seed 的核心包集合是一份经过签名校验的封闭清单，每个 profile 都要对校验它；而且每加一个插件都要重新构建并重新打包应用。

**只支持 registry 插件。** 这正是原代码的行为；它无法表达已部署 profile 中既有的 `github:` 与本地 tarball 插件。

## 结果

registry 插件仍然完全离线恢复。`github:` 插件现在在 profile 重建时需要网络，并且记录的定位符必须可达。

`file:` 定位符以绝对路径写入暂存 manifest，因此移动 profile 目录会使该记录失效，直到插件被重新安装。

未覆盖：插件补丁（`pnpm.patchedDependencies` 与 `patches/` 目录）以及自定义 workspace overrides 仍不会进入 staging，因此对插件应用的补丁会在下一次重建时丢失。
