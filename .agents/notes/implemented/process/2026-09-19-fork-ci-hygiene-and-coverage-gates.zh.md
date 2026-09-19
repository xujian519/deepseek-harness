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

该 job 依次执行安装、准备 bubblewrap，然后在 `DSH_COVERAGE_PARTITIONS=4`、`DSH_COVERAGE_MAX_WORKERS=4`、`DSH_COVERAGE_TEST_TIMEOUT_MS=90000`、`DSH_GATE_FAIL_FAST=1` 下运行 `pnpm run check:ci:coverage`，上限 180 分钟，且限定 `pull_request`。worker 预算拆成三个插桩 worker 与一个豁免重型 worker，匹配 fork 的 4 核 runner。每测试预算与单元 lane 采用同一数值、同一理由。没有 build 步骤：workspace 导入经 tsconfig paths 映射解析到 `src`，且该聚合会在插桩运行之前构建自己需要的原生系统插件。

`PRIMARY_NODE_VERSION` 固定值在这里的意义不止一致性。在 Node 22 下该门禁在开始度量之前就是红的：`packages/boot/app-boot/src/profile-resolution/resolver.ts` 中的 `ModuleLoaderV2` 分支在 Node 24.12 引入 v2 module-job API 之前不会执行（[vendor 同步记录](../../../../vendor/README.md)），因此这些行始终未覆盖。

### constraints 声明

`appPackageFiles['@deepseek-ai/dsh-desktop-host']` 现在在 `lib/index.js` 之外列出 `config/desktop.cordis.patch.yml`。清单是对的、声明是陈旧的；桌面宿主在运行时从自身目录解析该 overlay，所以该文件属于这个包的发布载荷。

## 备选方案

**把两个聚合都放进 `node-checks`。** 否决：覆盖率聚合远长于该 lane 的其余部分，会把快速信号排在它后面；而在那里加入 build 会改变单元套件运行所依据的前提。

**在不做 build 的情况下运行 hygiene 聚合。** 否决：它有三个门禁会去检视空的发布视图，那是一个什么也没检查的绿。

**给 coverage job 加 build。** 否决：该聚合中没有任何东西读取 `lib/`，锚定套件在未构建的检出上自跳过，上游的覆盖率 lane 出于同一理由也不做 build。

**不把覆盖率门禁接进 CI。** 否决：这样 fork 的覆盖率状态就取决于谁记得手工运行它，[上游同步后债务清扫](../bug-fix/2026-08-28-post-sync-debt-sweep.zh.md)所登记的那些包正是这样一直待在度量之外的。

**覆盖率也在 `master` 推送时运行。** 否决：pull request 已经拦住自己的合并，上游出于同一理由把覆盖率 job 限定在 `pull_request`。

## 影响

- 类似 `apps/desktop-host` 的 constraints 漂移，会在引入它的那个 pull request 上让 `node-hygiene` 变红。
- 被度量的 `packages/*/*/src` 集合内的覆盖率回归会让 `node-coverage` 变红。登记在 `vitest.config.ts` 中的 fork 本地族（`packages/patent/*`、`packages/web/synapse`、`packages/self-evolve/*`、`packages/client/ui-agent-preset` 以及文档工作台）仍留在度量之外。
- 该门禁的首次运行就找到了 fork 唯一一个低于阈值的文件 `packages/client/better-sidebar/src/pty-manager.ts`——这是上游任何 lane 都看不到的缺口，因为该包是 fork 独有的。
- fork CI 的总时长增加一个覆盖率聚合的时间，它是工作流中最长的 job：首次运行在 4 核 runner 上以最初的"四进程"预算实测 20 分钟，且只在 pull request 上运行。下面降低的预算会把其中一部分墙钟时间换回每进程的余量。
- 这条 lane 的头两次运行失败的都不是门禁本身，而是负载敏感的用例。第 1 次运行全部测试通过、报出 `pty-manager.ts` 的阈值缺口；第 2 次运行跑在修复该文件的代码上，阈值缺口为 0，却触发了两个在第 1 次运行中通过的用例：`packages/experimental/ptc-runtime-python/tests/runtime.spec.ts` 撞上它自己注释里为"覆盖率 lane 的 V8 插桩 + 多 worker 共享一机"而预留的 60 秒墙钟上限，以及 `packages/preset/agent-presets/tests/mount.spec.ts` 一个两条拒绝路径相互竞争的挂载断言。四个插桩进程跑在四个核上，比上游十六核六进程、也比 fork 未插桩的三进程都更拥挤，因此 `DSH_COVERAGE_MAX_WORKERS` 降到 2。第三次运行才能确认这个姿态；若仍有负载敏感失败，工作应转到对应的测试本身，而不是继续调这个预算。
- 两个新 job 重复支付 `node-checks` 已经支付过的安装步骤。GitHub Actions 的 job 之间不共享工作区，这是保持单元 lane 前置条件不变的代价。

## 验证

- 在本次改动的树上执行 `pnpm run build && pnpm run hygiene`：`run-gates: 16 passed, 0 failed, 0 skipped`。同一条命令在声明改动之前会因 `constraints` 变红。
- 在 Node 24 下于 macOS 完整运行 `DSH_COVERAGE_PARTITIONS=4 pnpm run test:coverage:partitioned`，每个被度量文件均为 100%（含 `packages/client/better-sidebar/src/pty-manager.ts`），唯一失败的测试是 `packages/util/http-proxy/tests/install.spec.ts` 的 "connects directly when the bypass list covers the target"（5000 ms 超时；它在该主机上单独运行同样失败，且不属于本 fork 改动的任何包）。这个本地结果**不能**证明该门禁在 Linux 上的行为：`pty-manager.ts` 只在 node-pty 那个仅 macOS 存在的 spawn-helper 产物存在时才恢复其可执行位，因此 Linux runner 报出 `pty-manager.ts:38` 的两处未覆盖位置，并使该文件的语句与分支阈值不达标。`packages/client/better-sidebar/tests/cov-host-platform-edges.spec.ts` 现在在该文件既有的 `node:fs` mock 下注入 `linux` 来钉住这条路径，于是该分支不再依赖宿主机磁盘布局。`better-sidebar` 是 fork 独有包（上游没有它），这正是此前没有任何 lane 度量过该文件的原因。
- 工作流可解析，`scripts/ci-workflow.spec.ts`（43 个测试）通过；该 spec 读取的是归档的上游工作流，因此只是间接约束这两个新 job。
- 这两个 job 本身的唯一验证是首次 CI 运行；开发者机器上没有任何东西会执行 GitHub Actions job。

## 相关

- [CI Node 编译缓存](2026-08-28-ci-node-compile-cache-data-disk.zh.md)——上游 lane 携带而这两个 job 没有的 lane 级环境注入。
- [上游同步后债务清扫](../bug-fix/2026-08-28-post-sync-debt-sweep.zh.md)——本门禁现在所针对的覆盖率 exclude 登记。
