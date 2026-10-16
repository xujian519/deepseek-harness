# Agent Note: 上游 dsh-v0.2.1-alpha.4 同步

Status: implemented

[English](2026-10-16-upstream-dsh-v0.2.1-alpha.4-sync.md) | 中文

## 问题

fork 从上游的 `dsh-v0.2.1-alpha.3` tag 前进到 `dsh-v0.2.1-alpha.4`：89 个提交、831 个文件、+22,232/−2,044 行，约为上一个 release 的四分之一。merge base 落在 alpha.3 的 release merge 上，而那一次同步以 merge commit 落地，因此一次 `git merge` 即到达该 tag，没有任何上游提交被重新推导。`git merge-tree` 预测 38 个冲突文件；实际合并恰好产生 38 个——同一个包目录内的八处 add/add 撞车与三十处内容冲突。

这个 release 在同一个子系统的每一个维度上都与 fork 撞车。上游新增了 `packages/boot/plugin-market`、`packages/client/ui-plugin-market` 与 `packages/experimental/plugin-market-bundle`；fork 早已持有 `packages/host/plugin-market`、`packages/api/plugin-market-controller`、`packages/extensions/tool-plugin-market`，以及同一个 client 包路径下自己那套只读设置标签页。于是两套实现共用同一个文件系统路径、同一个包名、同一个 Cordis 服务名与同一个 Remote 命名空间。上游删除了两个文件。

## 决策

- **本同步分支对 release tag 做 merge-forward。** `sync/upstream-dsh-v0.2.1-alpha.4` 承载这次合并，PR 以 first parent 为 fork `master` 的 merge commit 落地。squash 会把上游提交移出 fork 的提交图，并把下次同步的 merge base 推回前一个 tag。
- **冲突按类别解决，绝不按行范围取一侧。** 在 alpha.2 同步中，按行范围取侧保留了只对某一侧成立的共享行。

  | 类别 | 数量 | 解法 |
  |---|---|---|
  | `.i18n.yaml` 附属文件 | 9 | 取 release 侧，再用 `verify-translation-pairing --write` 重录 |
  | 生成页与 catalog | 8 | 取 release 侧，再重跑全部生成器 |
  | `package.json` manifest | 3 | 取 fork 侧（release 的列表除排序与 release 独有的包外逐字相同） |
  | 撞车的 client 包 | 8 | 路径留给 release；fork 的内容迁到 `packages/client/ui-plugin-catalog` |
  | 源码与手写散文 | 6 | 逐文件：以 fork 的版本为底，把 release 的改动编进去 |
  | 生成器、测试、锁文件 | 5 | 并集，再重跑生成器 |

