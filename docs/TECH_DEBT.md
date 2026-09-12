# 技术债务报告

> 探查日期:2026-08-17。方法:全仓静态扫描 + 三个并行深度探查 agent(core 组 / 能力包 / 基础设施包,合计覆盖 packages/ 全部 src 源码约 55k 行)。「已验证」条目经人工逐行复核;其余条目来自深度探查,行号以探查时为准。

## 2026-08-28 更新(上游 v0.1.2-alpha.1 合并后的债务清扫)

- **H1 证伪**:实测 cordis `resolveConfig` 走 schemastery `~standard.validate`,对缺失键返回 `{value:{}}` 无 issues(`vendor/cordis/src/fiber.ts:51-53`),schema 不拦省略、env 回退可达。不改 schema,已补 env 选择回归测试(`packages/web/web/tests/web.spec.ts`)。
- **H2、H3 已修**(随上游 v0.1.2):llm-deepseek `parseWireChunk` 逐层结构化校验;settings `redactSecrets` 对含可达 secret 的不可展开节点 fail-closed。
- **M5 已修**:`atomic-write` 现在把临时文件 fsync 于 rename 前、父目录条目 fsync 于 rename 后;目录 fsync 为 best-effort(Windows 无法打开目录句柄),平台差异收敛在 `src/fsync.ts`。Windows owner-only ACL 语义仍超范围。
- **M6 部分消解**:`packages/host/apiproxy`(3744 行)已随上游删除,RPC 传输归 connection;`tools/src/code-mode.ts` 改名 `ptc.ts`。其余上帝文件仍在且继续增长(analyzer 3142、continuation 1569、coordinator 1439 行)。
- **M7 已修**:两个 `describe.skip` 恢复(实测全套 <1s,「60s 超时」的跳过理由不成立),并修正滞后断言(service 方法模型新增 `kind` 判别字段)。
- **M9 决策:保留**。消费者是已出货桌面构建(DSH Patent 0.1.1-rc.2)磁盘上的历史会话日志,无法证明无消费者;「不支持词汇 fail-loud + 旧形状迁移」是有意设计。首个 tagged release 或 SESSION_FORMAT_VERSION bump 时复审。
- **L1 已修**:根 AGENTS.md 布局段收敛为指向 `packages/README.md`(唯一事实源),补 `apps/desktop` 与根 `examples/`;vitest coverage exclude 的 `packages/self-modification` 死条目删除。
- **L2 已修**:lsp `finalExtension` 收敛为包内模块(`src/extension.ts`,不再公共导出);workflow `WorkflowEventName` 取消导出;subagent `'unsupported'` 死变体已随上游删除。
- **L5 之 bridge-client 写路径泄漏已修**:同步 write 抛错现在 settle pending 条目并摘除 abort 监听(`packages/desktop/shell/src/bridge-client.ts`)。
- **合并新增债已清**:vendor/README.md manifest 版本表刷新(commit 列标 not recorded,下次 sync 按程序补录);`docs/event-producer-consumer(.md/.zh)` 再生(apiproxy→remotes/tool-cordis);fork CI 增补 `test:docs` 门禁;coverage exclude 登记 patent/synapse/self-evolve/ui-agent-preset(hygiene-gate note 第 3 项);ui-chat 两处 `it.skip` 恢复(skip-hardening 移植进上游 fold,AssistantMarkdown 加 textOf 兜底);桌面打包链修复(REQUIRED_BACKEND_PATHS 移除 apiproxy,apps/cli 显式声明 deploy 会丢弃的 9 个 peer seam 包,`package:desktop:prepare` 端到端验证通过)。
- **仍然开放**:H4、H5、M3、M4、M6 余下、M8、L3、L4;sync note follow-up 1(ui-document-studio readFileText Remote 网关)与 2(synapse live-reply)。H6(恢复/中止文案)、H7(监听器 containment)、M1(util 小工具)与 M2(ResolvedConfig)已于 2026-08-30 全部收敛;**原语清单 5 项已全部落地**(emitContained、abort-race、util 下沉、recovery-vocabulary、ResolvedConfig)。
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
- **M8** 点名项**零修复**(行号普遍漂移),且「shell seam 共享 `settingsNamespace('shell')`」的描述有误:shell 用的是裸字符串 `SHELL_SETTINGS_NAMESPACE`。见 Issue #88。
- **M9** 的前提已变:`SESSION_FORMAT_VERSION` 已升到 2,legacy shim 的消费者需重新验证。见 Issue #98。

