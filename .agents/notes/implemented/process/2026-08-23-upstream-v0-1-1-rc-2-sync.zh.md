# Agent Note：将上游 dsh-v0.1.1-rc.2 同步进 fork

Status: implemented

[English](2026-08-23-upstream-v0-1-1-rc-2-sync.md) | 中文

## 问题

上游发布了 `dsh-v0.1.1-rc.2`（`b150a551b8`），相对 fork 在 PR #20 合并的 rc.1 基线（`528c682e06`）变化 431 个文件（+8101/−2039）。上游 rc.2 以图像管线统一为主：`read_image` 规范化准入与确定性缩放、结果信封中的 `originalDimensions`、`saveImage` 在源事实之外返回规范引用、以及停用的 image-region 工具。fork 的自有面（patent、self-evolve、desktop、synapse、plugin-market、`dsh-timeout-guard` 改名）位于同一 rc.1 基线之上。

## 决策

以一个合并提交（`Merge upstream v0.1.1-rc.2 (b150a551b8) into fork`）前向合并，按类别解决冲突：

- **冲突（9 个文件，全部为文档）**：`docs/event-producer-consumer.{md,zh.md}`、`docs/module-graph.{md,zh.md}`、`packages/fs/tool-fs/README.md`/`README.zh.md` 及其 `.i18n.yaml` 配对记录。生成类图谱文档以 fork 侧为合并基线，随后从合并后的源码树重新生成——既纳入上游变更（`llm/stream` 源码行号移动、`host-apiproxy` 删除的 `permission-presets` 依赖），又保留 fork 内容。手写 tool-fs README 双侧合并：保留 fork 的 `timeout-guard` 措辞，采纳上游新增的 `No attachment-region tool` 限制条目。
- **无源码冲突**：fork 代码不触及重构后的 attachment/`read_image` seam；合并树上的 `typecheck`、`lint`（89 规则）与单元测试均通过，无需进一步源码改动。
- **版本族**：25 个 fork 专有包清单与 `apps/desktop/package.json` 从 `0.1.1-rc.1` 升到 `0.1.1-rc.2`，使工作区共享同一版本（dsh 发布族要求）。不推送标签——fork 与上游共享 `dsh-v*` 标签空间。
- **重新生成**：对合并后的源码树重新生成文档图谱、模块图、cordis/config/tool/persistence 目录、client 插槽目录、scoped events 与第三方声明。重新生成恢复了被合并后的上游目录内容覆盖的 fork 条目（config 目录中的 `dsh-host-synapse`、`dsh-client-synapse`、`dsh-client-ui-document-studio`、`dsh-self-evolve-eval`；模块图中的 synapse/patent/self-evolve 行）。zh 对侧手工镜像，五个变更配对重新记录（`verify-translation-pairing --write`）。
- **过期构建产物**：删除上次桌面构建留下的、被 gitignore 的 `apps/desktop/release/` 与 `apps/desktop/resources/mac/` 输出；它们不在翻译扫描排除清单中，其 rc.1 时期的过期 README 会破坏配对扫描。
- **master 既有门禁债不进入本 PR**：失败的 `launch-checklist` 链接/换行、`createFixtureApi` 导出 JSDoc 漂移、嵌套的 `packages/self-evolve/evaluation` 包路径违规、以及 `self-evolve-eval`/`synapse` README 的 model-experience/limitations 缺口均由 PR #23/#24/#26 引入 master，由 `fix/master-gate-debt`（PR #28）跟踪。

## 后果

fork 以上游 rc.2 为基线且自有接缝完好：`dsh-timeout-guard` 命名、desktop/patent/self-evolve/synapse 表面与 fork 的 CI 布局全部保留，工作区所有 `dsh` 包版本为 `0.1.1-rc.2`。上游随 rc.2 交付的图像管线语义（规范化图像准入、带 `originalDimensions` 的缩放读取）成为 fork `tool-fs` 表面的一部分，无需 fork 侧代码改动。

## 备选方案

- **先并入 `fix/master-gate-debt` 再同步**：否决——同步分支保持干净的上游合并记录；master 门禁债经 PR #28 落在新 master 之上，两条分支无冲突 hunk。
- **把桌面产物路径加入配对排除清单**：否决——它们是可丢弃的构建输出；删除可保持排除清单与上游一致。
- **从头翻译重新生成的目录**：否决——fork 通过镜像重新生成的英文侧来重建 zh 页（rc.1 同步确立的既有约定）。
