# Agent Note：上游 v0.2.1-alpha.2 同步

Status: implemented

[English](2026-10-10-upstream-dsh-v0.2.1-alpha.2-sync.md) | 中文

## Problem

fork 从上游的 `dsh-v0.2.1-alpha.1` 标签移到 `dsh-v0.2.1-alpha.2`。merge base 落在 alpha.1 的发布合并上，因此本次合并读到的是真实冲突集——三处冲突，全在生成文件里（`docs/tool-catalog.i18n.yaml`、`docs/tool-catalog.zh.md`、`scripts/preset-divergence-baseline.json`），没有任何上游提交被重复推导。

当两侧在同一个文件的不同位置各自动手、而其中一侧的改动是结构性的时，三方合并无法调和。本次合并把一批共享文件解析到了来向一侧，把 fork 的那一侧留在了原地；它还把若干生产调用点迁移了，却没有同步迁移对它们打桩的 spec。同步流程中的任何一步都没有在合并后的树上跑单元测试，所以这些丢失不可见：`pnpm run test` 报出 **24 个文件、141 个用例失败**，每一个都能在合并提交处复现。

随版本而来的还有两种损失形态。该版本把五个包（`skill-badge`、`tool-ralph`、`hook-protocol`、`hooks-claude-code`、`hooks-codex`）移入 `packages/experimental/`，废止了 `backgroundMode`，并用它自己的托管 activation `manager.ts` 取代了 fork 的 `subagent/continuation.ts`；fork 的清单、预设与文档仍在用旧形态指名。该版本还新增了 fork 从未满足过的门禁（`verify-product-use`、`verify-plugin-record-callers`、`verify-default-product-isolation`、`verify-runtime-closure`），以及更严格的 `publint`。

这次同步还落在了错误的基线上。它被提交到一个止于第 377 号 PR 的 `master` 上，而 `origin/master` 已经经 #380 前进了 16 个提交。

## Decision

