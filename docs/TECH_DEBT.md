# 技术债务报告

> 探查日期:2026-08-17。方法:全仓静态扫描 + 三个并行深度探查 agent(core 组 / 能力包 / 基础设施包,合计覆盖 packages/ 全部 src 源码约 55k 行)。「已验证」条目经人工逐行复核;其余条目来自深度探查,行号以探查时为准。

## 2026-08-28 更新(上游 v0.1.2-alpha.1 合并后的债务清扫)

- **H1 证伪**:实测 cordis `resolveConfig` 走 schemastery `~standard.validate`,对缺失键返回 `{value:{}}` 无 issues(`vendor/cordis/src/fiber.ts:51-53`),schema 不拦省略、env 回退可达。不改 schema,已补 env 选择回归测试(`packages/web/web/tests/web.spec.ts`)。
- **H2、H3 已修**(随上游 v0.1.2):llm-deepseek `parseWireChunk` 逐层结构化校验;settings `redactSecrets` 对含可达 secret 的不可展开节点 fail-closed。
- **M5 已修**:`atomic-write` 现在把临时文件 fsync 于 rename 前、父目录条目 fsync 于 rename 后;目录 fsync 为 best-effort(Windows 无法打开目录句柄),平台差异收敛在 `src/fsync.ts`。Windows owner-only ACL 语义仍超范围。
- **M6 部分消解**:`packages/host/apiproxy`(3744 行)已随上游删除,RPC 传输归 connection;`tools/src/code-mode.ts` 改名 `ptc.ts`。其余上帝文件仍在且继续增长(analyzer 3142、continuation 1569、coordinator 1439 行)。
- **M7 已修**:两个 `describe.skip` 恢复(实测全套 <1s,「60s 超时」的跳过理由不成立),并修正滞后断言(service 方法模型新增 `kind` 判别字段)。
- **M9 已收敛**:原 `packages/api/remotes/src/agent-lookup.ts` 的 legacy agent-busy fence 已随 2026-08-22 的 Session Controller refactor(`d26acfa2e3`)删除;当前 `session/agent-busy` 是 Session Controller 的当前设计,不是 shim。旧错误码与 `ApiRemote*` 符号在当前树中无残留。见 `.agents/notes/implemented/simplification/2026-09-14-legacy-agent-busy-shim-removed.md`。
- **L1 已修**:根 AGENTS.md 布局段收敛为指向 `packages/README.md`(唯一事实源),补 `apps/desktop` 与根 `examples/`;vitest coverage exclude 的 `packages/self-modification` 死条目删除。
- **L2 已修**:lsp `finalExtension` 收敛为包内模块(`src/extension.ts`,不再公共导出);workflow `WorkflowEventName` 取消导出;subagent `'unsupported'` 死变体已随上游删除。
- **L5 之 bridge-client 写路径泄漏已修**:同步 write 抛错现在 settle pending 条目并摘除 abort 监听(`packages/desktop/shell/src/bridge-client.ts`)。
- **合并新增债已清**:vendor/README.md manifest 版本表刷新(commit 列标 not recorded,下次 sync 按程序补录);`docs/event-producer-consumer(.md/.zh)` 再生(apiproxy→remotes/tool-cordis);fork CI 增补 `test:docs` 门禁;coverage exclude 登记 patent/synapse/self-evolve/ui-agent-preset(hygiene-gate note 第 3 项);ui-chat 两处 `it.skip` 恢复(skip-hardening 移植进上游 fold,AssistantMarkdown 加 textOf 兜底);桌面打包链修复(REQUIRED_BACKEND_PATHS 移除 apiproxy,apps/cli 显式声明 deploy 会丢弃的 9 个 peer seam 包,`package:desktop:prepare` 端到端验证通过)。
- **仍然开放**:H4、M3、M4、M6 余下、M8、L3、L4;sync note follow-up 1(ui-document-studio readFileText Remote 网关)与 2(synapse live-reply)。H6(恢复/中止文案)、H7(监听器 containment)、M1(util 小工具)与 M2(ResolvedConfig)已于 2026-08-30 全部收敛,H5(announcement 状态机)于 2026-09-14 收敛;**原语清单 6 项已全部落地**(emitContained、abort-race、util 下沉、recovery-vocabulary、ResolvedConfig、entry-lifecycle)。
- **hygiene 门禁现为红(既有,2026-08-28 确认)**:vendor rescope 的 6 处 exact-edit 漂移(agent-spine-demo README 双语 + cookbook 双语)、`ui-settings-models/onboarding-copy.ts` 的 6 条硬编码欢迎文案(需走 locale 字典)、3 个 client 包(synapse/ui-document-studio/ui-patent-teams)的 peer+dev 声明与 `verify-client-packages` 规则不一致。均为合并窗口遗留,文件未受本次清扫触碰,归入各自后续修复。

## 2026-09-11 更新(全仓复测 + Issue 关联跟踪)

复测基线 `dc50e9045f`。方法与逐条证据见 [全仓技术债务探查与 Issue 清单](../.agents/audits/2026-09-11-tech-debt-issue-manifest.md);该清单同时持有每条发现的 `file:line` 与拟建 issue 正文。本节的「Issue」列是本台账与 tracker 的唯一关联点。

### 已收敛(相应条目不再开放)

- **duplication 门禁**:08-30 的 28 克隆降为 **0 克隆**(462346 行),并已在 `ci-fork.yml` 纳入 CI——P1-1 的门禁红与「CI 盲区」同时消除。
- **P2-1** `llm-deepseek/src/translate.ts:171` 闭合联合已补 `assertNever`。
- **P2-4** `self-evolve-benchmark` 的 `BenchmarkId`/`CaseId` 已 brand。
- **P2-7** `packages/README.md` 组职责表已补齐(56/56),与 `packages/*/` 目录一一对应。
- **P2-8** `better-sidebar/src/pty-manager.ts` 注释已改指 `subprocess-local` 的真实 postinstall。
- **L1、L2** 根 AGENTS.md 布局段与 L2 三项死代码(`finalExtension`、`WorkflowEventName`、`list-children.ts` 的本地 `reason:'unsupported'`)均已处理。
- **M2** 13 处 `config as ResolvedConfig` 已由 `dsh-value` 的 `assertResolvedConfig` 收敛。
- **M6 部分**:`subagent/continuation.ts` 1569 → 550 行,可销案;`host/apiproxy` 已删除。

### 台账更正(本轮实测推翻原记录)

- **M1** 的「已收敛 / 0 剩余」**不成立**:`isRecord` 仍有 6 处本地定义、`asRecord` 5 处、`assertPositive*` 5 处(签名三方漂移)、`errorMessage` 简化版 4 处、`toError` 2 处、放宽语义的 `isENOENT`/`isEEXIST` 4 处,另有新族 `isAbortError`(5)、`hasExactKeys`(4)、`sleep`(9)。详表见 Issue #87。
- **M6** 的行数表大面积过期:仅 `continuation.ts` 收敛;`analyzer.ts` 3142 → 3235、`core/session` 1157 → 1281、`ptc.ts` 的 `createRunCodeTool` ~315 → 386、`acp` 的 `apply` ~310 → 341 均恶化,另有台账未载的新上帝文件(`client/connection/src/client/fixture.ts` 4052、`experimental/code-runtime-python/src/index.ts` 2441、`client/ui-trajectory/src/client/TrajectoryTable.tsx` 3208)。见 Issue #86。
- **M6 首个切口已落地**(2026-09-14):`experimental/code-runtime-python/src/index.ts` 2441 → 1801 行。字节计价与截断词汇落 `src/cost.ts`,日志台账落 `src/output-ledger.ts`(`class OutputLedger`);入口模块导出清单不变,无测试改导入路径,无快照移动。这是 Issue #86 拆分计划的批次 1 试点,其测得的拆分成本记在 `.agents/notes/implemented/simplification/2026-09-14-code-runtime-python-cost-and-ledger.md`,计划本身在 `.agents/notes/proposed/simplification/2026-09-14-god-file-split-plan.md`。M6 整体仍开放。
- **M6 批次 2 收尾已落地**(2026-09-14):`client/connection/src/client/fixture.ts` 2483 → 2288 行。`rpc` 派发表(六十条 `call` 臂加五条 `open` 臂,211 行)落 `src/client/fixture-rpc.ts`(`createFixtureRpc(deps)`);依赖清单 `FixtureRpcDeps` 留在入口,因为其成员类型就是入口自己的内部声明,搬到新模块会迫使十二个内部类型各自导出并补 JSDoc。`fixtureModelGroups` 及其两个 reasoning 常量随表搬走(`session/modelCatalog` 与 `llm/discoverModels` 的目录数据)。新文件不在覆盖率豁免名单里,由新增的 15 例 spec 覆盖到四项指标 100%,未新增豁免。见 `.agents/notes/implemented/simplification/2026-09-14-fixture-rpc-dispatch-extraction.md` 与 Issue #86。
- **M6 批次 3 首刀已落地**(2026-09-14):`core/session/src/index.ts` 950 → 904 行。三套增量折叠(`requestHeader`、`requestContext`、`deriveMessages` 及其六个私有缓存字段)落 `src/folds.ts`(`class SessionFolds`),按引用接收日志数组与 surface;入口保留三个同名一行委派,导出清单、`attachments` WeakMap 与 `@typert` 类型字符串均未变。新文件由既有 spec 覆盖到 100%,未新增覆盖率豁免。见 `.agents/notes/implemented/simplification/2026-09-14-session-folds-extraction.md` 与 Issue #86。
- **M6 批次 3 第二刀已落地**(2026-09-15):`core/tools/src/ptc.ts` 492 → 372 行。`run_code` 的每次运行调度车道(有序提交游标、独占屏障、并行上限、背压、唤醒顺序防御,116 行,原本全部内联在 `execute` 的闭包里)落 `src/ptc-dispatch-pool.ts`(`class DispatchPool`,176 行):构造只接 `{ maxParallel, isRunOver }`,入口用 `submit`/`track`/`drain` 三个方法接入,条目接口 `PooledDispatch` 的判别类型复用既有的 `ToolExecutionMode['kind']`。入口导出清单(`RUN_CODE_NAME`、`CodeRunFailedError`、`RunCodeBridgeOptions`、`createRunCodeTool`)不变,新模块不被包入口再导出,也未引入新的运行期依赖(只类型导入 `ToolExecutionMode`)。新文件不在覆盖率豁免名单,由新增的 `tests/ptc-dispatch-pool.spec.ts` 八例直接驱动该车道,四项指标 100%;`ptc.spec.ts` 的九个调度用例原样通过。六处变异(提交游标改取任一已结算条目、容量恒真、忽略并行上限、从不放弃排队项、去掉背压、排空不等附带工作)各被新 spec 的一至四例拦住。见 `.agents/notes/implemented/simplification/2026-09-15-ptc-dispatch-pool-extraction.md` 与 Issue #86。
- **M6 批次 3 第三刀已落地**(2026-09-15):`core/session/src/index.ts` 904 → 488 行。`Session` 对象(382 行)落 `src/session.ts`,连同 store 读写、必须与它同址的 `SessionEntry`/`attachments` 对;两条发布路径(`Session.append` 与 store 的 `announce`/`emitDisposed`/`flush`)共用的监听器分发 helper(`SessionCallback`、`collectSessionCallbacks`、`invokeContainedSessionObservers`)落 `src/observers.ts`。`@typert object` 类型字符串在 `SessionStore` 注册里逐字不变(承重的是 `tests/typert.spec.ts`,它跑真实注册表并解析该符号),`Context`/`Events`/`TypertLookupMap` 声明与整条 fork 路径留在入口,入口导出清单不变(`Session` 改为再导出)。两个新文件不在覆盖率豁免名单,由既有 15 文件 / 502 用例覆盖到四项 100%,无测试改导入路径。另需同步 `scripts/type-equiv.manifest.json` 的 `Session` 条目:该清单按文件定位符号,故其 `source` 由 `src/index.ts` 改为 `src/session.ts`。见 `.agents/notes/implemented/simplification/2026-09-15-session-object-extraction.md` 与 Issue #86。
- **M6 批次 3 第四刀已落地**(2026-09-15):`client/ui-trajectory/src/client/TrajectoryTable.tsx` 921 → 693 行。`renderedRecords.map` 回调里的整行渲染(255 行:该行的 ARIA 属性、十一个 `data-*` 属性、三个输入处理器、事件与内容两个单元格,以及请求边界控件)落 `src/client/trajectory-row.tsx`(344 行)的 `TrajectoryRow`(`memo` 组件)。为让 memo 比较成立,账本在 map 里先算出四个原语标记(`selected`、`sectionActive`、`timelineFocus`、`selectedRequestIdentity`)再作为 prop 传入,`requestBoundaryRuns` 也成为行 prop;`selectRequest` 与它依赖的 `activateTab`、以及 `TrajectoryView` 的 `toggleTurn`/`toggleAssistant` 改为 `useCallback`,使行 prop 在无关重渲中保持标识。行组件是该包 `RecordPresentation` 的唯一消费方,故 `tests/table-row.client.spec.tsx` 用只包装该呈现器的局部 mock 数行渲染次数:无关 prop 重渲后六个已挂载行零重渲;选中一行后恰好两行(选中行及其所在轮)重渲;`views.client.spec.tsx` 另加一例,切换时间线模式重渲视图而零行重渲。四处变异中,`memo` 换恒等函数、行 prop 变内联箭头、`toggleTurn` 去 `useCallback` 各被拦住,`onClearSelection` 变内联箭头拦不住——该 prop 无行读取,是守卫边界,已如实记录。该包 `src/*` 属既有 `TODO(gui)` 覆盖率豁免,新文件无需自建豁免。浏览器侧 `apps/web/tests/trajectory-virtualization.e2e.ts`(无密钥回放、真实 Chromium、构建产物)通过,覆盖选中、前插身份保持、挂载行上限与全部滚动范围。见 `.agents/notes/implemented/simplification/2026-09-15-trajectory-row-extraction.md` 与 Issue #86。
- **M6 批次 3 的 analyzer 前置件已落地**(2026-09-15):`typert/generator/tests/node-id-stability.spec.ts` 手写钉住 `allocateNodeId` 的全部同址位置(语法嵌套 18 处、Remote codec 单一作者节点 7 处、最多六个序号),每行写出「哪个类型拿到了该序号」。计划要求 analyzer 切分先有此测试,现已满足。四处变异验证守卫(union/array 移到成员之后分配、codec 的 object 移到成员之后分配 = 拦住;codec 闭包在查缓存前分配 = 拦不住,那些位置从未命中缓存),第五处(分支内求值顺序)按其设计不属于守卫范围:`convertType` 在函数顶部就分配。同时修正计划里该条目的过期计数(578 处出现中 282 个互不相同,非 294)。见 `.agents/notes/implemented/testing/2026-09-15-node-id-stability.md` 与 Issue #86。
- **M8 已收敛**(2026-09-14):点名项已逐项定性并收编。「shell seam 共享 `settingsNamespace('shell')`」的描述有误——实测 shell 用的是裸字符串 `SHELL_SETTINGS_NAMESPACE`,它属持久化格式键(改名即丢弃已存状态),判定保持固定。见下节与 Issue #88。
- **M9 已收敛**:原 `packages/api/remotes/src/agent-lookup.ts` 的 legacy agent-busy fence 已不存在。该文件在 2026-08-22 的 Session Controller refactor 中被删除,相关检查以 `session/agent-busy` 形式迁入了 `packages/api/session-controller/src/agent.ts`,旧错误码与 `ApiRemote*` 符号无残留;`SESSION_FORMAT_VERSION` 现已为 3。见 `.agents/notes/implemented/simplification/2026-09-14-legacy-agent-busy-shim-removed.md` 与 Issue #98。

