# Agent Note：上游 dsh-v0.2.1-alpha.3 同步

Status: implemented

[English](2026-10-14-upstream-dsh-v0.2.1-alpha.3-sync.md) | 中文

## Problem

fork 从上游的 `dsh-v0.2.1-alpha.2` 标签移到 `dsh-v0.2.1-alpha.3`：852 个提交、3,311 个文件、+120,978/−16,632 行。merge base 落在 alpha.2 的发布合并上，上次同步以合并提交（PR #381）落地了它，因此一次 `git merge` 就到达该标签，没有任何上游提交被重复推导。`git merge-tree` 预测 132 个冲突文件，而 alpha.2 是 276 个。

fork 携带该版本没有的内容——48 份包 manifest、`dsh-timeout-guard` 改名、`apps/desktop` 品牌层、`workflows-disabled/`，以及约 60 个包（含专利、self-evolve、better-sidebar、插件市场与文档各组）——因此本次合并必须在吸收该版本的同时不丢失其中任何一项。

上次同步的教训是，三方合并会悄无声息地解析共享文件，只有在合并后的树上跑套件才能报出它丢了什么。本次发布给这条教训添了第四种形态：**合并可以从一个从未标记为冲突的文件里丢掉整项上游功能，而合并后的树照样能编译。** `packages/core/tools` 就是这一例。该版本把 `Context` 穿进 `createRunCodeTool`，新增 `PtcCalls` 以便在沙箱策略变化时取消在途程序，并通过 `stateOwner` 实参按 Agent 为保留下来的 PTC 环境建立键。本次合并新增了 `ptc-calls.ts`，却把 `ptc.ts` 留在 fork 更旧的版本上，于是该包发运出一个无人 import 的模块、一个从不传 `stateOwner` 的 `run_code` 工具，以及一个文本已被该版本替换为按语言参数化工厂的 `run-code-flavor.ts`。`tsc`、`lint`、`build` 与 51,970 个通过的测试都把这棵树读作健康。信号来自一道翻译配对门禁：`docs/tool-catalog.zh.md` 持着该版本新的 `run_code` 描述，而另一侧的生成英文页面仍持旧描述，且英文页面是源码的投影。

## Decision

- **同步分支 merge-forward 该发布标签。** `sync/upstream-dsh-v0.2.1-alpha.3` 承载本次合并，PR 以合并提交落地它，其第一父提交是 fork 的 `master`。squash 会把上游的提交从 fork 的提交图中移除，并把下次同步的 merge base 推回上一个标签。
- **冲突按类别解决，绝不按行范围。** 按行范围择边在 alpha.2 同步中保住了只对一侧成立的共享行，把 import 留在存续的区域，而它们的使用留在被删除的区域。

  | 类别 | 数量 | 解决方式 |
  |---|---|---|
  | `.i18n.yaml` 伴随记录 | 21 | 取该版本的，然后 `verify-translation-pairing --write` |
  | `snapshots/**` | 13 | 取该版本的，然后刷新 |
  | `package.json` manifest | 24 | 取并集 |
  | Markdown | 29 | 重新生成这些生成页面；手工合并人工撰写的中文对侧文件 |
  | 源码 `.ts` | 18 | 逐文件：先取 fork 的版本，再把该版本的改动编入其中 |
  | 生成器、锁文件、tsconfig | 27 | 取并集，然后重跑生成器 |

