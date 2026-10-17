# Agent Note: upstream dsh-v0.2.1-rc.2 sync

Status: implemented

[English](2026-10-17-upstream-dsh-v0.2.1-rc.2-sync.md) | 中文

## Problem

fork 从上游的 `dsh-v0.2.1-rc.1` tag 前进到 `dsh-v0.2.1-rc.2`：9 个提交（5 个非合并提交）、456 个文件、+4,921/−845 行。merge base 是上一次同步落地的 rc.1 release commit，因此一次 `git merge` 即到达该 tag。合并产生 15 个冲突：3 个位于可执行源码或 manifest，12 个位于生成文档及其双语记录。

与 rc.1 不同，本次发布带有行为变更。`web-deepseek-api` 在网页搜索设置开关后加入 DeepSeek Search 与 Fetch API，`llm-deepseek` 为随产品发布的 DeepSeek Flash 显示名追加 `1017`，`ui-deepseek-model-label-1017` 加入一个临时标识。发布提交把 DSH 家族提升到 `0.2.1-rc.2`。

## Decision

- **本同步分支对 release tag 做 merge-forward。** `sync/upstream-dsh-v0.2.1-rc.2` 从 fork `master` 的 tip 出发并合并 `dsh-v0.2.1-rc.2`；以 first parent 为 `master` 的 merge commit 落地，把上游提交与该 tag 保留在 fork 的提交图中。
- **web seam 保留 fork 的选择辅助函数，并接入上游的实时设置读取。** `packages/web/web/src/index.ts` 保留 `selectProvider()` 与 `resolveFetchProvider()`，每个操作读取 `this.config.searchProvider.get() ?? this.searchProviderEnv`（fetch 同理），使设置变更作用于下一次搜索或抓取。
- **bundle 保留 fork 的精选依赖列表并加入新提供方。** `packages/bundle/base/package.json` 追加 `@deepseek-ai/dsh-web-deepseek-api`，`packages/bundle/base/cordis.patch.yml` 以与 Messages 搜索提供方相同的 `DEEPSEEK_API_KEY` 引用注册它。
- **tool-lsp manifest 保留 fork 的字面 em dash。** `packages/lsp/tool-lsp/package.json` 保留 fork 的 description，只提升版本号。
- **生成文档重新生成，不做手工合并。** `docs/capability-seams.md`、`docs/persistence-catalog.*`、`docs/persistence-schema.json` 与 `docs/persistence-changes/historical-formats/README.*` 由 `gen-doc-graphs`、`gen-persistence-catalog` 和 `persistence-formats --write` 产出。`docs/capability-seams.zh.md` 的中文侧为人工维护，因此其图中的节点、`pkg_web_deepseek_api --> svc_web` 连线和提供方行手工镜像英文生成结果。
- **上游的两处重复检测抑制注明原因。** `web-deepseek-api` 的传输层镜像 Messages 搜索传输层，fork 的抑制门禁要求每处 `jscpd:ignore-start` 带内联原因。
- **版本在 fork 自有面上统一钉住。** 根 manifest、47 份 fork manifest、`SIDEBAR_SERVICE_VERSION` 以及 9 份 ACP `agentInfo.version` golden 一并前进到 `0.2.1-rc.2`。`scripts/release/verify.ts --family dsh` 在该版本下解析出 390 个家族成员，无未排序的 peer 声明。
- **工具目录与配置目录按本树重新生成。** 基线 `master` 为两个专利方法学字段保留了目录条目，而对应源码只存在于尚未合并的特性分支；重新生成使两份目录与当前树中的源码一致。

## Consequences

fork 带着 rc.2 的行为发布——设置开关后的 DeepSeek Search 与 Fetch API，以及 DeepSeek Flash 1017 标识——同时专利、self-evolve、桌面、better-sidebar 与 document 各面保持原有行为。合并后的树相对同步前 `master` 改动 515 个文件：456 个上游文件，加上 fork 版本固定点与重新生成的文档。

设置开关现在会在运行期写入 `web` 命名空间的 `searchProvider` 与 `fetchProvider` 引用，因此 fork 的 `resolveFetchProvider()` 与 `fetch()` 读取同一组实时值。新包属于 base bundle，并以与 Messages 提供方相同的方式解析 `DEEPSEEK_API_KEY`。

重新生成目录后，工具目录移除了 `conflictingApplications`，配置目录移除了 `guidelineRevision`，因为对应源码不在 `master` 上。加入这些源码的特性分支在向前合并时会再次重新生成两份目录。

## Alternatives considered

- **整体采用上游的 `packages/web/web/src/index.ts`。** 否决：这会丢掉 `resolveFetchProvider()` 与 `selectProvider()`，而 fork 的工具启用逻辑会在加载时查询它们。
- **保留 fork 的静态提供方 id。** 否决：设置开关会在挂载后更新 volatile 配置引用，静态 id 会忽略新的选择。
- **手工合并生成的持久化与能力文档。** 否决：计数、摘要与章节哈希都由源码推导，生成器是唯一可靠的解决方式。
- **保留上游未注明原因的 `jscpd:ignore-start`。** 否决：`hygiene` 会让每处没有原因的抑制失败。

## Testing

`pnpm run build:artifacts` 通过 7/7 门禁。`pnpm run typecheck` 通过全部五项门禁——Host Typert、host 与 client 编译器，以及两个 aggregate——`pnpm run build:check` 在构建产物上通过两个 aggregate 检查。

`pnpm run lint` 退出码为 0，只带 `packages/experimental/client-ui-cot-translation/src/index.ts` 中既有的 unused-disable 警告。补齐抑制原因后，`pnpm run hygiene` 报告 22/22 门禁通过。`pnpm run doc-sync` 报告 51/51 门禁通过。

针对性测试覆盖改动的各个面：`packages/web`、`packages/client/ui-settings-web-search`、`packages/client/ui-deepseek-model-label-1017` 与 DeepSeek LLM 各包共 55 个测试文件、1,164 个测试。

`pnpm run test:snapshot` 在 session、sdk、acp、web 四个 lane 回放 226 个用例，224 个通过、2 个跳过。宿主的 `/usr/bin/python3` 为 3.9.6，低于 PTC runtime 要求的 CPython 3.10；把 Homebrew Python 3.14 放到 `PATH` 后回放通过，这是 `ptc-python-turn` 的环境条件。
