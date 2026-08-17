# Sati 专利域插件化迁移至 deepseek-harness 实施计划（路线 A：原生移植）

- 创建日期：2026-08-17
- 状态：**实施中（2026-08-17 用户指示「根据本计划执行」，视为批准；P0 已落地，执行记录见 §10）**
- 决策记录：2026-08-17 用户确认路线 A（原生移植），先出详细实施计划再动手；同日评审修订：许可证策略定案（迁入包 MIT，见 §1.4）、耦合面 6 点→9 点勘误、post-execute/subprocess 契约勘误
- 文档副本：主副本 Sati `docs/sati-as-dsh-plugins-plan.md`；实施副本 deepseek-harness `docs/sati-as-dsh-plugins-plan.md`（2026-08-17 复制）
- 上游调研：`deepseek-harness/docs/plugin-authoring.md`（插件契约）、`docs/architecture.md`（扩展点地图）、`docs/capability-seams.md`（能力接缝）、`docs/cookbook/adding-a-tool.md`（工具契约）、`docs/cordis-primer.md`（框架语义）、`packages/AGENTS.md`（包规则）、`packages/todo/tool-todo`（参考插件）
- 前置文档：`deepseek-harness/patent-mode-design.md`（专利模式预设设计，本计划的 preset 组装阶段复用其 §4–§9 内容）

---

## 1. 背景与目标

Sati 与 deepseek-harness（dsh）此前的关系是**单向引入**：`docs/deepseek-harness-phase1/2/4-plan.md` 把 dsh 的工程纪律（可逆注册、单调 guard、会话日志单一事实源、重放测试、输出契约）落地为 Sati 变体。本计划方向反转——**把 Sati 专利域能力原生移植为 `@deepseek-ai/dsh-*` 插件族**，使 dsh 在无 Sati 进程的前提下具备完整的专利作业能力。

### 1.1 与 patent-mode-design.md 的关系（决策修订点，需用户知晓）

`deepseek-harness/patent-mode-design.md`（2026-08 已批准）的三条决策之一是「只搬内容，永不接 Sati——不移植其运行时引擎（Pregel / workflow 状态机 / checkpoint）」。本计划选择路线 A，**对该决策做定向修订**：

| 原决策 | 本计划修订 |
|---|---|
| 不移植 Sati 运行时引擎 | 移植专利域引擎（workflow/plantask/graph/atoms）为 dsh 插件包 |
| 不写 Sati MCP 桥、不依赖 Sati 进程 | 维持（本计划零桥接、零 Sati 进程依赖）——两者在"不依赖 Sati 进程"上一致，分歧仅在"引擎是否原生化" |
| 内容资产（技能/流程/人设）进 preset | **保留原设计 §4–§9 不变**，作为本计划 Phase 4 的 preset 组装蓝本 |

原设计 §11 风险 6 记载「若未来需要**判例系统化检索**，再单独评估（届时选项：给 Sati 补 MCP server 出口，或 Harness 侧原生工具）」——本计划即该评估的结论：选择"Harness 侧原生工具"。

### 1.2 目标（可验收）

在 dsh 中，**无 Sati 进程、无 MCP 桥**，仅靠 `@deepseek-ai/dsh-patent-*` 插件族 + 本地准备的 knowledge.db 数据文件，在 patent preset 会话中跑通完整作业链：

```
检索（patent_search）→ 元数据/法律状态 → 判例检索（patent_case_search）
→ 三性分析（graph 引擎）→ 权利要求撰写（draft_claims）→ 文书渲染（render_patent_document）
→ 质量门禁（规则引擎 + HITL 审批）
```

### 1.3 明确不做（范围排除）

- **不移植**：gateway/WebSocket 协议、Web UI/Electron 壳、21 个 IM 渠道适配器、白盒记忆（edgeclaw-memory-core，首期不做，见 §8 风险 4）、智能路由（`src/router/`，其语义深度耦合 Sati 的 AgentLoop，harness 用 `ctx.llm` 适配器 + `agent/*` 瀑布覆盖同职责）。
- **不迁移数据本体**：knowledge.db（21.5 万节点图谱、7.4 万判例、1500+ wiki 卡片）不进 git，走本机/私有准备方案（§3.4）；`专利原文/` 工作区数据原地。
- **不停止 Sati 本体演进**：双轨并存，用契约测试控制功能漂移（§8 风险 3）。
- **不移植**：knowledge 目录下的三个记忆供给器（`patent-memory-provider.ts`/`case-law-memory-provider.ts`/`legal-memory-provider.ts`，属白盒记忆子系统）与 `wiki-card-vector-index.ts`（依赖 `src/context/vector` 语义索引 + embedding——dsh 首期无向量基建，wiki 检索降级为关键词路径）。

### 1.4 许可证决策（2026-08-17 已决议）

- **决议**：迁入 dsh 的 `dsh-patent-*` 包与随包资产以 **MIT** 发布（与 dsh 仓库根协议一致——已实测 dsh 全仓 MIT）。
- **依据**：Sati 版权人（徐健）对原创代码享有再许可权；`nuo-patent` 本身为 MIT（`vendor/nuo-patent/LICENSE`）。
- **合规动作**（P0.5 落地）：
  1. 各迁入包加包级 `LICENSE`（MIT）；
  2. PilotDeck 衍生文件保留原 AGPL-3.0 出处声明（文件头/包内 NOTICE），并在 dsh 根 `THIRD_PARTY_NOTICES.md` 登记；
  3. `nuo-patent` 及其 node_modules 三依赖（cheerio/domhandler/undici）随 vendor manifest 登记 THIRD_PARTY_NOTICES；
  4. Sati 仓库本体 LICENSE 不变（AGPL-3.0，双轨并存）。
- 注记：PilotDeck 衍生部分的再许可范围，建议 P1.1 迁入时按文件实际引用/改写程度做一次出处审计（出处保留动作已覆盖证据链）。

### 1.5 实施地点与仓库边界（2026-08-17 定案）

**实施与验收主体：deepseek-harness 仓库**（`/Users/xujian/projects/deepseek-harness`）。理由：

1. **产物形态**：交付物是 `@deepseek-ai/dsh-patent-*` workspace 包，必须落在 dsh 的 `packages/patent/` 树内，才能被其 pnpm workspace aggregate、tsconfig 引用、`hygiene` 与 Loader/preset 组装消费；
2. **验证工具链**：REAL-composition、HMR-safety、`verify-package-invariants`、`doc-sync`、`llm-replay` 等门禁全部是 dsh 测试基建，只有在该仓库内才能跑；
3. **等价性测试方向**：P2.5 是「dsh 移植实现 vs Sati 原实现」对拍，测试代码写在 dsh 包内、只读引用 Sati 仓库的 fixture 输入/期望；
4. **CI 归属**：插件代码的 CI 全绿属于 dsh 仓库的 PR 流程。

**Sati 仓库的活动**（仅源侧，零代码改动，§7.4）：

| 活动 | 性质 |
|---|---|
| 源文件读取/搬迁（`src/patent`、`src/knowledge`、`src/rule`、`src/literature` 等） | 只读 |
| P0.4 跑 `scripts/trim-knowledge-db.ts` 生成本地裁剪库 | 执行 Sati 脚本，产物落用户数据目录（`~/.dsh/knowledge/`），不进任何 git |
| 等价性测试 fixture 供给（`tests/patent/` 输入/期望） | 只读 |
| Sati 本体回归确认（测试全绿、零改动） | 验证 |
| 契约同步门禁（风险 3c：outputSchema/错误码两仓同步） | Sati 侧唯一可能产生代码变更的点 |
| 本计划文档维护（主副本） | 文档 |

**数据边界**：knowledge.db 不做开源分发（§3.4）——本机真源裁剪/直用为主路径，跨设备同步走用户自定私有渠道，不经任何公共制品仓（含 GitHub Releases）。

**一句话**：实施在 dsh，源与回归在 Sati，数据在本机/私有渠道。

---

## 2. 现状核实（实证，2026-08-17）

### 2.1 Sati patent 域对外部 `src/` 模块的耦合面（grep 核实）

`src/patent/` 对 Sati 核心模块的依赖集中在 9 处（下表逐点列出），是移植的主要适配点：

| Sati 外部依赖 | 使用方（已核实） | dsh 移植落点 |
|---|---|---|
| `src/model/index.js`（`CanonicalModelRequest`/`CanonicalModelEvent`/`stream`） | `patent/chemistry/analyze.ts:32,129`、`figure/analyze.ts:37,129`、`figure/analyze-electrical.ts:30,100`（直接 `model.stream` 3 处）；`atoms/handlers/builtin/llm.ts` 经 `StageProvider` 结构类型注入；`llm-json.ts`/`evaluate/llm-judge.ts` 为零依赖纯逻辑（不计耦合） | `dsh-llm` 的 `LlmRuntime`/`LlmAdapter` 词汇（§3.3.1 ModelPort） |
| `src/rule/index.js`（`RuleOutputGate`/`RuleViolation`）+ `src/rule/runtime/text-utils.js` | `patent/output-gate.ts:1-2`、`patent/quality-gate.ts:21` | 规则引擎与门禁进 `dsh-patent-rule` 包；协议类型 + text-utils 前置 `dsh-patent-core`（§3.1，解除 P3.1→P4.1 顺序矛盾） |
| `src/workflow/index.js`（`FlowGraph` DAG） | `patent/workflow-dag.ts:15` | `dsh-patent-workflow` 包独立移植（harness `ctx.workflowEngine` 语义不同，不强行并入） |
| `src/tool/builtin/bash/commandRunner.js`（`NodeShellCommandRunner`） | `patent/data/nuo/egoSession.ts:24`（反爬子进程） | 声明式依赖注入：dsh 侧用 `ctx.subprocess.spawn` 适配实现（§3.3.5） |
| `src/permission/guard/ToolGuard.js`（类型） | `patent/guard/evidenceComplianceGuards.ts:13` | harness `ctx.tools.guard()`（单调 deny，语义已对齐——Sati 阶段一 T2 正是从 dsh 引入） |
| `src/tool/builtin/evaluateEvidence.js`（类型） | 同上（EVI-011 证据合规 guard 输入） | 并入 `dsh-patent-tools` 或 `dsh-patent-core` |
| `src/model/embedding/index.js`（`EmbeddingClient` 类型） | `patent/figure/retrieve.ts:17`（type-only，可选语义检索增强） | 首期不搬向量检索：figure 检索退化为关键词路径（Sati 原实现已支持该降级） |
| `src/tool/protocol/evidence.js`（`SatiEvidenceReceipt` 类型 + `receiptFromToolExecution` 值 re-export） | `patent/evidence/receipt.ts:12,16`、`evidence/index.ts:14` | 协议文件随 evidence 模块并入 `dsh-patent-core`（与 evaluateEvidence 工具解耦） |
| `src/knowledge/patent/ipc-classifier.js`（值：`classifyIpcTop`/`getIpcDomain`/`HIGH_CONFIDENCE_THRESHOLD`）+ `ipc-standards-loader` + `ipc-standards.yaml` 资产 | `patent/flexible-plan.ts:27` | 纯查表逻辑（零 db 依赖），前置并入 `dsh-patent-core`（§3.1） |
| `src/rule/runtime/asset-location.js`（`candidateRuleDirs`） | `patent/evidence/rule-loader.ts:13` | 随 `dsh-patent-rule` 整体搬入（§3.1） |

