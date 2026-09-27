# Issue 分诊与执行计划（#312–#328，2026-09-27）

- 分诊对象：2026-09-27 三模式与全仓扫描开出的 17 条 issue（#312–#328，全部 OPEN；#311 号在本仓不可解析，自 #312 起编号）。
- 分诊基线：`master` HEAD（2026-09-27 10:34；短 sha 见 #312–#328 各单正文），即扫描所依据的同一棵树；各 issue 引用行号与该 HEAD 对应。
- 关联文档：审阅报告 [`.agents/audits/2026-09-27-repo-scan.md`](2026-09-27-repo-scan.md)；台账 `docs/TECH_DEBT.md` 的 2026-09-27 节。
- 用途：记录**哪些值得修、按什么批次修、每批如何验证**。执行时按批推进，每批完成后回写本文件的「执行状态」。

## 1. 结论

- **真缺陷 3 条**（产生错结论或声明不成立）：#312（门禁未接线）、#314（占位符两套文法）、#319（免责声明映射缺类）。
- **门禁与记录盲区 6 条**：#315、#316、#321、#322、#325、#326。
- **可配置性与依赖声明 2 条**：#313、#317。
- **结构债 1 条**：#323（清单登记，不主张拆分）。
- **死声明 / 文档失真 3 条**：#320、#318、#327。
- **规划态 1 条**：#328（未排期）。
- 与 09-23 的差别：那一轮最重的结论是「同一仓库两种模式，门禁覆盖一正一反」；本轮最重的是**专利域两条门禁链互相引用对方的覆盖**（#312）与**文档模式交付路径自相矛盾**（#314）。覆盖率方向在本轮**未发现新的正向差距**：两个域的门禁覆盖差异依旧，但 09-23 的 #208/#209 机制仍在运作，只是记录方式失效（#316、#315）。

## 2. 立即执行（低风险、证据完备）

| Issue | 性质 | 关键证据 | 成本 | 风险 | 执行状态 |
|---|---|---|---|---|---|
| #314 | 真缺陷 | `vars.ts:24` ASCII vs `checks.ts:84` 通用正则；probe 实测 residual 空而门禁命中 | 小-中 | 低（改渲染侧正则即可对齐，须补交叉用例） | ✅ 已完成（2026-09-28） |
| #319 | 真缺陷 | 5 个 `patent-report` 模板改拿 `patent_analysis` 声明（`types.ts:36-41`） | 小 | 低（改的是用户可见免责文本，须重录文档场景快照） | ✅ 已完成（2026-09-28） |
| #318 | 文档 | README 双语各两处「无消费方」与两条 import 相反 | 极小 | 无 | ✅ 已完成（2026-09-28） |
| #327 | 文档/台账 | 七处数字与措辞（含 `TECH_DEBT.md:307/:224`） | 极小 | 无 | ✅ 已完成（2026-09-28） |
| #320 | 死声明 | `extends` / `changelog` / `shared_vars` 零实现或零生产读者 | 小 | 低（先定「实现」或「删除」） | ✅ 已完成（2026-09-28，收口删除） |
| #324 | 抑制标记 | 42 处裸 `jscpd:ignore-start`；门禁 `DIRECTIVE` 不含 jscpd | 小-中 | 低（须改生成器模板，否则再生成又丢） | ✅ 已完成（2026-09-28） |
| #325 | 门禁盲区 | `DIRECTIVE` 不含 `v8 ignore`；现状 1204 处全合规 | 小 | 低（首跑基线须记录现状，避免把既存合规当红） | ✅ 已完成（2026-09-28） |

## 3. 需先定口径（决策点）