- **本次合并保留 fork 的分歧。** `dsh-timeout-guard`（上游的 `dsh-tool-call-timeout-policy`）、`workflows-disabled/`、`apps/desktop` 品牌层（`DSH_DESKTOP_PRODUCT_NAME`、`DSH_DESKTOP_ICON_DIR`、`mac.signIgnore`，以及旁挂于归档之外的 Office 引擎）、`packages/subagent/subagent/src/list-children.ts` 中的 `coldReadConcurrency`，以及每一个 fork 独有的包组。
- **该版本的 Host 堆上限装不下 fork，于是取回 fork 的值。** `scripts/compile-referenced-projects.ts` 随该版本而来，把 Host 聚合钉在 `--max-old-space-size=4096`。fork 的 Host 聚合比该版本的大——fork 自有的各组叠在该版本新增的 `cua`、`cua-macos`、`remote-access`、`harness-dev-context` 与 `ui-secret-mask` 编译面之上——在干净树上峰值接近 5.5 GB，因此每一条从全新检出开始做类型检查或构建的通道都会耗尽堆。`hostHeapArgs` 现在返回 fork 的 6144，也就是 `package.json` 的 `build:lib:host` 已经给同一个程序的同一条上限。
- **该版本的 PTC 取消与 state-owner 接线是移植而来，不是恢复。** `ptc.ts` 新增 `PtcCalls(ctx)`、以 Agent 为键的 `stateOwners` weak map、`runtime.resolve` 上的 `stateOwner` 实参，以及按需解析沙箱模式的 `run(callSignal)` 闭包；`index.ts` 把它的 `Context` 穿进 `createRunCodeTool`。`run-code-flavor.ts` 采用该版本的参数化工厂，它只指名本包自己的调用规则，把求值语法、输出规则与状态保留留给 `PtcRuntime.executionInstructions`。这也正是 `ptc-persistent` 回放失败的根因：没有 `stateOwner`，运行时就不会按 Agent 保留环境，因此第二次 `run_code` 读不到第一次设下的值。
- **该版本的 Office 渐进加载落地，fork 的 Office 链保留。** `packages/skill/skill-office` 收下该版本的路由 skill（技能）以及 `office-render`、`office-recalculate` 与 `office-export-pdf`，Python 运行时的 `_resources.py` 去掉它的 `check_office.py` 条目。`build_patent_filing` 与 `verify_patent_filing` 仍是原生 DOCX 路径，`render_doc_template` 仍是模板路径，两个预设仍把 fork 自有引擎覆盖不到的工作路由到 officecli。`check_office.py` 没有 fork 消费方——只有它自己的 SKILL.md 文件、它的测试与运行时的 require 清单——因此本次合并接受该删除。
- **`docs/defensive-patterns.md` 变成一个目录，指向它的引用随之移动。** 该版本把这页拆成一个 README 路由页加上 `general.md`、`package-surface.md`、`remote-and-api.md`、`client-components.md` 与 `conversation-and-session.md`。`AGENTS.md` 与引用它的四个 skill 被重新指向。余下九处引用位于 `archived/` 的 note 里，这些 note 被封存、不允许内容编辑，并且被文档门禁跳过。
- **该版本收紧的门禁被满足，而不是豁免。** `verify-package-dependencies` 新增一条规则：`@types/react` 与 `@types/react-dom` 只在根 manifest 中声明，因为每一处包内 pnpm 链接都是 TypeScript 为每个 JSX 文件多扫描的一个位置；五个在本地声明它们的 fork client 包去掉这些条目，`pnpm-lock.yaml` 随之少掉对应的 21 行。`rescope-vendor` 收下该版本的 `v0.2.1-alpha.1` 预设组合升级指南，作为一个指名 `cordis` **委派工具**而非包的站点，与 alpha.1 和 alpha.2 同步记录过的预设 id 站点并列。
- **persistence 历史的分叉由一条新记录收束。** 该版本的 `2026-10-13-user-rpc-principal` 记录为四个 fork 同样携带的 root 描述了自己的形态，而那个形态里没有 fork 的任何来源标注种类。`docs/persistence-changes/2026-10-14-alpha3-sync` 接在它之后，登记合并后的树实际具有的形态，其中 fork 独有的 `event:self-evolve/mined` 接在 `2026-09-16-upstream-sync` 之后。所有差异都是增量的且同为同一版本：早于这些新增种类的读者仍能渲染携带它们的消息。
- **机械对齐。** 根 manifest、47 份仅 fork 发布的 manifest 与 `SIDEBAR_SERVICE_VERSION` 在 388 份 manifest 中移到 `0.2.1-alpha.3`，没有一份落在后面；`pnpm install --lockfile-only` 只在上述类型包移除处改动 `pnpm-lock.yaml`。九份 `snapshots/acp/*/stdout.expected.jsonl` 重新钉住 `agentInfo.version`。`verify-test-skips` 与 `no-unknown-casts` 基线重新录制（后者修剪掉该版本退役的五条），`docs/TECH_DEBT.md` 的计数随之更新。
- **被删除文件的清查针对 fork 独有的配置运行。** 该版本删除了 18 个文件。每一处 fork 独有的 `vitest.*.config.ts`、`lefthook.yml`、工作流与 `tsconfig*` 都就每条被删除路径与每个被删除基名逐一 grep 过；没有任何一处指名其中任何一个。这正是 alpha.1 同步缺失的那项检查——当时该版本的 Vitest 配置清理让 `vitest.race-stress.config.ts` 成了孤儿引用，71 个测试文件收集失败。

## Consequences

fork 在完整保留其专利、self-evolve、桌面、better-sidebar、插件市场与文档面的前提下，发运上游 v0.2.1-alpha.3 基线。单元套件报出 Testing 一节点名的两处失败，二者在本机于本次同步之前就已经是红的，且不属于本次合并触及的任何文件。

本次发布添上的教训是：「合并能编译」并不证明共享文件保住了该版本的内容。`packages/core/tools` 在每一道门禁里都编译通过，却丢掉了一项功能。本次合并的退出状态、`tsc` 与套件里都没有任何东西能把这种情况与一次干净的合并区分开；能作出区分的产物是生成页面——它们投影源码，因此带上了源码自身的漂移。把生成页面的 diff 与其手写对侧对照来读，现在是发现它的最廉价探测器。

每次发布仍需关注的三处分歧与上次同步相同：fork 的预设是上游组合改动的落点，归档 note 的封条必须与该版本退役的 note 一致，fork 的 note 必须跟随上游的工作流路径进入 `workflows-disabled/`。alpha.2 同步新增的第四条——fork 自有的 manifest 会指名该版本可能移入 `experimental/` 的包——本次发布没有重演。