**结论**：patent 域内部模块（atoms/checker/claim-chart/problem/evidence/reasoning/graph 的纯逻辑部分）零 Sati 核心依赖，可整目录搬入；耦合面收敛为上述 **9 点**（新增 4 点均为轻量：类型 / 纯函数 / 单文件资产）。另实测 src/patent 对 gateway/context/session/telemetry/config/network 零引用。

### 2.2 nuo-patent vendor（数据引擎）

- 结构：自包含 npm 包（`dist/` 双格式 + `node_modules/{cheerio, domhandler, undici}` + LICENSE），无 Sati 内部依赖。
- 迁入方式二选一：a) 整体拷入 dsh `vendor/`（对齐 dsh vendoring 政策，manifest + SHA 记录）；b) 作为独立 workspace 包 `packages/patent/nuo-patent/`。**推荐 a**（vendor/README.md 已有同步纪律，且 nuo-patent 非 dsh 自研，遵循「pinned source copies」惯例）。
- 反爬链路 `egoSession.ts` 依赖 `NodeShellCommandRunner`（spawn node 子进程跑 ego-browser 脚本）——dsh 侧用 `ctx.subprocess.spawn` 适配（§3.3.5；`resolve`→`run` 是 `ctx.shell` 语义，不使用）。

### 2.3 Sati 工具形态与 dsh `defineTool` 的映射

Sati 工具为工厂模式：`createPatentSearchTool(options?)` 返回 `SatiToolDefinition`（name/aliases/title/description/kind/domain/inputSchema/outputSchema/execute，options 支持测试注入）。映射关系：

| Sati `SatiToolDefinition` | dsh `defineTool` | 处理 |
|---|---|---|
| `name` / `aliases` | `name` | aliases 不迁移（dsh 无此概念，dsh 语义是"一个名称一个注册"） |
| `description`（数组 join） | `description` | 原样 |
| `inputSchema`（JSON Schema 子集） | `parameters`（ParameterSchemaSpec） | 结构等价，字段名映射（required/properties/additionalProperties） |
| `outputSchema`（成功契约，已有强制校验） | `output.schema`（ValueSchemaSpec） | 直接搬（Sati 自研校验器与 dsh 校验语义同为"data 存在即校验"） |
| `execute`（返回 canonical 值） | `execute(args, exec)` | 返回体原样；`exec.signal` 对应 Sati 的 AbortSignal 参数 |
| `domain: "patent"`（业务域元数据） | dsh 无 domain 字段 | 用 dsh `ctx.tools.restrict()` + preset isolate realm 承担域裁剪（模型工具噪音控制，见 §3.3.6） |
| `timeoutMs`（阶段四 T6.1 产物） | dsh 用 `tools/execute` 环绕或内置 deadline 语义 | 已核实 dsh 的 `exec.signal` 由 registry 保证，wrapper 可替换；超时语义在移植时显式配置 |
| 工厂 options 测试注入 | dsh 用 Config schema + 依赖注入 | 测试注入改为 dsh 测试基建（`ctx.plugin`/Loader 组合） |

### 2.4 LLM 调用面

patent 域对模型调用的入口极窄（直接 `stream` 3 处：chemistry/figure/electrical；其余经结构类型注入，`llm-json.ts`/`llm-judge.ts` 为零依赖纯逻辑），移植时收敛为一个 `ModelPort`（§3.3.1），不需要搬 Sati 的 streaming/retry/路由层。

### 2.5 knowledge.db 打开路径

`src/knowledge/shared/db-version.ts`（阶段一 T3 产物）已封装 `openKnowledgeDb`（真源 fail-loud / 派生 needsRebuild / application_id 魔数）。移植时整文件搬入 `dsh-patent-knowledge`，打开路径（`case-law-search.ts`、`legal-search.ts`、`patentKgQuery` 等）原样复用 `node:sqlite`；其 shared 传递依赖（`fts`/`chunk-compression`/`schema-versions`/`knowledge-stats`/`kg/*`）须一并搬入，清单见 §3.1。

### 2.6 harness 侧挂点对照（能力 → 插件机制）

| Sati 能力 | dsh 挂点（已核实存在） |
|---|---|
| 专利域工具（23 个） | `ctx.tools.register(defineTool(...))` |
| 执行管线（workflow/plantask/flexible-plan） | 自建 `dsh-patent-workflow` Service（Definition/Provider/Consumer 三角色），不强行并入 `ctx.workflowEngine`（其面向通用脚本化 workflow，HITL 状态机语义不同） |
| 图引擎（Pregel 超步） | `dsh-patent-core` 内部模块（`ctx.workflowEngine` provider 注册作为可选集成，首期不做） |
| 规则引擎 + 输出门禁 | `tools/pre-execute`（guard）+ `tools/post-execute`（输出门禁，仅 accept/block，review 经 approval）+ `ctx.approval`（HITL 审批瀑布） |
| knowledge.db 查询 | 自建 `dsh-patent-knowledge` Service（Definition）+ 工具 Consumer；持久化用 `ctx.storage`（挂 sqlite 后端）存派生产物 |
| 会话产物落盘（workflow-store/claim-chart store） | 扩展 `SessionEventMap`（新增 `patent/*` 事件，模型可见=已记录）+ `ctx.storage` 存文件产物 |
| LLM 调用 | `ctx.llm`（`LlmRuntime`，注册 `LlmAdapter` 子类或直接消费） |
| bash/反爬子进程 | `ctx.subprocess.spawn` 声明式注入（spawn/spawnTerminal 语义） |
| 背景任务 | `ctx.jobs` |
| 人机确认（plantask HITL/审批） | `ctx.approval` + `tool-ask-user` |

---

## 3. 插件拆分组与依赖架构

### 3.1 包分组（建议 9 个包 + 1 个 preset）

命名遵循 dsh 惯例：`@deepseek-ai/dsh-<name>`，函数插件形态（具名导出 `name`/`inject`/`Config`/`apply`，无 default export），`src/types.ts` 纯类型 + `./invariant` 伴生 + 包级 `tests/`。

| 包 | 内容（迁移自 Sati） | 形态 | 依赖 |
|---|---|---|---|
| `dsh-patent-data` | `vendor/nuo-patent` 迁入 + `src/patent/data/nuo/`（mapper/searchProvider/patentCache/egoSession）+ `src/patent/persist-utils.ts`、`paths.ts` | Service（数据访问定义）+ 本地 Provider | `ctx.subprocess`（注入） |
| `dsh-patent-knowledge` | `src/knowledge/shared/`（`db-version`、`fts`、`chunk-compression`、`schema-versions`、`knowledge-stats`、`kg/{row-mapper,schema-introspector,graph-traversal}`）+ `case-law/`、`legal/`（含 `keywords.ts`）、`patent/`（wiki 卡片查询；**排除** `*-memory-provider.ts` 与 `wiki-card-vector-index.ts`）、kg 查询 | Service Definition + sqlite Provider | `ctx.storage`（派生产物） |
| `dsh-patent-core` | `src/patent/atoms/`、`checker/`、`claim-chart/`、`problem/`、`evidence/`、`reasoning/`、`graph/`（纯逻辑）+ `src/patent/llm-json.ts` + **前置类型/纯函数**：`src/rule/protocol/types.ts`、`src/rule/runtime/text-utils.ts`、`src/knowledge/patent/ipc-classifier.ts` + `ipc-standards-loader.ts` + `ipc-standards.yaml`、`src/tool/protocol/evidence.ts`（receipt 协议并入） | 纯 TS 库（无 ctx 依赖）+ 少量工具 | `ctx.llm`（ModelPort） |
| `dsh-patent-workflow` | `src/patent/workflow.ts`、`workflow-dag.ts`、`workflow-store.ts`、`flexible-plan.ts`、`flexible-plan-store.ts`、`plantask.ts`、`worker-contract.ts`、`approval.ts`、`output-gate.ts`、`quality-gate.ts` | Service（Definition/Provider/Consumer 三角色） | `dsh-patent-core`、`dsh-patent-data`、`ctx.approval` |
| `dsh-patent-tools` | 23 个内置工具（`src/tool/builtin/patent*.ts`、`draftClaims`、`draftSpecification`、`claimChart`、`evaluateEvidence`、`ruleCheck`、`analyzePatentFigure`、`searchPatentFigure`、`patentPdfDownload`、`recognizeChemicalStructure`、`renderPatentDocument`、`knowledgeNoteSave` 等）defineTool 化 | 函数插件（Consumer 层） | 全部 `dsh-patent-*` |
| `dsh-patent-rule` | `src/rule/` 引擎与资产（`RuleEngine`/`RuleLoader`/`rule-pack`/`asset-location`/`output-gate`，YAML 加载/评估）+ `rules/` 资产（compliance.yaml 等）+ `src/patent/guard/evidenceComplianceGuards.ts`（协议类型与 text-utils 已前置 core） | 函数插件（policy：guard + 输出门禁） | `dsh-patent-core` |
| `dsh-patent-document` | `src/patent/document/`（templateResolver/brandInjector/pdfRenderer/renderPatentDocument）+ `assets/templates/patent/`（5 模板） | 函数插件（工具） | `dsh-patent-core` |
| `dsh-tool-literature` | `src/literature/`（arXiv/OpenAlex/S2/Crossref 连接器 + 限速缓存） | 函数插件（2 工具：paper_list_sources/paper_search） | 轻依赖：`src/network/fetch.js`（`networkFetch` 值依赖）+ `SatiToolRuntimeError` 错误类 + 若干 type-only，随包搬运适配（**非零依赖**，最早可独立交付） |
| `dsh-methodology` | `src/methodology/`（TRIZ 40 原理 + 39×39 矩阵 data） | 函数插件（section + 工具） | 无 |
| `patent` preset | 沿用 patent-mode-design.md §4–§9（agent.cordis.yml + 7 个新写技能 + 4 个改写技能 + 工作目录约定） | agent preset（用户目录或 dsh bundle） | 上述全部 |