| Issue | 决策点 | 建议 |
|---|---|---|
| #312 | 接线 `PatentOutputGate` 还是删除并把职责收敛进 `patent-rule` | 先接线（改动小、`ruleGate` 接缝已存在）；若决定删除，须同时停止 `selectGateRules` 对 `PAT-*` 的排除，否则三条规则无人执行 |
| #314 | 共享正则 vs 渲染侧放宽 | 抽共享常量，并把「可替换名」与「残留占位符」两个概念分开；`residual` 必须与门禁等价 |
| #320 | 实现 `extends`/`changelog`/`shared_vars` 还是收口删除 | 收口更便宜：三者在仓内无消费者；若产品要用模板组合，则 `extends` 单独实现 |
| #315 | 是否收窄工作室豁免 | 立即移出已 100% 的 `locales.ts` / `paths.ts`；其余按「分支未覆盖」重写理由 + `TODO(cov)` |
| #322 | 跨 preset 一致性门禁的形态 | 报告式基线（学 `duplication-baseline.json`），不强制相等——27 个差异块多为有意 |
| #326 | Web 组装快照接线还是改口 | 先改口（写入 `docs/testing.md` 并删无调用的 run-gates 模式）成本最低；接线需先刷新 ARIA 金标 |
| #313 | 端点是否进 `Config` | **已定（2026-09-27 执行）**：端点进 `patent-law` 的 `Config`（`cnlawEnabled` / `cnlawSearchUrl` / `cnlawGraphUrl`），由它渲染 `patent-law:cnlaw` 声明段；`patent-data` 只收自己的预算（`commandName` / `probeTimeoutMs` / `defaultTimeoutMs` / `maxTimeoutMs` / `maxOutputBytes`）。理由：issue 原文把端点放 `patent-data`，但该包 README 声明「数据缝不做模型可见面、由消费方拥有」，端点只进它的 `Config` 而无模型可见出口就是死配置 |
| #317 | `MAX_FINDINGS_PER_CHECK` 是否进 `Config` | 先证明 5 是产品口径并写进 JSDoc；否则进 `Config`。`patent-data` 的四个预算按 #211 形态处理 |

## 4. 不排期

- **#323**（173 个长函数 / 67 个大文件）：仓库先例（#86、#219、#292）是「能说出切割换来什么才动」。本项只要求**清单可见**（把 `TaskDetail.tsx` 等补进台账）并按需把 AST 扫描脚本入库为只读报告门禁；不主张重新拆分。
- **#328**（专利自媒体模式）：模式本身未立项；先决条件是 #315/#316/#321/#322/#326 五项共享面门禁先落地，避免第三次复制同一套 preset 行。

## 5. 执行批次与验证矩阵

| 批次 | 内容 | 验证 |
|---|---|---|
| 批 1 | #318 + #327（纯文档/台账） | `pnpm run test:docs`；`verify-tool-catalog` 与 `docs/tool-catalog.md` 一致 |
| 批 2 | #314 + #319（文档模式交付路径，同一域） | 交叉用例「residual 空 ⇒ 门禁零 placeholder」修复前必失败；「模板类别必命中免责映射」负例；`pnpm run test:snapshot`（document 场景） |
| 批 3 | #320 + #315（同包） | 字段生效/删除后的引用清零；`pnpm run test:coverage`（移除已 100% 文件的豁免后仍绿） |
| 批 4 | #312（专利门禁接线，二选一） | 端到端「命中审批词 → 挂起」或「`PAT-*` 在 `RuleOutputGate` 命中」；`pnpm run test:snapshot -t patent` |
| 批 5 | #321 + #322（preset 面门禁） | 注入不存在的工具名必失败；注入跨 preset 差异必失败（基线外） |
| 批 6 | #324 + #325（抑制标记门禁） | 各一条负例（裸 `jscpd:ignore-start`、裸 `v8 ignore` 必须失败）；生成器重新生成后理由仍在 |
| 批 7 | #313（**2026-09-27 已完成**）+ #317 | #313：模型可见语料零端口字面量（`packages/bundle/web-app/tests/patent-preset.spec.ts` 两条断言，注入 `:8100`/`127.0.0.1` 反例已证明会失败）、`pnpm run gen-config-catalog` 再生、`patent-data` 非默认预算用例（`tests/service.spec.ts`）；`pnpm run typecheck`/`lint`/`test:docs`/`test:snapshot -t patent` 通过。#317 仍开 |
| 批 8 | #316 + #326（记录与车道口径） | 注释命令粘贴即得非空条目；`docs/testing.md` 与实际工作流逐条一致 |

任何改动模型可见文本的批次追加 `pnpm run test:snapshot`；改 `Config` 的批次再生 `docs/config-catalog.md`。

## 6. 分诊实跑的核对项（供后续读者省掉重跑）