fork 的 `ptc-runtime-python` 仍未吸收该版本的沙箱支持或其 stdin bootstrap；拆成 `config`／`supervisor`／`output-ledger`／`frame-reader` 四个模块与上游带文件限制策略的单个 `index.ts` 之间仍未调和，与上次同步所记录的完全一致。吸收那项文件限制仍是另一项改动。

## Alternatives considered

- **逐冲突重新解析本次合并，而不先点名检查项。** 否决：alpha.2 同步的丢失发生在合并自动解析的文件里，而本次发布的 PTC 丢失发生在一个合并从未标记过的文件里。在合并之前点名孤儿引用、静默丢失与生成页面这三项检查，才让它们真正跑起来。
- **把 fork 的提交 rebase 到该版本上，而不是向前合并。** 否决：fork 的分歧是一组持续演进的决策——timeout-guard 改名、桌面品牌层、归档的工作流——而不是一组可以重新施加的补丁序列。rebase 会在每次发布时把其中每一项重新推导一遍，而上一次同步的 merge base 才是让一次合并就能到达下一个标签的原因。
- **采用该版本的 `apps/desktop` 打包方式并更新 fork 的 spec。** 否决：品牌参数是已发布、有记录的 fork 行为，并附有 Agent Note，fork 的本地打包配方依赖它们。
- **把 `check_office.py` 与该版本的渐进加载 skill 并列保留。** 否决：fork 里没有任何东西调用它，它自己的 SKILL.md 文件已被该版本的路由 skill 取代，而保留它意味着维护一份合并后的树里没有任何测试覆盖的 Python。
- **恢复 fork 的 `run_code` flavor 文案，而不是移植该版本的工厂。** 否决：fork 的文案重述了 `PtcRuntime.executionInstructions` 已经提供的求值语法、输出规则与状态保留，于是模型把同一批指令收到两次，两份副本还可能漂移。
- **新增一道门禁，把生成页面与其手写对侧比对。** 本次同步否决：配对门禁已经读取两侧，新门禁只会把同一类漂移再报一次。发现 PTC 丢失的机制是既有的翻译配对检查，而不是一道新门禁。

## Testing

`pnpm run test` 报出 51,970 个通过中的 2 个失败、1 个预期失败与 218 个跳过（合计 52,191 个）。两处失败在本机于本次同步之前就已经是红的，且不属于本次合并触及的任何文件：`packages/util/http-proxy/tests/install.spec.ts`（此处无法解析的 `origin.test` 查询）与 `packages/subprocess/subprocess-local/tests/spawn-runner.spec.ts`（调用方 shell 导出了 `NoDefaultCurrentDirectoryInExePath`，CI 没有该变量）。上次同步作为残差留下的两个 `ui-trajectory` 用例现在通过：该版本重写了这个包的请求状态模型，而它们断言的正是该模型。

`pnpm run test:snapshot` 在 session、sdk、acp 与 web 四条道上回放 223 个无密钥用例，跳过 2 个，无失败。三个场景需要在 `test:snapshot:refresh` 把原始值写入一个已提交的规范化不动点之后，重新 token 化它们的 job id。

`pnpm run typecheck` 在两个编译面上都退出 0，`pnpm run lint` 退出 0 并只余一条非致命的 unused-disable 警告，`pnpm run build:artifacts` 与 `pnpm run build:check` 退出 0，`pnpm run duplication` 报全仓 0 处克隆。`pnpm run constraints` 以家族统一版本通过，`pnpm exec tsx scripts/release/verify.ts --family dsh` 在 `0.2.1-alpha.3` 解析出 384 个成员，发布顺序已解析且没有未排序的 peer 声明。`pnpm run hygiene` 报 21 门全过；其中两门在合并后的树上曾是红的，并在本次同步中修好，二者都落在此版本迫使本次同步接管的材料上：`rescope-vendor` 失败于该版本的预设组合升级指南，`verify-package-dependencies` 失败于那五份仍声明该版本已移到根的类型包的 fork manifest。`pnpm run doc-sync` 报 51 门中 50 门通过。唯一一处失败是 `verify-repository-references`，它是完整历史克隆带来的产物而非缺陷：`python/sdk/uv.lock` 记录了一个字节大小 `6344383`，其十六进制前缀与本克隆中存在的一个对象匹配，而门禁自身的约定说浅历史中不存在的对象不可能匹配。CI 的浅克隆看不到该对象，因此报不出这一行。

CI 对本分支的首轮运行有五条通道为红，且全部失败在同一处：`tsc` 跑 Host 聚合时堆耗尽。四条通道死在 `pnpm run build` 里，一条死在 `pnpm run typecheck` 里——正是 Decision 一节所恢复的那条上限在冷树上的形态。那处堆恢复就是全部修复：在干净树上同样的命令现已通过，Host 聚合峰值接近 5.0 GB。