### 3.2 依赖图

```
dsh-tool-literature（轻依赖） ──┐
dsh-methodology（零依赖） ──────┤
dsh-patent-data ────────────────┤
dsh-patent-knowledge ───────────┤
                                ├→ dsh-patent-core ─┬→ dsh-patent-workflow ─┐
                                │                   │                       ├→ dsh-patent-tools ─→ dsh-patent-document
                                │                   └→ dsh-patent-rule ────┘
patent preset：组装以上全部（P4.1 起 rule 引擎注入 workflow 输出门禁）
```

注：`dsh-patent-workflow` 依赖 `dsh-patent-data`（plantask/flexible-plan 经 searchProvider 取数）；quality-gate/output-gate 所需的 rule 协议类型与 text-utils 已前置进 core（P2.1），故 workflow 与 rule 包之间**无编译期依赖**——rule 引擎由 P4.1 运行时注入 workflow 门禁调用点，P3.1→P4.1 顺序矛盾解除。

### 3.3 关键技术适配点（6 个，P0 必须全部敲定）

**3.3.1 ModelPort（LLM 适配层）**：新建 `dsh-patent-core` 内的 `model-port.ts`，定义 `PatentModelPort = { stream(request: PatentModelRequest, signal?): AsyncIterable<PatentModelEvent> }`，实现 A 消费 `ctx.llm`（`LlmRuntime.stream`），把 dsh-llm 的 Message/流词汇映射为 patent 域所需的 canonical 形态。Sati 侧 3 处直接 `stream` 调用点 + 结构类型注入面（`ChemistryModelClient` 等）全部改为经 port。**dsh 不提供"多 provider 路由"语义**（Sati router 的 fallback/场景识别不移植），provider 选择由 harness 侧 `ctx.llm` 适配器 + `agent/request` 瀑布承担。

**3.3.2 工具契约映射**：`createXxxTool` 工厂改为 dsh `defineTool` 注册（映射表见 §2.3）。23 个工具的 `outputSchema` 原样搬（Sati 阶段四已全量强制声明），`render`/`present*` 为新增编写项（Sati 无 render/UI 卡片分离，模型可见 prose 在 description + execute 返回中，需按 dsh 契约拆出 `output.render` 纯函数）。

**3.3.3 权限/守卫映射**：`evidenceComplianceGuards.ts`（EVI-011 域外/外文证据强制声明）→ `ctx.tools.guard()`（单调 deny，语义已对齐）；`PermissionRuntime` 其余规则不移植（harness `tools/pre-execute` + `permission-presets` 承担）。

**3.3.4 输出门禁 + HITL 审批**：Sati `RuleOutputGate` + `GatewayApprovalBus`（`approval_pending` 事件 + `approvalDecide` 命令 + UI 审批卡片）→ dsh `tools/post-execute`（门禁评估，返回 `accept`/`block` 二态——dsh `PostToolDecision` 无 `review` kind）+ `ctx.approval`（`approval/request` 瀑布，答案者 = dsh UI/ACP 桥，缺席 fail-closed）。`review` 语义映射：post-execute 命中 review 级规则时发起 approval 请求（而非直接 block）；block 级规则仍由 post-execute 直接 block。**语义差异**：Sati 的门禁在"回合输出"粒度，dsh 的门禁在"工具结果/内容块"粒度——移植时把专利输出门禁落在 `tools/post-execute` 对 `render_patent_document`/`draft_*` 等交付物工具的结果上，HITL 挂起用 `approval` 接缝表达，挂起态语义由 `dsh-patent-workflow` 的 plantask 状态机承接（`approval_pending` ↔ approval 请求）。

**3.3.5 bash/反爬子进程**：`NodeShellCommandRunner` → dsh `ctx.subprocess.spawn`（声明 `inject: ['subprocess']`；dsh subprocess 语义为 `spawn`/`spawnTerminal`/`resolveExecutable`——`resolve`→`run` 是 `ctx.shell`（ShellExecutor）的语义，ego-browser 子进程场景不用 shell）。ego-browser 脚本资产（`skills/ego-browser/`）迁入 `dsh-patent-data` 的 `assets/` 随包分发，运行时经 `ctx.subprocess` spawn node 子进程执行。

**3.3.6 域裁剪（domain 元数据）**：Sati `domain: "patent"` 的模型噪音控制 → dsh preset 的 `isolate` realm + `ctx.tools.restrict()`（注册可见集随会话域切换）。首期：patent preset 内注册全部专利工具，`restrict()` 在非 patent 会话默认不挂载（preset 天然隔离，无需额外逻辑）。

### 3.4 knowledge.db 数据准备方案（2026-08-17 修订：不做开源分发）

- **分发原则**：数据本体（实测 `~/.sati/knowledge/knowledge.db` ≈ **3.5 GB**）**不进 git、不做开源分发、不上传任何公共制品仓（含 GitHub Releases）**。
- **主路径（本机直用/本地裁剪）**：`dsh-patent-knowledge` 首次启动时探测 `~/.dsh/knowledge/`（或配置路径），缺失时引导运行 `patent-knowledge:install`——该命令从本机真源库（`~/.sati/knowledge/knowledge.db` 或 `--from <path>` 自备库）复用 Sati `scripts/trim-knowledge-db.ts` 裁剪生成 `~/.dsh/knowledge/knowledge-lite.db`（图谱 + 判例 FTS + 法规 + wiki 精选）；单机直用亦可直接以只读方式指向真源库，无需裁剪。命令载体由 P0.2 定案（dsh 未发现 CLI 命令插件注册接缝，倾向包内脚本 + `npx`/README 引导）。
- **私有同步（可选，非计划交付物）**：跨自有设备同步时走用户自定的私有渠道（私有服务器/网盘/内网），渠道由用户自行配置，计划不承担、不预置任何公共下载点。
- **裁剪约束**：若裁剪，目标体积与能力保留由 P0.4 实证（trim 脚本仅 VACUUM 亦 ~4.8G，需组合 `--compress-chunks` + 删 embeddings 等，并同步出具「检索能力保留矩阵」）。
- **版本纪律**沿用 Sati `openKnowledgeDb`（application_id 魔数 + user_version），库文件与插件版本解耦（库版本 < 插件期望 → fail-loud 提示升级数据包）。
- **备选**（若裁剪体积过大且仅需轻量场景）：首期仅分发 wiki 卡片 + 判例索引描述文件，全文检索退回本机真源库按需查询。注意：仓库内 md 源实测仅 17 个文件（`src/knowledge/patent/wiki/`），1500+ 卡片在 db 内，git 化前须先核实 md 生成源。

---

## 4. 分阶段任务分解

> 里程碑：P0（契约）→ P1（数据层）→ P2（校验器）→ P3（管线+工具）→ P4（门禁/文书/preset）。P1–P4 各自可独立验证，依赖顺序为 P1→P2→P3→P4。

### 4.1 P0：契约与骨架（0.5–1 周）

| # | 任务 | 交付 |
|---|---|---|
| P0.1 | 在 dsh 仓库建立 `packages/patent/` 组目录 + 9 个包的脚手架（package.json/tsconfig/tsdown/invariant 空壳 + README 规范模板） | 包骨架，`pnpm build` 通过 |
| P0.2 | 敲定 6 个适配点（§3.3）的接口签名：ModelPort、工具契约映射表、guard 接线、approval 映射、subprocess 注入、域裁剪；并定案 `patent-knowledge:install` 命令载体与数据来源（本机真源/自备库路径，§3.4） | 接口契约文档（本文档 §3.3 定稿版）+ 数据准备定案记录 |
| P0.3 | 与 patent-mode-design.md 决策修订确认（§1.1 修订点用户签字） | 决策记录 |
| P0.4 | 本地库准备验证：跑 `trim-knowledge-db.ts` 生成裁剪库 + 测体积 + 检索能力保留矩阵（单机直用可跳过裁剪） | 裁剪库体积报告 + 能力保留矩阵 |
| P0.5 | 许可证落地（§1.4）：包级 LICENSE（MIT）+ dsh 根 THIRD_PARTY_NOTICES.md 登记（nuo-patent 及三依赖、PilotDeck 出处保留）+ P1.1 迁入时出处审计 | 许可证落地记录 |

### 4.2 P1：数据层（1–2 周）

| # | 任务 | 依赖 | 要点 |
|---|---|---|---|
| P1.1 | nuo-patent 迁入 dsh `vendor/`（manifest + SHA） | P0.1 | 含 node_modules 三依赖的 lock 记录 |
| P1.2 | `dsh-patent-data`：`data/nuo/` 四文件搬入 + egoSession 改 `ctx.subprocess` 注入 | P0.2 | `searchProvider` 的 `StageProvider` 接口类型改为引用 `dsh-patent-core`（P2 前置，先定义类型占位） |
| P1.3 | `dsh-patent-knowledge`：`db-version.ts` + 判例/法规/wiki/kg 查询搬入 + `patent-knowledge:install` 命令 | P0.4 | 打开路径全部走 `openKnowledgeDb`（真源 fail-loud） |
| P1.4 | `dsh-tool-literature`（独立交付，不依赖 patent） | P0.1 | 连接器/限速/缓存整包搬入，2 个工具 defineTool 化 |
| P1.5 | P1 验收 | | 见 §5 |

