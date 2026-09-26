# Agent Note: Fork CI 运行已录制会话快照车道

Status: implemented

[English](2026-09-26-fork-ci-snapshot-lane.md) | 中文

## 问题

`ci-fork.yml` 原先运行 lint、typecheck、duplication、单元套件、构建产物套件、文档检查、coverage、hygiene、benchmarks 与 keyless Python 套件。没有任何车道运行 `pnpm run test:snapshot`——它是唯一无密钥的模型可见行为端到端检查：启动发布形态的 profile、回放已提交的转录，并把组装的请求头、系统提示词与持久化日志同已提交的预期逐项比较。

在没有车道运行它期间，这些预期与其所钉住的源码脱节。被钉住的 `tool-schemas.expected.json` 与 `system-prompt.expected.md` 侧车仍带着 fork 精简模型可见措辞之前的提示词与工具描述文案，而已提交的会话代还是 V3，checkout writer 已是 V4。在本 job 所属改动的合并基线上，该车道 190 例中有 83 例因请求头或系统提示词失败。

其中一部分脱节藏在平台门禁之后。两个场景声明 `platform: pwsh`，在任何模式下只要主机 `PATH` 上没有 `pwsh` 就会被跳过；本 fork 的开发主机正是如此，因此没有任何本地运行回放过它们，其侧车是靠手工改动而非刷新维护的。最后一次手工改动跟随了一次措辞重构，却把钉住的 `todo_write` 描述留在 2026-09-02 之前的文案，于是在有可用 `pwsh` 的主机第一次运行它们时，两例都因请求头 1 失败。

## 决策

`ci-fork.yml` 新增 `node-snapshots`，限定 `pull_request`，上限 45 分钟，按序执行四步：`pnpm install --frozen-lockfile`、`bash scripts/prepare-ci-bubblewrap.sh`、`pnpm run build`，以及车道本体 `DSH_EXAMPLE_MODE=lib pnpm run test:snapshot snapshots scripts/session-snapshot-corpus.corpus.ts`。

### 车道自带 build 与限域准备

`DSH_EXAMPLE_MODE=lib` 让每个 profile 子进程都在普通 Node 下从构建产物 `lib/` 启动，此时裸包插件通过该包真实的 `exports` 解析；源模式是零构建的开发者路径，其工作区导入改走 tsconfig paths 映射。`scripts/build.ts` 同时构建 Session 日志加锁所依赖的 native system addon，故一步 build 覆盖两者。限域类场景通过真实沙箱钉住 Session 文件策略，而 Linux 链路偏好 `bwrap` 而非 Landlock，托管镜像无法为无特权用户命名空间提供它；因此本 job 带上与 `node-checks`、`node-built-suites` 相同的准备步骤。

### 两个过滤条件都不可省

`DSH_EXAMPLE_MODE=lib` 还会让 `vitest.snapshot.config.ts` 收集 `apps/web/tests/**/*.snapshot.ts`，所以车道需要显式 `snapshots` 过滤才能留在已录制会话语料上。仅此一个过滤又会丢掉 `scripts/session-snapshot-corpus.corpus.ts`——那份在同一批目录上检查归属、请求头 pin、脱敏与跨场景 Session 引用的策略文件，因此本 job 把两条路径都写进命令。

### 本 job 只在 pull request 上等待

pull request 的运行把关的是落地该改动的合并，而本 fork 的合并路径就是 pull request。上游同样只在其 snapshots-and-artifacts 车道这样做。`node-checks`、`node-built-suites` 与 `node-hygiene` 两个事件都跑，维持原样。

## 备选方案

**直接运行 `pnpm run check:ci:snapshot`——上游 artifacts 车道调用的那个聚合。** 否决：该聚合设置的 `DSH_EXAMPLE_MODE=lib` 同时正是收集 `apps/web/tests/**/*.snapshot.ts` 的条件。那四个用例会针对构建好的 Web 客户端启动 Chromium，其中 `minimal-preset` 在当前主机上比对的是一份过期 ARIA 金标：渲染结果缺少金标持有的 `tab "Teams"` 行，故本 job 还需 Playwright 准备，并会带着 Web 车道的待办直接变红。已录制会话语料才承载本 job 要守护的模型可见契约；组装式 Web 快照属于 Web 车道，而本 fork 未接线该车道。