- **fork 的只读标签页迁到 `packages/client/ui-plugin-catalog`。** 上游的 `ui-plugin-market` 是可安装的 Discover 标签页（`DiscoverController`、`market-store.ts`、`remote.pluginManager.installBundle`）；fork 的是不含安装路径的只读发现标签页。给 fork 的包改名是一次性成本，此后每次 release 该路径零冲突；反之若让上游改名则永久冲突。改名覆盖包名、目录、`PluginMarketTab*` → `PluginCatalogTab*`、locale 命名空间 `settings.pluginMarket` → `settings.pluginCatalog`、slot id `market` → `catalog`、可见标签，以及十一处引用位点（`tsconfig.base.json`、`tsconfig.client.json`、web-app bundle 的 manifest 与 patch 行、两个门禁脚本、组 README、ui-theme 的 CSS 圆角例外、fork 的 Agent Note，以及由生成器重写的生成页）。
- **服务与 Remote 命名空间改名，而不共用。** 计划把这次撞车记录为「被默认关闭的实验 bundle 掩盖的运行时互斥」。这个判断没能通过第一次 `pnpm run typecheck`：两个包都 `declare module '@deepseek-ai/cordis'`，把 `pluginMarket: PluginMarket` 合并进 `Context`，而两个 `PluginMarket` 类是不同的类型，于是十二条错误落在 `packages/boot/plugin-market/tests`。Remote 层以同样的方式撞车——fork 的 controller 与上游的 `dsh-plugin-market/remote` 都向 `TypertRemoteNamespaceMap` 注入 `pluginMarket` 成员，fork 的标签页与上游的 Discover 标签页也都调用 `ctx.remote.pluginMarket`。fork 的 Host 服务、它的 Remote 命名空间及其全部引用迁到 `pluginCatalog`；上游保留 `pluginMarket`，两套实现自此并行而互不触碰。`pluginMarketController` 保持原名——它是 fork 自己的 Remote controller 服务，不与任何东西撞车。
- **release 对 workflow 的加固落在 fork 活跃使用的工作流上。** 上游把每个 `workflow_dispatch` 输入描述本地化为中文，并收紧了 macOS 与 Windows 的打包来源校验：所选的 preset 必须是 `test` 或 `production`；`production` 运行只接受 `master` 或 `dsh-v*` tag；tag 运行必须已 checkout 到该 tag；分支运行必须指名真实分支，而不是 SHA 或 PR ref。两个文件里 `DSH_PACKAGING_PRESET` 都已绑定到 `inputs.preset`。fork 自己的打包参数位于 `apps/desktop` 而非这些 workflow，因此 fork 依赖的任何东西都没有被覆盖，也没有任何 fork 侧内容需要保留。
- **`webworker-packer` 的选项收缩被吸收，而不是恢复。** 上游重写了 `PackOptions` 并删掉了 fork 的测试传给 `packVfsImage` 的 `config` 字符串；合并保留了上游的 `src` 与 fork 的 `tests`，于是整棵树处处可编译，只有 `image-loadable.spec.ts` 里那两条 fork 用例例外。那两条用例只断言 vendored 的 `@deepseek-ai/nuo-patent` 与 fork 的 `dsh-patent-knowledge` 闭包进入了 image（`result.missing`、`result.files`），而上游的 `roster: [<package>]` 直接表达了同一件事；`config` 的写入从未被断言。把合并倒退回旧接口会让每次 release 重新推导这个冲突。
- **三项「合并干净但会坏树」的检查在信任合并之前都已执行。**（1）`verify-no-top-level-await` 的 spec 固定了真实树的排除列表；fork 的 `packages/patent/patent-knowledge/src/bin.ts` 是第三个 shebang 入口，已按路径序加入。（2)`ui-conversation` 里 release 删除了 `claim-decor.ts`；该文件与所有 `ClaimDecoration` 引用都已消失，而 release 的 `command-chip-node.tsx`、`command-chip-selection.ts` 与 `CommandChip.tsx` 均已就位。（3）`run-gates.ts` 在 `sharedHygieneGates()` 内获得了 release 的 `no-top-level-await` 行；hygiene 的 gate-id spec 现已列出它。
- **改名扰动的门禁被修复而非豁免。** `gen-cordis-catalog` 把每个被渲染的服务映射到文档页，并同时拒绝「可渲染却无映射」与「陈旧的 walk 豁免」；fork 的 `pluginCatalog` 保留了其前身 `pluginMarket` 所持有的豁免，因为该 seam 的契约位于 `packages/host/plugin-market/README.md`，而不是某个 subsystems 页。`@deepseek-ai/dsh-value` 在 `SAFE_HOST_DEPENDENCY_EXPORTS` 中获得 `isAbortError` 与 `toError`——release 的 `packages/experimental/inspector` 导入了这两个，且二者都是纯函数。`apps/cli` 声明了 `@deepseek-ai/dsh-experimental-plugin-market-bundle`，这是 `app-boot` 的 `OPTIONAL_BUNDLES` 对启动器提出的要求。`packages/experimental/client-ui-agent-team` 在 `devDependencies` 中声明了 `@deepseek-ai/dsh-util-values`，这是本次运行的依赖门禁暴露出的、fork 自身长期存在的遗漏。`no-unknown-casts` 基线把 `tool-plugin-market/src/index.ts` 上漂移的那一条指纹换成了它的替代值，1,802 条断言的总数保持不变。
- **机械对齐。** 根 manifest、47 份 fork 独有 manifest（含新的 catalog 包）与 `SIDEBAR_SERVICE_VERSION` 一并前进到 `0.2.1-alpha.4`。九份 `snapshots/acp/*/stdout.expected.jsonl` 重新钉住 `agentInfo.version`，这是 ACP 回放报出的唯一漂移。十七份翻译配对重录。全部生成器重跑，`docs/TECH_DEBT.md` 的计数更新为本树自身的实测值（186 个长函数、75 个大文件、1,167 行 `v8 ignore`）。

