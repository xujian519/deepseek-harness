# Agent Note: Fork CI 运行 hygiene 与 coverage 两个聚合

Status: implemented

[English](2026-09-19-fork-ci-hygiene-and-coverage-gates.md) | 中文

## 问题

fork 的 `.github/workflows/ci-fork.yml` 原先运行 lint、typecheck、duplication、单元套件、文档检查与 keyless Python 套件。因此有两个仓库门禁在 fork 里没有 CI 信号。

第一个是覆盖率门禁。`check:ci:coverage` 按 per-file 100% 阈值度量 `packages/*/*/src` 下每个文件，而它在 fork 中只被手工运行，手工运行之间的覆盖率状态无人守护。

第二个是 `hygiene` 聚合。`pnpm run hygiene` 是本地开发者聚合：它是唯一在没有自身 build 的情况下携带完整 constraints / publint / node-next-types / built-package-invariants 集合的聚合，且没有任何工作流调用它。上游把这些叶子门禁放在自带 build 的聚合里运行（`check-all`、`ci-artifacts`、`ci-consumers`），其中每个都把 `build` 声明为依赖。于是与 constraints 表脱节的清单 `files` 字段在无人察觉的情况下进入 `master`：`apps/desktop-host/package.json` 列出了 `config/desktop.cordis.patch.yml`——其构建产物 `lib/index.js` 在运行时从同级目录解析的那个 overlay——而 `scripts/check-workspace-constraints.ts` 中的 `appPackageFiles` 仍只声明了 `lib/index.js`。

## 决策

`ci-fork.yml` 新增 `node-hygiene` 与 `node-coverage` 两个 job，constraints 声明补上缺失条目。

### `node-hygiene` 自带 build

该 job 依次执行安装、`pnpm run build`、`pnpm run hygiene`，上限 45 分钟，在每次推送到 `master` 和每个 pull request 上触发。`pnpm run build` 已经会构建原生系统插件（`scripts/build.ts`），所以不需要第二个 build 步骤。

这一步 build 不是可选项。hygiene 聚合的 publint、built-package-invariants 与 node-next-types 门禁读取已产出的 `lib/` 产物；在未构建的树上它们检视的是空的发布视图，不检查任何东西就通过。该 job 自带 build 也保住了单元 lane 的前置条件：消费 `lib/` 的套件（`webworker-packer` 的 image-loadable、客户端 `ui-trajectory` 的 client-bundle）在未构建的检出上自跳过，因此在 `node-checks` 内构建会让它们在与编写时不同的前置条件下启动。

### `node-coverage` 只在 PR 上运行且不做 build

该 job 依次执行安装、准备 bubblewrap，然后在 `DSH_COVERAGE_PARTITIONS=4`、`DSH_COVERAGE_MAX_WORKERS=2`、`DSH_COVERAGE_TEST_TIMEOUT_MS=90000`、`DSH_GATE_FAIL_FAST=1` 下运行 `pnpm run check:ci:coverage`，上限 180 分钟，且限定 `pull_request`。两个预算各司其职：配置了分区后，协调器并行运行四个单 worker 的 Vitest 进程，完全忽略 `DSH_COVERAGE_MAX_WORKERS` 中属于插桩那部分，因此该预算只决定豁免重型门禁的 worker 数——这里 `2` 给出一个 worker，而上游的 `6` 给出两个——于是这条 lane 在四个核上跑五个 Vitest 进程。保留四个分区是因为上游就用四个，也因为本 lane 的失败源于夹具预算而非那第五个进程。每测试预算与单元 lane 采用同一数值、同一理由。没有 build 步骤：workspace 导入经 tsconfig paths 映射解析到 `src`，且该聚合会在插桩运行之前构建自己需要的原生系统插件。若测试改走 Loader 自己的入口模块导入去取 workspace 包，就不在该映射的作用范围内——下文这条 lane 的失败正是如此。

`PRIMARY_NODE_VERSION` 固定值在这里的意义不止一致性。在 Node 22 下该门禁在开始度量之前就是红的：`packages/boot/app-boot/src/profile-resolution/resolver.ts` 中的 `ModuleLoaderV2` 分支在 Node 24.12 引入 v2 module-job API 之前不会执行（[vendor 同步记录](../../../../vendor/README.md)），因此这些行始终未覆盖。

### constraints 声明

`appPackageFiles['@deepseek-ai/dsh-desktop-host']` 现在在 `lib/index.js` 之外列出 `config/desktop.cordis.patch.yml`。清单是对的、声明是陈旧的；桌面宿主在运行时从自身目录解析该 overlay，所以该文件属于这个包的发布载荷。