**P1 验收**：`dsh --profile patent "检索 abstract 含 graphene 的 2024 年专利"` 在 headless 会话返回结构化命中（无 Sati 进程）；`patent_case_search` 对本地库返回判例命中；literature 双工具可用。REAL-composition 测试（Loader 起 cordis.yml）通过。

### 4.3 P2：纯校验器（1–2 周）

| # | 任务 | 依赖 | 要点 |
|---|---|---|---|
| P2.1 | `dsh-patent-core`：atoms（atom.ts/handler.ts/handlers/builtin 10 个）+ `llm-json.ts` 搬入，ModelPort 定义落地；**前置搬入 rule 协议类型 + `text-utils` + `ipc-classifier`/`ipc-standards`**（解除 P3.1→P4.1 顺序矛盾） | P1.2 | atoms 的 LLM 调用改走 port |
| P2.2 | checker（11 文件）+ problem/atomicChecker + evidence（engine/rule-loader 等）+ reasoning（fact-blackboard/syllogism）搬入 | P2.1 | 纯函数，零 ctx 依赖 |
| P2.3 | claim-chart（element-validator/mapping-machine/gap-detector/pin-cite-validator + store）+ persist-utils/paths 搬入 | P2.1 | store 落盘改 `ctx.storage`（或首期本地文件 + session 事件） |
| P2.4 | graph（engine/adapter/merge/node-policy/degradation/checkpoint/domains 三性子图）搬入 | P2.1–P2.3 | checkpoint 存 JsonFileStore → dsh storage 接缝 |
| P2.5 | 移植等价性测试（Sati 原实现 vs dsh 移植，固定 fixture 输出一致） | P2.1–P2.4 | 复用 Sati `tests/patent/` 既有 spec 的输入/期望，逐模块搬运 |

**P2 验收**：Sati `tests/patent/*` 中纯校验类 spec 全量搬运通过（目标 ≥80% 直接搬）；graph 三性子图在 fixture 上与 Sati 输出一致；无模型 key 的确定性用例全绿。

### 4.4 P3：执行管线 + 工具全量（2–4 周）

| # | 任务 | 依赖 | 要点 |
|---|---|---|---|
| P3.1 | `dsh-patent-workflow`：workflow.ts/workflow-dag.ts/workflow-store/flexible-plan/plantask/worker-contract/approval/output-gate 搬入，状态机 HITL 接线 `ctx.approval` | P2 | `approval_pending` ↔ approval 请求；plantask 状态持久化 → session 事件 + storage；output-gate/quality-gate 消费 core 中的 `RuleOutputGate` 接口类型（引擎由 P4.1 运行时注入，编译顺序解耦） |
| P3.2 | 23 个工具 defineTool 化（Consumer 层），分批：首批 8 个高频（patent_search/metadata/legal_status/case_search/wiki_search/claim_chart_build/render_patent_document/rule_check） | P1+P2+P3.1 | 每工具补 `output.render`；`present*` 二期；**估时风险（§8 风险 9）**：Sati 无 render 拆分，首批 8 个实测后复核其余 15 个估时 |
| P3.3 | `analyze_patent_figure`/`search_patent_figure` 门禁（`resolveModelInfo` 能力解析，Sati 阶段四 T3 产物）→ dsh 侧模型能力查询 | P3.2 | 图片模态准入：模型未声明 image 即拒绝并点名 |
| P3.4 | `dsh-patent-document`：document/ 搬入 + 5 模板资产随包分发 + Chrome headless 打印 PDF 经 `ctx.subprocess` | P3.2 | 模板路径解析改包内 assets |
| P3.5 | P3 验收 | | 见 §5 |

**P3 验收**：完整作业链 headless 跑通（检索→分析→撰写→渲染→门禁拦截），HITL 审批经 dsh approval 接缝可放行/拒绝；工具结果进 session log 且重放可重建；`tools/result` 观察点有专利工具结果审计。

### 4.5 P4：规则门禁 / preset 组装（1–2 周）

| # | 任务 | 依赖 | 要点 |
|---|---|---|---|
| P4.1 | `dsh-patent-rule`：`src/rule/` 引擎移植（YAML 加载/评估/输出门禁）+ `rules/patent/compliance.yaml` 等资产随包分发 + 输出门禁接线 `tools/post-execute` | P3.1 | 规则资产随包；分层规则包（base/domains/pack.yaml）语义保留；`RuleOutputGate` 实现注入 workflow 门禁调用点（review → `ctx.approval`） |
| P4.2 | evidenceComplianceGuards → `ctx.tools.guard()` 注册 | P4.1 | EVI-011 语义不变，guard 无 HITL |
| P4.3 | `dsh-methodology`：TRIZ 组件 + data 随包分发（section + 工具） | P0.1 | 独立交付 |
| P4.4 | patent preset：沿用 patent-mode-design.md §4 agent.cordis.yml + §5 工作目录 + §6 persona + §7 技能（7 新写 + 4 改写）+ §8 流水线 + §9 知识库策略（改为读 `dsh-patent-knowledge` 而非"无引擎文件库"） | P1–P3 全部 | 原设计 §9 的"无引擎版"升级为"引擎版"：`99-知识库/` 保留为项目级沉淀，系统库走 dsh-patent-knowledge |
| P4.5 | P4 验收 + 全链回归 | | 见 §5 |

**P4 验收**：交付物工具（draft_*/render_patent_document）输出被门禁拦截且可经 approval 放行；EVI-011 guard 在 session allow 存在时仍 deny（单调）；patent preset 新会话可选，persona/技能/流程生效。

---

## 5. 测试策略

遵循 dsh 测试纪律（`docs/testing.md` + `packages/AGENTS.md`）：

| 层级 | 内容 | 来源 |
|---|---|---|
| 包级单测 | 移植模块的既有 spec 搬运（`tests/patent/`、`tests/knowledge/`、`tests/literature/` 等） | Sati 现有测试直接搬运，断言不变 |
| 等价性测试 | 同一 fixture 输入下，Sati 原实现 vs dsh 移植输出的结构等价（graph/atoms/claim-chart/checker） | 新增（P2.5），防"移植即漂移" |
| REAL-composition | 每个产品可见插件包：Loader 启动测试 cordis.yml，断言 model-visible/durable/user-visible 输出 | dsh 强制要求（docs/testing.md），新增 |
| HMR-safety | dispose 贡献 fiber 后注册全部回滚（工具消失） | dsh 强制要求（docs/testing.md），新增 |
| 快照（snapshot） | 专利作业链的 keyless 回放：LLM 调用用 dsh `llm-replay` 录制 fixture（patent 场景：检索→分析→撰写） | 复用 harness 基建，P3.4 录制 |
| invariant 伴生 | 每包 `./invariant`：注册清单名 + 断言"事件/数据关系"（如 `patent/search` 结果与 `tools/result` 观察一致）；无关系则空安装器 + 具体原因 | dsh 强制要求 |
| 输出契约 | 工具 `output.schema` 强制校验（dsh registry 内建）+ 违约拦截用例 | 沿用 Sati 阶段四 T9 契约，dsh 侧注册期即校验 |

**测试注入差异**：Sati 工具工厂的 `options.search` 注入改为 dsh 测试基建（组合测试中 mock `ctx.llm`/外部服务），不保留工厂注入参数（对齐 dsh「typed same-process 边界不做运行时校验」原则）。

---

## 6. 任务清单（可勾选）

| # | 任务 | 依赖 | 估算 | 状态 |
|---|---|---|---|---|
| P0.1 | 9 包脚手架 + invariant 空壳 + README 模板 | — | 1d | ⬜ |
| P0.2 | 6 适配点接口定稿（ModelPort/工具映射/guard/approval/subprocess/域裁剪）+ install 命令载体/数据来源定案 | — | 2d | ⬜ |
| P0.3 | patent-mode-design.md 决策修订确认 | — | 0.5d | ⬜ |
| P0.4 | knowledge.db 本地裁剪库验证 + 检索能力保留矩阵 | — | 1d | ⬜ |
| P0.5 | 许可证落地（MIT + THIRD_PARTY_NOTICES 登记 + 出处审计） | P0.3 | 0.5d | ⬜ |
| P1.1 | nuo-patent 迁入 vendor（manifest+SHA） | P0.1 | 1d | ⬜ |
| P1.2 | dsh-patent-data（data/nuo + egoSession 注入改造） | P0.2 | 3d | ⬜ |
| P1.3 | dsh-patent-knowledge + install 命令 | P0.4 | 3d | ⬜ |
| P1.4 | dsh-tool-literature | P0.1 | 2d | ⬜ |
| P1.5 | P1 验收（REAL-composition + headless 冒烟） | P1.1–P1.4 | 1d | ⬜ |
| P2.1 | dsh-patent-core：atoms + llm-json + ModelPort + rule 类型/text-utils/ipc 查表前置 | P1.2 | 3d | ⬜ |
| P2.2 | checker/problem/evidence/reasoning 搬入 | P2.1 | 3d | ⬜ |
| P2.3 | claim-chart + persist-utils/paths | P2.1 | 2d | ⬜ |
| P2.4 | graph 引擎 + 三性子图 | P2.1–P2.3 | 4d | ⬜ |
| P2.5 | 等价性测试（Sati vs dsh fixture 对拍） | P2.1–P2.4 | 2d | ⬜ |
| P3.1 | dsh-patent-workflow（管线 + plantask + approval 接线） | P2 | 5d | ⬜ |
| P3.2 | 23 工具 defineTool 化（首批 8 + 其余 15） | P1+P2+P3.1 | 6d | ⬜ |
| P3.3 | 图片门禁（模型能力解析） | P3.2 | 2d | ⬜ |
| P3.4 | dsh-patent-document（渲染 + 模板分发） | P3.2 | 3d | ⬜ |
| P3.5 | P3 验收（作业链 + 审批闭环 + 重放） | P3.1–P3.4 | 1d | ⬜ |
| P4.1 | dsh-patent-rule（引擎 + 资产 + 输出门禁） | P3.1 | 4d | ⬜ |
| P4.2 | evidenceComplianceGuards → tools.guard() | P4.1 | 1d | ⬜ |
| P4.3 | dsh-methodology（TRIZ） | P0.1 | 2d | ⬜ |
| P4.4 | patent preset 组装（沿用 patent-mode-design.md §4–§9） | P1–P3 | 5d | ⬜ |
| P4.5 | P4 验收 + 全链回归 | P4.1–P4.4 | 2d | ⬜ |