### 本轮新增(台账与 08-30 审计均未载)

hygiene 门禁在 master 红(#78,`verify-package-dependencies` 3 条违规,源于 fork 的桌面侧栏改造)、一处未声明的工作区依赖(#82,`session-persistence-jsonl/src/win32.ts:17` 运行期值导入 `dsh-value` 但未声明)、26 处闭合联合缺 `assertNever`(#89)、10 个组 README 共缺 16 个包条目(#90)、src 内 63 处空 `.catch(() => {})`(#85)、硬编码参数新簇(#88)、测试可靠性族(#92)、死导出无门禁(#93)、`vitest.config.ts` 豁免理由错位残留(#91)。完整清单见上述 manifest。

### 台账条目 → Issue 关联

| 台账条目 | 状态 | Issue |
|---|---|---|
| H4 e2b 生命周期缺口 | 已收敛(余 5 处上游依赖 TODO,见 09-12 节) | #79 |
| H5 agent/session announcement 状态机双份 | 已收敛(2026-09-14,下沉为 `dsh-entry-lifecycle`) | #101 |
| M1 小工具复制流行病 | 已收敛(2026-09-14 收口,余下均为成文裁定的契约变体) | #87 |
| M3 settings 三个竞态 | 已收敛 | #80 |
| M4 hooks 桥行为缺口 | 修复就绪,待合并 | #81 |
| M6 上帝文件 | 开放(行数已更新) | #86 |
| M8 硬编码可调参数 | 已收敛(2026-09-14 逐项定性,余下均为成文裁定的固定项) | #88 |
| M9 legacy shim | 已收敛(2026-09-14,原 shim 已随 Session Controller refactor 删除) | #98 |
| L2 死导出与失效注释引用 | 已收敛 | #93 |
| L3 `types.ts` 含运行时代码 | 已收敛 | #99 |
| L4 terminal seam 错误风格 | 已收敛 | #100 |
| L5 其他低危 | 开放,仍只在本台账登记 | — |
| H1–H3、H6、H7、M2、M5、M7、L1、P1-1、P2-1、P2-4、P2-7、P2-8 | 已收敛 | — |

L5 的余下条目(魔法哨兵、`whenIdle()` 自旋、`isAborted` 平凡包装、identity 首启并发窗口、todo 双 schema 库混用等)保持台账登记、不单独立案:它们各自没有可独立评审的修复单元,合并成一个滚总 issue 又无法被单个 PR 关闭。

## 2026-09-12 更新(已闭合项归档 + 覆盖率门禁决定)

- **H4 已收敛**(#79,PR #104):`ready` 失败不再静默(落 `logger.warn`),teardown 按错误类型分类而非只识别 `SandboxNotFoundError`,publication 等待在取消时可终止。余下 5 处 `TODO(e2b-*)`(`e2b-status-watch`、`e2b-replace-environment`、`e2b-pgid-identity`×2、`e2b-terminal-setup-rollback`)的注释都以「等 E2B 上游能力」或「出现真实需求再补」为前提,不构成可独立评审的修复单元。
- **M3 已收敛**(#80,PR #105):`__proto__` 原型污染、注册 dispose 的 quiescence、replacement 后陈旧写提交三项竞态均已修复。
- **M4 修复就绪**(#81,PR #106):`SessionStart` 门控改为「被首个 step 消费才清除」,Stop 连续强制 continuation 有上限,`{"continue": false}` 成为运行级停止。
- **门禁红项修复**:`verify-export-jsdoc` 缺 `@param ctx`(PR #107);`docs/event-producer-consumer.md` 事件图过期(随 PR #106 重新生成)。
- **M1 第二批收敛**(#87,PR #110):`isRecord` 回升后的 4 处副本(`client/file-upload`、`core/session`、`goal`、`workflow/tool-ralph`)与放宽语义的 `isENOENT`/`isEEXIST` 3 处(`session-persistence-jsonl` ×2、`patent-teams` 的 `isEnoent`)全部改 import `@deepseek-ai/dsh-value`。严格版本要求真实 `Error`,非 Error 的 `code` lookalike 由「按码判缺」改为向上抛出;真实 fs 失败路径不变。`assertPositive*` 当时仍有 4 处未收(见 M1 行;其中 2 处可收敛副本于同日第三批收敛)。
- **决定(2026-09-12)**:fork CI 不纳入覆盖率门禁。`.github/workflows/ci-fork.yml` 以裸 `vitest run` 执行,逐文件 100% 只在上游 CI 与本地 `pnpm run test:coverage` 强制;fork 侧已知未达标的文件(如 `packages/e2b/subprocess-e2b/src/process.ts` 99.48%)不阻塞合并。
- **M1 第三批收敛**(#87,PR #111):`session-title/index.ts` 与 `sandbox-local/index.ts` 的 `assertPositive*` 副本改 import `@deepseek-ai/dsh-value`。前者所在包的 `normalize.ts` 早已 import 权威版本,消除同包自相矛盾;后者的 `sandbox-local: ` 诊断前缀移入 label,抛出类型由 `Error` 变为 `TypeError`(仍是 `Error` 子类,消息逐字不变)。至此 M1 的 `assertPositive*` 只剩 2 个刻意保留的语义特例。
- **M1 第四批收敛**(#87,PR #112):`asRecord` 此前只散落在消费方,本轮把它下沉进 `@deepseek-ai/dsh-value`(`isRecord(value) ? value : null`),收敛 `ui-chat`、`ui-trajectory`、`patent-core`、`patent-rule` 四处副本;`patent-rule` 的公开导出改为再导出,签名不变。README 增补该函数的用法与源码映射。
- **M1 口径更正**(2026-09-12):09-11 记的 `errorMessage` 4 处 / `toError` 2 处是按**函数名**匹配的结果,漏掉异名同义定义与内联调用点。按语义口径重测:本地函数定义共 21 处(第五批收 21),内联三元另 191 处(已登记为独立行,未收编)。
- **M1 第五批收敛**(#87,PR #113):把「抛出值渲染 / 规整」的本地函数定义族收干净——`errorMessage` 同义 16 处(4 处同名:`fs-local`、`ui-agent-preset`、`self-evolve-eval`、`workspace-controller`;异名 12 处:inspector `renderError`×5、`messageOf`×5、`errorLabel`、`errorText`)、`toError` 5 处(`test-support/client-runtime` + inspector `renderError(): Error`×4),并简化 `interaction/commands` 中 `error instanceof Error ? error.message : errorMessage(error)` 的冗余守卫(该文件早已 import 共享版)。`fs-local` 与 `directory-picker-browse` 两处 `/* v8 ignore */` 豁免随本地函数一并删除;`openviking` 的 `errorLabel`、`better-sidebar` 的 `messageOf` 改为再导出,对外签名不变。文案变化:非 Error 且带字符串 `message` 的抛出值由 `[object Object]` 改为其 `message`(先例见 2026-08-30 条)。
- **共享 `errorMessage` 已硬化**(#87,PR #114,第六批):其 `Error` 分支此前原样返回 `value.message`,而该属性在运行期可为任意值、返回类型却声明为 `string`。现改为按 `unknown` 读出后再 `String(...)` 转换(先读进 `unknown` 是为了不被 `no-unnecessary-type-conversion` 判为冗余转换;对 `string` 输入等价)。恶意 `Error.message`(抛出式 `Symbol.toPrimitive`、循环对象)由新返回值变为「固定占位符」或 `[object Object]`,不再把非字符串递给调用方。
- **M1 第六批收敛**(#87,PR #114):硬化后 `code-runtime-python` 的本地 `messageOf` 完全冗余(它要的两条保证——渲染不得抛出、必须得到真字符串——共享版都已提供),故整段删除改 import,8 处调用点与 1 处注释随之改名;该包 4 条断言里的本地占位文案 `<unrenderable rejection value>` 改为共享占位符 `[unrenderable thrown value]`,占位文案彻底统一。至此 M1 的抛出值渲染 / 规整定义族 21 处全部收敛。

- **测试可靠性(#92)之一:快照 harness 等待的确定性诊断**(PR #115):`packages/test-support/session-snapshot/src/harness.ts` 的 8 处持久化等待此前委托 `vi.waitFor(cb, { interval: 10, timeout })`;该库只在截止前已有尝试抛出时才重抛回调错误,于是首个探针仍在自己读日志时就被它自己的 `Timed out in waitFor!` 顶掉,既不说在等什么状态、也不说哪个 session。仓库里为此积累了两处绕行:产线 `waitForPersistedChildTurnEnd` 外套 try/catch 重抛带 `cause` 的诊断,测试侧 `isolateDiagnosticTimeout` monkey-patch `vi.waitFor` 以让 20ms 预算先跑一次回调;`titleDiagnosticTimeoutMs` 还按平台把预算抬到 5s。现改为共享 `waitForPersisted(probe, diagnostic, timeoutMs)`:探针是纯谓词,预算同时约束状态出现与探针卡住,读失败仍重试、截止时报告读失败本身。两处绕行与 Windows 分支随之删除,`harness.ts` 覆盖率回到 100%。触发记录:PR #114 的 CI 首跑即在 `waitForGoalPhase` 用例上出现该文案,同提交重跑即绿;新增用例覆盖「探针自身失败」分支。
- **既有红项:快照回放套件**(2026-09-12 实测,与本轮改动无关):`pnpm run test:snapshot` = 5 failed / 127 passed / 2 skipped,失败项为 `keeps a current-writer majority plus bounded declared historical migration coverage` 与四条 `replays …`(`system-prompt-in-history` ×2、`macos-tools-validation`、`subagent-tool-filter`);在合并基线 `3adac36997` 的干净检出上逐项一致。fork CI 只跑 `vitest run`,不含该套件,故长期未暴露。**已修复,见下条。**
- **keyless 快照回放套件修复**(PR #120,关联 #92):重测为 4 文件 14 用例失败,源自四处合法产品改动未同步 fixture——`todo_write` 新增 `tags`(`daebc0e82f`)、`SESSION_FORMAT_VERSION` 升到 3(`f7a6221158`)、`str_replace_editor` 退出默认工具集(`36a4665144`)、以及本轮 #83/#84 的客户端导出与 ACP 版本变化。按官方 keyless 路径 `test:snapshot:refresh` 再生期望(`macos-tools-validation` 在保留的 v2 代旁新增 `session.v3.jsonl`;refresh 对 `writer.expected.jsonl` 的纯时间字段重写已回退,避免无关噪声)。修 fixture 时又挖出两个真缺陷:① 该场景用 `persona` 配置 system-prompt 插件,而字段实为 `personaPrefix`——schema 非严格,未知键被静默剥掉,场景一直在断言组合从未组装的 persona;② ACP 会话转录存在竞态:`config_option_update` 公告排在 `session/new` 响应之外、会话一关闭即丢弃,于是以响应收尾的场景能否捕获公告取决于调度(同一次 refresh 前一次两行、后一次三行)。为此新增 `newSession` 步骤的 `waitForConfigOptionUpdate` 选项——**请求前**装等待、响应后 await(响应后才注册会错过已到达的公告,因为客户端不重放旧更新),七个会建会话的 ACP 场景全部启用,`reject-extra-dirs` 的会话被拒故无需。验证:回放连续三次 132 通过 / 2 跳过;refresh 两次产出的 ACP 期望逐字节一致;`session-snapshot` 单测 68 通过。**遗留**:该层仍不在 fork CI 内(CI 只跑 `vitest run`),同类漂移仍会累积;非严格插件 schema 静默吞掉拼错配置键的行为与 AGENTS.md「Misconfiguration fails loud」相悖,建议单独立项。
- **测试可靠性族其余项**(#92,commit `987397e1e9`,直接落在 master):四类。① **固定睡眠改状态等待**——`apps/desktop/tests/bridge-server.spec.ts` 的 20 处 20 ms 睡眠(全仓最大单簇)全部替换为等待帧:新增 `waitForFrame(predicate)`,失败时报出实际到达的帧;`beforeEach` 用白名单无副作用方法(`desktop/unregisterGlobalShortcut`)做往返就绪握手(桥接服务在 accept 回调里才挂上后端套接字,连接事件不构成「后续 `notify()` 会到达该客户端」的证据);无 id 帧的「不存在」断言无事件可等,改为在其后补发合法帧并断言帧总数(桥接服务按请求顺序作答,故对非法帧的回复必然排在前);`afterEach` 的固定等待取消,只留一次尽力而为的 `unlinkSync`(插桩发现 Node 在关闭监听时已自行 unlink,重试循环每用例白等 200 ms)。② **墙钟界定性**——`code-runtime-python/tests/runtime.spec.ts` 删除 3 处 elapsed 界:其「记录在案」断言是运行结局本身,消耗掉墙钟预算的运行会报告 `timeout`(或得到已定义的 `error`)而非被断言的取值,故这些界只可能虚假失败。保留的界各自写明所区分的两种结局与外层预算:墙钟截止对「否则永久运行」的程序、CPU 硬上限对墙钟天花板、`dispose()` 必须等满的宽限期、close 截止兜底对 setsid 孤儿的自行退出、`ui-primitives` 的回退工作量上限(实测约 60 ms 对 3 s 界,余量约 50×)、`better-sidebar/cov-host-git.spec.ts` 的 4 s 下界(即被测的 `DISCOVERY_TIMEOUT_MS`,定时器不会提前触发)、`ptc.e2e.ts` 的 5 s 上界(区分命令中途生效的中止与 `sleep 10` 结束后才生效)。③ **重试语义如实化**——`vitest.e2e.config.ts` 的 `retry: 2` 保留但注释改写:它重跑**任意**失败(含断言失败),因为真实 API 测试无法把自身期望与提供方区分开(一次运行共用一个内部 key,配额或提供方抖动包在它所破坏的那个断言里),收窄的 `condition` 正则表达不了这件事,并写明 keyless 快照层才是复现间歇缺陷之处。④ **静默跳过变可见**——`transform-corpus.spec.ts` 的无构建产物分支改发 `::warning::`(与 `sandbox-windows-acl` 探针跳过的做法一致)并把同一理由传给 `context.skip`,快照车道与 fork CI 之外再少一处「静默通过」。**登记**:`web-search-deepseek/tests/deepseek.e2e.ts:26` 的静态 `it.skip` 为有意停用的真实 API 探针(原位已有理由),记入本台账以免与「全仓无条件 skip 为 0」的结论相抵;确定性测试笔记的措施 3(nightly repeats + shuffle)单独立项为 Issue #121。**未能处理**:`better-sidebar/tests/cov-views-editor-host.client.spec.tsx` 的两例(审计在全量跑中失败、串行通过)——在 CPU 饱和(n-1 个 `yes` 占用)下连续 10 次运行、每次 18 用例全过,既无法复现也从失败信息指认不出被等待的状态,故不改代码、只登记该观测;`app-boot/tests/user-patches.spec.ts` 的 HMR 偶发已有 `eventually` 的负载诊断(报告已等待时长与 loadavg),该族无需改动。
- **组 README 包表缺口已补齐,并新增防漂移门禁**(#90,PR #116):十个组的 `README.md`/`README.zh.md` 各补 16 条包条目(`client/` 7、`util/` 2,`api/`、`bundle/`、`core/`、`host/`、`session/`、`test-support/`、`web/` 各 1),`host/` 的「All eight packages」/「Eight packages play the host roles」与 `web/` 的「Six packages play the web roles」三处计数措辞随中文对应句一并改为九与七。新增 `verify-group-readme-packages`(`doc-sync` 的 quick 叶门):按组比对 `## Packages`/`## 包` 段与该组目录下持有 `package.json` 的包集合,英文与中文各查一遍——配对门禁只把每一侧与其记录状态比对,发现不了「只加一侧」;跨组 `../` 目标归目标组所有而忽略,空扫描、缺段、组内无包均报错。此前 `hygiene` 各叶门与 `doc-sync` 都不读组内包表,故 16 条缺口长期无人发现。

- **空 `.catch(() => {})` 第一批**(#85,PR #117):按 issue 点名的两个聚焦包逐处判定——`core/agent-loop` 7 处、`subprocess/subprocess-local` 8 处,共 15 处。其中 4 处早有说明性注释(agent-loop 两个回滚 dispose、`setupAndPublish` 的回滚 dispose,以及 `spawn.ts` 的 range 观测),另 11 处补上注释,按五种形态写明「吞掉什么、为什么别的路径到不了」:setup 失败后的回滚(主错误交给调用方)、取消后弃置的句柄(调用方收到的是自己的中止,句柄无其它属主)、`finally` 中的 close(块的结局已定)、teardown 对自己正在终结的进程做 join(`waitForExit()` 才是 teardown 自己的证据并经 `allSettled` 上报,range 等待失败时句柄仍留在集合里待强制结束)、以及自身仍保留消费方的 promise 上的未处理拒绝防护(失败仍到达等待者,防护只避免噪声)。口径更正:实测 src 为 **62 处**(09-11 记 63 处);`总体评估` 的「零未注释空 catch」指 `catch {}` 子句(src 0 处、tests 10 处),`catch(() => {})` 从不在该断言的覆盖范围内。其余 47 处分布在 20 个包(subagent 桥、LSP stdio、OpenViking、e2b、浏览器 UI 等),按同一词汇逐批判定,#85 保持开放。
- **空 `.catch(() => {})` 第二批(收敛)**(#85,PR #118):剩余 47 处判定完毕。issue 点名的三包共 15 处,其中 `lsp/lsp-stdio` 实测已收敛(5 处全带紧邻理由:`connection.ts` 写明 `write()` 已记录失败并拒绝所有待决请求、`instance.ts` 写明握手拒绝不得在首个查询等待它之前浮出),`subagent/subagent-codex` 与 `memory/openviking` 也各有说明 2 处、3 处(构造函数里对 fatal promise 的防护、发布后 `processFailure` 的防护、`state.ts` 持久化尾注、会话启动 JSDoc),故这三包只需新补 5 处。按同一规则(理由须紧邻吞掉语句,含同行尾注)重筛全仓,又得 8 包 9 处——`llm-deepseek` 与 `attachment-local` 的上传/in-flight 清理、`plugin-market` 的流取消、`web/synapse` 的过期锁 unlink、`patent-document` 与 `patent-tools` 的临时文件、`terminal-bash` 的模拟器 teardown、`subagent-claude-code` 2 处(teardown join 与 `childProcessFailure` 防护)——一并补注。合计 13 包 17 文件 21 处注释(纯新增 41 行),归纳为六种形态:自身仍有消费方的 promise 上的未处理拒绝防护、没有观察者的 best-effort 工作、不得顶替主错误的清理、被弃置的请求或响应、teardown 对正在终结的进程做 join、没有上报面的 dispose。**无一处需要改行为**:判定结论是没有调用方能据以行动的失败,因此不引入日志也不传播。src 内 62 处至此全部自述,#85 关闭。
- **跨边界事实三处修正(收敛)**(#82/#83/#84,PR #119):① **未声明依赖**——运行期 `dsh-value` 的缺失声明已随 #110 落地,本轮处理类型导入:实测会进入公开 `.d.ts` 的只有 6 对,按各包既有惯例补声明(`patent-tools`、`mcp-client`、`api-settings-controller`、`tool-fs-search` 的 `dsh-util-values` 进 `dependencies`;`token-meter` 的 `dsh-attachment` 进 `peerDependencies` 并镜像 dev;`host-synapse` 的 `dsh-llm` 进 `dependencies`),其余类型导入故意不声明(类型不进产物,声明只会白加安装要求)。同时记录门禁边界:`verify-package-dependencies` 只挑选 client-faced 与 configured-host 包(66 个),纯 host 包不在其内;今日实测 `src` 内已无未声明的值导入。② **跨边界 id 打品牌**——`patent-teams` 新增 `src/ids.ts`(`PatentTeamsTeamId`/`PatentTeamsTaskId`/`PatentTeamsMessageId`/`PatentTeamsAttemptId` 与同名构造函数),载荷字段(`captainSessionId`、`memberId` 复用 `SessionId`)与 13 个发点一并改造,`captainSessionOf` 的裸 cast 随之删除;`desktop-seam` 新增 `MenuId`/`NotificationId`(两个事件载荷、`DesktopNotification.id`、`DesktopMenuItem.id`),shell 在 Electron 桥回传处打品牌;`ui-chat` 的 `ToolCallId` 改为再导出宿主品牌,`ui-tool` 在 `inspectCall` 处打品牌。三处各加编译期钉子(`ids.spec.ts`、desktop-seam 身份断言、`ToolCallId` 身份测试)。durable 团队文件与客户端节点的字符串表示保持不变。③ **ACP 握手版本**——`agentInfo.version` 由硬编码 `'0.0.1'` 改为读自身 `package.json`(与 dsh-llm 的 attribution 同法),bridge spec 新增断言把握手钉到 manifest。附带再生受影响的 catalog(acp 行号、客户端槽位 `ToolCallId` 引用、persistence 行号、desktop 子系统文档)并在 `gen-cordis-catalog` 的类型分类表登记两个新品牌。

## 2026-09-13 更新(lint 抑制理由门禁)

- **lint 抑制理由残留已清,并新增 `verify-suppression-reasons` 门禁**(#94,PR #122):按解析器口径重测受 lint 约束的语料,共 **400 条**抑制指令,其中 325 条行内写明理由、75 条由块标题承担;issue 记的 322/13/82 是 grep 行数口径(把字符串字面量里的指令文本与多行块指令的续行一并算入)。真正无理由的只有两处——`compaction-basic/src/region.ts:130` 的 `surfaceNodes[0]!` 与 `core/tools/src/testing.ts:30` 的 `options.execute`;第三处点名的 `session-query/tests/observation.spec.ts:115` 有理由,只是位于同函数体内上方 28 行。issue 另两条证据已过期:region.ts 其余 10 处均有注释,`:102`/`:547` 的两条双规则指令各有一行对应各自规则的理由。三处按各文件既有风格补紧邻注释(空 surface 提前返回与长度检查保证索引 0 在范围内、对象字面量 fixture 体不读 `this`、stub 原样转发注入的失败值)。**裁定块注释覆盖边界**:理由可写在指令上、`@ts-expect-error` 尾随文本,或充当该指令所在**空行分隔块**的标题——`defineTool` 7 处 `unbound-method`、`patent-teams` 3 处保存原方法同属一个事实,逐行重复只增噪音;JSDoc 文档块说明的是它前面的声明,不算理由;一条关掉多条规则的指令需为每条规则各写一处理由(评审层规则,理由是散文无法机检)。**新门禁** `scripts/verify-suppression-reasons.ts`:语法感知(逐行正则会误报 `oxlint-contract.spec.ts` 字符串字面量里的指令文本)、对空语料与「扫不到任何指令」双重设防、跳过三族指令都不出现的文件不做解析;只注册进 `ciSharedStaticGates`(静态与 hygiene 两份列表本就大量重复,再注册一处会让公共行越过 jscpd 克隆阈值,`duplication` 会报克隆)。15 个用例覆盖全部准入/排除形态,负控制(探针 spec 放一条裸指令)确认门禁以退出码 1 报出 `file:line`。**已记录的边界**:接受的形式以空行块为界而非相邻,故长函数体里离指令很远的标题也能满足门禁(`observation.spec.ts` 的 stub 即现成例子);要堵住须改用被否决的严格相邻规则(会把现有 75 条块标题全部改写)。验证:`verify-suppression-reasons` 400 条/0 发现、`run-gates.spec` + 新 spec 107 通过、受影响的三个包 552 通过、lint 0/0(4489 文件)、typecheck、duplication 0 克隆、`test:docs` 18/18、配对 1002 对、agent note 格式 487 篇。Agent Note:`.agents/notes/implemented/process/2026-09-13-lint-suppression-reasons.md`。
- **会话历史页大小的默认值收进显式解析**(#95,PR #123):`api/session-controller/src/history.ts` 的 `page()` 与 `follow()` 此前各自把 `request.maxMessages ?? DEFAULT_MAX_MESSAGES` 塞进 `paginate(...)` 实参(分别在方法内第 4、5 行),`follow()` 还在三处各自比较 `request.assistantStream === true`,两个入口都看不出实际生效的页大小。现按 AGENTS.md 的 request/spec 模板拆解:`resolveMaxMessages(value)` 承担默认值,`resolvePageRequest`/`resolveFollowRequest` 产出 `PageSpec`/`FollowSpec`,两个方法统一为「校验 → 解析 → 执行」;游标品牌转换(`SessionSeq`/`SessionLogOffset`)与 `assistantStream` 谓词一并移入解析器,执行路径只读已解析的值。校验器保持不动:它们守 Remote 线上边界、两种请求除 `maxMessages` 外校验的字段不同,且默认值不是部署配置——这与 `resolveMaxParallelToolCalls`/`resolveSessionListPageSize` 连校验一起做不同(后者的直接 `apply()` 调用方不经过 schema)。**同包复核**(issue 第二项交付):`DEFAULT_MAX_MESSAGES` 是本包唯一的 `DEFAULT_*` 常量,其余内联 `??` 判定保留并写明理由——`session.create` 的 `workspace?.path ?? request.cwd ?? this.defaultCwd` 是优先级链且默认值在方法开头解析(配置字段,未藏进所喂入的调用)、客户端把页大小写成请求字段(`PAGE_MESSAGES`/`JUMP_PAGE_MESSAGES`)而非依赖宿主默认、`SESSION_SEARCH_RESULT_LIMIT` 与 `SEARCH_PROVIDER_CALL_LIMIT` 是搜索路径的就地上限而非 `??` 默认(若需按部署变化属 #88)。行为不变:同默认值、同校验顺序、同错误文案。验证:包内 38 文件 742 通过、`history.ts` 逐文件覆盖率仍 100%(默认值两分支分别由省略与显式传 `maxMessages` 的用例覆盖)、lint 0/0(4489 文件)、typecheck、duplication 0 克隆。Agent Note:`.agents/notes/implemented/architecture/2026-09-13-session-history-request-spec.md`。

- **闭合联合 switch 守卫第一批,并裁定穷举 lint 选项**(#89,PR #124):按「解析器 + 类型检查器」口径重测全仓 `src` 中无 `default` 且 case 标签全为字面量的 switch,共 **69 处**——61 处字面量联合、8 处判别值为普通 `string`(后者 `assertNever` 不适用),issue 记的 26 处已过期。**裁定**:`.oxlintrc.json` 的 `considerDefaultExhaustiveForUnions` 保持 `true`——改为 `false` 会让全仓 **90 处**有意的「子集 + default」处理(以可合并扩展的 `SessionEventMap` 投影为主)全部报 `switch-exhaustiveness-check`;`assertNever` 的契约由编译器而非 lint 承担(`assertNever(value: never)` 只接受 `never`,新成员在调用点令 typecheck 失败,覆盖每个消费方构建)。**本批落地**:九处协议 switch 补 `assertNever`(session-controller 五处:Host 助手流累加器、Client 累加器、列表变更折叠、日志变更应用、日志变更翻译;ui-conversation 的会话窗口折叠;webworker-runtime 的参数分段与重定向子类型;inspector 的 `validateRemoteObject`),各带 `/* v8 ignore next -- closed-union backstop; ... */`(该 default 在构造上不可达);三处可扩展联合的 default 补就地理由(compaction 的 `eventDelta`、permission-presets 的引用不变闸门、summarizer 的 `finishError`——`FinishReasonMap` 的类型文档本就要求对未知种类落空)。**口径更正**:审计列为「void 静默面」的 `experimental/inspector/worker/inspection/network-store.ts` 实测并非缺守卫——`append` 在 `ingest` 之前就用 `topics`(`FETCH_TOPICS`)过滤掉未知 topic,故把边界写在那道过滤处,并用一个「更新版 worker 的 topic」用例钉住(该用例同时验证已捕获请求不被扰动),而非加 `default`。**遗留**:52 处字面量联合(10 个已声明 `@deepseek-ai/dsh-util-values` 的包 16 处、20 个未声明的包 36 处;host 包进 `dependencies`、client 包进 `devDependencies`)与 8 处开放判别值(需逐处裁定:收紧类型或写明落空)留下批,#89 保持开放。验证:七个受影响包 2409 通过、13 个改动文件逐文件覆盖率 100%、lint 0/0(4489 文件)、typecheck、duplication 0 克隆、`verify-package-dependencies` 66 包、`verify-suppression-reasons` 400 条零发现、翻配置实测 90 处报错。Agent Note:`.agents/notes/implemented/architecture/2026-09-13-switch-exhaustiveness-guards.md`。

- **闭合联合 switch 守卫第二批（收敛）**(#89,PR #125):按第一批记录的分类机械落地——52 处字面量联合中的 **51** 处各补 `default: assertNever(...)` 与同一句 `/* v8 ignore next -- closed-union backstop; ... */`,共 29 个包;19 个包新增 `@deepseek-ai/dsh-util-values` 声明(7 个客户端包由 `verify-package-dependencies --fix` 补,12 个手工补)并补上对应 tsconfig `references` 与 lockfile。**口径要点**:传给 `assertNever` 的是被 switch 的值本身而非判别属性——TypeScript 会把被 switch 的对象在 default 子句收窄成 `never`,属性访问在那里是 error 类型,`tsc` 与 tsgolint 的 `no-unsafe-argument` 都会拒绝(约 15 处须如此)。**第 52 处不落地**:`typert/generator/src/emitter.ts` 保留无 default 的 switch——根 `tsdown.config.ts` 会经 Typert 插件在任何 workspace bundle 产出之前导入该模块,共享 `assertNever` 会让干净构建中途去找 `dsh-util-values/lib/index.js`(CI 实测:该导入令 host 构建失败,去掉即通过),switch 保留编译器自身的穷举保证并就地写明该约束。**八处开放判别值逐处裁定**:`apps/desktop/src/bridge-server.ts` 收紧为字面量 `Set` 加 `method is DesktopBridgeMethod` 类型谓词,`dispatch` 对闭合联合全穷举并以 `assertNever` 收尾(尾部 `return undefined` 随之删除,白名单有项而无 case 现在编译期失败);其余七处写明边界不加 default(`core/session` 种子信封的六类、四处 `session-format-*` 迁移、`skill-filesystem` 布尔拼写落到 `TypeError`、`workflow-worker-thread` 的 `typeof` 八结果由语言固定且 `unknown` 不收窄为 `never`)。**顺带收敛**:`patent-teams` 的本地 `assertNever` 副本删除改用共享版;`docs/module-graph` 双语对再生时补上此前 #119 遗留未再生的 `token-meter` → `attachment` peer 边。验证:36 个受影响包 9989 通过;`pnpm run clean` 后重跑 `typecheck`(即抓出上述构建期问题的路径);完整 `test:coverage` 门禁 0 条逐文件阈值发现;lint 0/0(4489 文件);duplication 0 克隆;依赖门禁 66+57 包;`verify-suppression-reasons` 400 条零发现;`test:docs` 18/18;复扫候选 9 处(全为已裁定站点)。**登记**:完整覆盖率那次满载运行中另有两个无关套件超时——`util/http-proxy/tests/install.spec.ts`(本机 DNS 对 `origin.test` 黑洞化,该用例期望直连快速失败;该包只依赖 undici,不在本批改动内,隔离重跑同样超时)与 `boot/app-boot/tests/hmr-config.spec.ts`(隔离重跑通过,属 #92 记录的 HMR 负载敏感族)。本批落地后 #89 关闭。Agent Note 就地更新:`.agents/notes/implemented/architecture/2026-09-13-switch-exhaustiveness-guards.md`。

- **声明口径与豁免清单两处收口**(#99、#91,PR #126):① **#99(L3)**——实测 `packages/*/*/src/**/types.ts` 中 18 个文件含运行时代码(17 个接缝文件散布 13 个包 + `webworker-runtime` 的 Node builtin shim),另有 2 个只做转发(`shell/types.ts` → `DSH_ENV_PREFIX`、`jobs/types.ts` → `JobId`),而 `packages/AGENTS.md` 原文是「只放类型」。按 issue 允许的第二条路落地:规则改写为「声明本包接缝词汇——类型加上该词汇定义的运行时代码(brand 构造函数、本包错误类、常量、成员表、谓词),且绝不转发别的模块的运行期值」;两处转发移到入口(`shell/src/index.ts` 从 `@deepseek-ai/dsh-subprocess`、`jobs/src/index.ts` 从 `./brand.ts`),包根导入面不变,`shell-env`/`tool-bash`/`jobs-local`/`tool-jobs` 零改动;`vitest.config.ts` 里「types-only 文件没有运行时覆盖率」的说法改为如实陈述。② **#91**——7 条错位豁免逐条实测后处置:`client/modules/src/client/system.ts`(98.34% 行/91.66% 分支,补 5 个用例)、`ui-input-trigger/src/core/menu.ts`(98.83% 语句,`next === undefined` 改为带理由的 `/* v8 ignore */`)、`core/detect.ts`(96.77% 分支,删掉恒为 `'/'` 的 `char` 参数与其永不成立分支)、`test-support/client-runtime/src/translate.ts`(80% 行,补 2 个用例)四条豁免删除,现均 100%;`client/hmr/src/client/index.ts`(35.18% 语句/11.76% 分支)保留豁免并写明自己的理由(系统 SSE 通道 + Loader 条目替换,jsdom 车道打不开);`packages/extensions/*/src/**/*.ts{,x}` 两条无理由通配合并为一条并写明(该树从未进门禁、`tool-cordis` 的 src 由真实组合轮次 `apps/web/tests/cordis-tool-round.e2e.ts` 与录制会话触达、两份生成 catalog 归 `verify-cordis-api`/`verify-cordis-inspect-catalog`)。**顺手收敛**:`system.ts` 构造函数的重复 id 检查删除——`parseBootManifest` 已用同一诊断拒绝重复(`manifest.ts:239`),该类只经由先做解析的 `createClientModuleSystem` 构造,原先「覆盖」它的用例实际走的是解析器,现移入 boot-manifest 一节并改名,`BootManifest.modules` 写明解析器保证的唯一性。**未做**:其余约 90 条豁免未逐条重审(仍可能有过时理由,登记为后续批次);未新增「豁免必须带理由」门禁——本类失效是归属错误,存在性检查看不见,类别型 glob(`src/types.ts`、`bin.ts`、`worker.ts`)本就不带 TODO,理由记入 Agent Note。验证:两编译面 `typecheck` 通过;lint 0 发现;受影响 9 包 29 套件 556 用例通过;四个文件解除自身 exclude 后逐文件覆盖率实测 100%;`verify-module-graph` 三产物最新;`verify-translation-pairing` 1006 对;`verify-agent-note-format` 491 条;`verify-suppression-reasons` 400 条;`test:docs` 18/18。Agent Note 两篇:`.agents/notes/implemented/architecture/2026-09-13-types-ts-runtime-companion-boundary.md`、`.agents/notes/implemented/testing/2026-09-13-coverage-exemption-reasons.md`。

- **新发现:`doc-sync` 在 master 上 4 项红(与本批无关,已登记待单独开批)**:`doc-typecheck` 报 `.agents/notes/implemented/architecture/2026-08-15-desktop-shell-plugins.md` 第 60 行代码块 `TS2322: Type 'string' is not assignable to type 'MenuId'`(根因:#119 给 `MenuId` 打品牌);`doc graphs`、`config catalog`、`persistence catalog` 报 `docs/event-producer-consumer.md`、`docs/config-catalog.md`、`docs/persistence-catalog.md` 过期(根因:#119 改动 `desktop-seam`/`permission-presets`、#125 改动 `plan-mode`/`tool-str-replace-editor` 造成行号整体下移;重现生成差异后确认只有行号变化,且三份中文孪生文件同样过期)。fork CI 的文档作业只跑 `test:docs`(doc-quick 的 18 个叶门不含这 4 项),故上游合并后一直未被发现;修复需三份双语目录文档 + 一条笔记代码块 + 四份配对记录重录。
- **上述四项已修复(`doc-sync` 全绿)**(#127,PR #128):三份生成物按 `gen-config-catalog`/`gen-persistence-catalog`/`gen-doc-graphs` 重出,差异**只有 `Source:` 行号**——config-catalog 3 处(`permission-presets:144→147`、`plan-mode:64→65`、`tool-str-replace-editor:505→512`)、persistence-catalog 1 处(`plan-mode:47→48`)、event-producer-consumer 6 处(`desktop-seam` 六个事件)。笔记的 `ctx.desktop` 代码块按真实接缝补 `MenuId` 导入与 `MenuId('open-workspace')` 实参,同一笔记的载荷表 `{ menuId: string }` 一并改为 `{ menuId: MenuId }`(与 `docs/subsystems/desktop.md:134` 一致,后者已随 #119 更正)。**中文侧真值无人复核(本批最值得记的一条)**:生成器只写英文侧,`verify-translation-pairing` 只校验结构对齐与已记录 blob 哈希,不比对内容——实测 `docs/persistence-catalog.zh.md` 在英文侧早已更新之后仍独立残留 4 处旧指针(`core/session/src/types.ts:465`、`message-feedback/src/types.ts:53`/`:55`、`session-title-llm/src/index.ts:45`),无任何门禁报警;本批按英文侧为准逐处对齐(该文件 `:144→147` 等共 5 处)。四份配对记录重录。**复核口径**:新增一次性比对——取全仓 tracked 的双语对,比较两侧 `[`path:line`]` 指针集合;修复前仅 persistence-catalog 一对不等(差 4 处),修复后全仓 0 处不等,说明「中文侧指针集合 = 英文侧」这一不变量当前无例外,可机械化为 `quick: true` 的 doc 叶门。**未做**:未把该不变量升格为门禁——新增门禁需单独评审,不在修红 PR 内夹带,登记为 #127 的 follow-up。验证:`doc-sync` 36/36 通过(修复前 32/4)、`test:docs` 全绿、`doc-typecheck:contracts-ready` 98 块编译通过、配对 1006 对、`doc graphs`/`config catalog`/`persistence catalog` 三叶门 `--check` 复绿。本次为纯文档/生成物修复,无源码改动,故不附 Agent Note。

- **terminal seam 错误分类收敛**(#100,PR #129):口径定为「谁能对失败行动」——消费者据以路由的会话或服务状态走 `TerminalError` + `TerminalErrorCode`,调用方入参违规走 `TypeError`,调用方自身的取消原样保留其值。`TerminalErrorCode` 补 `SESSION_CLOSING`、`SESSION_EXITED`,于是五处裸 `Error` 归位:`terminal/src/index.ts` 的 `startSend` 关闭态(紧邻 `SEND_ACTIVE` 的上一行)、`registerBackend` 的空后端类型与 `spawn` 的空会话名(后者改 `TypeError`,消息同时由 `pty` 统一为 `PTY`),以及 `terminal-bash/src/session.ts` 的关闭态(发送与信号两处)与已退出态。`kill(owner, id, reason = 'model request')` 的硬编码默认值删除,`reason` 改必填并在 JSDoc 写明后端清理失败会逐字报告该文本;`tool-terminal` 显式传 `'model request'`,该工具的诊断文本逐字节不变。**前提更正(issue 第一项撤销)**:「同族包全带包名前缀、唯独它抛裸消息」经统计不成立——`terminal-bash` 12 裸/7 前缀、`subprocess-local` 31/5、`tool-terminal` 6/1、`fs-local` 0/1,裸消息本就是主流,故不做前缀统一;该结论已作为评论记在 #100。**测试**:两处空入参断言改为 `TypeError` 加精确消息,关闭与退出改为 `toThrow(expect.objectContaining({ code }))`;幂等 kill 用例原先把「省略 reason 时的默认值」钉成 `['model request']`,现改为断言调用方自己的原因到达后端——即被删除的那条契约由测试显式记录;两个持久 shell 套件里手写的后端替身此前抛裸 `Error('PTY session has exited')`,现改为与真实后端一致的 `TerminalError(..., 'SESSION_EXITED')`(该替身的注释自称「与真实后端完全一致」)。验证:两个改动文件逐文件覆盖率实测 100%;`pnpm run typecheck`、lint 0 发现(4489 文件)、`duplication`、`doc-sync` 全绿;`terminal`、`terminal-bash`、`tool-terminal`、`tool-bash-persistent`、`tool-pwsh-persistent`、`e2b`、`sdk-minimal`、`subprocess` 的套件通过。Agent Note:`.agents/notes/implemented/architecture/2026-09-13-terminal-failure-classification.md`。

- **死导出与失效注释引用收口,并补上 `.tsx` 门禁缺口**(#93):① **删除两处零引用导出**——`session-title-llm/src/index.ts` 的 `SessionTitleLlmConfigSchema`(把 `SessionTitleLlmConfigFields` 包进 `z.object`,而两个同族标题提供方各自用共享字段表拼装自己的对象,故它是字段表抽取的残留)与 `session-query-sqlite/src/index.ts` 的 `SESSION_QUERY_SQLITE_PATH_KEY`。后者牵出更大范围:`git log -S` 显示 `10bb9cbf4a`(移除 TUI 包与 legacy 入口)同时删掉了该键唯一的提供方(`hostCtx.provide(SESSION_QUERY_SQLITE_PATH_KEY, queryIndexPath)`)与唯一消费方(配置里的 `!!js launcherSessionQueryPath ?? './.sessions/session-query.db'`),因此与之配对的 `declare module '@deepseek-ai/cordis'` 中 `launcherSessionQueryPath?: string` 同样是无人读取的惰性键,且 `SERVICE_WALK_EXEMPTIONS` 把它的文档归属推给了一个从未描述它的 README——两处一并删除,豁免条目随之移除。**门禁耦合已实测**:先删 Context 键、暂留豁免,`verify-cordis-catalog` 立即以「names 'ctx.launcherSessionQueryPath' but no Context merge declares it; remove the stale exemption」报错;删掉豁免后 105 个生成文件/区域最新(该键不渲染进任何生成文档,故生成物零 diff)。② **修复三处失效引用**——`chunks/editor.tsx`/`chunks/terminal.tsx` 的 `docs/plans/2026-08-12-lazy-chunks-design.md`(本仓库无 `docs/plans/` 目录,全仓仅这两条注释引用它)改为指向包内真实归属 `chunk-loader.ts` 与 `tsdown.config.ts`;`tests/plugin-shape.spec.ts` 的 `packages/ui/jsonrpc`(`3fc35c91ff` 已将其改名为 `packages/sdk/server`)改为引用事后复盘 `docs/postmortem/0001-acp-default-export-drops-inject.md`——裸包路径没有任何门禁解析得到,正是本次要修的漂移模式,故不再新增一条。③ **`verify-doc-refs` 补齐 `.tsx` 并精确化取词**——`PATTERNS` 由 `packages/**/*.ts` 扩为含 `packages/**/*.tsx`(语料 3577 → 4049 文件),同时把「一条引用」定义为开出一个路径的记号:位于记号起始处的 `docs/…`/`.agents/notes/…`,或对仓库根解析的 `./`/`../` 链尾段。**这一步是必要前提而非顺手改动**:原取词会匹配任意更长路径中的形如文档片段,只补扩展名会误报两处夹具虚拟路径 `path: '/ws/docs/README.md'`(better-sidebar 的两个 markdown 渲染测试);以修复后的语料实测,旧取词 52 处匹配 → 新取词 50 处,**丢弃的正好是这 2 处误报、零新增**,11 处 `../../../../.agents/notes/...` 相对链引用全部保留(它们解析到仓库根,是有效检查)。`apps/**` **不并入语料**:`apps/web/tests/clickable-links-gallery.e2e.ts` 的 `docs/press.md`/`docs/guide.md` 是合成工具调用画廊的夹具工具参数,把它与引用分开需要单独规则,该边界写进取词模式的 JSDoc。**生成物随行号再生**:`session-query-sqlite/src/index.ts` 净删 10 行,`docs/config-catalog.md` 中该包 Config 的 `Source:` 指针随之 `93→83`(该文件唯一差异),中文孪生按英文侧手工同步——这正是 09-12 节记下的「生成器只写英文侧、中文侧指针无人复核」风险的又一次实例——两份配对记录重录,并复核两侧 `` `path:line` `` 指针集合一致。④ **不恢复死导出门禁**——`2026-08-19-remove-knip.md` 已是成文裁决(全仓静态未使用检查不在门禁内,且未来检查须理解 manifest 驱动的 Cordis 加载、生成产物与 Host/Client 分裂),issue 该项交付以「引用既有裁决」闭合,不新建机制。**新增门禁测试**:按 `verify-md-links.ts` 的既有惯例把门禁主体置于 `process.argv[1]` 守卫内并导出 `PATTERNS`/`isExcluded`/`findViolations`,`scripts/verify-doc-refs.spec.ts` 六条验收路径(语料含 `.tsx` 且仍排除 `vendor/`/`.d.ts`/构建产物、缺失目标报出、`../` 链对根解析且笔记消失时报出、具名路径分量跳过、以 `/` 开头的记号仍受检查)。验证:修复前跑该门禁只报两行 `.tsx`、零夹具路径,修复后 4049 文件全部解析;`pnpm run typecheck`;lint 0 警告 0 错误(4490 文件);受影响套件 88 通过;`verify-cordis-catalog` 105 项最新;配对 1008 对一致。Agent Note:`.agents/notes/implemented/simplification/2026-09-13-dead-exports-and-doc-reference-coverage.md`。
- **残留 peer 边逐条定性,`util/` 组描述对齐实况**(#96):① **选择器的四个 peer 保留**——`BACKEND_PACKAGES`/`SURFACE_PACKAGES` 装的是包名,本包对它们**零 import**,`apply` 用 `ctx.loader.create({ name })` 挂载解析出的那一对;Loader 解析裸说明符用的是组合根的 `baseUrl`(`vendor/loader/src/config/tree.ts:151-168`),故「挂载目标可解析」这件事只能由组合的清单承担——`verify-cordis-config` 从选择器扩展到这四个包(`scripts/verify-cordis-config.ts:436-437`,门禁注释写明理由:keyless Linux CI 只会解析到 `browse`,漏掉 `-native` 要到 macOS 启动才暴露)。这四个 peer 是同一要求的插件侧复述,与「本包 loader 组合套件真实 import 两个 Host 后端、为两个客户端面挂载 Loader 可见替身」并不矛盾;要求在包 README 新增的「组合必须声明什么」一节成文。② **`frontend-static` 的 `client-connection` peer 删除,只留开发依赖**——该边是一个空的仅类型 import,唯一作用是引入 `connection` 的 `Context` 合并(合并声明在 connection 包的 host 面 `packages/client/connection/src/rpc-host.ts:53`,本包 tsconfig 本就引用该面),服务本身经 `inject` 到达。**实测安装面**:删掉 `lib/tsconfig.tsbuildinfo` 与 `lib/types/index.d.ts` 后重新生成 host 面声明,`index.d.ts` 中 `dsh-client-connection` 出现 **0 次**;`pnpm install --lockfile-only` 在改动后仍报 `Already up to date`。依据 `2026-08-26-published-dependency-faces.md` 的成文条款(「仅类型 import……与既有纯元数据 peer……只放 `devDependencies`」),并与消费同两个服务的 `api/gateway`、`open-in-app` 一致(两者早已 dev-only);源码里的合并 import 补上同族包都有的那句注释。③ **`sdk/server` 的 `llm-deepseek` peer 保留**——它既是值 import 又是被挂载的插件,只在没有任何适配器负责该路由时挂载(`src/server.ts:150-153`);适配器选择属于组合(随包发布的 `sdk-minimal` 自己组合 `llm-deepseek` 行,`packages/bundle/sdk-minimal/cordis.patch.yml:26-27`),锁进 `dependencies` 等于把某个适配器钉进每次安装,故留在 `peerDependencies` 并在 README 写出理由。④ **`util/` 组描述改按实测**:旧行称「无运行时依赖,仅不变量伴随 peer」,实测该组运行期依赖全集仅 `zod`、`undici`、`dsh-util-values`(分别落在 `chunked-list`、`http-proxy`、`output-retention`/`value`),且全组无一把 `dsh-invariants` 声明为 peer(唯一提及它的 `http-proxy` 是 devDependency);中英两行同步改写。**未做(登记)**:同一「仅类型 + 仅服务」类别的 `host-webserver` peer 还散布在另外六个未被依赖策略覆盖的包里(`directory-picker-auto`、`experimental/inspector`、`experimental/webworker-runtime`、`memory/openviking`、`web/synapse`、`webhook/webhook-github`),一次扫掉属策略扩展、影响面自成一体会,不在本 issue 范围;插件侧 peer 列表本身无门禁(组合侧由 `verify-cordis-config` 负责),这一不对称正是把四个名字写进 README 的原因。**生成物随边消失**:`docs/module-graph` 三产物(`.md`/`.zh.md`/`.i18n.yaml`,该生成器双语同写)再生,差异只有 mermaid 里的 `pkg_host_frontend_static --> pkg_client_connection` 这条边与其表行的 `client-connection` 项——这也顺带证实模块图渲染的正是 peer 边;`docs/config-catalog.md` 因新增注释行再生(该包 `Config` 指针 `30→31`,中文孪生手工同步、配对重录)。验证:host 面重新生成声明后 `dsh-client-connection` 出现 0 次;`verify-cordis-config` 152 个配置通过;`verify-package-dependencies` 66 包;`typecheck`(host + client 两编译面)通过;lint 0 警告 0 错误(4490 文件,90 规则);`duplication` 0 克隆;`test:docs` 18/18;`doc-sync` 36/36(含 `verify-module-graph` 三产物最新);`hygiene` 16/16;受影响三包 57 用例通过;`pnpm-lock.yaml` 未变;配对 1009 对一致。Agent Note:`.agents/notes/implemented/architecture/2026-09-13-peer-declaration-classes.md`。

## 2026-09-14 更新(M1 收口:三处残留副本 + 四族成文裁定)

- **M1 复测并收口**(#87):按 `7a031dcbe8` 逐族复测 09-11 清单(该清单的行号与数量均已漂移,多数族已在 #110–#114 收敛),`packages/*/*/src` 内的真残留只剩三处,全部收编:① `client/ui-tool/toolviews/ask-question-row.tsx` 的 `isRecord`——与权威版逐字同形,09-12 批次只收了它当时列出的 5 处却记下「0 剩余」,本包因此漏到现在;② `client/ui-chat/chat/ContextBody.tsx` 的 `asRecord`——同包 `conversation-nodes/event-projection.ts` 早已 import 权威版,自相矛盾消除;③ `core/session/src/surface.ts` 的 `isDeepEqualJson`。两个客户端包按依赖政策把 `dsh-value` 记进 `devDependencies` 并补 tsconfig reference(与 `ui-chat`、`file-upload` 既有处理一致);`core/session` 早已声明 `dsh-util-values`,无需新增依赖。
- **收敛第三处时挖出共享版的一个真缺陷**:`dsh-util-values` 的 `deepEqualJson` 用 `key in right` 判定键存在,而 `in` 会命中继承名——`JSON.parse('{"__proto__":{}}')` 造出的是**自有** `__proto__` 数据属性,`right['__proto__']` 于是读成 `Object.prototype`(自有可枚举键为 0),递归在空键集上恒真,`{"__proto__":{}}` 与 `{"other":1}` 被判相等。受影响的不只是会话面:`settings` 与 `settings-file` 用它做「配置是否变化」的闸门,误判相等会静默丢弃一次写入。现改为 `Object.hasOwn(right, key)` 并把该保证写进 JSDoc 与 `dsh-util-values` 双语 README;新增 `packages/util/values/tests/values.spec.ts`(该包此前没有任何测试文件)钉住「自有 `__proto__` 键 vs 缺失该键」用例,旧实现下它以 `expected true to be false` 失败。**本地副本原本是对的**(它用的就是 `Object.hasOwn`),错的是它留下的理由:「替代 `node:util` 的 `isDeepStrictEqual` 以保持本模块浏览器安全」——该模块早已 import 同层 `dsh-value` 的 `isRecord`,且 `dsh-util-values` 零 `node:` 导入、本就是该包依赖;`2026-07-26-dependency-swaps-rejected-by-nih-audit` 否决的是引入 `fast-deep-equal` 这类**外部**包,与本轮改指仓内包不冲突。
- **四族维持不收敛,并逐处写明理由(此前或缺、或记错)**:① `sleep` 复测为 4 处同形定义(`patent-core/graph/node-policy.ts`、`patent/tool-literature/runtime/http.ts`、`patent/patent-teams/state.ts`、`workflow/workflow-worker-thread/host.ts`)+ 1 处接受 `AbortSignal` 的变体(`client/connection`)+ 3 处测试内定义,维持 09-12 的「暂不下沉」。② abort-race **更正**——「e2b `withinMs` 已随上游消失」不成立,它仍在 `subprocess-e2b/src/process.ts:83`(超时竞速、超时 resolve `undefined`,是查询语义;真正消失的只有 `waitWithSignet`);同批复测到 4 处本地 `abortable`(`lsp-stdio/src/abort.ts`、`deepseek-llm-api-extensions`、`web-search-deepseek`、`api/gateway/client/remote-events`)与 3 处 `waitWithAbort`(`skill`、`session-query-sqlite`、`session-persistence-jsonl`),差异全是对外契约(分类后的 abort 值、`WEB_ABORTED` 域错误、竞速后再查一次信号、值或 promise 入参、`Error` 逃逸规整),判为保留。③ `assertPositive*` 补记第三个变体:`dsh-subagent` 公开导出的三参 `assertPositiveFinite(prefix, name, value)`(前缀分离、抛 `Error`),由 `subagent-claude-code`、`subagent-codex`、`subagent-dsh-sdk` 消费,可机械收敛但改的是公开导出与三处抛错类型,单独立批。④ `errorMessage` 内联三元裁定**不推进**(复测 188 处、`return` 形态 15 处,理由见 M1 行),该待决项不再挂在 #87 上。
- **范围外并记录**:`apps/` 与 `scripts/` 各有 10 处 `isRecord`(`scripts/client-build-environment.ts` 另有 `hasExactKeys` 两参变体),判为不计入收敛面(应用外壳与仓库工具内部的单行收窄谓词,不在发布面)。另折叠上一批遗留的一条:`api/session-controller` 的 `client-connection` 同时是 peer 与 dev、且只被一个空的类型 import 引用,该包声明了 `dsh.client` 又不在依赖政策作用域内,其 peer 属元数据而非挂载目标,与 #96 裁定的四个选择器 peer 同类,保留。
- **新发现(与本批无关,已单独立项)**:验证过程中 `pnpm exec vitest run scripts/` 在干净 master 上复现红(2 失败,均为 `ENOENT: .../oxlint-contract-<uuid>.ts`)——`scripts/oxlint-contract.spec.ts` 把探针文件写进真实包 `src` 目录,而 `scripts/gen-client-catalog.spec.ts` 与 `scripts/verify-application-entrypoints.spec.ts` 会遍历全仓并逐个 `open`,列目录与读取之间探针被删即抛错。已用 `git stash -u` 在干净树复现(每次 uuid 不同,是竞争而非残留文件),整仓 `vitest run` 这一次未命中(调度不同)。见 #132。另有一处**非仓库缺陷**需记明:以 `npx vitest run` 调用会让 `npm_execpath` 指向 npm,`ui-sidebar-documentpreview` 的打包用例据此改调 `npm pack --json`(返回数组而非对象)而失败;改用 `pnpm exec` 即通过,仓库约定本就是 pnpm。
- 验证:受影响四包 66 套件 1268 用例通过;`pnpm run typecheck`(host + client 两编译面)通过;lint 0 警告 0 错误(4491 文件,90 规则);`duplication` 0 克隆;`test:docs` 18/18;`hygiene` 16/16;`verify-module-graph` 三产物最新(新增的 client `devDependency` 不产生模块图边,与 09-13 的 peer 边结论互补);`verify-package-dependencies` 66 包;`verify-client-packages` 57 包;`verify-package-paths` 5569 文件;`verify-doc-refs` 4050 文件;`verify-md-wrap` 2024 文件;`verify-agent-note-format` 495 篇;配对 1010 对;`pnpm-lock.yaml` 仅 +3 行(ui-tool 的 devDependency)。Agent Note:`.agents/notes/implemented/architecture/2026-09-14-local-helper-copy-rulings.md`。

## 2026-09-14 更新(H5 收口:announcement 状态机下沉为原语包)

- **H5 复测并收口**(#101,PR #134):两侧的状态机确认仍逐字同形,且真实共享面比 issue 记的更窄也更清楚——共用的是「认领唯一创建边 → 同步派发窗口内的移除延后 → 只对已公告条目发出配对销毁」这一条规则,差异只在窗口个数(session 多一个 append 发布窗口)。下沉为 `packages/util/entry-lifecycle`(`@deepseek-ai/dsh-entry-lifecycle`,零依赖、无服务、无事件):`announce(subject)` 认领创建边并打开它的派发窗口;`endAnnouncement()`/`endDispatch()` 关闭窗口,并在「移除请求已存在且再无窗口」时返回 true 让调用方执行移除;`detachCapability(remove)` 是两侧都交出的那个一次性移除能力;`hasOpenDispatch` 是「自身发布不得重入」的守卫。两条原本两处各写一遍的事实因此回到单点:公告拒绝句子 `` `${subject} was already announced` ``(subject 由调用方给,如 `agent "<id>"`),以及「窗口关闭后由谁执行移除」的判定。
- **两侧保留的部分**:存储成员关系、`scopeTarget` 载体、事件名与 payload、session 的 `attachments` 映射、`agent/disposed` 与 `session/disposed` 的发出各留在原包;`SessionEntry` 只把 `detach` 留作 `Session.append` 到服务之间的桥。会话侧的 `appending` 换成一对 `beginDispatch`/`endDispatch`,重入守卫改读 `hasOpenDispatch`——与原 `appending` 同条件,因此**在 `session/created` 监听器内部追加**这一既有行为不变(此处刻意不用「任一窗口打开」当守卫,那会把它变成抛错)。agent 侧的三处旗标与延迟分支、两侧的一次性闭包全部删除。
- **为什么不寄宿 `dsh-scope`**:该包 `store.ts` 虽已是注册表原语的家(`NamedEntries`/`AnonymousEntries`/`ScopedLayers`),但本状态机与 scope 无关,而 `dsh-scope` 是稳定核心包;共享机械原语按既有惯例落在支援级 `util/` 组,与 H7 的 `dsh-contained-emit` 同组同形。
- **新增包接入面**(后续同类批可直接照此清单):`packages/util/entry-lifecycle`(package.json、tsconfig、src、tests、README 双语 + i18n 记录)、`tsconfig.base.json` 与 `tsconfig.base.host.json` 两处 paths、`tsconfig.host.json` 的 references、两个消费包各补 `dependencies` 与 tsconfig reference、`packages/util/README.md`/`.zh.md` 包表行、`scripts/doc-standard.spec.ts` 的 `PACKAGE_LIBRARIES` 条目、`scripts/verify-package-readme-model-experience.ts` 的短句式允许清单(`kind: 'none'`)、`docs/config-catalog.md` 与其中文孪生条目、`docs/event-producer-consumer.md` 与其中文孪生指针、`docs/module-graph` 三产物、lockfile。
- **依赖归类按包级而非导出级**:[`2026-08-26-published-dependency-faces`](../.agents/notes/implemented/process/2026-08-26-published-dependency-faces.md) 的条款适用于本包——`EntryLifecycle` 实例自包含、无 `instanceof` 跨包比较、模块无模块级状态,即「已无包级身份或状态要求」,故进 `scripts/package-dependency-policy.ts` 的 `duplicateSafePackages`(包级);导出级 `safeHostDependencyExports` 表按该文件自身的规定**不许自动代理添加**,本次未使用。连带事实:`scripts/verify-package-dependencies.spec.ts` 显式钉住该名单,新增归类必须同步更新那条断言(否则该 spec 红)。
- **两处约定陷阱(本批实测踩到,值得记)**:① `docs/config-catalog.zh.md` 是**手工**维护的孪生——生成器只写英文侧,新增包后中文侧必须同步补行,否则配对门禁以「list item 数 / link target 不一致」报错;② 配对门禁对**代码块逐字节比对**,中文 README 的代码块内注释须保持英文(与 `util/value` 双语 README 的既有做法一致),否则报「code block #1 diverges」。
- **一处 lint 反馈**:接口成员写成 `detach(): void` 时,把 `entry.detach` 当回调传入会触发 `typescript(unbound-method)`;改为属性 `readonly detach: () => void` 即消除,且与构造处的箭头函数写法一致。
- 验证:两侧受影响包加新包加依赖名单 spec 共 48 套件 1068 用例通过(含新包 11 项,覆盖重复公告的逐字拒绝、无窗口时立即移除、跨公告 / 跨一个派发 / 跨两个嵌套派发 / 嵌套于公告内部的派发四种延迟、一次性能力与被消费的请求);新包逐文件覆盖率实测 100%(statements 100 / branches 100 / functions 100 / lines 100——fork CI 不含覆盖率门禁,故该项只能本地实测,结论见 2026-09-12 的覆盖率决定条);`pnpm run typecheck`(host + client 两编译面)通过;lint 0 警告 0 错误(4493 文件,90 规则);`duplication` 0 克隆;`test:docs` 18/18;`doc-sync` 36/36;`hygiene` 16/16;`verify-package-dependencies` 66 包(第 1 次红即「未归类」,按包级归类后转绿);`verify-module-graph` 三产物最新;`verify-config-catalog` 最新;`verify-doc-graphs` 随 `docs/event-producer-consumer` 行号再生转绿;配对、`verify-agent-note-format`(496 篇)、`verify-package-paths`、`verify-doc-refs`、`verify-md-wrap` 全绿;`pnpm-lock.yaml` 随两个消费包的新依赖更新。
- **完整 `vitest run`(fork CI 口径)两次本机运行各出现 1–3 例负载敏感失败,均与本批无关**:`packages/client/better-sidebar/tests/smoke.spec.ts` 的 pty zombie 三例与 `packages/boot/app-boot/tests/hmr-config.spec.ts`(后者是 09-13 已登记的 HMR 负载敏感族);两次运行的失败集合互不相同(第一次的 better-sidebar 在第二次未复现、第二次的 app-boot 在第一次未出现),且**隔离复跑两个文件 59 用例全过**。两处均不在本批改动面内(pty 管理器与 HMR 配置父目录观察)。Agent Note:`.agents/notes/implemented/architecture/2026-09-14-entry-lifecycle-primitive.md`。

## 2026-09-14 更新(M9 收敛:legacy agent-busy shim 已删除)

- **M9 复测并收口**(#98):台账记录的 `packages/api/remotes/src/agent-lookup.ts:83` legacy agent-busy fence 已不存在。该文件在 2026-08-22 的 Session Controller refactor(`d26acfa2e3`)中被整体删除(211 行),其 subagent ownership 检查随后在新的 Session Controller 中以当前 RemoteError 词汇重新实现为 `session/agent-busy`。
- **消费者验证**:当前代码树中无旧错误码 `'agent-busy'`(不带 `session/` 前缀)的引用,也无 `ApiRemoteLookupError`、`ApiRemoteAgentResult`、`createApiRemoteAgentResolver` 等旧符号的引用;旧类型与旧错误码均未进入当前 API catalog 或任何生产代码/测试。历史会话格式迁移(`session-format-v0-to-v1`、`session-format-v1-to-v2`)与 `session-persistence` 的 storage contract 均未保留该 fence。
- **当前设计定位**:现在的 subagent ownership fence 位于 `packages/api/session-controller/src/agent.ts`(`hasApiSessionSubagentOwner`、`apiSessionSubagentOwnershipError`),返回 `RemoteError<'session/agent-busy'>`,是 `docs/api-gateway.md` 与 `docs/subsystems/session.md` 中记录的普通会话 resolver 契约的一部分,不是遗留 shim。
- **结论**:M9 无需删除任何源码(删除已发布),也无需设定未来复审条件。台账、manifest 与 Agent Note 同步关闭。Agent Note:`.agents/notes/implemented/simplification/2026-09-14-legacy-agent-busy-shim-removed.md`。

## 2026-09-14 更新(M8 收尾:硬编码可调参数逐项定性)

- **M8 逐项定性并收口**(#88,PR #140):15 个模块级常量按 AGENTS.md「No hardcoded tunables in plugins」逐条判定——随部署而变的取值属可从 `cordis.yml` 变更的、经校验的 `Config` 字段,协议常量、外部规格、安全不变量与内部节奏保持固定,而 `DEFAULT_*` 常量本身不等于可配置性。结论:仅 `SYMLINK_PROBE_CONCURRENCY`(`client/better-sidebar/src/fs-tree.ts`,一次目录列举中并发的符号链接探测数)够得上「部署相关」候选,按「Require evidence for public choices」维持固定并写明依据(当前无使用方需要别的上界,该路径又是人机交互路径);其余 14 个无需改动源码。
- **已可配置者不算缺陷**:两个 `DEFAULT_STREAM_IDLE_TIMEOUT_MS`(`llm/llm-deepseek/src/index.ts`、`llm/llm-pi-ai/src/config.ts`)各自与所在包 `Config` 的 `streamIdleTimeoutMs` 配对——schema 给默认值、显式的 `resolveAdapterOptions`/`resolve` 步骤在全字段可选的接口上做 `??` 回退,正是 AGENTS.md 的 request/spec 模板。其余为持久化格式键(`SETTINGS_NAMESPACE`、`SHELL_SETTINGS_NAMESPACE`,改名即丢弃已存状态)、安全不变量(`FAIL_LOUD_RELEASE_TIMEOUT_MS`:卡住的 disposer 只能推迟致命退出、绝不能取消它)、内部节奏(`ZSTD_DECODE_YIELD_INTERVAL_MS`、`ELU_POLL_INTERVAL_MS`,两处注释本就写明不是部署配置)与产品可见上限(`SESSION_SEARCH_RESULT_LIMIT`,已导出并有文档)。
- **5 处固定项补写定性依据**:`STDERR_TAIL_LIMIT`、`STREAM_SETTLE_MS`(`sdk/client/src/client.ts`)、`MAX_MISSED_HEARTBEATS`(`api/gateway/src/stream-server.ts`,乘在已配置的 `heartbeatIntervalMs` 上、只计数窗口内的帧)、`SEARCH_PROVIDER_CALL_LIMIT`(`api/session-controller/src/list.ts`,防一次性查询触发过多取内容的预算,与 `SESSION_SEARCH_RESULT_LIMIT` 分工)、`SCROLLBACK_PAGE_LINES` 与 `POLL_INTERVAL_MS`(两个 persistent 工具)。此前它们确实固定却无一处说明理由,读者无法区分「斟酌过的固定值」与「从未审视的值」。
- **修复一处 issue 未点名的对称性缺陷**:`shell/tool-bash-persistent` 与 `shell/tool-pwsh-persistent` 把 `backendType`、`timeoutMs`、`maxOutputChars` 的默认值以裸字面量写了两遍(schema 一次、`apply()` 的 resolve 步骤一次),而同一对象字面量里的 `DEFAULT_DESCRIPTION` 早已抽取为常量。两个包各抽取 `DEFAULT_BACKEND_TYPE`/`DEFAULT_TIMEOUT_MS`/`DEFAULT_MAX_OUTPUT_CHARS`,schema 默认值与解析结果共用同一来源。
- **前台超时默认值横向不对称的依据**(前次要求):本地执行器(`bash-local`/`pwsh-local`)为 `120_000`、persistent 工具为 `300_000`,差异是结构性的——`tool-bash`/`tool-pwsh` 不自持默认值,只在模型给出 `timeoutMs` 时透传,否则落到执行器的 `resolve()`(`clampTimeout(request.timeoutMs, config.timeoutMs, config.maxTimeoutMs)`),该值是「兜底值 + 上限」;persistent 工具经 `ctx.terminals` 驱动长驻 PTY、不走 `run()` 路径,底下没有执行器的 `resolve()`,必须自持截止时间(`deadline(upstream, config.timeoutMs, TIMEOUT_CODE)`)。两者都是各自包的 `Config` 字段、仍可从 `cordis.yml` 变更,不对称反映的是两种不同契约,而非同一选择的重复。
- **行为零变更,验证**:两个 persistent 工具的 schema 默认值与解析结果不变、其余常量取值不变;`pnpm run test:docs` 18/18(含 agent note format、agent note classification、translation pairing);受影响 6 包 `vitest run` 205 文件、2865 通过 / 6 跳过;`pnpm run typecheck` 通过,pre-push hook 复跑通过。Agent Note:`.agents/notes/implemented/simplification/2026-09-14-hardcoded-tunable-closeout.md`。

## 总体评估

项目纪律基线很强,债务主体不是「脏代码」而是「跨包重复与文档化的已知缺口」:

- **src 零 `any`、零 `@ts-ignore`、零未注释空 catch**(35 处 ts-ignore 全部在 tests)
- 每个包都有 `./invariant`,依赖方向干净(util 全零依赖、无 spine 反向依赖),内部依赖全部 `workspace:^` 无版本漂移
- 生成文件(api-catalog.ts 等)有 freshness gate,非债务;lib/ 构建产物未被 git 跟踪
- 模范实现:`sdk/protocol/src/transport.ts`、`sdk/client/src/dispose.ts`、acp quiesce、session-persistence per-session 串行链与 retire drain

债务集中在四类:**① 跨包复制**(小工具、状态机、文案、containment 循环);**② 文档化但未修的缺口**(TODO 共 59 处,其中约 15 处是真实并发/边界缺陷);**③ 上帝文件**;**④ 文档漂移**。

---

## 高严重度(7 项,均已验证)

### H1. Web seam 的 Config schema 与其契约矛盾:env fallback 不可达

- **位置**:`packages/web/web/src/index.ts:80-83`(schema)、`:92-93`(构造函数)、`:55-60`(接口)
- **问题**:接口与 JSDoc 声明 `searchProvider`/`fetchProvider` 可选,且 `$DSH_WEB_SEARCH_PROVIDER`/`$DSH_WEB_FETCH_PROVIDER` 是等价回退;但 schema 是必填 `z.string()`。Schemastery 在构造前校验,缺字段直接失败,构造函数里的 `?? process.env.DSH_WEB_SEARCH_PROVIDER` 永远执行不到。文档承诺的 env 驱动部署模式会在 boot 崩。
- **修复**:schema 改 `.optional()`(接口与回退逻辑已按可选写)。

### H2. llm-deepseek wire 边界 JSON 解析后无结构校验

- **位置**:`packages/llm/llm-deepseek/src/translate.ts:120-127`
- **问题**:`JSON.parse(payload) as WireChunk` 只捕获语法错误,类型断言后直接消费。provider 返回 `{"choices": "x"}` 时 `for...of` 逐字符迭代产生垃圾块;`delta` 非对象时字段静默变 `undefined`。畸形内容流入流组装与 session log,而不是产生带码错误——违反 AGENTS.md「wire 边界必须校验」铁律。同仓 `api/gateway/src/index.ts:640`(`assertJsonValue`)与 `hooks/hook-protocol/src/codec.ts` 都做了结构化校验,唯独这里没有。
- **修复**:对 `WireChunk` 做结构化校验(对照 `assertJsonValue` 先例),失败抛 `LlmError(MALFORMED_RESPONSE)`。

### H3. settings 脱敏对 union/transform 分支静默放行 secret

- **位置**:`packages/settings/settings/src/redact.ts:86-91`
- **问题**:`redactSecrets`(`settings.describe({redactSecrets:true})` 用于 UI/诊断输出)对声明在 union/intersection/transform 分支里的 `role('secret')` 字段原样返回,且无任何记录。JSDoc 以「不得这样建模」为契约,但违反建模约定时是静默泄漏,而非失败。
- **修复**:fail-closed——default 分支抛错或显式掩码并记录命中。

### H4. e2b POC 组生命周期缺口集中

- **位置**:`packages/e2b/e2b/src/index.ts:106,120,174`;`packages/e2b/subprocess-e2b/src/process.ts:490,542,673`、`terminal.ts:303,561`、`remote.ts:87`、`environment.ts:29`
- **问题**:
  - `void this.ready.catch(() => {})`(:106)——吞掉 setup 失败,无日志(失败保留在 ready promise,`getSandbox()` 仍会返回错误,但部署侧无任何可见信号)
  - `TODO(e2b-setup-rollback)`(:174)与 `TODO(e2b-terminal-setup-rollback)`(:561)——spawn 半途失败无完整回滚路径(对比 terminal seam 的 `TerminalBackendCleanupError` + AggregateError 回滚设计)
  - teardown 只捕获 `SandboxNotFoundError`(:120),其他网络/权限错误打断清理
  - `TODO(e2b-publication-cancel)`(:490)、`TODO(e2b-status-watch)`(:542)——取消/状态传播依赖轮询补偿
  - `(reader as E2BOutputReader).size`(process.ts:673)——类型断言绕过接口
  - `TODO(e2b-replace-environment)`、`TODO(e2b-pgid-identity)`×2——远端 PGID 身份识别未解决,信号投递正确性存疑
- **修复**:对照 terminal seam 补齐回滚与 quiescence;`ready` 失败至少 log;teardown 错误区分处理。

### H5. agent/session 双份 lifecycle 状态机开始分叉

- **位置**:`packages/core/agent/src/index.ts`(`enter`/`announce`/`detachEntered`,改动前 460-556 行)vs `packages/core/session/src/index.ts`(`enter`/`announce`/`detachEntered`,改动前 1034-1118 行)
- **问题**:AgentEntry 与 SessionEntry 拥有同构的 `announced`/`announcing`/`detachRequested` 三旗标状态机与 `enter() → announce() → detachEntered() → emitDisposed()` 方法序列,连错误文案都逐字相同(`"${kind} ${id}" was already announced`)。已开始分叉:session 侧多出 `appending` 旗标,agent 侧多出 announcing 重查。任何语义修正都要两处落地,是 defensive-patterns「Honor public contracts on BOTH sides」的漂移温床。
- **修复**:**已收敛**(2026-09-14,PR #134)。两侧的状态机下沉为 `@deepseek-ai/dsh-entry-lifecycle` 的 `EntryLifecycle`:认领唯一创建边、计数打开的派发窗口、把窗口期到达的移除延后到最后一个窗口关闭。两侧各保留自己的存储、`scopeTarget` 载体、事件名与 payload、`attachments` 映射与销毁发出;公告拒绝文案由调用方传入 subject(`agent "<id>"` / `session "<id>"`)拼出,句子回到单点。session 的 `appending` 成为围绕 append 发布的一对 `beginDispatch`/`endDispatch`,其重入守卫改读 `hasOpenDispatch`(与 `appending` 同条件,故 `session/created` 监听器内追加的行为不变)。行为不变,由两侧既有套件与新包单测共同钉住。

### H6. 模型可见恢复/中止文案三包复制且已漂移

- **位置**:`packages/core/session/src/repair.ts:104-106` vs `packages/core/agent-loop/src/tool-calls.ts:291-293`;`packages/core/tools/src/index.ts:1945-1949` vs `tool-calls.ts:266-272`
- **问题**:同一错误码 `TOOL_OUTCOME_UNKNOWN` 对应两段相似但不相同的模型可见文案(「interrupted after it was recorded」vs「failed while this call was executing」);`'Error: tool call aborted before dispatch'` 字面量双份,tool-calls.ts 还手工重构了 tools 包已有的 `toolAbortedBeforeDispatchResult()` 形状。违反「pin stable model-visible text verbatim」,模型对恢复语义的认知会随微调漂移。
- **修复**:**已收敛**(2026-08-30)。`TOOL_OUTCOME_UNKNOWN` 双文案已随上游消失(session/repair.ts 持唯一现实定义,README 逐字钉住);`'tool call aborted before dispatch'` 合成结果改为导出 tools 包 canonical 工厂 `toolAbortedBeforeDispatchResult()`,agent-loop 的 `appendSkippedToolCall` 与 session-checkpoint-policy 的 `tools/execute` 中止臂删手抄形状改调工厂,输出逐字节不变。`toolAbortedResult` 保持私有(无手抄面)。

### H7. 监听器 containment 派发循环复制 9+ 份

- **位置**:core 5 份(`agent/src/dispatch.ts:126-136`、`session/src/index.ts:382-399`、`session/index.ts:989-1005`、`agent/index.ts:534-537,569`、`tools/src/index.ts:1312,1672`)+ 能力包 4 份(`workflow/src/index.ts:175-186`、`skill/src/index.ts:649-660`、`subagent/src/lifecycle.ts:112-121`、`schedule/runtime.ts`)
- **问题**:每包手写同一算法:绕过 Cordis 派发、逐回调 try/catch + `Promise.resolve(returned).catch(warn)`。告警文案三种风格(`listener rejected/threw`、`observer failed`、`dispatch threw`)。任何一版漏掉 async-rejection 分支,监听器异常即击穿事件循环——这是 defensive-patterns 规则 5 要求的关键安全模式。jobs-local 的 `onJobsChanged` 就是漏掉 async 臂的实例。
- **修复**:**已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-contained-emit`,`emitContained`/`invokeContained` 双入口,渲染器由调用点注入——`errorMessage` 为常规、agent-loop 注入 `errorChain` 保 cause 链、subagent 注入 `renderThrown` 保类名)。10 个循环收敛;保留特例:agent/session 的 created 公告(veto 契约:同步 throw 传播以否决发布,只 contain 异步拒绝)、schedule durable-change(单回调非列表)、gateway remote-events/client-connection/webworker-vfs(console.error 客户端宿主,无 ctx.logger)。文案变化:`String(error)`→`errorMessage(error)`(Error 输入等价)、tools `observer failed` 单句式→`listener rejected/threw` 双句式、jobs `onJobDone ... for ${id}` 语序调整。

---

## 中严重度

### M1. 跨包小工具复制流行病(jscpd 阈值检测不到)

| 函数 | 份数 | 分布(部分) |
|---|---|---|
| `assertPositiveInteger`/`assertPositiveFinite` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`;2026-09-12 收敛回升后的副本:`session-title/index.ts`——同包 `normalize.ts` 早已 import 权威版本——与 `sandbox-local/index.ts`,后者的 `sandbox-local: ` 前缀由 label 承载) | 保留 2 个语义特例:subagent-acp 的 `assertPositiveFinite`(钉 `MAX_TIMER_DELAY_MS` 上限,timer 域契约)、session-query-sqlite 的包装(抛 `SessionQueryError`,配置错误聚合契约);2026-09-14 补记第三个变体——`dsh-subagent` 公开导出的三参 `assertPositiveFinite(prefix, name, value)`(前缀分离、抛 `Error`),被 `subagent-claude-code`/`subagent-codex`/`subagent-dsh-sdk` 消费,可机械收敛(把前缀合进 label),但改的是公开导出与三个消费者的抛错类型,单独立批 |
| `isRecord` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`;sdk/client 公开导出改为再导出;mcp-client 的 JsonValue 谓词由调用点显式收窄替代) | 0 剩余(2026-09-12 收敛回升后的 5 处:`subprocess-local/runner-protocol.ts`、`client/file-upload`、`core/session/surface.ts`、`goal/fold.ts`、`workflow/tool-ralph`;`file-upload` 按 client 依赖政策记 `devDependencies`。2026-09-14 再收 1 处:`client/ui-tool/toolviews/ask-question-row.tsx`——与权威版逐字同形,09-12 批次漏记,同按 client 政策记 `devDependencies` 并补 tsconfig reference) |
| `asRecord` | **已收敛**(2026-09-12 下沉 `@deepseek-ai/dsh-value`,形态为 `isRecord(value) ? value : null`;原 4 处本地副本——`ui-chat`、`ui-trajectory`、`patent-core`、`patent-rule`——全部收敛,`patent-rule` 的公开导出改为再导出) | 0 剩余(2026-09-14 再收 1 处:`client/ui-chat/chat/ContextBody.tsx`——同包 `conversation-nodes/event-projection.ts` 早已 import 权威版,同包自相矛盾消除) |
| `deepEqualJson` | **已收敛**(权威实现自始只有 `@deepseek-ai/dsh-util-values` 一份;2026-09-14 删除唯一本地副本 `core/session/surface.ts` 的 `isDeepEqualJson`。原注释称「替代 `node:util` 的 `isDeepStrictEqual` 以保持本模块浏览器安全」已过期:该模块早已 import 同层 `dsh-value`,且 `dsh-util-values` 零 `node:` 导入、本就是 `core/session` 的依赖。`.agents/notes/rejected/simplification/2026-07-26-dependency-swaps-rejected-by-nih-audit.md` 否决的是引入 `fast-deep-equal` 这类**外部**包,与本轮改指仓内包不冲突) | 0 剩余(收敛时一并修正权威实现的键存在判定:`key in right` 会命中继承的 prototype accessor,使 `JSON.parse('{"__proto__":{}}')` 与 `{"other":1}` 被判相等;改为 `Object.hasOwn(right, key)`,回归用例 `packages/util/values/tests/values.spec.ts`) |
| `toError` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`,采用 skill 的 hostile-proxy 加固形式;2026-09-12 收敛回升后的 5 处:`test-support/client-runtime` 的 `toError`+`messageOf`,以及 inspector 四处 `renderError(error): Error`——`shared/bridge/rpc.ts`、`worker/bridge/{source,runtime}-rpc.ts`、`worker/inspection/query-router.ts`) | 保留 2 个不同契约:`api/gateway/client/remote-events` 的 `(reason, message, cause)` 三参变体;`test-support/remote-mock` 的 `toError`——该模块的成文不变量是「不得运行时导入其它 harness 包」(`src/index.ts` 模块文档),收敛即违约 |
| `errorMessage`/`renderThrown` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value` 短格式:`.message` → string-message 探针 → `String` → 固定占位符 `[unrenderable thrown value]`;占位文案统一,`<unrenderable…>`/`<unprintable…>`/`unknown error` 消失。2026-09-12 收敛同名 4 处 + **异名同义 12 处**:inspector `renderError`×5、`messageOf`×5(`directory-picker-browse`、`lsp-stdio`、`session-log-export`、`code-runtime-worker-thread`、`settings-controller`)、`errorLabel`(openviking)、`errorText`(ui-commands);2026-09-12 硬化 `Error` 分支为按 `unknown` 读出后 `String(...)`,第六批据此收敛 `code-runtime-python` 的最后一份副本)。09-11 记的「4 处」只按函数名匹配) | 保留 4 个不同契约:inspector `host/inspection/network.ts` 的 `renderError`(渲染 `${name}: ${message}` 且自带 try/catch 与自有占位文案)、agent-team(inspect 有界描述)、llm adapter-failure(`Error` 入参的 SDK getter 防御)、subagent lifecycle(带类名行);tool-ralph/tool-workflow 的 `?? 'unknown error'` 是结果字段缺省值,不属本族 |
| `errorMessage` 内联三元 | **未收编**(2026-09-12 实测口径) | 判定 `x instanceof Error ? x.message : String(x)` 在 src(非测试)中 **191 处**(`return` 形态 21 处),另有 9 处右值为模板串/`JSON.stringify` 等变体。与具名定义不同:每处都在 catch 块内就地渲染,收敛要给约百个文件补依赖与项目引用,而语义增量只是「非 Error 且带字符串 `message` 的对象不再渲染成 `[object Object]`」+ hostile-proxy 兜底。2026-09-14 裁定**不推进**(按 `instanceof Error ? <expr>.message` 口径复测 188 处,`return` 形态 15 处),理由即上述成本收益,故本行不再作为 #87 的待决项 |
| `isENOENT` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`;同批折叠同族 `isEEXIST` 3 份) | 0 剩余(2026-09-12 收敛:`session-persistence-jsonl` 的 `index.ts`/`generation.ts`、`patent-teams/state.ts` 的 `isEnoent` 变体;同一包内 `win32.ts` 早已 import 权威版本,自相矛盾消除) |
| `isPlainObject` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`;实际 3 份——台账漏记 inspector/shared/json.ts 的导出副本,一并折叠,包内 14 处导入走 re-export) | 0 剩余 |
| `deepFreeze` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`;`dsh-llm` 公开导出移除,9 个导入包改指 `dsh-value`;settings 递归副本由共享迭代版替代,配置数据上行为不变) | 0 剩余 |
| `isAbortError` | **已收敛**(2026-09-12 下沉 `@deepseek-ai/dsh-value`,严格 `instanceof Error` + `name` 判定;原 5 处本地副本——`fs-local`、`inspector`、三个 `web-search-*`——全部收敛) | 0 剩余 |
| `hasExactKeys` | **已收敛**(2026-09-12 下沉 `@deepseek-ai/dsh-value`,收敛为 `required` + `optional` 单一签名;`schedule`、`subprocess-local`、`llm-replay` 三处副本全部收敛) | 0 剩余 |
| `sleep`(未收编) | **评估后暂不下沉**(2026-09-12) | 实测 7 处同形定义,但语义分叉:`workflow-worker-thread` 的 timer 需 `unref`(dispose 宽限不得吊住进程)、`connection`/`linux-scope` 的变体需接受 `AbortSignal`,`subprocess-local/spawn.ts` 的 `sleepTick` 是让出而非定时。现有两个共享包(`dsh-value`/`dsh-timeout`)都不持有「可 unref、可中止的定时等待」契约,单签名会引入语义参数;待出现第三个真实需求时随 `dsh-timeout` 的定时原语一并评估。2026-09-14 复测分布:4 处同形定义(`patent-core/graph/node-policy.ts`、`patent/tool-literature/runtime/http.ts`、`patent/patent-teams/state.ts`、`workflow/workflow-worker-thread/host.ts`)+ 1 处 signal 变体(`client/connection`)+ 3 处测试内定义,结论不变 |
| abort-race 包装器 | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-timeout` `abortable`,标准语义原样 `reject(signal.reason)`;原记 5 份中 e2b `withinMs`/`waitWithSignal` 两份已随上游更新消失) | 保留特例:skill `waitWithAbort`(4 行适配,公开契约要求中止以 `Error` 形态逃逸,测试钉点 `instanceof Error` + hostile reason)、terminal-bash `startupSession` 的 pwsh deadline(内联 timer+`startupOperation.cancel()`,是超时语义非取消)、subprocess-local `waitForExit`(resolve false 是「等待退出 vs 放弃等待」查询语义,非取消)。**2026-09-14 更正与复测**:「e2b `withinMs` 已消失」不成立,它仍在 `subprocess-e2b/src/process.ts:83`(超时竞速、超时 resolve `undefined`,是查询语义,确实消失的只有 `waitWithSignet`);另有 4 处本地 `abortable`(`lsp-stdio/src/abort.ts` 的 `abortError` 分类且把非 Error 拒绝规整为 `Error`、`deepseek-llm-api-extensions` 的竞速后再查一次信号、`web-search-deepseek` 抛 `WEB_ABORTED` 域错误、`api/gateway/client/remote-events` 接受「值或 promise」)与 3 处 `waitWithAbort`(`skill` 的适配、`session-query-sqlite` 的域错误、`session-persistence-jsonl` 的 Error 规整),逐处差异都是对外契约而非糖,判为保留 |
| `apps/`、`scripts/` 内的副本 | **不计入收敛面**(2026-09-14 裁定) | 实测 `isRecord` 各 10 处(`apps/desktop`/`apps/desktop-host`/`apps/web` 的测试与 `scripts/` 的门禁脚本),`scripts/client-build-environment.ts` 另有 `hasExactKeys` 的两参变体;它们是应用外壳与仓库工具内部的单行收窄谓词,不参与发布面,收敛要给工具侧补 workspace 依赖与构建前置,收益与成本不成比例 |

- **影响**:日志/诊断格式漂移(运维无法依赖统一格式)、helper 语义各自微调、任何一处的 bug 修复要同步多处。
- **修复**:下沉 `util/`;`dsh-timeout` 补通用的 promise-vs-abort race 原语(明确一种语义并文档化)。注意 `snapshotJsonValue` 已做了正确示范(全部消费方 import 自 dsh-session)。

### M2. Config 边界类型安全妥协三连 + `config as ResolvedConfig` 遍布 8+ 文件

- **位置**:
  - `system-prompt/src/index.ts:344`:`z.array(z.string()).default(undefined as unknown as string[])`——双重 cast 表达「保留省略语义」
  - `agent-loop/src/index.ts:311`:`}) as z<Config>`——整段 schema cast,schema 与接口漂移编译期不可见
  - `tools/src/code-mode.ts:670`:`as unknown as Record<string, unknown>`——强类型投影塞回弱类型
  - `config as ResolvedConfig`:`e2b/index.ts:93`、`subprocess-e2b/index.ts:69`、`bash-local:84,125`、`pwsh-local`、`lsp-stdio:144`、`workflow-worker-thread:130`、`fs-local:81`、`repeat-tool-reminder:164-168`(`config.thresholds as number[]`)
- **问题**:每处都注释「schemastery 已填默认值」,但类型系统不编码该事实;任何一处未来绕过 schema 手动构造 config 就静默拿到 undefined。
- **修复**:**已收敛**(2026-08-30)。dsh-value 新增 `assertResolvedConfig`(单一断言点:带默认值字段仍为 `undefined` 即加载期抛错,返回 `ResolvedConfig<C,K>` 形状)+ 13 文件 cast 收敛(gateway、subagent-dsh-sdk、typert/loader、cordis-host-runner、tool-web、webserver、web-fetch-http、pwsh-local×2、bash-local×2、terminal-bash、storage-sqlite、jobs-local、repeat-tool-reminder×4,含清点出的 `as Required<Config>` 同族)。**保留**(2026-08-30 复核):`default(undefined as unknown as T)`(system-prompt、tool-subagent)表达 schemastery「缺省不物化」语义,需 vendor 级显式原语,单独评估;agent-loop `as z<Config>`(实为 313 行)是 schema↔接口对齐检查绕过,非边界 cast,单独评估;`ToolDefinition.parameters` 弱类型(实为 ptc.ts:679 与 schema.ts:572,code-mode.ts 已并入 ptc.ts)是公共类型面改造,单独评估。

### M3. settings 三个文档化竞态(真实缺陷,非待办优化)

- **位置**:`packages/settings/settings/src/index.ts`
  - `:275` `TODO(settings-json-properties)`——clone/mergeLayers 用 `out[key] = ...` 构造对象,合法 JSON key `"__proto__"` 会污染原型或丢失
  - `:453` `TODO(settings-registration-quiescence)`——注册 fiber dispose 时只删 map 条目,watcher 回调(含异步 tail)可在注册者死后继续触发,违反「Dispose must reach quiescence」
  - `:639` `TODO(settings-replacement-resync)`——旧 registration 的 in-flight 写可在 replacement 注册后提交,新注册停留在旧值
- **修复**:quiescence 用 disposer 内 await 尾部;`__proto__` 用 property-safe 构造;replacement 后用最新 registration 重解析。

### M4. hooks 桥行为缺口(每个都有 TODO,但直接影响用户)

- **位置**:`packages/hooks/hooks-claude-code/src/index.ts:189,205,269`(hooks-codex 镜像 `:172,187,257`)
- **问题**:
  - `merged.stop` 只记日志,无 run 级 halt——hook 请求停止但 agent 继续跑
  - `TODO(stop-loop-guard)`——Stop hook 反复强制 continue 无上限,无限循环风险
  - `TODO(session-start-gating)`——SessionStart 异步 resolve 时可能错过首个请求的上下文注入
  - `:176-179` 对 `updatedInput`/`systemMessage` 仅 warn 忽略(静默降级面)
- **修复**:打通 run 级 halt 通道;Stop 循环计数上限;SessionStart 门控。

### M5. atomic-write 无 fsync(凭据/设置写盘不具崩溃持久性)

- **位置**:`packages/util/atomic-write/src/index.ts:54`(`TODO(settings-atomic-durability)`)
- **问题**:该工具是 `settings-file` 与 `credentials-local`(**凭据文件**)的唯一写路径。write+rename 无 fsync,系统崩溃可丢凭据/设置且不留痕;Windows 下 owner-only 权限也不保证。
- **修复**:fsync 文件与父目录,Windows 权限语义补测试。

### M6. 上帝文件

| 文件 | 行数 | 承载职责 |
|---|---|---|
| `packages/host/apiproxy/src/api-proxy.ts` | 3744(69 方法) | 整个 BFF API 代理单体 |
| `packages/typert/generator/src/analyzer.ts` | 3113 | TypeScript 项目分析器(53 个顶层符号) |
| `packages/core/tools/src/index.ts` | 1955 | ToolRuntime + registry + 调度器 + 水印 + 守卫 + Config 投影 |
| `packages/subagent/subagent/src/continuation.ts` | 1483 | ChildLock、Activation/Materialization、drain、coldResume、dispose 全挤在一个类 |
| `packages/extensions/cordis-host-runner/src/index.ts` | 1274 | Dynamic Plugin 服务 |
| `packages/client/ui-slots/src/index.ts` | 1192 | — |
| `packages/core/session/src/index.ts` | 904 | session 服务 + 事件词汇 |
| `packages/api/session-controller/src/client/sessions/manager.ts` | 1131 | — |
| `packages/session-query/session-query-sqlite/src/index.ts` | 1103 | — |
| `packages/typert/generator/src/cordis-catalog.ts` | 1059 | — |
| `packages/skill/skill-filesystem/src/index.ts` | 1041 | provider + watcher 状态机 + 发现/解析(`TODO(file-watch-service)` 自认应抽取) |

另:300+ 行函数有 `acp/acp/src/index.ts:105` `apply`(310 行)与 `tools/src/code-mode.ts:294-673` `createRunCodeTool`(execute 闭包约 315 行,聚合 per-run 调度器/drain/结果桥接/语言风味/SDK 渲染五个职责)。

### M7. typert 契约测试被整体跳过

- **位置**:`packages/typert/generator/tests/cordis-catalog-contract.spec.ts:127,242` — `describe.skip('gen-cordis-catalog collectEvents/collectServices')`
- **问题**:cordis-catalog 生成器核心逻辑(事件/服务抽取契约)失去测试保护;跳过原因未记录(可能因 60s 超时)。
- **修复**:恢复或拆分测试并记录原因。

### M8. 硬编码可调参数(对照「no hardcoded tunables」)

- **同语义上限双份**:`maxParallelToolCalls`(agent-loop `constants.ts:2` 集中定义,好)vs `maxParallelSubCalls`(tools `index.ts:785,801` 各硬编码 `10` 且 schema 默认值与解析器回退手工同步)——名称、常量、解析器三处事实源
- **部署相关并发度非 Config**:`subagent/src/list-children.ts:27` `COLD_READ_CONCURRENCY = 4`(注释立场:bound 本地 read-only 扫描、非部署行为,「Should a networked persistence backend appear, promote it to a validated Config field」——当前可接受,网络化持久化出现时须 promote)
- **客户端可见行为无 Config**:`sdk/client/src/client.ts:28,31` `STDERR_TAIL_LIMIT=400`/`STREAM_SETTLE_MS=100`;`boot/app-boot:578` `FAIL_LOUD_RELEASE_TIMEOUT_MS=2000`;`acp:239` `agentInfo.version='0.0.1'`(应从包版本派生);`session-persistence-jsonl:44` `ZSTD_DECODE_YIELD_INTERVAL_MS=500`
- **默认值风格漂移**:同类超时默认值横向不对称(bash/pwsh-local 前台 `120_000` vs tool-bash-persistent `300_000` vs terminal-bash `30_000` vs e2b `300_000`),无一处集中文档化来源依据
- **同机制两样写法**:`preset/agent-presets:55` 裸字符串 `SETTINGS_NAMESPACE = 'agent-presets'` 与 `shell/shell/src/index.ts:21` 的 `SHELL_SETTINGS_NAMESPACE = 'shell'` 是同类写法(2026-09-11 更正:原记录称 shell 共享 `settingsNamespace()` 不实)

### M9. 残留 shim 待验证消费者（已收敛）

- **位置**:`api/remotes/src/agent-lookup.ts:83` — legacy agent-busy fence
- **问题**:SESSION_FORMAT_VERSION 仍是 0 且「无兼容承诺」,这些迁移是否还有真实生产消费者需要验证;无消费者则应删除(对照 pre-release stance:foundation over blast radius)。
- **结论**:该文件已在 2026-08-22 的 Session Controller refactor(`d26acfa2e3`)中删除,legacy agent-busy fence 已不存在。当前 `session/agent-busy` 是 `packages/api/session-controller/src/agent.ts` 的当前设计,旧错误码 `'agent-busy'` 与 `ApiRemote*` 符号在代码树中无残留。`SESSION_FORMAT_VERSION` 现为 3。详见 `.agents/notes/implemented/simplification/2026-09-14-legacy-agent-busy-shim-removed.md`。

### M10. 其他中危

- **acp prompt 结算链无 rejection 处理**:`acp/acp/src/index.ts:322` `void record.agent.whenIdle().then(...)`——whenIdle reject 时(结算期间 agent 被 dispose)成为 unhandledRejection,而 `boot/app-boot:578-654` 的 installFailLoud 会把 unhandledRejection 当 fatal `exit(1)`;同文件其他路径(notify/quiesce)均带 `.catch`,此处风格不一致
- **sdk client settleStreams 定时器泄漏**:`sdk/client/src/client.ts:444-449`——race 获胜方不清理 timer,每次对已死 runtime 的 request 挂一个 100ms 未清且未 unref 的定时器
- **e2b abort/timeout 语义分叉**(与 M1 的 abort-race 同源):reject/哨兵/resolve-false 三种,调用方须逐处记住——2026-08-30 大部收敛:两份哨兵已随上游消失,reject 包装收敛进 `dsh-timeout` `abortable`,余下 resolve-false 是查询语义保留
- **hook 双桥镜像复制**:hooks-claude-code vs hooks-codex 各 ~250 行几乎相同接线(runPoint 循环、payload 构造、decision 映射、4 个镜像 TODO),tests/coverage-cases.ts 也成对重复(691/583 行)
- **llm-deepseek vs llm-pi-ai 平行重建**:`DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000`(adapter.ts:89 与 config.ts:35)等相同 plumbing 各一份
- **api/gateway 内部循环重复**:`index.ts:117-134` collectSrcClaims 与 `:233-260` resolveSrcDescriptor 两段 ~25 行同构扫描循环
- **typert package.json 裸解析 ×4**:`loader/index.ts:333`、`generator/analyzer.ts:470`、`generator/workspace.ts:70`、`generator/tsdown-plugin.ts:74,127`——`JSON.parse as X` 只信任不校验(受信输入,风险低)
- **类型安全瑕疵**:`util/launch-environment/src/index.ts:116` `process.env as Record<string, string>`(类型谎言);`session-persistence-sqlite/src/schema.ts:206-214` durable 边界裸 cast(有下游兜底,属 defense-in-depth 缺口);`boot/app-boot:672-676` const enum 值镜像需与两包手工对齐

---

## 低严重度

### L1. CLAUDE.md 布局段落漂移

- **位置**:`CLAUDE.md`(symlink 至 AGENTS.md)Repository layout 段
- **问题**:`self-modification` 实为 `extensions/`(cordis-client-runner、tool-cordis 等)、`support` 实为 `test-support/`;约 17 个新组未记录:`attachment`、`client`、`code-runtime`、`desktop`、`extensions`、`feedback`、`goal`、`host`、`jobs`、`mcp`、`runtime-diagnostics`、`sandbox`、`schedule`、`session-query`、`spill`、`storage`、`workspace`。docs/subsystems 与 packages/README.md 已同步,仅布局段过时(新贡献者读布局会迷路)。
- **修复**:布局段补全/改名,与 packages/README.md 对齐。

### L2. 死代码/无主导出

- `lsp/src/index.ts:60` `finalExtension`——无外部消费者(仅测试与自身引用)
- `subagent/src/list-children.ts:84-86` `reason: 'unsupported'` 变体——注释自认「never produced」,无主保留
- `workflow/src/index.ts:94-100` `WorkflowEventName`——仅被自身 lib d.ts 引用

(对照:core agent 的 `foldConsumedWork` 初判为无消费者,经复核其生产消费者存在于 `subagent/subagent-in-process-driver/src/index.ts:219` 与 `subagent/subagent/src/lifecycle.ts:236`,非死代码。)

### L3. `src/types.ts` 含运行时代码,违反 packages/CLAUDE.md 明规则

- **位置**:7+ 包——fs/types.ts:24,43,196(brand 函数、FsError)、web/types.ts:129、terminal/types.ts:18、subagent/types.ts:27、workflow/types.ts:20、shell/types.ts:13、compaction/types.ts:16
- **问题**:规则写「types.ts contains only types — no runtime code」,但 brand 函数与错误类是系统性、有意的例外,规则未记录该例外;混放还迫使 `shell/types.ts` 这类文件 re-export 运行时符号。

### L4. terminal seam 错误风格与同族不对称

- **位置**:`packages/terminal/terminal/src/index.ts:126,160,236,245,285,324`
- **问题**:同类包全部带包名前缀(bash-local:、subprocess-local:),唯独 terminal seam 抛裸消息;同一类失败混用 `Error` 与 `TerminalError`(`startSend` closing/exited 用裸 Error、SEND_ACTIVE 用 TerminalError);`kill(owner, id, reason: string = 'model request')`(:285)是唯一带硬编码默认参数的可选诊断字段。

### L5. 其他低危

- **魔法哨兵**:`agent-loop/src/index.ts:281,357` `resumeSessionId === ''` 判定缺席(branded SessionId 不存在空串合法值,应 schema 边界归一化);`system-prompt` 与 `tools` 未知工具诊断两种文案风格
- **agent-loop `kick()` 空 catch**(`agent.ts:210-215`):无人监听 `agent/error` 时驱动失败无任何日志落点
- **`whenIdle()` 自旋等待**(`agent.ts:195-200`):依赖引用换代隐式契约,缺收敛注释
- **`isAborted` 平凡包装器**(`tools/index.ts:1889-1892`):仅 2 处调用,可直接内联
- **desktop bridge-client 泄漏**(`desktop/shell/src/bridge-client.ts:113-125`):`socket.write` 同步抛错时 pending 条目与 abort listener 不清理
- **skill-filesystem abort listener 未移除**(`skill-filesystem/src/index.ts:167`):dispose 后 abort 仍空转触发一次 dispose(实际无害)
- **llm-pi-ai 错误分类靠正则**(`llm/llm-pi-ai/src/stream.ts:31-70`):上游 flatten 丢失 cause 链,措辞变化即错分类(有 XXX 注释)
- **identity 首启并发窗口**(`identity/anonymous-user-id:100-102`):两进程各得一个 id,下次启动收敛(注释已承认)
- **todo/tool-todo 双 schema 库混用**(`tool-todo/src/index.ts:11-13`):同文件 schemastery z 与 zod 并存

### L6. 已论证的权衡(记录,不建议改动)

- `TOOL_RUNTIME_SCHEDULER` 字符串键服务握手(`core/tools/src/index.ts:475`,消费 `agent-loop/tool-calls.ts:19,155-176`):pnpm 双副本 hoist 下 Symbol 失效的正当理由;纵深防御见 [2026-08-19-dual-copy-defense-in-depth](../.agents/notes/implemented/architecture/2026-08-19-dual-copy-defense-in-depth.md)(profile pnpm-workspace overrides 钉版本 + `requireScheduler` 诊断 + `DSH_AUTO_PNPM_INSTALL` 自动收敛);若未来单一副本分发应回归 Symbol/typed 访问
- `credentials-local` 与 `settings-file` 约 200 行 provider 对称代码:`jscpd:ignore-start` 声明「deliberate symmetry」并豁免
- `tools/src/json-schema.ts:89-135` 复制 `session/src/json.ts:16-42` realm 探测、`py-types.ts:511-548` 与 `ts-types.ts:112-230` 渲染器骨架:均已 jscpd 豁免并注释;bug 修复需手工同步,第三处消费时下沉

---

## 横切主题:建议的共享原语清单

按「先收原语、再收调用点」的顺序推进,每项都是独立可评审的 PR:

1. **cordis 层 `emitContained(ctx, name, args)`** — 收敛 H7 的 containment 循环(2026-08-30 已落地 `@deepseek-ai/dsh-contained-emit`;未动 vendor,渲染器由调用点注入)
2. **`dsh-timeout` promise-vs-abort race 原语** — 收敛 abort-race 包装器(2026-08-30 已落地 `abortable`;候选名 promise-vs-abort 见台账 M1 行)
3. **`util/` 小工具包** — `isRecord`、`assertPositiveInteger`、`toError`、`errorMessage`、`isENOENT`、`isPlainObject`、`deepFreeze`(收敛 M1 的 40+ 份;2026-08-30 已全部落地 `@deepseek-ai/dsh-value`)
4. **recovery-vocabulary 模块** — 错误码 + 模型可见逐字文案 + 合成结果工厂(收敛 H6;2026-08-30 已落地:`TOOL_OUTCOME_UNKNOWN` 文案已随上游坍缩为 session 单点,导出 tools 的 `toolAbortedBeforeDispatchResult` 工厂并收敛两份手抄)
5. **ResolvedConfig helper** — `Required<Config>` + 单一断言(收敛 M2 的 8+ 处 cast;2026-08-30 已落地 `dsh-value` `assertResolvedConfig`,13 文件收敛)
6. **announcement 状态机原语** — 收敛 H5 的双份 entry 生命周期(2026-09-14 已落地 `@deepseek-ai/dsh-entry-lifecycle`)

## 修复优先级路线图

**第一批(安全/正确性,建议先做)**:
- H1 web schema 修正、H2 llm-deepseek wire 校验、H3 redact fail-closed、H5 atomic-write fsync、H4 e2b 回滚与吞错
- M3 settings 三个竞态、M4 hooks run 级 halt

**第二批(横切收敛)**:
- 原语 1-5(emitContained、abort-race、util 下沉、recovery-vocabulary、ResolvedConfig)
- M8 硬编码可调参数收编(先 maxParallelSubCalls 双份)

**第三批(结构/维护)**:
- M6 上帝文件拆分(优先级:continuation.ts → tools/index.ts → api-proxy.ts)、M7 typert 契约测试恢复、L1 CLAUDE.md 布局同步、M9 legacy shim 清理(验证消费者后)、L2 死代码删除

> 备注:59 处 TODO/FIXME 中,除本报告列为债务的之外,其余为常规记账(命名规范、多属「待办优化」而非缺陷)。FIXME(timeout-policy 改名)必须在首个 tagged release 前决定——已于 2026-08-19 以 `dsh-timeout-policy` → `dsh-timeout-guard` 执行完毕。