- **同步分支在评审前先 merge-forward `origin/master`。** `sync/upstream-dsh-v0.2.1-alpha.2` 承载本次合并及其修复，然后合入 `origin/master`，因此 PR 是相对 fork 当前 master 阅读的，评审看到的是那 16 个专利提交作为普通历史，而不是一处缺失。三份生成文件在该步解析到来向一侧，随后重新生成。
- **丢失的 fork 内容按恢复处理，不重新推导。** `packages/subagent/subagent` 取回 `coldReadConcurrency` 字段及其 `listDescendants` 实参；根清单取回 19 条门禁注册与更大的宿主构建堆；`packages/bundle/web-app` 取回专利与文档预设指南、它们的补丁表、`skills`，以及两条 bundle patch 条目；`gen-tool-catalog` 的 `document_deliver` 配方不再挂载 `LocalFileSystem`，那已归该版本共享的 harness 所有。每一次恢复都是把 fork 自己先前的提交重放到该版本的结构上，而不是重新发明。
- **该版本自己做的改动，跟随该版本。** `backgroundMode` 随废止它的升级指南一起离开 fork 自有的预设层；共享预设层去掉该版本移除的 codex／claude-code／ralph 行与 `{{cwd}}` 后缀；被移入 `experimental/` 的五个包失去所有发布成员对它们的依赖，而 fork 的 `document` 预设不再直接挂载 `tool-ralph`——该版本是经 `OPTIONAL_BUNDLES` 中的 `dsh-experimental-ralph-bundle` 抵达该工具的。预设分歧基线按由此产生的 24 行重录。
- **`apps/desktop` 保留 fork 的发布品牌与 Office 旁挂。** Agent Note《2026-09-09-desktop-release-branding-parameters》把这两项记为已发布的 fork 行为：带 fail-loud 校验的 `DSH_DESKTOP_PRODUCT_NAME` 与 `DSH_DESKTOP_ICON_DIR`、`apps/desktop/assets` 下的应用图标集，以及旁挂于归档之外的 Office 引擎——好让它的转换辅助进程读到带真实权限位的真实文件系统路径。这些都在该版本自身的结构上恢复，包括 `mac.signIgnore` 与两条运行时映射的引擎排除项。`mac.identity` 对未签名构建保留该版本的 ad-hoc `'-'`：fork 原先选的是 `null`，但该版本加上 ad-hoc 签名时给出的理由是修改过的 Electron 可执行文件需要它才能运行，且打包 spec 现在钉住了这一行为。同一文件里还落下两处合并缺陷：重复的 `mac.extendInfo` 键曾静默丢掉 `CFBundleLocalizations`。
- **spec 迁到 fork 生产代码实际调用的 API。** patent-teams、self-evolve 与 subagent 的 spec 改为对 `startActivation` 打桩，而非已退役的 `start`／`startContinuable`；真实 Loader 组合与内联 context 挂载 `SubagentRuntime` 现在注入的 `workingDirectory`。`gen-tool-catalog.spec.ts` 期望的是两侧工具名的多重集并集，而不是合并拼出的三份重复字面量；已废弃的 `one-shot` 遍历用例跟随该版本的模型——本地 activation 结算为 `continuable`。
- **persistence 历史的分叉由一条新记录来收束。** fork 的 `2026-09-22-fork-source-attribution` 与该版本的 `2026-10-05-working-directory-attribution` 各自把 `2026-09-21-user-question-reply` 记为四个 root 的前驱。现在该版本的记录接在 fork 的记录之后，并由 `2026-10-10-fork-attribution-resync` 确认合并后的树实际携带的并集——因为两个前驱的 schema 快照都描述不了它。
- **该版本新增的门禁被满足，而不是豁免。** 十一个 fork 包加 `dsh-im` 在 `PRODUCT_PACKAGE_POLICY` 中获得显式角色——各自点明挂载它的组合——于是 `verify-product-use` 把它们的「不在默认产品中」读作已声明的角色而非缺口。`verify-plugin-record-callers` 跟随声明进入 fork 重构后所在的 `session.ts`，并接纳再导出它的入口。`rescope-vendor` 收下该版本新增的 `optional-bundle-transitions.e2e.ts` 站点——那里指名的 `cordis` 是预设 id，不是包。`publint` 忽略随 skill 的 `templates/` 树发布的 `package.json` 的嵌套清单告警：那是创建者会复制到真实包根目录的示例数据，Node 从不经已发布的副本解析。
- **三处门禁把 `git ls-files -z` 的缓冲区抬到 Node `execFileSync` 默认 1 MiB 之上。** 跟踪文件列表越过该上限后，`verify-concrete-terms`、`verify-public-repository-links` 与 `rescope-vendor` 都以 ENOBUFS 崩溃。该版本自己的副本带着同一个默认值，所以这是规模上限，不是 fork 分歧。
- **手写页面是被带过来，而不是重新生成。** `docs/tool-catalog.zh.md` 收下该版本新增的两行包映射与两段包小节，其 `Source` 链接与逐字 schema 块同生成的英文页对齐——有六个不同的包路径已移动。`docs/capability-seams.zh.md` 收下该版本新增的四行服务，其图示与各行同生成的页面重新对齐。`verify-persistence-formats` 以及本次同步所编辑每一页的配对记录都重新录制。

## Consequences

fork 在完整保留其专利、self-evolve、桌面、better-sidebar、插件市场与文档面的前提下，发运上游 v0.2.1-alpha.2 基线。单元测试从 141 个失败降到 Testing 一节所载的数量，残余失败在那里点名，而不在此处修复。

每次发布需要关注的分歧由三条变为四条。前三条与上次同步相同：fork 的预设是上游组合改动的落点，归档 note 的封条必须与该版本退役的 note 一致，fork 的 note 必须跟随上游的工作流路径进入 `workflows-disabled/`。新增的第四条是：fork 自有的预设层与清单会指名该版本可能移入 `experimental/` 的包，而三道隔离门禁会读到每一个这样的名字。

fork 的 `ptc-runtime-python` 仍未吸收该版本的 sandbox 支持与 stdin bootstrap。fork 把该运行时拆成 `config`／`supervisor`／`output-ledger`／`frame-reader` 四个模块，而该版本保留了单个 `index.ts` 并向其加入了文件限制策略；合并保留了 fork 的拆分与该版本的 `py/` 脚本，二者并不相容。该包被恢复到 fork 自身自洽的状态，`snapshots/session/ptc-python-read-only` 被删除，因为该场景演练的是该版本的只读 sandbox 语义。把该版本的限制能力吸收进拆分后的运行时，是另一项改动。

