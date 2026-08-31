# Agent Note：patent 预设的 group 行与插件行不得共用条目 id

Status: implemented

[English](2026-08-31-patent-preset-duplicate-group-id-loader-livelock.md) | 中文

## 问题

`patent` 预设的 self-evolve 段落给 `cordis:group` 行与其子插件行起了同一个 id（`self-evolve-benchmark`）。roster 挂载该预设时，`cordis-plugin-loader` 的 `create()` 按 id 在条目映射里解析子行，命中了 group 自己的条目并收养了它：新条目的父链指回自身。`_disabled()` 沿父链的 `while (entry) { ... entry = entry.parent.ctx.fiber.entry }` 循环没有环路保护，于是启动在 `cordis.init` 内以 100% CPU 永久自旋——HTTP 端口在监听却无法响应，桌面 app 后端每次启动必卡死。所有预设里其余 group 都以段落命名（`planning`、`patent`），这一行是唯一的 id 冲突。

卡死是在渲染端 `@deepseek-ai/dsh-api-remotes` 客户端产物修掉缺失 `zod` 模块表行之后才暴露的：BFF 损坏期间桌面渲染器根本挂载不了预设，冲突一直处于潜伏状态，直到 client-modules externals 漂移修复后才具备触发条件。

## 决策

group 行改名为 `self-evolve`；子行保留 `self-evolve-benchmark`，符合"group id 用段落名、子行 id 用插件挂载名"的既有约定。本次失败沉淀出的预设级规则：`cordis:group` 行的 id 必须与其 `config` 子树内所有条目 id 不同——冲突会让 loader 收养自己的祖先并活锁，而不是响亮报错。

## 已否决的替代方案

**给 loader 加守护。** 已随预设修复一并落地：vendored loader 现在在应用前校验组合树（id 在各嵌套层级唯一、不得与同 store 的容器条目 id 冲突）、拒绝把条目移进自己的子树，并在变更点保留创建期收养判定（vendor 登记第 22 条）。未来的冲突会响亮报错而非静默挂起。

## 后果

挂载 `patent` 预设时 self-evolve 段落不再产生自我收养环。桌面渲染器无法挂载预设期间该缺陷不可见，一旦能挂载即确定复现，因此这类预设组合问题表现为后端卡死而非预设报错；定位它需要用 SIGUSR1 打开运行中进程的 inspector，经 CDP 走查 fiber 父链。