### 本轮新增(台账与 08-30 审计均未载)

hygiene 门禁在 master 红(#78,`verify-package-dependencies` 3 条违规,源于 fork 的桌面侧栏改造)、一处未声明的工作区依赖(#82,`session-persistence-jsonl/src/win32.ts:17` 运行期值导入 `dsh-value` 但未声明)、26 处闭合联合缺 `assertNever`(#89)、10 个组 README 共缺 16 个包条目(#90)、src 内 63 处空 `.catch(() => {})`(#85)、硬编码参数新簇(#88)、测试可靠性族(#92)、死导出无门禁(#93)、`vitest.config.ts` 豁免理由错位残留(#91)。完整清单见上述 manifest。

### 台账条目 → Issue 关联

| 台账条目 | 状态 | Issue |
|---|---|---|
| H4 e2b 生命周期缺口 | 已收敛(余 5 处上游依赖 TODO,见 09-12 节) | #79 |
| H5 agent/session announcement 状态机双份 | 开放 | #101 |
| M1 小工具复制流行病 | 部分收敛,仍有残留 | #87 |
| M3 settings 三个竞态 | 已收敛 | #80 |
| M4 hooks 桥行为缺口 | 修复就绪,待合并 | #81 |
| M6 上帝文件 | 开放(行数已更新) | #86 |
| M8 硬编码可调参数 | 开放(零修复) | #88 |
| M9 legacy shim | 开放(前提已变) | #98 |
| L3 `types.ts` 含运行时代码 | 开放 | #99 |
| L4 terminal seam 错误风格 | 开放 | #100 |
| L5 其他低危 | 开放,仍只在本台账登记 | — |
| H1–H3、H6、H7、M2、M5、M7、L1、L2、P1-1、P2-1、P2-4、P2-7、P2-8 | 已收敛 | — |

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
- **既有红项:快照回放套件**(2026-09-12 实测,与本轮改动无关):`pnpm run test:snapshot` = 5 failed / 127 passed / 2 skipped,失败项为 `keeps a current-writer majority plus bounded declared historical migration coverage` 与四条 `replays …`(`system-prompt-in-history` ×2、`macos-tools-validation`、`subagent-tool-filter`);在合并基线 `3adac36997` 的干净检出上逐项一致。fork CI 只跑 `vitest run`,不含该套件,故长期未暴露。
- **组 README 包表缺口已补齐,并新增防漂移门禁**(#90,PR #116):十个组的 `README.md`/`README.zh.md` 各补 16 条包条目(`client/` 7、`util/` 2,`api/`、`bundle/`、`core/`、`host/`、`session/`、`test-support/`、`web/` 各 1),`host/` 的「All eight packages」/「Eight packages play the host roles」与 `web/` 的「Six packages play the web roles」三处计数措辞随中文对应句一并改为九与七。新增 `verify-group-readme-packages`(`doc-sync` 的 quick 叶门):按组比对 `## Packages`/`## 包` 段与该组目录下持有 `package.json` 的包集合,英文与中文各查一遍——配对门禁只把每一侧与其记录状态比对,发现不了「只加一侧」;跨组 `../` 目标归目标组所有而忽略,空扫描、缺段、组内无包均报错。此前 `hygiene` 各叶门与 `doc-sync` 都不读组内包表,故 16 条缺口长期无人发现。

- **空 `.catch(() => {})` 第一批**(#85,PR #117):按 issue 点名的两个聚焦包逐处判定——`core/agent-loop` 7 处、`subprocess/subprocess-local` 8 处,共 15 处。其中 4 处早有说明性注释(agent-loop 两个回滚 dispose、`setupAndPublish` 的回滚 dispose,以及 `spawn.ts` 的 range 观测),另 11 处补上注释,按五种形态写明「吞掉什么、为什么别的路径到不了」:setup 失败后的回滚(主错误交给调用方)、取消后弃置的句柄(调用方收到的是自己的中止,句柄无其它属主)、`finally` 中的 close(块的结局已定)、teardown 对自己正在终结的进程做 join(`waitForExit()` 才是 teardown 自己的证据并经 `allSettled` 上报,range 等待失败时句柄仍留在集合里待强制结束)、以及自身仍保留消费方的 promise 上的未处理拒绝防护(失败仍到达等待者,防护只避免噪声)。口径更正:实测 src 为 **62 处**(09-11 记 63 处);`总体评估` 的「零未注释空 catch」指 `catch {}` 子句(src 0 处、tests 10 处),`catch(() => {})` 从不在该断言的覆盖范围内。其余 47 处分布在 20 个包(subagent 桥、LSP stdio、OpenViking、e2b、浏览器 UI 等),按同一词汇逐批判定,#85 保持开放。
- **空 `.catch(() => {})` 第二批(收敛)**(#85,PR #118):剩余 47 处判定完毕。issue 点名的三包共 15 处,其中 `lsp/lsp-stdio` 实测已收敛(5 处全带紧邻理由:`connection.ts` 写明 `write()` 已记录失败并拒绝所有待决请求、`instance.ts` 写明握手拒绝不得在首个查询等待它之前浮出),`subagent/subagent-codex` 与 `memory/openviking` 也各有说明 2 处、3 处(构造函数里对 fatal promise 的防护、发布后 `processFailure` 的防护、`state.ts` 持久化尾注、会话启动 JSDoc),故这三包只需新补 5 处。按同一规则(理由须紧邻吞掉语句,含同行尾注)重筛全仓,又得 8 包 9 处——`llm-deepseek` 与 `attachment-local` 的上传/in-flight 清理、`plugin-market` 的流取消、`web/synapse` 的过期锁 unlink、`patent-document` 与 `patent-tools` 的临时文件、`terminal-bash` 的模拟器 teardown、`subagent-claude-code` 2 处(teardown join 与 `childProcessFailure` 防护)——一并补注。合计 13 包 17 文件 21 处注释(纯新增 41 行),归纳为六种形态:自身仍有消费方的 promise 上的未处理拒绝防护、没有观察者的 best-effort 工作、不得顶替主错误的清理、被弃置的请求或响应、teardown 对正在终结的进程做 join、没有上报面的 dispose。**无一处需要改行为**:判定结论是没有调用方能据以行动的失败,因此不引入日志也不传播。src 内 62 处至此全部自述,#85 关闭。
- **跨边界事实三处修正(收敛)**(#82/#83/#84,PR #119):① **未声明依赖**——运行期 `dsh-value` 的缺失声明已随 #110 落地,本轮处理类型导入:实测会进入公开 `.d.ts` 的只有 6 对,按各包既有惯例补声明(`patent-tools`、`mcp-client`、`api-settings-controller`、`tool-fs-search` 的 `dsh-util-values` 进 `dependencies`;`token-meter` 的 `dsh-attachment` 进 `peerDependencies` 并镜像 dev;`host-synapse` 的 `dsh-llm` 进 `dependencies`),其余类型导入故意不声明(类型不进产物,声明只会白加安装要求)。同时记录门禁边界:`verify-package-dependencies` 只挑选 client-faced 与 configured-host 包(66 个),纯 host 包不在其内;今日实测 `src` 内已无未声明的值导入。② **跨边界 id 打品牌**——`patent-teams` 新增 `src/ids.ts`(`PatentTeamsTeamId`/`PatentTeamsTaskId`/`PatentTeamsMessageId`/`PatentTeamsAttemptId` 与同名构造函数),载荷字段(`captainSessionId`、`memberId` 复用 `SessionId`)与 13 个发点一并改造,`captainSessionOf` 的裸 cast 随之删除;`desktop-seam` 新增 `MenuId`/`NotificationId`(两个事件载荷、`DesktopNotification.id`、`DesktopMenuItem.id`),shell 在 Electron 桥回传处打品牌;`ui-chat` 的 `ToolCallId` 改为再导出宿主品牌,`ui-tool` 在 `inspectCall` 处打品牌。三处各加编译期钉子(`ids.spec.ts`、desktop-seam 身份断言、`ToolCallId` 身份测试)。durable 团队文件与客户端节点的字符串表示保持不变。③ **ACP 握手版本**——`agentInfo.version` 由硬编码 `'0.0.1'` 改为读自身 `package.json`(与 dsh-llm 的 attribution 同法),bridge spec 新增断言把握手钉到 manifest。附带再生受影响的 catalog(acp 行号、客户端槽位 `ToolCallId` 引用、persistence 行号、desktop 子系统文档)并在 `gen-cordis-catalog` 的类型分类表登记两个新品牌。

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

- **位置**:`packages/core/agent/src/index.ts:474-576` vs `packages/core/session/src/index.ts:913-1005`
- **问题**:AgentEntry 与 SessionEntry 拥有同构的 `announced`/`announcing`/`detachRequested` 三旗标状态机与 `enter() → announce() → detachEntered() → emitDisposed()` 方法序列,连错误文案都逐字相同(`"${kind} ${id}" was already announced`)。已开始分叉:session 侧多出 `appending` 旗标,agent 侧多出 announcing 重查。任何语义修正都要两处落地,是 defensive-patterns「Honor public contracts on BOTH sides」的漂移温床。
- **修复**:抽取共享 announcement 原语(参照 `scope` 包 ScopedLayers 模式)或让 session 侧宿主 agent 侧。

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
| `assertPositiveInteger`/`assertPositiveFinite` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`;2026-09-12 收敛回升后的副本:`session-title/index.ts`——同包 `normalize.ts` 早已 import 权威版本——与 `sandbox-local/index.ts`,后者的 `sandbox-local: ` 前缀由 label 承载) | 保留 2 个语义特例:subagent-acp 的 `assertPositiveFinite`(钉 `MAX_TIMER_DELAY_MS` 上限,timer 域契约)、session-query-sqlite 的包装(抛 `SessionQueryError`,配置错误聚合契约) |
| `isRecord` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`;sdk/client 公开导出改为再导出;mcp-client 的 JsonValue 谓词由调用点显式收窄替代) | 0 剩余(2026-09-12 收敛回升后的 5 处:`subprocess-local/runner-protocol.ts`、`client/file-upload`、`core/session/surface.ts`、`goal/fold.ts`、`workflow/tool-ralph`;`file-upload` 按 client 依赖政策记 `devDependencies`) |
| `asRecord` | **已收敛**(2026-09-12 下沉 `@deepseek-ai/dsh-value`,形态为 `isRecord(value) ? value : null`;原 4 处本地副本——`ui-chat`、`ui-trajectory`、`patent-core`、`patent-rule`——全部收敛,`patent-rule` 的公开导出改为再导出) | 0 剩余 |
| `toError` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`,采用 skill 的 hostile-proxy 加固形式;2026-09-12 收敛回升后的 5 处:`test-support/client-runtime` 的 `toError`+`messageOf`,以及 inspector 四处 `renderError(error): Error`——`shared/bridge/rpc.ts`、`worker/bridge/{source,runtime}-rpc.ts`、`worker/inspection/query-router.ts`) | 保留 2 个不同契约:`api/gateway/client/remote-events` 的 `(reason, message, cause)` 三参变体;`test-support/remote-mock` 的 `toError`——该模块的成文不变量是「不得运行时导入其它 harness 包」(`src/index.ts` 模块文档),收敛即违约 |
| `errorMessage`/`renderThrown` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value` 短格式:`.message` → string-message 探针 → `String` → 固定占位符 `[unrenderable thrown value]`;占位文案统一,`<unrenderable…>`/`<unprintable…>`/`unknown error` 消失。2026-09-12 收敛同名 4 处 + **异名同义 12 处**:inspector `renderError`×5、`messageOf`×5(`directory-picker-browse`、`lsp-stdio`、`session-log-export`、`code-runtime-worker-thread`、`settings-controller`)、`errorLabel`(openviking)、`errorText`(ui-commands);2026-09-12 硬化 `Error` 分支为按 `unknown` 读出后 `String(...)`,第六批据此收敛 `code-runtime-python` 的最后一份副本)。09-11 记的「4 处」只按函数名匹配) | 保留 4 个不同契约:inspector `host/inspection/network.ts` 的 `renderError`(渲染 `${name}: ${message}` 且自带 try/catch 与自有占位文案)、agent-team(inspect 有界描述)、llm adapter-failure(`Error` 入参的 SDK getter 防御)、subagent lifecycle(带类名行);tool-ralph/tool-workflow 的 `?? 'unknown error'` 是结果字段缺省值,不属本族 |
| `errorMessage` 内联三元 | **未收编**(2026-09-12 实测口径) | 判定 `x instanceof Error ? x.message : String(x)` 在 src(非测试)中 **191 处**(`return` 形态 21 处),另有 9 处右值为模板串/`JSON.stringify` 等变体。与具名定义不同:每处都在 catch 块内就地渲染,收敛要给约百个文件补依赖与项目引用,而语义增量只是「非 Error 且带字符串 `message` 的对象不再渲染成 `[object Object]`」+ hostile-proxy 兜底。是否按批次推进待定,见 #87 |
| `isENOENT` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`;同批折叠同族 `isEEXIST` 3 份) | 0 剩余(2026-09-12 收敛:`session-persistence-jsonl` 的 `index.ts`/`generation.ts`、`patent-teams/state.ts` 的 `isEnoent` 变体;同一包内 `win32.ts` 早已 import 权威版本,自相矛盾消除) |
| `isPlainObject` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`;实际 3 份——台账漏记 inspector/shared/json.ts 的导出副本,一并折叠,包内 14 处导入走 re-export) | 0 剩余 |
| `deepFreeze` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`;`dsh-llm` 公开导出移除,9 个导入包改指 `dsh-value`;settings 递归副本由共享迭代版替代,配置数据上行为不变) | 0 剩余 |
| `isAbortError` | **已收敛**(2026-09-12 下沉 `@deepseek-ai/dsh-value`,严格 `instanceof Error` + `name` 判定;原 5 处本地副本——`fs-local`、`inspector`、三个 `web-search-*`——全部收敛) | 0 剩余 |
| `hasExactKeys` | **已收敛**(2026-09-12 下沉 `@deepseek-ai/dsh-value`,收敛为 `required` + `optional` 单一签名;`schedule`、`subprocess-local`、`llm-replay` 三处副本全部收敛) | 0 剩余 |
| `sleep`(未收编) | **评估后暂不下沉**(2026-09-12) | 实测 7 处同形定义,但语义分叉:`workflow-worker-thread` 的 timer 需 `unref`(dispose 宽限不得吊住进程)、`connection`/`linux-scope` 的变体需接受 `AbortSignal`,`subprocess-local/spawn.ts` 的 `sleepTick` 是让出而非定时。现有两个共享包(`dsh-value`/`dsh-timeout`)都不持有「可 unref、可中止的定时等待」契约,单签名会引入语义参数;待出现第三个真实需求时随 `dsh-timeout` 的定时原语一并评估 |
| abort-race 包装器 | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-timeout` `abortable`,标准语义原样 `reject(signal.reason)`;原记 5 份中 e2b `withinMs`/`waitWithSignal` 两份已随上游更新消失) | 保留特例:skill `waitWithAbort`(4 行适配,公开契约要求中止以 `Error` 形态逃逸,测试钉点 `instanceof Error` + hostile reason)、terminal-bash `startupSession` 的 pwsh deadline(内联 timer+`startupOperation.cancel()`,是超时语义非取消)、subprocess-local `waitForExit`(resolve false 是「等待退出 vs 放弃等待」查询语义,非取消) |

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
| `packages/core/session/src/index.ts` | 1157 | session 服务 + 事件词汇 |
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