`packages/subagent/subagent/src/continuation.ts` 已不存在：该版本的托管 activation 重写用 `manager.ts` 取代了它。债务台账的上帝文件清单与拆分计划 note 现在指名后继者。

## Alternatives considered

- **逐冲突重新解析合并，而不是恢复 fork 的提交。** 否决：合并已被提交与评审，而这些丢失并不在冲突文件里——它们在合并自动解析的共享文件里。把 fork 自己的提交重放到该版本结构上，内容相同而来源可审。
- **采用该版本的桌面打包层并改 fork 的 spec。** 否决：品牌参数是已发布、有记录的 fork 行为，并附有 Agent Note，fork 的本地打包配方依赖它们。采用该版本的图标会移除 `DSH_DESKTOP_ICON_DIR` 与 Office 旁挂，二者都是 fork 在用的。
- **保留 fork 的 `startContinuable` 调用点，与该版本的 spec 夹具各自为政。** 否决：该版本整体替换了 continuation 管理器，fork 的调用点无法对它运行。把调用方与其桩一起迁移，才是让合并后的树自洽的做法。
- **记录新门禁的失败，而不是满足它们。** 对隔离类门禁否决：每一条都指名该版本确实移除的依赖，跟随它只花两行清单改动。`publint` 的过滤是唯一的例外，且它很窄——点名一个消息 code 与一种路径形态，而不是全局关掉一条规则。
- **把 persistence 记录反向串链。** 否决：fork 的记录更早、先被提交，所以该版本的记录是它的后继；而且无论哪种顺序，既有 schema 快照都描述不了合并后的树——这正是新记录无论如何都要存在的原因。

## Testing

`pnpm run test` 报出 49,913 个通过中的 5 个失败、1 个预期失败与 217 个跳过。其中三个在本机于本次同步之前就已经是红的，且不属于本分支的面：`packages/util/http-proxy/tests/install.spec.ts`（此处无法解析的 `origin.test` 查询，单独跑也失败）、`packages/subprocess/subprocess-local/tests/spawn-runner.spec.ts`（调用方 shell 导出了 `NoDefaultCurrentDirectoryInExePath`，CI 没有该变量），以及 `packages/client/ui-trajectory/tests/views.client.spec.tsx`。另有两个是本同步记录在案、而非在此修复的残差：该 trajectory 用例与 `packages/client/ui-trajectory/tests/table.client.spec.tsx`，二者都在用该版本的请求状态模型断言 fork 抽出的 `RecordInspector`，且都经构建后的 client bundle 挂载插件，因此只改源码而不重建到不了它们。首轮报出的另外 21 个文件都在本次同步中修复：`patent-teams` 62 例、`self-evolve` 26 例、`subagent` 后代列举 8 例、`ci-workflow` 8 例、工具目录 5 例，外加 Decision 一节点名的打包、session 与连接 spec。

`pnpm run test:snapshot` 在 session、sdk、acp、web 四条道上重放 204 个无密钥用例，跳过 2 个。两个压缩场景保持红色，因为它们的重放脚本只提供三次模型调用，而 fork 的组合需要第四次；重录需要带 `DEEPSEEK_API_KEY` 跑 `pnpm run test:snapshot:record`。它们在同步前的 fork 树上同样是红的，所以成因是组合而非本次合并。

`pnpm run typecheck` 在两个编译面上都退出 0，`pnpm run lint` 退出 0 并只余一条非致命的 unused-disable 警告，`pnpm run build` 退出 0 并记录 371 个 client 产物。`pnpm run constraints` 以家族统一版本通过，`pnpm exec tsx scripts/release/verify.ts --family dsh` 解析出 379 个成员，版本 `0.2.1-alpha.2`，发布顺序已解析。

`pnpm run doc-sync` 报 49 门全过，`pnpm run hygiene` 报 20 门全过。这两组在本次同步修复之前都是红的，且失败落在此同步负责的材料上：11 道文档门失败于过期的生成物与该版本移动的路径，5 道 hygiene 门失败于该版本新增的隔离检查。`pnpm run duplication` 报全仓 0 处克隆。
