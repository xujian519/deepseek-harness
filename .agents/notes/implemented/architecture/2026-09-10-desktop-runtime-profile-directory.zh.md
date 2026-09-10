# Agent Note: 让桌面运行时使用专属 profile 目录

Status: implemented

[English](2026-09-10-desktop-runtime-profile-directory.md) | 中文

## 问题

打包后的 Electron shell 拥有一个保留 profile：启动时读取其 `desktop-release.json`，把记录的发布版本与已安装的 `@deepseek-ai/dsh`、`@deepseek-ai/dsh-desktop-host` 版本同应用版本比较，不一致时把打包的 seed 安装到该目录。该 profile 曾经是 `<DSH_HOME>/profiles/desktop`，也就是 CLI 通过拒绝 `dsh --profile desktop` 为 Electron 应用保留的名字（[args.ts](../../../../apps/cli/src/args.ts)）。

`profiles/desktop` 里可能已经放着一个在桌面组合迁到私有 Desktop Host 之前创建的 dsh CLI desktop profile：手工安装的插件 bundle、一份 `cordis.patch.yml` overlay，以及缺失的 `desktop-release.json`。启动在任何归属检查之前就会在这个目录上失败：`applyRelease` 用 `releaseVersion()` 作为复用判定，而该调用会读缺失的 release 文件，于是 shell 报出 `ENOENT: ... profiles/desktop/desktop-release.json` 并在没有窗口的情况下退出。

用 seed 替换该目录并不是修复：它会丢弃已安装的插件清单与 patch overlay；插件恢复只重装"名称加精确版本"的配对，因此以 `github:` 或 `file:` spec 记录的插件无法恢复。

## 决策

Electron 运行时 profile 是 `<DSH_HOME>/profiles/desktop-runtime`。`resolveDesktopPaths` 是唯一命名它的地方；`<DSH_HOME>/desktop` 下的 staging、rollback、pending、lock 与私有 pnpm 路径均不变。应用从不读写 `<DSH_HOME>/profiles/desktop`，因此放在该保留路径上的 CLI profile 不会导致桌面启动失败。

## 考虑过的替代方案

**就地迁移被占用的目录。** 启动需要先区分自己的 profile 与外来目录，把外来目录移走，再安装 seed。否决：它会移动 shell 从未拥有的数据，无法恢复被丢弃的插件 spec，相比一个完全属于 shell 的目录没有任何收益。

**一次性给 CLI profile 改名，继续保留 `<DSH_HOME>/profiles/desktop`。** 一次目录改名无需改代码即可解除阻塞。否决：名字仍然共用，此后新建到该路径的 CLI profile 会复现同一失败，而且修复动作落在仓库之外。

**让 CLI 与 shell 共用一个 profile。** 否决：shell 要求 profile 的核心包集合与其打包 seed 一致，并以事务方式修改 manifest、lockfile 与 `node_modules`，这是 CLI 维护的 profile 无法满足的。

## 结果

桌面启动、插件修改与后端重启只触碰 `<DSH_HOME>/profiles/desktop-runtime`；它们既不读也不重写 CLI profile。本次改动后的首次启动会在新目录中执行完整的 seed 安装，而不是复用旧路径，因此它会在首个窗口出现前安装完整的核心包集合。

上游把 `profiles/desktop` 保留给 shell；本仓库让 shell 使用 `desktop-runtime`，因此在该路径上偏离上游。旧 CLI profile 中的插件不会被带过去，而 shell 的插件安装只接受 registry 包 spec，因此以 `github:` 或 `file:` spec 解析的插件必须从可发布来源重新安装。