### M9. 残留 shim 待验证消费者

- **位置**:`api/remotes/src/agent-lookup.ts:83` — legacy agent-busy fence
- **问题**:SESSION_FORMAT_VERSION 仍是 0 且「无兼容承诺」,这些迁移是否还有真实生产消费者需要验证;无消费者则应删除(对照 pre-release stance:foundation over blast radius)。

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
6. **announcement 状态机原语** — 收敛 H5 的双份 entry 生命周期

## 修复优先级路线图

**第一批(安全/正确性,建议先做)**:
- H1 web schema 修正、H2 llm-deepseek wire 校验、H3 redact fail-closed、H5 atomic-write fsync、H4 e2b 回滚与吞错
- M3 settings 三个竞态、M4 hooks run 级 halt

**第二批(横切收敛)**:
- 原语 1-5(emitContained、abort-race、util 下沉、recovery-vocabulary、ResolvedConfig)
- M8 硬编码可调参数收编(先 maxParallelSubCalls 双份)

**第三批(结构/维护)**:
- H5 状态机抽取、M6 上帝文件拆分(优先级:continuation.ts → tools/index.ts → api-proxy.ts)、M7 typert 契约测试恢复、L1 CLAUDE.md 布局同步、M9 legacy shim 清理(验证消费者后)、L2 死代码删除

> 备注:59 处 TODO/FIXME 中,除本报告列为债务的之外,其余为常规记账(命名规范、多属「待办优化」而非缺陷)。FIXME(timeout-policy 改名)必须在首个 tagged release 前决定——已于 2026-08-19 以 `dsh-timeout-policy` → `dsh-timeout-guard` 执行完毕。