- 覆盖率机制：`--coverage.include` **不覆盖** `coverage.exclude`（`writing-patterns` 产出 0 条目）；改覆盖 `exclude` 后 8 条目、97.4%。
- `ui-document-studio` 撤豁免实测：StudioView 92.15%、document-deliverables 86.66%、file-reads 86.11%、client/index.ts 0%、locales/paths 100%。
- 结构口径（AST，`packages/*/*/src`，测试与生成文件不计）：173 个函数体 > 150 行；67 个非生成文件 > 800 行；`TaskDetail.tsx` 2178 行未载台账。
- 门禁基线：lint 0/0（6249 文件/90 规则）、typecheck 通过、duplication 0 克隆 + 收紧域 81 对、域测试 3776 通过 / 2 跳过、`-t patent` 快照 11 通过。
- 标记口径：全仓裸 `jscpd:ignore-start` 42 处（09-23 记 41）；`v8 ignore (next|start)` 1204 处全部带理由。

## 7. 未证实项（不进 issue，供后续复核）

1. 6 个豁免专利包是否达 per-file 100%（本轮只测聚合）。
2. 153 个零引用导出是否真死（扫描语料不含外部消费者与 `python/`/`website/`/`examples/`）。
3. `formatYearMonth` 的死分支判定（需控制流证明）。
4. #322 的 27 个差异块中哪些是有意的。
5. 平台门（pwsh）场景与 FreeCAD CI 路线。

## 8. 执行状态（2026-09-28 工作树）

- **批 1（#318/#327）**：✅ 完成（文档/台账就地更正，`pnpm run test:docs` 通过）。
- **批 2（#314/#319）**：✅ 完成（`EXTRACTION_PATTERN` 统一；`patent-report` → `patent_drafting`，新增随包模板类别交叉用例；document/patent 快照 12 例通过）。#319 同时按 issue 建议登记了 `prior_art` 无类别可达的已知缺口。
- **批 3（#320/#315）**：✅ 完成。**#320 实测后改按「收口删除」执行**（含 `mergeVarContext` 与三字段），并在 Dev Note 记录与上游的有意差异；#315 将工作室豁免收窄为 4 个真实未达标文件，移出已 100% 的 `locales.ts`/`paths.ts`。
- **批 4（#312）**：✅ 完成，**方向由「先接线」改为「删除并收敛进规则门禁」**。依据：仓库不存在可改写 `assistant/message` 的接缝（文档化瀑布为 `agent/pre-step`、`agent/request`、`llm/stream`、`tools/*`；`llm/stream` 是 provider 流级变换，无法表达「暂缓持久化直到人工批准」），接线需改循环与消息级审批。删除 `output-gate.ts`、`processPatentOutput`、引用核验镜像、审批审计存储与输出门禁消息词汇；`selectGateRules` 不再排除 `PAT-*`，三条合规关键词规则由规则门禁（`tools/post-execute` + `patent-teams` 收口）执行；断言「每条 `PAT-*` 关键词规则都有执行者」落在 `patent-compliance.spec.ts`。决策记录：Agent Note `2026-09-28-patent-output-gating-runs-on-the-rule-gate`。
- **批 5（#321/#322）**：✅ 完成。`verify-preset-tool-refs`（按 preset 挂载集校验反引号工具引用，`foo_bar` 负例已证失败）与 `verify-preset-divergence`（`scripts/preset-divergence-baseline.json` 覆盖 27 个现有差异块，注入差异已证失败）均接入 `doc-quick`。
- **批 6（#324/#325）**：✅ 完成（门禁覆盖 `v8 ignore` 与 `jscpd:ignore-start`；两个生成器模板同步输出理由，重新生成不再丢）。
- **批 7（#313/#317）**：#313 ✅（2026-09-27 完成）；#317 ✅ 完成（`patent-data` 预算进 `Config` 并有非默认值用例；`document-deliver` 的 `MAX_FINDINGS_PER_CHECK` 提升为 `Config` 字段 `maxFindingsPerCheck`，默认 5，`config-catalog` 已再生，工具级与检查级用例各钉一条非默认上限）。
- **批 8（#316/#326）**：#316 ✅ 完成；#326 ✅ 完成（改口方向：`docs/testing.md` 双语改为「本 fork 未接线」并登记四个组装式驱动无 CI 信号；删除无工作流调用的 `ci-snapshot`/`ci-artifacts` 两个 run-gates 模式及其 `check:ci:*` 脚本，`run-gates`/`ci-workflow` spec 通过）。
- **未排期**：#328 仍开（规划态，按计划不排期）。#323 ✅ 完成：台账 M6 复测表补录 9 个未载的 >1500 行文件，新增只读报告脚本 `scripts/report-structure.ts`（`pnpm run report:structure` 一条命令复算 173/67，`-- --top N` 打印最长条目）。