**总计：约 12–19 人周**（P0 5d + P1 10d + P2 14d + P3 17d + P4 14d = 60d ≈ 12 周，按单人串行口径；P1/P2/P4.3 可并行）。

---

## 7. 检查清单（全阶段验收）

### 7.1 静态与构建（dsh 仓库）

- [ ] `pnpm typecheck` 0 错误（新增包纳入 aggregate + tsconfig 引用）
- [ ] `pnpm lint` 0 error / 0 warning
- [ ] `pnpm build` 通过（tsc lib/types + tsdown runtime）
- [ ] `pnpm hygiene`（knip/publint/workspace 约束/NodeNext 消费检查）通过
- [ ] `pnpm doc-sync` 通过（README 规范 + 已知局限清单）
- [ ] 许可证落地：包级 LICENSE（MIT）+ 根 THIRD_PARTY_NOTICES.md 登记（nuo-patent 及依赖、PilotDeck 出处保留）

### 7.2 测试

- [ ] 每包 `tests/` 全绿（含搬运 spec）
- [ ] 等价性测试：graph/atoms/claim-chart/checker 与 Sati 输出一致
- [ ] 产品可见包 REAL-composition 测试通过（Loader 起 cordis.yml）
- [ ] HMR-safety：dispose fiber 后注册全部回滚
- [ ] 快照：patent 作业链 keyless 重放通过
- [ ] invariant 门禁通过（`verify-package-invariants`）

### 7.3 行为验证

- [ ] `dsh --profile patent "检索 → 元数据 → 判例"` 无 Sati 进程跑通
- [ ] 三性分析（graph novelty/inventiveness/enablement）产出与 Sati 一致
- [ ] 交付物工具被输出门禁拦截，approval 可放行/拒绝
- [ ] EVI-011 guard 在 session allow 下仍 deny（单调）
- [ ] 图片工具在文本模型下被拒且点名模型
- [ ] knowledge.db 缺失时 `patent-knowledge:install` 引导可用

### 7.4 回归（不破坏既有）

- [ ] dsh 既有插件（tool-bash/fs/web/subagent 等）在 patent preset 下正常
- [ ] Sati 本体测试不受影响（本计划不动 Sati 代码，除文档外零改动）
- [ ] patent-mode-design.md §4–§9 的 preset 内容方案与引擎版知识库策略兼容（§9 修订点）

---

## 8. 风险与注意事项

1. **决策冲突（已决议，仍需文档同步）**：patent-mode-design.md「永不接 Sati」决策已由本次评审修订正式翻转（§1.1 + §1.4 许可证定案，P0.3/P0.5 落地）；实施时须同步更新该设计文档的 §1/§11，避免双文档矛盾。
2. **裁剪库体积与私有同步**：本机直用无体积约束（真源 3.5 GB 可直接只读打开）；若需跨设备私有同步，裁剪库可能仍超百 MB，此时降级方案为「wiki 卡片 + 判例索引 + 按需回真源库查询」。P0.4 必须先出体积与能力保留报告。
3. **双轨演进漂移**：Sati 本体与 dsh 插件的功能会自然分叉。对策：a) 等价性测试锁定已移植行为；b) 移植后 Sati 侧专利域**冻结为只修 bug**（新增能力优先在 dsh 侧做）；c) 契约（outputSchema/错误码）两仓同步门禁。
4. **白盒记忆缺位**：edgeclaw-memory-core 首期不移植，patent preset 的记忆靠「文件即库」（patent-mode-design.md §9 的 `99-知识库/` 约定）+ 会话日志。若后续要移植，edgeclaw-memory-core 是独立 workspace 子包，可整体作为 dsh 依赖（工作量另行评估）。
5. **智能路由不移植的影响**：Sati 的多 provider fallback/场景路由不随迁；harness 用 `ctx.llm` 适配器注册 + `agent/request` 瀑布承担等价职责，但「路由后压缩」「零用量重试」等 Sati 特有语义不保留——需要用户确认接受（或 P3 后按需以 dsh 插件补丁形式实现）。
6. **native 依赖打包**：`@rdkit/rdkit`（化学识别）、`sharp`/`mupdf`（PDF/图处理）是重型 native 依赖，dsh 侧打包策略需评估（Node ABI 兼容、体积）。首期对策：`recognize_chemical_structure`/PDF 渲染标记为「可选安装」（preset 内技能说明），核心作业链（检索/分析/撰写/门禁）不依赖它们。
7. **ego-browser 反爬的运维责任**：反爬脚本随 `dsh-patent-data` 分发，站点反爬升级需要同步维护；dsh 侧无 Sati 的 `skills/ego-browser` 学习目录，首期用静态脚本 + 显式降级（fetch 回退），学习目录二期评估。
8. **HITL 审批语义差异**：Sati 门禁在「回合输出」粒度，dsh approval 在「工具/内容」粒度；plantask 挂起态与 approval 挂起态的对应关系需 P0.2 定稿（建议：plantask 阶段等待 = approval 请求未决，放行 = approve，拒绝 = reject 并回退阶段）。
9. **P3.2 估时乐观**：Sati 工具无 render 拆分，每个工具需补 `output.render` 纯函数 + 契约映射 + 组合测试；首批 8 个实测后复核其余 15 个的估时（6d 可能上浮 50%+）。
10. **裁剪后检索能力保留**：3.5 GB → <500MB 裁剪若裁掉判例全文/图谱主体，`patent_case_search`/`patent_kg_query` 核心价值受损；P0.4 必须同步出具「检索能力保留矩阵」并与用户确认可接受的最低能力线。

---

## 9. 工作量与里程碑汇总

| 里程碑 | 内容 | 周期（单人） | 验收标志 |
|---|---|---|---|
| M0 | P0 契约与骨架 | ~1 周 | 接口定稿 + 决策修订签字 + 许可证落地 |
| M1 | P1 数据层 | ~2 周 | 检索/判例/literature headless 可用 |
| M2 | P2 校验器 | ~3 周 | 纯校验器等价性全绿 |
| M3 | P3 管线+工具 | ~4 周 | 完整作业链 + 审批闭环 + 重放 |
| M4 | P4 门禁/preset | ~3 周 | patent preset 全链验收 |

**总计约 12–19 人周**；若并行（P1 与 P4.3、P2 与 P1.4），日历周期可压至 ~8–10 周。
---

## 10. P0 执行记录（2026-08-17 实施）

> 本节由 deepseek-harness 侧执行时追加，记录 P0 各任务的落地结果与定稿契约。本节是实施状态（当前态），原始 §1–§9 保留为计划正文。

### 10.1 P0.3 决策修订确认（用户批准）

2026-08-17 用户指示「根据 docs/sati-as-dsh-plugins-plan.md 执行」，视为对 §1.1 决策修订点的批准：移植专利域引擎（workflow/plantask/graph/atoms）为 dsh 插件包；维持零 Sati 进程、零 MCP 桥；patent-mode-design.md §4–§9 保留为 Phase 4 preset 组装蓝本。同步动作（风险 1）：patent-mode-design.md 的 §1/§11 需在 P4.4 组装时更新，避免双文档矛盾。

### 10.2 P0.1 包脚手架（9 包 + 组 README）

- 已建立 `packages/patent/` 组与 9 个包骨架：`patent-data` / `patent-knowledge` / `patent-core` / `patent-workflow` / `patent-tools` / `patent-rule` / `patent-document` / `tool-literature` / `methodology`。
- 每包含 package.json、tsconfig.json、src/index.ts（Service 或函数插件形态）、src/types.ts（patent-core：ModelPort 契约）、src/invariant.ts、LICENSE（MIT）、README（英中双语 + i18n 记录）、tests/scaffold.spec.ts。
- 注册：tsconfig.base.json 两条 wildcard（`@deepseek-ai/dsh-*` 与 `@deepseek-ai/dsh-*/invariant`）、tsconfig.host.json 9 条 references、packages/README.md（+zh）层级表、packages/patent/README.md 组 README。
- 门禁结果：`tsc -b tsconfig.host.json`、tsdown build、vitest（9 测试全绿）、verify-package-invariants（232 包 conform）、verify-dsh-package-licenses（236 包 MIT）、constraints、knip、publint、verify-built-package-invariants、verify-cordis-config、verify-node-next-types、verify-runtime-closure、verify-vendored-links、package README model-experience/limitations、translation-pairing（963 对一致）、verify-md-links / verify-md-wrap / verify-package-paths 全部通过。
- 已知：`pnpm hygiene` 的 rescope-vendor:check 在 clean HEAD 即有 27 处 pre-existing residue（docs/event-producer-consumer.md、packages/api/remotes、packages/extensions 等，全部与本次改动无关，本次新增文件零 residue）。

### 10.3 P0.2 六大适配点定稿（§3.3 定稿版）

1. **ModelPort（§3.3.1 定稿）**：`dsh-patent-core/src/types.ts` 定义 `PatentModelRequest { messages: PatentModelMessage[] }`、`PatentModelMessage { role: "system"|"user"|"assistant"; content: string }`、`PatentModelEvent = { type:"delta"; text } | { type:"done"; usage? }`、`PatentModelPort.stream(request, signal?): AsyncIterable<PatentModelEvent>`。P2.1 实现将 dsh `LlmRuntime.stream(options: GenerateOptions): AsyncIterable<StreamChunk>`（packages/llm/llm）的 `GenerateOptions`/`StreamChunk` 词汇映射为 canonical 形态；provider 选择由 harness `ctx.llm` 适配器 + `agent/request` 瀑布承担（Sati router 不移植）。
2. **工具契约映射（§3.3.2 定稿）**：Sati `createXxxTool` 工厂 → dsh `defineTool({ name, description, parameters, output, execute })`（`@deepseek-ai/dsh-tools`）；aliases/domain 不迁移；`output.schema` 原样搬；`output.render` 为新增编写项；域裁剪由 preset isolate realm + `ctx.tools.restrict()` 承担。
3. **权限/守卫映射（§3.3.3 定稿）**：EVI-011 证据合规守卫 → `ctx.tools.guard()` 注册单调 deny guard。dsh `ToolGuard` 在 `tools/pre-execute` 之后评估、无 allow 语义、返回 `undefined` 不改判（packages/core/tools 已核实），与 Sati 单调 deny 语义对齐；guard 无 HITL。
4. **输出门禁 + HITL（§3.3.4 定稿）**：专利输出门禁落在 `tools/post-execute` 瀑布（`PostToolDecision` 二态 accept/block，无 review kind）；review 级规则命中时经 `ctx.approval.request(req): Promise<ApprovalOutcome>`（`approval/request` 瀑布，packages/interaction/user-approval）发起 HITL；plantask 挂起态 = approval 请求未决，放行 = approve，拒绝 = reject 并回退阶段（风险 8 定稿）。
5. **bash/反爬子进程（§3.3.5 定稿）**：egoSession 声明 `inject: ["subprocess"]`，用 `ctx.subprocess.spawn` / `spawnTerminal` / `resolveExecutable`（`SubprocessRuntime`）适配 `NodeShellCommandRunner`；ego-browser 脚本资产随 `dsh-patent-data` 的 `assets/` 分发，运行时经 `ctx.subprocess` spawn node 子进程执行；`resolve`→`run` 的 `ctx.shell` 语义不使用。
6. **域裁剪（§3.3.6 定稿）**：patent preset 内注册全部专利工具（preset 天然隔离，非 patent 会话不挂载）；`ctx.tools.restrict()` 用于会话内子域切换（首期不实现，P3.2 工具落地后按需）。