**以源模式运行车道（`pnpm run test:snapshot`，不设环境变量）。** 否决：本仓每个自带 build 的 CI 车道都从构建产物 `lib/` 启动 profile 子进程（[测试策略](../../../../docs/testing.zh.md)），源模式会走一条任何用户安装都不会走的解析路径。

**同时在推送到 `master` 时运行。** 否决：pull request 的运行已经把关该次合并，而每次合并重复跑一条 45 分钟的车道不会带来新信号。

**不带 fixture 刷新，让本 job 直接以红到达。** 否决：上线即红的车道无人阅读，而刷新正是车道可用的证据。刷新作为独立提交接受审查——143 个新会话代、63 个侧车、8 份 native-writer oracle、3 处 Web Session 引用——本提交则加入 job、workflow spec 断言与 `docs/testing.md` 中的层级说明。

## 后果

- 与当前组合脱节的钉住预期、缺失的 Session 格式后继代，以及不再指向所属者选中代的跨场景引用，现在都会让引入它们的 pull request 变红。本 pull request 里的刷新就是第一次证明：合并基线报 83 例失败，车道现在报 188 通过、2 跳过。
- 本 job 也是本 fork 中唯一运行 `platform: pwsh` 场景的主机，因此它的首次运行同时是这些场景在任何地方的首次运行。它们因手工维护的 `todo_write` 侧车而失败，其侧车随后在 Linux 上重新生成；语料现在在强制执行它的地方得到验证。
- `apps/web/tests/**/*.snapshot.ts` 在本 fork 仍无 CI 信号。`minimal-preset.snapshot.ts` 在本主机上与其已提交 ARIA 金标不一致，故该车道需要先做自身刷新与 Playwright 准备才能接线。
- 本 job 要额外付一次 install 与一次完整 build，`node-built-suites` 与 `node-hygiene` 也要付——GitHub Actions 的 job 之间不共享工作区。这是工作流中的第三次 build。

## 测试

- `pnpm run test:snapshot`：188 通过、2 跳过、0 失败（合并基线上为 190 例中 83 失败）。两个跳过项就是本主机无法回放的 `platform: pwsh` 用例。
- 本 job 的实际命令在本主机上、于一次全新的 `pnpm run build` 之后：`DSH_EXAMPLE_MODE=lib pnpm run test:snapshot snapshots scripts/session-snapshot-corpus.corpus.ts`，4 个文件、188 通过、2 跳过。
- 同一条命令在自带 `pwsh` 的 runner 上报 `Tests 2 failed | 188 passed (190)`；两例失败都是 `verifyHeaders` 处的 pwsh 用例，卡在 `todo_write` 工具描述上。针对同一条命令的一次 Linux `DSH_SNAPSHOT=refresh` 运行重新生成了这两个侧车。
- `pnpm run test:snapshot:refresh` 需要两遍才能收敛：第一遍余下 14 例失败——11 例顺序相关的读取方、2 例钉住 `text-turn` 侧车的 SDK 场景，以及 1 处跨场景引用——第二遍报 4 个文件通过、187 通过。refresh 是串行的，因此读取另一场景 pin 或请求头来源的场景，会比较到同一次运行稍后才改写的文件。
- `pnpm exec vitest run scripts/ci-workflow.spec.ts`:50 通过，其中包含钉住本 job 步骤顺序、lib mode 与两个过滤条件的用例。
- 本 job 自身的验证只能由第一次 GitHub Actions 运行给出；没有任何本地命令会执行工作流。

## 相关

- [Fork CI hygiene 与 coverage 门禁](2026-09-19-fork-ci-hygiene-and-coverage-gates.zh.md)——本 job 参照其形态的两个 job，以及与之共担的 install 成本。
- [`dsh-session-snapshot`](../../../../packages/test-support/session-snapshot/README.zh.md)——车道所依赖的共享存储、启动器与归一化规则。