### 9. 最终验证（2026-09-28，工作树）

- `pnpm run lint` 0/0（6265 文件 / 90 规则）；`pnpm run typecheck` 通过；`pnpm run duplication` 0 克隆 + 收紧域 81 对与基线一致。
- `pnpm run test:docs` 25 gates 全通过（含新增 `preset tool references`、`preset divergence baseline`、`report structure` 不入门禁但与 `config catalog` 再生一致）。
- 文档/专利域定向测试：`packages/document/{doc-style,doc-template,document-deliver}` 与 `packages/patent/{patent-rule,patent-workflow,patent-tools}` 全绿（1294 passed）；`test:snapshot -t "patent|document-deliver"` 12 通过（全量快照 189 通过）。
- `pnpm run test` 全量：46037 passed / 2 failed，两个失败均与本轮改动无关且可独立复现为环境问题：① `packages/util/http-proxy/tests/install.spec.ts` 的 bypass 用例在本机 DNS 解析 `origin.test` 挂起 ~10s，超过 5s 默认超时（`--testTimeout=40000` 下通过）；② `packages/boot/hmr/tests/watch-config.spec.ts` 的文件监视用例在并发负载下偶发（单独跑 16 passed）。
- 未提交：工作树同时包含本会话改动与**此前会话的未提交工作**（`profile-installed-client-entry-tolerance`、#313 的 cnlaw/Config、`malformed-provider-streams-are-retryable` 等），提交策略待定。

### 10. 评审轮修复（2026-09-28，同轮）

外部评审对工作树提出 5 条，全部处理：

1. `verify-preset-tool-refs` 把 `disabled: true` 行的工具也当已挂载（`document` preset 的 `subagent_codex` / `subagent_claude_code` 即为实例），门禁漏报指向未挂载工具的技能文本。修复：`mountedToolNames` 跳过 `disabled === true` 的整行（`!!js` 条件已求值，平台关闭行按加载口径跳过）；新增「禁用行不挂载其包与 toolName」「禁用行的工具引用被报出」「`disabled: false` 仍挂载」三条用例；注入探针由 0 报错变为报错。
2. `report-structure.ts` 的 `LONG_FUNCTION_LINES` 与 `LongFunction.name` 注释仍写「函数体」，与实测的函数声明跨度口径矛盾；已改为「函数声明」。
3. `patent-eval` 的 `ABSOLUTE_PHRASES` 与 `compliance.yaml` 的 `PAT-ABS-001` 词表无任何钉住关系；改为导出常量并新增 `patent-tools/tests/patent-eval.spec.ts`，读取 shipped 规则资产断言两表相等。
4. `EXTRACTION_PATTERN` 放宽后 `render_doc_template` 的 `residual`（模型可见）会报出非 ASCII/连字符/带空格的占位符，此前只有 `extractPlaceholders` 单测；新增 `store.spec.ts` 渲染边界用例，断言 `residual === ['机构名称','doc-no']`。
5. shipped `PAT-APPROVAL-001` 在无审批服务时 fail-closed 的行为此前只有合成规则用例；新增 `post-execute.spec.ts` 用例，用随包规则资产断言 `draft_claims` 返回 `PAT-APPROVAL-001` + 「无审批通道」（README §output gate 已陈述该行为）。

复验：`lint` 0/0（6266 文件）、`typecheck` 通过、`duplication` 0 克隆 + 81 基线、`test:docs` 25 gates 通过、`packages/patent/{patent-rule,patent-tools}` + `packages/document/{doc-template,document-deliver}` + `scripts/{verify-preset-tool-refs,report-structure,verify-preset-divergence,verify-suppression-reasons}.spec` 共 1299 passed。