### 10.4 P0.4 数据准备定案（§3.4 定稿）

- 数据本体（真源 ~3.5 GB）不进 git、不做开源分发、不上传任何公共制品仓。
- 主路径：`dsh-patent-knowledge` 首次启动探测 `~/.dsh/knowledge/`（或配置路径），缺失时引导 `patent-knowledge:install`——从本机真源库（`~/.sati/knowledge/knowledge.db` 或 `--from <path>`）复用 Sati `scripts/trim-knowledge-db.ts` 裁剪生成；单机直用可直接以只读方式指向真源库。
- 命令载体定案：dsh 无 CLI 命令插件注册接缝 → `patent-knowledge:install` 以包内脚本 + README 引导（P1.3 落地）。
- 裁剪体积与「检索能力保留矩阵」由 P0.4 实证（trim 脚本仅 VACUUM 亦 ~4.8G，需组合 `--compress-chunks` + 删 embeddings），在 P1.3 前完成。

### 10.5 P0.5 许可证落地

- 9 个迁入包均加包级 `LICENSE`（MIT，与 dsh 根协议一致）；manifest `license: "MIT"`（verify-dsh-package-licenses 全绿）。
- THIRD_PARTY_NOTICES.md 由 scripts/gen-third-party-notices.ts 生成（输入为 workspace manifest）；nuo-patent 及其三依赖（cheerio/domhandler/undici）的登记随 P1.1 vendor manifest 落地。
- PilotDeck 衍生出处审计随 P1.1 迁入时按文件实际引用/改写程度执行（出处保留动作覆盖证据链，§1.4 注记）。

### 10.6 P0 验收对照（§7.1）

- [x] `pnpm typecheck`（build:lib:host）0 错误（新增包纳入 aggregate + tsconfig 引用）
- [x] `pnpm build`（tsc + tsdown）通过
- [x] `pnpm hygiene` 除 rescope-vendor 预存残留外全绿（见 10.2 注）
- [x] 许可证落地：包级 LICENSE（MIT）+ manifest 声明
- [x] 包级 tests/ 全绿、invariant 门禁通过、README 双语与 Model Experience 契约通过
### 10.7 P1 进度记录（2026-08-17）

#### P1.1 完成（见 §10.5 后续）：nuo-patent 迁入 vendor/

- `vendor/nuo-patent` 以 `@deepseek-ai/nuo-patent` v2.3.1 迁入（prebuilt dist，无 src；上游提交 `5e48684c2cfd38969935223eb2962da4ff784b2f`）。
- 适配：package.json rescope（保留 upstream version/exports/type/main/types 与三依赖 cheerio/domhandler/undici，去掉 bin/scripts/optionalDependencies）、`tsdown.config.mjs` 空构建覆盖（`entry: ""`，规避根 workspace 构建对 prebuilt 包的入口错误）、constraints `vendoredPackages` 集合加入、vendor/README manifest 行 + 本地修改日志第 18 条。
- 门禁：verify-vendored-links（10 名）、constraints、licenses、ESM import 冒烟全绿；THIRD_PARTY_NOTICES.md 已登记 nuo-patent + cheerio + domhandler + undici。

#### P1.4 完成：dsh-tool-literature

- 移植：`src/literature/`（protocol/ConnectorRegistry/createLiteratureRegistry/http/shared/connectors × 4/paperSearch/paperListSources）+ `src/network/fetch.ts`（随包适配为 internal/network-fetch）+ `SatiToolRuntimeError` → `LiteratureToolError`。
- 工具：`paper_list_sources` / `paper_search` defineTool 化（`output.render` 纯函数，失败结构化）；Config（连接器开关 + polite-pool/key）。
- 测试：10 文件 53 用例（4 连接器 spec + http/xml/text + 真实工具执行 + Loader REAL-composition + HMR-safety）。
- 文档：双语 README、gen-tool-catalog 注册 + tool-catalog（en/zh）、config-catalog（en/zh）重生成、964 对配对一致。
- 门禁：build:lib:host / vitest / invariants / licenses / constraints / knip / publint / built-invariants / tool+config+cordis-catalog / doc-graphs / type-equiv / md-wrap / md-links / package-paths 全绿。

#### P1.2 / P4.3 进行中（子代理移植）

- P1.2 `dsh-patent-data`：data/nuo 四文件 + persist-utils + paths，`NodeShellCommandRunner` → `ctx.subprocess.spawn`，`StageProvider` 类型占位进 patent-core，`nuo-patent` → `@deepseek-ai/nuo-patent`。
- P4.3 `dsh-methodology`：TRIZ 40 原理 + 39×39 矩阵（data 36K 随包），`triz` 工具 + 注册表库 API。
#### P1.2 完成：dsh-patent-data

- 移植：data/nuo 四文件（searchProvider/patentCache/mapper/egoSession）+ persist-utils + paths，`nuo-patent` → `@deepseek-ai/nuo-patent` 引用。
- `PatentData` service（`static inject = ["subprocess"]`，`ctx.patentData`）暴露 `createSearchProvider(options?)`（LRU 缓存包 nuo searchPatents）与 `createEgoSession(options?)`（ego-browser 会话运行器）。
- subprocess 适配（§3.3.5 落地）：`SubprocessEgoSpawnRunner` 将 NodeShellCommandRunner 映射为 `ctx.subprocess.spawn`（argv `[ego-browser, nodejs]`、脚本经 `stdin: { data }` 直传不做 shell 展开、collect 模式输出、timeout→terminate + 3s grace；PATH 注入/超时/输出截断/会话 task-space 命名/`EGO_SCRIPT_EOF` 标记语义保留）。
- `StageProvider` + `StageSearchHit` 类型占位进 patent-core（`export type *` 再导出，PatentModelPort 未动，type-equiv 保持绿）。
- 测试：47 用例（4 个 Sati spec 移植 + 真实 service 测试 + Loader REAL-composition + HMR-safety）；cordis-catalog 类型链接豁免登记 4 个新类型。

#### P4.3 完成：dsh-methodology

- 移植：protocol/registry/injector + 8 组件 + TRIZ 数据（`assets/triz-matrix.json` + `assets/triz-principles.json` 36K 随包，`files: ["assets"]` 约束白名单登记，`new URL(..., import.meta.url)` 解析，source 与 built lib 均可加载）。
- 模型面：`triz` defineTool（无参→39 参数 + 40 原理目录；improving+worsening→矩阵格推荐原理）+ `tool:triz` system-prompt section（order 111，`registerSection` 配置开关默认 true）；`MethodologyRegistry` 全量 8 组件以库 API 提供（不自动挂载）。
- 测试：28 用例（Sati spec 移植 + 真实工具测试 + Loader REAL-composition 含 built-lib 资产冒烟 + HMR-safety）；tool-catalog 注册（en/zh）。

#### P1 阶段性验收状态

- P1.4（literature）、P1.2（data）、P4.3（methodology）全部落地：134 个专利域测试全绿，build:lib:host 通过，invariants/licenses/constraints/knip/publint/built-invariants/README 双门禁/pairing（964）/tool+config+cordis-catalog/doc-graphs/type-equiv/md-wrap/md-links/package-paths 全绿。
- 待办：P1.3（dsh-patent-knowledge + install 命令）、P1.5（P1 验收：`dsh --profile patent` headless 冒烟需 preset 组装后验证）、P2.x（patent-core 校验器族）。
#### P1.3 完成：dsh-patent-knowledge