## 后果

fork 带着上游 v0.2.1-alpha.4 的基线发布，专利、self-evolve、桌面、better-sidebar 与 document 各面保持完整，并且两套插件目录实现以各自的名字并存。

这个 release 补上的教训是：fork 的子系统与上游同名，并不是一件可以记录在案、留待日后处理的运行时属性。计划预测了默认关闭的 bundle 内加载期的互斥，就其所及而言是对的；真正让这件事变得可行动的是跑编译器——同一个名字在合并后的 `Context` 与 `TypertRemoteNamespaceMap` 接口里撞车，而这是无法推迟的。推迟改名会让此后每个 release 都付出同样这十二条错误，外加一次更大、触及 Remote wire 的改名。

`webworker-packer` 这一例是上一个同步的 PTC 教训的新形态：合并保留了上游重写后的 `src` 与 fork 的 `tests`，于是能力缺口以两条类型错误现身，而不是一次静默的功能丢失。让它可见的是对某个包的测试做类型检查；合并的退出状态里没有任何东西能把这种情况与一次干净合并区分开。

每次 release 仍需关注的三处分歧不变：fork 的 preset 是上游组合改动的落点；archived note 的封条必须与上游为其退役的笔记一致；fork 的笔记必须跟随上游的 workflow 路径进入 `workflows-disabled/`。

## 备选方案

- **保留上游的 `pluginMarket` 名，把 fork 的服务让给上游的实现。** 否决：fork 的标签页、工具与 Remote controller 投射的是另一套 wire（目录源、`CatalogPage`、安装预检），不同于上游的索引格式（`MarketQuery`、`MarketListingEntry`），且 fork 的 provider 提供上游没有的内置离线目录。采用上游的将是替换一项已发布的 fork 能力，而不是同步一个 release。
- **只在 Host 层给 fork 的服务改名，Remote 命名空间继续叫 `pluginMarket`。** 否决：Remote 层的撞车是真实的——两个包注入同一个 `TypertRemoteNamespaceMap` 成员——因此这一步走得更小，随后仍会在 wire 上做同一次改名。
- **删除上游的 `plugin-market` 各包以保住 fork 的命名。** 否决：它丢弃了一项 fork 没有替代品的上游特性，而且下次同步会把每个文件、每个冲突重新引入。
- **在上游的 `roster` 之外恢复 `PackOptions.config`。** 否决：声明 image 包集合的两条路径会相互漂移，而 fork 自己的测试从未断言过 config 的写入。

## 测试

`pnpm run typecheck` 五个门禁全过——Host Typert、host 与 client 编译器，以及两个聚合——这正是首先暴露服务撞车的检查。

`pnpm run lint` 退出 0，只带 `packages/experimental/client-ui-cot-translation/src/index.ts` 中那条既有的 unused-disable 警告。`pnpm run hygiene` 报 22/22 门禁通过，含 release 的 `no-top-level-await`。`pnpm run doc-sync` 报 50/51，`pnpm run verify-module-graph` 为最新。唯一的 doc-sync 失败是 `verify-repository-references`，与上一次同步相同：`python/sdk/uv.lock` 与 alpha.3 同步笔记的两行记录了十进制串 `6344383`，它恰好是本 full-history clone 能解析到的某个对象的前缀；该门禁自身的契约写明，浅历史中不存在的对象无法匹配，因此 CI 的 shallow clone 报不出这几行。

`pnpm run test:snapshot` 在 session、sdk、acp 与 web 各 lane 回放 223 个无密钥用例，跳过 2 个，无失败。

本次同步触及的每个包的单测均通过：`host/plugin-market`、`api/plugin-market-controller`、`extensions/tool-plugin-market`、`client/ui-plugin-catalog`、`experimental/webworker-packer`、`api/remotes`、`client/modules`、`core/tools`、`client/ui-theme` 与 `subprocess/subprocess-local`——第一组 17 个文件 177 个用例，第二组 50 个文件 1,134 个。`subprocess/subprocess-local/tests/spawn-runner.spec.ts` 中那一处失败是已知的本机产物，源于此 shell 导出了 `NoDefaultCurrentDirectoryInExePath`；同一文件在 `env -u NoDefaultCurrentDirectoryInExePath` 下 35/35 通过。