## 备选方案

**把两个聚合都放进 `node-checks`。** 否决：覆盖率聚合远长于该 lane 的其余部分，会把快速信号排在它后面；而在那里加入 build 会改变单元套件运行所依据的前提。

**在不做 build 的情况下运行 hygiene 聚合。** 否决：它有三个门禁会去检视空的发布视图，那是一个什么也没检查的绿。

**给 coverage job 加 build。** 否决：该聚合不读取任何 `lib/`，锚定套件在未构建的检出上自跳过，上游的覆盖率 lane 也不做 build。用 build 来满足某个测试对构建产物的需求，还会让整条 lane 的套件都丢掉源码平面：一个解析到 `lib/` 的 workspace 导入，度量的是已产出代码而不是 `src`。

**不把覆盖率门禁接进 CI。** 否决：这样 fork 的覆盖率状态就取决于谁记得手工运行它，[上游同步后债务清扫](../bug-fix/2026-08-28-post-sync-debt-sweep.zh.md)所登记的那些包正是这样一直待在度量之外的。

**覆盖率也在 `master` 推送时运行。** 否决：pull request 已经拦住自己的合并，上游出于同一理由把覆盖率 job 限定在 `pull_request`。

## 影响

- 类似 `apps/desktop-host` 的 constraints 漂移，会在引入它的那个 pull request 上让 `node-hygiene` 变红。
- 被度量的 `packages/*/*/src` 集合内的覆盖率回归会让 `node-coverage` 变红。登记在 `vitest.config.ts` 中的 fork 本地族（`packages/patent/*`、`packages/web/synapse`、`packages/self-evolve/*`、`packages/client/ui-agent-preset` 以及文档工作台）仍留在度量之外。
- 该门禁的首次运行就找到了 fork 唯一一个低于阈值的文件 `packages/client/better-sidebar/src/pty-manager.ts`——这是上游任何 lane 都看不到的缺口，因为该包是 fork 独有的。
- fork CI 的总时长增加一个覆盖率聚合的时间，它是工作流中最长的 job：首次运行在 4 核 runner 上以最初的"四进程"预算实测 20 分钟，且只在 pull request 上运行。
- 这条 lane 的四次运行失败都发生在夹具上，从未发生在阈值上。第 1 次运行止步于 bubblewrap 下载（其后已重新固定版本）。第 2—4 次运行的阈值缺口均为 0，且触发了同样三个用例，每个都是撞预算而不是断言失败：`packages/experimental/ptc-runtime-python/tests/runtime.spec.ts` 中两个 O(depth) 内存用例撞上它们各自的 60 秒墙钟上限（实测 60.1 秒与 43.6 秒）；`scripts/gen-client-catalog.spec.ts` 的工作区扫描撞上其 30 秒用例预算（实测 31.5 秒）；以及 `packages/preset/agent-presets/tests/mount.spec.ts` 的过期配置断言。
- 挂载那个用例根本不是竞态。它的夹具行写的名字是随包发布的 `@deepseek-ai/dsh-persona`，Loader 会经 Node 解析到该包构建出的 `lib/`；在没有该构建产物的树上这一行永远导入不成功，于是挂载报出 `persona (@deepseek-ai/dsh-persona): never started`，而不是该用例要钉住的 schema 拒绝。单元 lane 的 `lib/` 是 `typecheck` 调用 `build:lib:host` 的副产物；覆盖率 lane 什么都不构建。该夹具的行现在改用一个不导入任何东西的本地插件，两个 lane 都会用同一行 schema 诊断报出拒绝。
- 两个受预算约束的用例现在按这条 runner 的尺度来定，而不是按空闲机器的尺度。ptc-runtime 的两个用例采用 120 秒上限与 180 秒用例预算——是本 lane 最差实测值的两倍，且仍低于用例预算，因此超时运行时仍能报出内存判定；工作区扫描则加入覆盖率豁免名单，那里的 `scripts/` 文件从不被插桩，工作站上实测 3.7 倍的插桩开销（1.5 秒增至 5.4 秒）不再生效。
- 有两项定标事实属于这条 lane，而不属于任何测试。行或夹具模块必须不导入任何东西，因为 Loader 经 Node 的 ESM 解析器解析入口模块，而这里没有任何 lane 做 build。以及，按空闲机器定标的夹具预算在这条 lane 上只剩约五分之一的余量：同一个 ptc-runtime 用例在工作站插桩下耗时 12.7 秒，在这台 runner 上耗时 60 秒。
- 两个新 job 重复支付 `node-checks` 已经支付过的安装步骤。GitHub Actions 的 job 之间不共享工作区，这是保持单元 lane 前置条件不变的代价。