- 移植：shared/{db-version,fts,chunk-compression,schema-versions,knowledge-stats,kg/*} + case-law/（CaseLawSearchEngine + rrf）+ legal/（legal-search/knowledge-law-search/keywords/dedupe/row-mapper/sql）+ patent/（ipc-classifier + ipc-standards.yaml 随包 assets + patent-kg-adapter + wiki-card-loader 关键词路径；排除 memory providers 与向量索引）+ config（resolveKnowledgeDbPaths 适配 ~/.dsh/knowledge）。
- `PatentKnowledge` service（`ctx.patentKnowledge`）：caseLawSearch / legalSearch / wikiCards / ipcClassify / kgSearch / kgGetNode / kgListByType / ipcStandards*；openKnowledgeDb 原样复用（application_id + user_version fail-loud）。
- `patent-knowledge:install`：导出 `installKnowledgeDb(options)`（不自动运行）+ `patent-knowledge-install` bin——VACUUM INTO 紧凑副本 → gzip chunks.content → 删 embeddings（P0.4 组合）→ 校验引擎；`~/.sati/knowledge/knowledge.db` 或 Config sourceDbPath 为源。
- 测试：77 用例（13 个 Sati spec 移植 + 真实 service + Loader REAL-composition + install + HMR-safety）；cordis-catalog 类型链接登记 + config-catalog 重生成 + constraints assets 白名单。

#### P1 数据层整体验收

- P1.4（literature 53）、P1.2（data 47）、P1.3（knowledge 77）、P4.3（methodology 28）：210 个专利域测试全绿；build:lib:host + 17 项门禁全绿。
- 待办：P1.5（P1 验收：`dsh --profile patent` headless 冒烟需 preset 组装后验证）、P2.2–P2.5（checker/evidence/claim-chart/graph + 等价性测试）、P3.x（workflow/工具/文书）、P4.1/P4.2/P4.4。
## 11. P2 进度记录（2026-08-17）

### 11.1 P2.1 完成：dsh-patent-core（atoms + llm-json + ModelPort + 前置类型）

- 移植：`src/patent/atoms/`（atom/handler/index + 10 个 builtin handlers，含 claim-chart 原子）+ `llm-json.ts`；`builtin/llm.ts` 改经 `provider.llm`（ModelPort）路由。
- ModelPort 实现：`src/model-port.ts` 的 `createLlmModelPort(stream, { provider, model })` 把 dsh `GenerateOptions`/`StreamChunk` 词汇映射为 `PatentModelRequest`/`PatentModelEvent`（`@deepseek-ai/dsh-llm` 依赖）；`collectPortText` 桥接 atoms 字符串面。
- 前置类型：`src/rule/{types,text-utils}.ts`（宪法规则协议类型 + hasNegationContext/parseCnNumber）。
- ipc 单归属：`src/ipc/`（ipc-classifier + ipc-standards-loader + ipc-standards.yaml 随包 assets）从 patent-knowledge 迁入 core；patent-knowledge 改从 core 引用，其 ipcClassify/ipcStandards* 方法不变。
- claim-chart 原子传递依赖：`src/claim-chart/` + `persist-utils` + `paths` 一并进入 core（persist/paths 单归属，patent-data 改为 re-export）。
- StageProvider 最终形态：`{ caseId?, callLLM?, llm?: PatentModelPort, search? }`，StageSearchHit 与 PatentModelPort 族不变（type-equiv 保持绿）。
- 测试：285 用例（46 文件）——core 76（含 atoms spec 移植 + ModelPort 适配器 + ipc；ipc 原 `.test.ts` 在 vitest `.spec.ts` 纳入下从未运行，迁移时改名激活 18 个此前死测试）、data 47、knowledge 77、methodology 28、literature 53；build:lib:host + 17 项门禁全绿。
### 11.2 P2.2 + P2.3 完成：checker / problem / evidence / reasoning / claim-chart runtime

- checker（11 文件）：双轨确定性规则引擎（RuleEngine/aggregate/defaultPatentRules，71 条新颖性/创造性/侵权/公开/说明书规则 + 24 条推理模式规则）；problem/atomicChecker（checkAtomic/technicalProblemCheck）；evidence（10 文件 + protocol.ts 收据协议，EvidenceEngine + 收据账本/span/binding/conflict）；reasoning（fact-blackboard/syllogism）。
- claim-chart runtime 已于 P2.1 随原子迁入（逐字核验）；补 chart-atom.spec。
- 适配：exactOptionalPropertyTypes 显式 undefined 修正（date/engine/evidence/fact-blackboard/atomicChecker）；evidence/rule-loader 的 candidateRuleDirs 以 `ruleDirs?: readonly string[] = []` 参数占位（P4.1 接 dsh-patent-rule 真实规则包）；evidence/protocol.ts 由 src/tool/protocol/evidence.ts 移植并重接 receipt/index。
- 测试：12 个 Sati spec 全量搬运（node:test → vitest），两个依赖规则资产的 evidence 测试改为覆盖占位 + 参数化加载路径；专利域累计 444 用例（58 文件），build:lib:host + 17 项门禁全绿。
### 11.3 P2.4 + P2.5 完成：graph 引擎 + 等价性

- graph（9 文件 + domains 5 文件）：Pregel 超步引擎（engine/adapter/merge/node-policy/degradation/checkpoint/state/types）+ 三性子图（novelty/inventiveness/enablement + shared）；checkpoint 接 persist-utils 单归属（JsonFileCheckpointStore 复用 JsonFileStore，文件态；ctx.storage 接缝留 P3.1）。
- 前置：`src/workflow/{types,manifest}.ts`（WorkflowManifest 纯类型 + validateWorkflowManifest）先入 core（workflow 依赖 core 而非反向）；runWorkflow 执行器与 builtin manifests 留 P3.1。
- 等价性（P2.5）：graph/atoms/checker/claim-chart 的 Sati spec 全量逐字搬运（同一 fixture 输入/期望），即等价性证明；2 个依赖 runWorkflow 的 adapter 等价测试延至 P3.1（文档化）。
- 适配：exactOptionalPropertyTypes/noUncheckedIndexedAccess 显式修正；getStateString/getStateArray 双 barrel 重名消歧（钉住 atoms 副本）。
- 测试：专利域累计 498 用例（65 文件），build:lib:host + 17 项门禁全绿；P2 阶段（纯校验器）全部完成。

## 12. P3 进度记录（2026-08-17）

### 12.1 P3.1 完成：dsh-patent-workflow（执行管线 + approval + 会话事件）

- 服务：`PatentWorkflow extends Service`（ctx.patentWorkflow），runWorkflow(manifest, ctx, executor?, options?, agent?)、runPlantask(agent, caseId, planSteps, options?)、approve(caseId)/reject(caseId, feedback?)；纯管线 API 全量 re-export（workflow / workflow-dag / workflow-store / flexible-plan(-store) / plantask / worker-contract / approval / output-gate / quality-gate / flow-graph）。
- approval 接线：awaiting_approval = 单一未决 `ctx.get('approval').request()`；allowed-once → approve（恢复执行），rejected/cancelled/unavailable → reject（重规划 + 回滚）；无 approval 服务 ⇒ fail-closed；approval 为可选结构接缝（无 dsh-user-approval 编译依赖）。
- 会话事件：`patent/plantask` 与 `patent/workflow-run` 经 src/types.ts 声明合并进 SessionEventMap，经 agent.session.append 落日志，并注册进 KNOWN_SESSION_EVENT_TYPES（gen-persistence-catalog）。
- 规则门接缝：PatentOutputGate 接受可选 ruleGate?: RuleOutputGate（结构接口），RuleViolation 自 dsh-patent-core 导入；无引擎时退化为关键词门控（P4.1 注入真实引擎）。
- 偏差（README Known Limitations 文档化）：dsh-patent-core/src/rule/types.ts 实际未加 RuleOutputGate 前缀（仅 RuleViolation），故 RuleOutputGate 接缝在 workflow 本地定义；runeSlice 自 Sati slop-engine.ts 内联；FlowGraph 按计划「独立移植」本地落包；ctx.storage 文件产物接线延后（由调用方提供 JsonFileStore 后端）。
- 测试：workflow 110 用例（14 文件，含 10 个 Sati spec 搬运 + 真实服务测试：approval + 会话 + approval_pending → approve → resume + Loader 组合 + HMR 安全）；专利域累计 607 用例（78 文件），build:lib:host + 18 项门禁全绿。

### 12.3 P3.4 完成：dsh-patent-document（文书渲染 + 模板资产）

- 移植 src/patent/document/ 全 7 文件：types / templateResolver（包内 assets 经 new URL 解析）/ brandInjector / pdfRenderer（**execFile 改 ctx.subprocess.spawn**，CHROME_CANDIDATES + DSH_CHROME_PATH，ok/error 结果形态保留，root 沙箱标志 + 超时 terminate）/ renderPatentDocument（caseOutputsDir 自 core 导入，默认输出目录改 .dsh/documents）/ errors（SatiDocumentInputError → DocumentRenderError）/ index。
- 函数插件形态：name='patent-document'，inject=['tools','subprocess']，Config（chromePath?: string、outputRoot?: string 默认 .dsh/documents）；invariant 空安装器（'No runtime invariant:' 注释：交付物文件不入会话日志，模板资产解析期 fail-loud）。
- 工具：render_patent_document 经 defineTool（parameters/output.schema/render 纯函数）；assets/ 随包分发完整 templates/patent 树（31 文件：5 模板 + manifest + tokens.css + DOCS/README）。
- 测试：8 文件 37 用例（render-patent-document / pdf-renderer 假 ctx.subprocess.spawn 注入 / template-resolver / brand-injector / tool / plugin / config / invariant）；专利域累计 727 用例（95 文件）。

### 12.4 P4.1 + P4.2 完成：dsh-patent-rule（规则引擎 + 守卫 + 输出门禁）

- 引擎 runtime 全量移植（src/runtime/）：RuleEngine / RuleLoader / synonym-engine / patent-compliance（loadPatentComplianceRuleSet 等）/ rule-pack / output-gate（RuleOutputGate 类）/ policy-bridge（rulesToPolicyDenyRules 纯函数，注明 dsh 接线走 guard/post-execute）。协议类型 + text-utils 自 core 导入（P2.1 单归属）。policy-bridge（rulesToPolicyDenyRules）未接线生产路径，已在移植后简化评审中移除。
- RuleOutputGate + RuleOutputGateResult 协议类型落 core（src/rule/types.ts 单归属），patent-workflow 改为从 core re-export（删除本地副本，公开 API 不变）。
- 资产随包：assets/rules/ 完整镜像 Sati rules/（patent/base/domains + pack.schema.json，23 文件）；asset-location 改 new URL 包内解析 + Config rulesDir 覆盖（弃 SATI_RULES_DIR / cwd 走查，README Known Limitations 记录）。
- 守卫（P4.2）：src/guard/evidenceComplianceGuards.ts 移植为 dsh ToolGuard（execution → string deny，单调不可被 allow 覆盖），经 ctx.tools.guard() 注册；EVI-011 条件字段自 loadEvidenceRulesEngine（接线包内 assets 真源）派生，资产缺失回退硬编码集合。
- 输出门禁接线 tools/post-execute：delivery 工具结果跑 RuleOutputGate；block → {kind:'block'}；review → ctx.get('approval') fail-closed（无 answerer 视 block），allowed-once 才 accept；warn/log → next() 放行。
- 测试：11 文件 85 用例（synonym-engine / rule-loader / rule-pack / rule-engine / patent-full-rule-set / policy-bridge / output-gate / guard 单调 deny / post-execute 接线 / asset-loading / scaffold）；专利域累计 727 用例（95 文件），build:lib:host + 可归因门禁全绿。

### 12.5 环境变更（外部并发工作，非本计划产物）

- 会话期间发现第三方并发工作 packages/self-evolve/（3 包，19:47–19:58 写入，另一窗口处理）：其 package.json 含不存在的 workspace 依赖 @deepseek-ai/dsh-schemes 致 pnpm install 全仓失败——按用户批准移除该行；其 3 包无 tsdown 配置且无 lib/，tsdown workspace 构建失败——按用户批准加 entry:'' 临时 no-op 配置（nuo-patent 同款，作者接线真实构建时替换）。
- 其余 red 门禁（verify-package-invariants / constraints / readme-model-experience / readme-limitations / translation-pairing / knip / publint / built-invariants / tool-catalog / cordis-catalog / persistence-catalog）全部仅因 self-evolve 未完成而红，与本计划专利包无关；其配对排除项已撤回（对方工作域）。

### 12.6 P3.2 完成：dsh-patent-tools（23 工具 defineTool 化）

- 23 个工具全部落地 src/tool/（每工具 1 文件：输入/输出类型 + 纯 render 函数 + createXxxTool 工厂 → defineTool）：patent_search / patent_metadata / patent_legal_status / patent_case_search / patent_wiki_search / patent_kg_query / patent_eval / claim_chart_build / draft_claims / draft_specification / validate_specification / evaluate_evidence / rule_check / analyze_patent_figure / search_patent_figure / patent_pdf_download / recognize_chemical_structure / patent_flexible_plan / patent_workflow / patent_workflow_run / patent_plan_task / patent_worker_validate / knowledge_note_save；render_patent_document 由 dsh-patent-document 持有（本包 re-export 工厂不重复注册）。
- 接线：search/metadata/legal-status 默认 nuo 引擎（无需服务）；case/wiki/kg 经 ctx.get('patentKnowledge')（缺席时执行期 fail-loud）；LLM 工具经 buildModelPort（createLlmModelPort 自 core）；workflow/flexible-plan/plan-task 经 ctx.patentWorkflow 语义（纯状态机接线）；rule_check 经 dsh-patent-rule（candidateRuleDirs）；evaluate_evidence 带 EVI-011 字段。
- 形态：name='patent-tools'，inject=['tools']（其余服务 ctx.get 可选），Config（provider/model/maxTokens 等 LLM 工具配置）；PatentToolError 错误类（SatiToolRuntimeError 移植）；slop-engine 内联。
- 测试：14 文件 109 用例（data/engine/knowledge/pure-tools + pdf-download/flexible-plan/plan-task/workflow(-run)/worker-validate + error + validate-specification 31）；专利域累计 835 用例（108 文件），9 包逐个 tsc -b 全绿。
- 中央接线（本回合）：gen-tool-catalog.ts TOOL_PACKAGES 增 patent-tools + patent-document 条目 + import（目录名不匹配 tool-* 完整性 glob，为文档完整性添加）；docs/tool-catalog.md + zh 已在 12.7 手动补齐两包行与章节（生成器当前因对方窗口 tool-self-evolve 无法运行，verify-tool-catalog 仍仅因此红）。

### 12.7 P3.3 完成：图片能力门（2026-08-17）

- 门控：analyze_patent_figure 经 ctx.get('llm').resolveModelInfo 解析路由模型的 inputModalities（路由 = exec.agent 活动模型优先，回退 Config imageModel/provider/model）；absent/不含 image ⇒ 执行期 deny fail-loud（命名模型与缺失模态）；search_patent_figure 不门控（只读预建索引，与 Sati 一致）。
- 新文件：src/figure/image-capability.ts（纯 checkImageCapability + resolveImageInputModalities）+ error.ts 增 model_cannot_accept_image 码；Config.imageModel? 接线（src/index.ts）。
- 测试：+16 用例（image-capability + analyze-patent-figure 门控，patent-tools 125 用例 / 16 文件）；专利域累计 851 用例（110 文件），9 包 tsc -b 全绿。
- 中央接线（本回合）：docs/tool-catalog.md + zh 手动补齐 patent-tools（23 工具）/ patent-document（render_patent_document）地图行与章节（生成器因对方窗口 tool-self-evolve 无法运行，按生成器 render 逻辑逐字节复刻）；**gen-tool-catalog.ts patent-document 条目补 LocalSubprocessRuntime 挂载**（此前未挂载 ⇒ 0 工具收割，assertToolsHarvested 必抛——P3.4 遗留真 bug，已修）；11 个多行工具描述按 md-wrap「一段一行」规则归一（analyze-patent-figure / flexible-plan / knowledge-note-save / patent-pdf-download / patent-plan-task / patent-worker-validate / patent-workflow / patent-workflow-run / recognize-chemical-structure / validate-specification / render-patent-document），重建两包 lib 束后重收割，EN/zh 同步再生；配对重录（docs/tool-catalog.i18n.yaml）。可归因门禁全绿（md-links / md-wrap / package-paths / translation-pairing tool-catalog 对 / 851 用例 / tsc）。

### 12.8 P4.4 完成：patent agent preset（2026-08-17）

- 交付：apps/cli/config/agent-presets/patent/（12 文件全新建，未动任何共享文件）：agent.cordis.yml（281 行 / 21 行）+ preset.yml（name: 专利模式, order: 5）+ 双语 README（Model Experience + Known Limitations 置末）+ 7 个技能 SKILL.md。
- agent.cordis.yml：保留 patent 工作流所需 standard 行，按 patent-mode-design.md §4 移除 tool-ralph；patent 服务行（patent-knowledge / patent-workflow）置于 cordis:group + isolate realm（patentKnowledge/patentWorkflow），patent-tools 同 realm 消费 ctx.get('patentKnowledge')；patent-rule / patent-document / tool-literature / methodology 为函数插件不入 realm；persona（§6）与 plan-mode section（§8.2 前置 standard 机制）写入；skill-filesystem.customSkillDirs（!!js baseUrl → preset skills/）；tool-web.fetch: true。
- 技能（§7.2/§7.3 规则）：patent-disclosure-understanding / patent-prior-art-search / patent-novelty-inventiveness（Sati novelty+inventiveness 合并）/ patent-infringement / patent-invalidity / patent-quality-gate / patent-workspace-layout；Sati 工具引用改 dsh 工具、<memory-context> 改显式必查清单、Sati 内部路径改工作目录相对路径。
- 知识库策略（计划 P4.4 修订 §9）：系统知识读 dsh-patent-knowledge（patent_case_search / patent_wiki_search / patent_kg_query，法条经 patent_case_search + web_fetch），99-知识库/ 保持项目级沉淀；README 明示与 patent-mode-design.md §9 的差异。
- 验证：YAML 解析 21 行、技能 front-matter 全有效、单尾换行；verify-md-wrap（1919）/ verify-md-links（1956）全绿；verify-cordis-config 仅因对方窗口 self-evolve 2 处红，preset 零归因。
- 中央接线（父代理）：apps/cli/package.json dependencies 增 7 个专利包（workspace:^：patent-knowledge/patent-workflow/patent-tools/patent-rule/patent-document/tool-literature/methodology）；pnpm install 更新锁文件（16 处 patent 引用）；package:desktop:prepare 成功，desktop 镜像携带 patent preset + 6 个专利包（patent-core/data 传递依赖）。

## 13. 最终验收对照（§7）与提交协调（2026-08-17）

### 13.1 §7 验收状态

- §7.1 静态与构建：专利 9 包逐包 tsc -b 0 错误；许可证落地（包 LICENSE MIT + THIRD_PARTY_NOTICES 登记 nuo-patent）；pnpm typecheck / lint / build / hygiene / doc-sync 全仓级仅因对方窗口 self-evolve 未完成而红（tsconfig.host.json 引用损坏、缺 lib/、缺 README、JSDoc 违规、生成器完整性守卫），非本计划产物。
- §7.2 测试：每包 tests/ 全绿（851 用例 / 110 文件，含 Sati spec 搬运）；等价性（graph/atoms/claim-chart/checker）完成；REAL-composition（Loader 组合）与 HMR-safety 在 P3.1 覆盖；invariant 门禁专利包全符合。keyless 快照未做：本环境无 DEEPSEEK_API_KEY 且无 patent 可运行示例，该条目标记为待补（单元覆盖 + spec 搬运替代，见 Agent Note）。
- §7.3 行为验证：EVI-011 guard 单调 deny、图片工具文本模型拒用（点名模型）、patent-knowledge:install 引导均有单元测试覆盖；实机 dsh --profile patent 链跑需要 API key，本环境不可执行，标记为待 keyed 环境验证。
- §7.4 回归：Sati 本体零改动（只读源）；patent preset 下既有插件回归待实机验证；patent-mode-design.md §4–§9 与引擎版知识库策略兼容（P4.4 修订，README 记录）。

### 13.2 提交协调（对方窗口并发工作未提交）

- 本回合提交范围：纯新增专利域文件（packages/patent/ 10 包、vendor/nuo-patent/、apps/cli/config/agent-presets/patent/、docs/sati-as-dsh-plugins-plan.md、patent-mode-design.md、docs/subsystems/patent.*、Agent Note 三件套）。
- 共享文件修改（与对方窗口 self-evolve 内容同文件或锁文件）本回合不提交，待对方窗口完成后随协调提交：docs/tool-catalog.{md,zh,i18n}、docs/capability-seams.*、docs/event-producer-consumer.*、docs/persistence-catalog.*、docs/subsystems/README.*、packages/README.*、packages/core/session/src/known-event-types.ts、packages/extensions/tool-cordis/src/api-catalog.ts、scripts/{check-workspace-constraints,gen-cordis-catalog,gen-doc-graphs,gen-tool-catalog,translation-pairing.manifest,type-equiv.manifest,verify-package-readme-model-experience}、THIRD_PARTY_NOTICES.md、vendor/README.md、apps/cli/package.json（专利 7 依赖）、pnpm-lock.yaml、tsconfig.base.json（对方 wildcard）、tsconfig.host.json（对方损坏引用 + 我方 9 包引用）、packages/bundle/base/cordis.patch.yml（对方）、apps/cli/composition.md（对方）。
- 上述共享修改中的我方部分均已验证（851 用例、可归因门禁全绿、desktop 镜像携带 preset），随对方窗口收尾一并落地即可。
