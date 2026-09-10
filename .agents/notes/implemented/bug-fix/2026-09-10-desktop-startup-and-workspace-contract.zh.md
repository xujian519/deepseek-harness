# Agent Note: 报告停滞的桌面启动并保持 workspace 契约精确

Status: implemented

[English](2026-09-10-desktop-startup-and-workspace-contract.md) | 中文

## 问题

有两种失败模式会让桌面安装不可用，却不说原因。

**永不结束的启动是沉默的。** 在一个实例被强杀后的一次启动产生了这样的进程：没有窗口、没有后端子进程、stderr 为空、主线程空闲——与"启动很慢"无法区分，事后也无法从机器上诊断。每个启动阶段（桥接、打包 profile 事务、后端）都在没有期限的情况下被等待，因此任何永不结束的阶段都会让 shell 永久停在这个状态。

**pnpm 会改写 profile 的 workspace 文件，而 profile 契约对它做逐字符比较。** pnpm 11 把供应链的发布年龄豁免记录在项目自己的 `pnpm-workspace.yaml` 里；安装 `@dely0/dsh-personal-workbench@1.12.1` 与 `dsh-checkpoint-rewind@0.6.9` 时追加了一个 `minimumReleaseAgeExclude` 块。`projectManifest` 把该文件与它自己生成的精确文本比较，于是这次写入注解的事务在紧接着的清单读取中失败——已记录的桌面单测复现了这一点——而被早先某次 GUI 插件安装写入注解的 profile 会拒绝启动。

## 决策

`withStartupDeadline` 把每个启动阶段限制在 180 秒，并在失败信息中点名该阶段；该信息会进入既有的启动失败对话框，而不是留下一个空闲进程。

在单次 pnpm 调用中，`runPnpm` 传入 `--config.minimumReleaseAge=0` 让 pnpm 不再记录该豁免，并在每次成功调用后把 `pnpm-workspace.yaml` 重写为契约文本，因此任何 pnpm 版本留下的注解都无法在一次事务后存活。

## 考虑过的替代方案

**增加日志并把卡住当作环境问题。** 日志不会把卡住的启动变成可报告的状态；操作者仍然只看到窗口缺失。

**放宽 workspace 比较以忽略未知键。** 正是这个比较保证每个核心包都从打包的本地 tarball 解析；接受额外键将不再能发现改变解析结果的手工编辑与工具写入。

**只依赖 `--config.minimumReleaseAge=0`。** 它取决于当前打包的 pnpm 的行为；重写才是与版本无关的保证。

## 结果

真正缓慢的启动——在冷缓存上对打包 seed 与 profile 本地 tarball 做哈希，然后引导每个已安装插件——必须在期限内完成，否则报告一个具名失败。停滞的阶段现在代价是一个对话框与一条诊断，而不是一个无法解释的空闲进程。

每次事务都会重写 workspace 文件，因此其中任何其它 pnpm 注解都会被丢弃。这是有意的：拥有该文件的是 profile 契约，而不是 pnpm 的记账。

所观察到的停滞的根因没有被复现；启动期限改变的是它的表现——从沉默变为具名失败——而不是修复了一个已知缺陷。