## 验证

- 在本次改动的树上执行 `pnpm run build && pnpm run hygiene`：`run-gates: 16 passed, 0 failed, 0 skipped`。同一条命令在声明改动之前会因 `constraints` 变红。
- 挂载用例在那条 lane 上的失败可在本机复现：把 `packages/preset/persona/lib` 移开后，`packages/preset/agent-presets/tests/mount.spec.ts` 报出 `persona (@deepseek-ai/dsh-persona): never started (…/stale-persona/agent.cordis.yml)`——与覆盖率 lane 完全同一字符串；把该目录放回后该文件 54 项全过。替换后的夹具在两种状态下同样是 54 项全过，这才解除了该用例对"哪条 lane 会做 build"的依赖。
- 名单改动的两侧都已验证：`DSH_COVERAGE_EXEMPT_HEAVY=1 pnpm exec vitest list --filesOnly` 不再列出这次工作区扫描；而用豁免门禁自己的过滤器集合运行（`vitest run scripts/gen-client-catalog.spec.ts scripts/install-lefthook.spec.ts scripts/oxlint-contract.spec.ts scripts/change-scope.spec.ts scripts/translation-pairing-merge.spec.ts`）报出 5 个文件、102 个测试通过，其中扫描耗时 1.6 秒。
- 在 lane 自己的预算下运行 `pnpm run check:ci:coverage`（`DSH_COVERAGE_PARTITIONS=4 DSH_COVERAGE_MAX_WORKERS=2 DSH_COVERAGE_TEST_TIMEOUT_MS=90000`，未开 fail-fast 以便两个门禁都报结果）：2 个门禁通过、1 个失败，两处失败都属于本机状态而非本次改动。插桩门禁唯一的阈值缺口是 `packages/boot/app-boot/src/profile-resolution/resolver.ts`——即本 job 固定 Node 24 所针对的那个 Node 22 红。`packages/client/ui-document-studio/tests/client-bundle.client.spec.ts` 有四项失败，原因是本机构建出的 studio bundle 早于 studio 自身的改动；该套件在 CI 的未构建检出上会自跳过。本次改动涉及的用例在 lane 内全部通过：挂载文件 54/54（501 毫秒）；ptc-runtime 文件 111 秒跑完，其中两个 O(depth) 用例分别 14.3 秒与 7.9 秒；豁免门禁在扩大后的名单上以 122.7 秒通过。
- 在 Node 24 下于 macOS 完整运行 `DSH_COVERAGE_PARTITIONS=4 pnpm run test:coverage:partitioned`，每个被度量文件均为 100%（含 `packages/client/better-sidebar/src/pty-manager.ts`），唯一失败的测试是 `packages/util/http-proxy/tests/install.spec.ts` 的 "connects directly when the bypass list covers the target"（5000 ms 超时；它在该主机上单独运行同样失败，且不属于本 fork 改动的任何包）。这个本地结果**不能**证明该门禁在 Linux 上的行为：`pty-manager.ts` 只在 node-pty 那个仅 macOS 存在的 spawn-helper 产物存在时才恢复其可执行位，因此 Linux runner 报出 `pty-manager.ts:38` 的两处未覆盖位置，并使该文件的语句与分支阈值不达标。`packages/client/better-sidebar/tests/cov-host-platform-edges.spec.ts` 现在在该文件既有的 `node:fs` mock 下注入 `linux` 来钉住这条路径，于是该分支不再依赖宿主机磁盘布局。`better-sidebar` 是 fork 独有包（上游没有它），这正是此前没有任何 lane 度量过该文件的原因。
- 工作流可解析，`scripts/ci-workflow.spec.ts`（43 个测试）通过；该 spec 读取的是归档的上游工作流，因此只是间接约束这两个新 job。
- 这两个 job 本身的唯一验证是首次 CI 运行；开发者机器上没有任何东西会执行 GitHub Actions job。

## 相关

- [CI Node 编译缓存](2026-08-28-ci-node-compile-cache-data-disk.zh.md)——上游 lane 携带而这两个 job 没有的 lane 级环境注入。
- [上游同步后债务清扫](../bug-fix/2026-08-28-post-sync-debt-sweep.zh.md)——本门禁现在所针对的覆盖率 exclude 登记。
