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
| `assertPositiveInteger`/`assertPositiveFinite` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`) | 保留 2 个语义特例:subagent-acp 的 `assertPositiveFinite`(钉 `MAX_TIMER_DELAY_MS` 上限,timer 域契约)、session-query-sqlite 的包装(抛 `SessionQueryError`,配置错误聚合契约) |
| `isRecord` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`;sdk/client 公开导出改为再导出;mcp-client 的 JsonValue 谓词由调用点显式收窄替代) | 0 剩余 |
| `toError` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`,采用 skill 的 hostile-proxy 加固形式;gateway/remote-events 的 `(reason, message, cause)` 变体是同名不同契约,保留本地) | 0 剩余 |
| `errorMessage`/`renderThrown` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value` 短格式:`.message` → string-message 探针 → `String` → 固定占位符 `[unrenderable thrown value]`;占位文案统一,`<unrenderable…>`/`<unprintable…>`/`unknown error` 消失。保留特例:subagent lifecycle(带类名行)、workflow-worker-thread realm(栈优先报告)、agent-team(inspect 有界描述)、llm adapter-failure(`Error` 入参的 SDK getter 防御)——四者是不同契约而非副本;tool-ralph/tool-workflow 的 `?? 'unknown error'` 是结果字段缺省值,不属本族) | 0 剩余 |
| `isENOENT` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`;同批折叠同族 `isEEXIST` 3 份) | 0 剩余 |
| `isPlainObject` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`;实际 3 份——台账漏记 inspector/shared/json.ts 的导出副本,一并折叠,包内 14 处导入走 re-export) | 0 剩余 |
| `deepFreeze` | **已收敛**(2026-08-30 下沉 `@deepseek-ai/dsh-value`;`dsh-llm` 公开导出移除,9 个导入包改指 `dsh-value`;settings 递归副本由共享迭代版替代,配置数据上行为不变) | 0 剩余 |
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
- **同机制两样写法**:`preset/agent-presets:40` 裸字符串 `SETTINGS_NAMESPACE = 'agent-presets'` vs shell seam 共享 `settingsNamespace('shell')`

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
