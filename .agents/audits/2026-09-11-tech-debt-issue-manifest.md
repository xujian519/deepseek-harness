# 技术债务 / 异味代码 Issue 跟踪清单（草稿，待确认后创建）

- 日期：2026-09-11；仓库 `xujian519/deepseek-harness`（fork，`origin`）；基线提交 `dc50e9045f`
- 范围：`packages/`、`apps/`、`scripts/`、`python/`；排除 `vendor/`（vendored，改动须走 sync 程序）与构建残留目录
- 方法：门禁实跑 + 8 个并行只读探查代理（债务标记 / 抑制与逃生口 / 跨包复制 / 体量与复杂度 / 硬编码参数 / 死代码与失效引用 / 测试质量 / 架构不变量与文档一致性）+ 主会话逐条回读 `file:line` 复核
- 复核纪律：子代理给出的每条候选都经主会话回读源码确认；本清单只保留已复核属实的条目，被证伪的条目集中在第 5 节「不建 issue」，不在正文出现

## 1. 门禁基线（本机实跑）

| 门禁 | 结果 | 备注 |
|---|---|---|
| `typecheck` | ✅ 0 错误 | 含 `build:lib:host` |
| `lint` | ✅ 0 警告 0 错误 | `Found 0 warnings and 0 errors.` |
| `duplication` | ✅ 0 克隆 / 462346 行 | 08-30 审计时红（28 克隆），现已收敛且在 `ci-fork.yml:43` 纳入 CI |
| `hygiene` | ❌ **16 门中 1 门失败** | `verify-package-dependencies` 报 3 条违规，全部在 `packages/client/better-sidebar/src/sidechat-routes.ts` |
| `test:docs` | ✅ 17 passed / 0 failed | — |
| `test` | ⚠️ 27696 passed / 3 failed / 109 skipped | 2 例 better-sidebar EditorHost（串行单跑通过 → 并发/负载敏感）；1 例 `util/http-proxy/tests/install.spec.ts:109` 在本机确定性超时（见第 5 节，DNS 环境产物） |

`test:coverage` 与 `doc-sync` 未跑（最慢，CI 拥有该信号）；`python/` 未纳入本机测试。

## 2. 与既有台账的对照（`docs/TECH_DEBT.md` + `.agents/audits/2026-08-30-full-scan.md`）

**已收敛（不再建 issue，需在台账销案）**

| 项 | 证据 |
|---|---|
| P1-1 duplication 门禁红 + CI 盲区 | 实测 0 克隆；`ci-fork.yml:43` 已含该步骤 |
| P2-1 `translate.ts` 闭合联合缺 assertNever | `packages/llm/llm-deepseek/src/translate.ts:171` 已有 `assertNever` |
| P2-4 `self-evolve-benchmark` 裸 id | 已改 `Branded<'BenchmarkId'>` / `Branded<'CaseId'>` |
| P2-7 `packages/README.md` 组表缺 4 组 | 组表 56/56 与实际 `packages/*/` 一一对应 |
| P2-8 `pty-manager.ts` 注释指向错误 | 现指向 `@deepseek-ai/dsh-subprocess-local`，与 postinstall 实况一致 |
| L1 根 AGENTS.md 布局段 | 只指向 `packages/README.md`，无重复清单 |
| L2 死代码三项 | `finalExtension` 已降为包内模块、`WorkflowEventName` 取消导出、`list-children.ts` 本地 `reason:'unsupported'` 已删 |
| M2 `config as ResolvedConfig` 13 处 | 已由 `dsh-value` `assertResolvedConfig` 收敛 |
| M6 `subagent/continuation.ts` | 1569 → 550 行，可销案 |
| M6 `host/apiproxy` | 已删除 |

**仍开放（台账记录与实际一致，本轮重新定位行号）**：H4（e2b，7 条 TODO 全在）、H5（agent/session 双份 announcement 状态机）、M3（settings 3 条竞态）、M4（hooks 4 组镜像 TODO ×2 包）、M6（余下上帝文件，多数继续增长）、M8（全部点名项零修复）、M9（legacy shim）、L3、L4、L5 余项。

**本轮新增（台账与审计均未载）**：hygiene 门禁在 master 红、未声明的工作区依赖、`packages/experimental/code-runtime-python` 2441 行新上帝文件、`client/connection/fixture.ts` 与 `ui-trajectory/TrajectoryTable.tsx` 等新超大文件、M1 覆盖范围回升（isRecord/asRecord 等 11 处本地变体）、26 处闭合联合缺 assertNever、10 个组 README 共缺 16 个包条目、63 处 src 空 `.catch(() => {})`、硬编码参数新簇、测试可靠性族、死导出无门禁。

## 3. 拟建 issue 一览（24 条）

| # | Issue | 标题 | Type | 新增 area 标签 | 优先级 | 证据锚点 |
|--|--|--|--|--|--|--|
| 1 | #78 | hygiene 门禁在 master 红：better-sidebar 依赖分类未登记 | Task | area/infra | P1 | `client/better-sidebar/src/sidechat-routes.ts:26,31` |
| 2 | #79 | e2b 沙箱生命周期缺口 | Bug | area/e2b | P1 | `e2b/src/index.ts:183`、`subprocess-e2b/src/{process,terminal,remote,environment}.ts` |
| 3 | #80 | settings 三个文档化竞态 | Bug | area/settings | P1 | `settings/src/index.ts:449,689` + `__proto__` 构造 |
| 4 | #81 | hooks Claude/Codex 双桥行为缺口 | Bug | area/hooks | P1 | `hooks-claude-code/src/index.ts:50,182,198,262` ↔ `hooks-codex/src/index.ts:48,165,180,250` |
| 5 | #82 | 未声明的工作区依赖（1 处运行期值导入 + 16 处类型导入） | Bug | area/infra | P2 | `session-persistence-jsonl/src/win32.ts:17` |
| 6 | #83 | 跨边界裸 string id 未 brand | Task | area/api | P2 | `patent-teams/src/event-types.ts:15,17`、`desktop-seam/src/index.ts:88,112`、`ui-chat/src/client/contract/store.ts:4` |
| 7 | #84 | acp 握手版本号与包版本失同步 | Bug | area/api | P2 | `acp/src/index.ts:182`（`0.0.1`）vs `acp/package.json`（`0.1.5-rc.2`） |
| 8 | #85 | src 内 63 处空 `.catch(() => {})` 未命名吞错 | Task | area/core | P2 | `core/agent-loop/src/index.ts`(7)、`subprocess-local/src/*`(8) 等 |
| 9 | #86 | 上帝文件：新增未立案 + 在案继续增长 | Task | area/core、area/client | P2 | 见正文证据表 |
| 10 | #87 | 小工具复制回升：M1 覆盖范围重测 | Task | area/util | P2 | 11 处本地变体（isRecord×6、asRecord×5）等 |
| 11 | #88 | 硬编码可调参数未收编（含新簇） | Task | area/session、area/core | P2 | 见正文证据表 |
| 12 | #89 | 闭合联合缺 `assertNever`（26 处） | Task | area/core、area/client | P3 | oxlint 规则已启用作兜底 |
| 13 | #90 | 组 README 包表缺 16 个包条目（10 个组） | Task | area/docs | P3 | 见正文证据表 |
| 14 | #91 | coverage 豁免清单理由错位残留 | Task | area/tests | P3 | `vitest.config.ts:299,338,347` |
| 15 | #92 | 测试可靠性：重试语义、负载敏感、墙钟断言、静默跳过 | Task | area/tests | P2 | 见正文证据表 |
| 16 | #93 | 死导出与失效注释引用（含死导出无门禁） | Task | area/infra、area/docs | P3 | `chunks/editor.tsx:5`、`chunks/terminal.tsx:5` |
| 17 | #94 | 无理由 lint 抑制残留 | Task | area/core、area/tests | P3 | `compaction-basic/src/region.ts:130` 等 |
| 18 | #95 | 显式默认违规：查询执行路径内联 `??` | Task | area/api | P3 | `api/session-controller/src/history.ts:103,183` |
| 19 | #96 | 架构面：host→client peer 与 sdk/server 钉具体 provider | Task | area/infra | P3 | `host/directory-picker-auto/package.json`、`sdk/server/package.json` |
| 20 | #97 | `docs/TECH_DEBT.md` 台账失真并与 issue 建立关联 | Task | area/docs | P1 | 本清单第 2 节 |
| 21 | #98 | legacy shim 消费者验证与删除决策（M9） | Task | area/session | P2 | `api/remotes/src/agent-lookup.ts` |
| 22 | #99 | `types.ts` 含运行时代码的规则例外未记录（L3） | Task | area/core | P3 | `fs/types.ts`、`web/types.ts` 等 7+ 包 |
| 23 | #100 | terminal seam 错误风格与同族不对称（L4） | Task | area/core | P3 | `terminal/terminal/src/index.ts:126,160,236,245,285,324` |
| 24 | #101 | agent/session announcement 状态机双份分叉 | Task | area/core | P2 | `core/agent/src/index.ts:219-221,526-537` ↔ `core/session/src/index.ts:421-424,1044-1059` |

**需要新建的 `area/*` 标签（11 个）**：`area/core`、`area/client`、`area/util`、`area/session`、`area/e2b`、`area/hooks`、`area/settings`、`area/api`、`area/tests`、`area/docs`、`area/infra`。理由：这些是与 `packages/README.md` 组表同源的持久工程域，现有 8 个 `area/*`（patent/self-evolve/mcp/desktop/plugin-market/llm/sandbox/web）覆盖不到。taxonomy 明确允许 agent 自行创建并在事后报告；如你希望收缩，可只保留 `area/core`、`area/tests`、`area/docs`、`area/infra` 四个。

**偏差记录（已核实）**：两项治理元数据在本仓库无法写入，均已尝试并记录证据。
- **Project Status/Priority**：`gh` token 缺 `read:project`，且 `DSH Issue Management` Project 属上游 org，fork 无法写入。优先级以 `P1/P2/P3` 写在每个 issue 正文首行。
- **原生 Issue Type**：`gh issue create`/`gh issue edit`（v2.92.0）无 `--type` 参数；REST `PATCH /repos/{owner}/{repo}/issues/{n}` 与 GraphQL `updateIssue(issueTypeId:)` 均静默忽略（无错误返回，读回 `type: null`），试过 `type` / `issue_type` / 嵌套对象三种载荷。`GET /repos/{owner}/{repo}/issue-types` 确认 Task/Bug/Feature 三种类型已启用，因此这是写路径限制而非配置缺失。分类信息落在 `area/*` 标签与正文「类型：」字段中；Type 待可用后回填。

---

## 4. 各 issue 正文草案

### Issue 1 — hygiene 门禁在 master 红：better-sidebar 依赖分类未登记

- Type：Task；标签：`area/infra`；优先级：P1

**Summary**

`pnpm run hygiene` 在 master 上失败，唯一红门是 `verify-package-dependencies`，报 3 条违规且全部指向 `packages/client/better-sidebar/src/sidechat-routes.ts`：

```
:26:10  @deepseek-ai/dsh-subagent/client#snapshotSubagentDescriptor is not classified as safe or peer-required
:31:10  @deepseek-ai/dsh-session/types#SessionLogOffset is not classified as safe or peer-required
        safeHostDependencyExports lists unused @deepseek-ai/dsh-subagent export snapshotSubagentDescriptor
```

这是 fork 自身桌面侧栏改造（`aee23304a9 feat(desktop): remount the workspace sidebar and repair its portless transports`，PR #73）留下的分类缺口，不是上游引入。它当前阻断任何触达该门禁的 PR。

**Deliverables**

- 为 `@deepseek-ai/dsh-subagent/client#snapshotSubagentDescriptor` 与 `@deepseek-ai/dsh-session/types#SessionLogOffset` 补 `safeHostDependencyExports` 分类，或按实际身份需求改为 peer-required。
- 删除 `safeHostDependencyExports` 中已无消费者的 `@deepseek-ai/dsh-subagent#snapshotSubagentDescriptor` 条目。
- 实跑 `pnpm run verify-package-dependencies` 与 `pnpm run hygiene` 并附输出。

**Evidence**：本机 `pnpm run hygiene` → `15 passed, 1 failed`，失败明细如上。

---

### Issue 2 — e2b 沙箱生命周期缺口

- Type：Bug；标签：`area/e2b`；优先级：P1；对应台账 H4

**Summary**

e2b POC 组的生命周期缺口集中且长期未动（最旧 TODO 44 天）：setup 失败被吞、spawn 半途失败无回滚、teardown 只识别一种错误、取消/状态传播依赖轮询、远端 PGID 身份识别缺失。

**Reproduction**

- `packages/e2b/e2b/src/index.ts:183` `TODO(e2b-setup-rollback)`、`:106` 附近 `void this.ready.catch(() => {})` 吞掉 setup 失败（无日志）。
- `packages/e2b/subprocess-e2b/src/terminal.ts:561` `TODO(e2b-terminal-setup-rollback)`。
- `packages/e2b/subprocess-e2b/src/process.ts:485` `TODO(e2b-publication-cancel)`、`:537` `TODO(e2b-status-watch)`。
- `packages/e2b/subprocess-e2b/src/remote.ts:87` 与 `terminal.ts:303` `TODO(e2b-pgid-identity)`：信号投递按数值 PGID，非身份绑定。
- `packages/e2b/subprocess-e2b/src/environment.ts:29` `TODO(e2b-replace-environment)`。

**Current behavior**：setup/spawn 失败无完整回滚路径、无部署侧可见信号；取消与状态靠轮询补偿；信号投递正确性无法证明。

**Expected behavior**：对照 terminal seam 的 `TerminalBackendCleanupError` + AggregateError 回滚设计补齐 quiescence 与回滚；`ready` 失败至少落日志；teardown 区分错误类型而不是只捕获 `SandboxNotFoundError`。

**Environment**：`packages/e2b/*`，当前基线 `dc50e9045f`。

**Evidence**：`grep -rn 'TODO(e2b' packages/e2b` 命中 7 条，全部与 08-30 审计 H4 描述一致；台账 H4 标记「仍开放」。

---

### Issue 3 — settings 三个文档化竞态

- Type：Bug；标签：`area/settings`；优先级：P1；对应台账 M3

**Summary**

`packages/settings/settings/src/index.ts` 内三条 TODO 是真实缺陷而非优化待办，涉及原型污染、dispose 后回调、replacement 后 in-flight 写。

**Reproduction**

- `:275` `TODO(settings-json-properties)`：clone/mergeLayers 用 `out[key] = ...` 构造对象，合法 JSON 键 `"__proto__"` 会污染原型或丢失。
- `:449` `TODO(settings-registration-quiescence)`：注册 fiber dispose 只删 map 条目，watcher 回调（含异步尾链）可在注册者死后继续触发。
- `:689` `TODO(settings-replacement-resync)`：旧 registration 的 in-flight 写可在 replacement 注册后提交，新注册停留在旧值。

**Expected behavior**：`__proto__` 用 property-safe 构造；quiescence 用 disposer 内 await 尾部；replacement 后用最新 registration 重解析。三者各补一个可失败的回归测试。

**Evidence**：主会话回读三处源码确认存在；台账 M3 标记「仍开放」，且 M3 明确定性为「真实缺陷，非待办优化」。

---

### Issue 4 — hooks Claude/Codex 双桥行为缺口

- Type：Bug；标签：`area/hooks`；优先级：P1；对应台账 M4

**Summary**

两个 hooks 桥（claude-code 与 codex）各带 4 组镜像 TODO，全部影响用户可见行为；两个包的接线骨架近乎镜像，修一处必须同步另一处。

**Reproduction**

- `hooks-claude-code/src/index.ts:182` ↔ `hooks-codex/src/index.ts:165` `TODO(hook-continue-false)`：`merged.stop` 只记日志，无 run 级 halt —— hook 请求停止但 agent 继续跑。
- `:262` ↔ `:250` `TODO(stop-loop-guard)`：Stop hook 反复强制 continue 无次数上限，存在无限循环风险（codex 侧有 `stop_hook_active` 可收敛）。
- `:198` ↔ `:180` `TODO(session-start-gating)`：SessionStart 异步 resolve 时可能错过首个请求的上下文注入。
- `:50` ↔ `:48` `TODO(per-session-hook-config)`：进程级配置未做 per-session 发现。

**Expected behavior**：打通 run 级 halt 通道；Stop 循环计数上限；SessionStart 门控；两侧同步落地并各补测试。

**Evidence**：8 条 TODO 均在源码中确认（含 `hooks-codex/src/index.ts` 镜像）；台账 M4 标记「仍开放」。

---

### Issue 5 — 未声明的工作区依赖

- Type：Bug；标签：`area/infra`；优先级：P2

**Summary**

`packages/session/session-persistence-jsonl/src/win32.ts:17` 运行期值导入 `@deepseek-ai/dsh-value`，但该包 `package.json` 从未声明这个依赖。另有 16 组「类型导入未声明」的较弱实例。

**Reproduction**

```sh
grep -n 'dsh-value' packages/session/session-persistence-jsonl/package.json   # 无输出
node -e "require.resolve('@deepseek-ai/dsh-value',{paths:['packages/session/session-persistence-jsonl']})"  # MODULE_NOT_FOUND
```

**Current behavior**：源码平面靠 tsconfig `paths` 解析；构建产物 `lib/index.js`（tsdown 打包）因为该依赖未声明而被**顺带内联**，所以今天运行不报错——依赖解析正确性依赖打包器的外部化启发式，而非声明。

**Expected behavior**：在 `package.json` 声明该依赖（值导入应进 `dependencies`，或按 duplicate-safe 分类进 `peerDependencies`）；顺带处理 16 组类型导入未声明（若类型出现在公开 `.d.ts` 中则必须声明，否则改用已声明的 `@deepseek-ai/dsh-value` 或去掉）。

**Environment**：本机 macOS arm64；`@deepseek-ai/dsh-value` 只在 `node_modules/.pnpm/node_modules/` 下存在，不在解析路径上。

**Evidence**：引入自 commit `ac5ff49b75 refactor: sink isPlainObject, the errno tests, and deepFreeze into dsh-value`（2026-08-30）；该 commit 未改动此包 `package.json`。类型导入清单（16 组，全部 `import type`）：api-settings-controller、host-synapse(×2)、mcp-client、patent-document、patent-teams、patent-tools(×10 文件)、token-meter、tool-cordis(×2)、tool-fs-search、tool-literature(×2)、tool-plugin-market、tool-ralph、tool-self-evolve、tool-subagent、tool-workflow。

---

### Issue 6 — 跨边界裸 string id 未 brand

- Type：Task；标签：`area/api`；优先级：P2

**Summary**

三处跨包/跨进程边界的 id 仍是裸 `string`，违反「Opaque cross-boundary ids are branded」。

**Deliverables**

- `packages/patent/patent-teams/src/event-types.ts:15,17` 等：`teamId`、`captainSessionId`、`memberId`、`taskId` 等被 `ui-patent-teams` 消费，改用 `Branded<'...'>`。
- `packages/desktop/desktop-seam/src/index.ts:88,112`：IPC wire 载荷 `menuId`、`notificationId` 未 brand（audit 记录的路径已从 `desktop/desktop` 漂移到 `desktop/desktop-seam`）。
- `packages/client/ui-chat/src/client/contract/store.ts:4`：`ToolCallId = string` 与宿主 `packages/llm/llm/src/brand.ts:31` 的 `ToolCallId = Branded<'ToolCallId'>` 同名不同义，应复用宿主品牌类型。
- 三处各补一个编译期断言或测试钉住品牌关系。

**Evidence**：主会话回读三处源码确认（`teamId: string` / `payload: { menuId: string }` / `export type ToolCallId = string`）；`self-evolve-benchmark` 的同类问题（P2-4）已修，可作为改法样板。

---

### Issue 7 — acp 握手版本号与包版本失同步

- Type：Bug；标签：`area/api`；优先级：P2

**Summary**

ACP 握手里上报的 `agentInfo.version` 是硬编码 `'0.0.1'`，而包实际版本是 `0.1.5-rc.2`。客户端据此判断 agent 版本会拿到假信息。

**Reproduction**：`packages/acp/acp/src/index.ts:182` `agentInfo: { name: 'deepseek-harness-acp', version: '0.0.1' }`。

**Expected behavior**：从包版本派生（构建期注入或读取 `package.json`），并在测试中断言两者一致。

**Environment**：基线 `dc50e9045f`，`packages/acp/acp/package.json` 的 `version` 为 `0.1.5-rc.2`。

**Evidence**：台账 M8 已登记该常量（原行号 239，现 182），至今未修。

---

### Issue 8 — src 内 63 处空 `.catch(() => {})` 未命名吞错

- Type：Task；标签：`area/core`；优先级：P2

**Summary**

AGENTS.md 要求空的 catch「命名它吞掉什么、为什么别的路径到不了」。`src/` 下有 63 处 `.catch(() => {})` 形式的空处理，集中在进程与资源生命周期路径，没有任何说明。这不等于 63 个缺陷，但当前无法区分「已在上游处理过的 best-effort 清理」与「真正的静默失败」。

**Deliverables**

- 逐处判定：已在上游/调用方处理 → 补一行说明（吞掉什么、为什么安全）；未被处理 → 改为落日志或传播。
- 优先核 `packages/core/agent-loop/src/index.ts`（7 处：676/698/706/774/814/825/914）与 `packages/subprocess/subprocess-local/src/`（8 处：`index.ts:105,185,291`、`managed-owner.ts:35`、`spawn.ts:519,558`、`terminal.ts:340`、`windows-job.ts:80`）。
- 若确认某类（如 teardown 期的 `handle.close()`）系统性安全，抽一个具名 helper（例如 `settleQuietly(handle)`）一次性表达语义，替代散落的空 catch。

**Evidence**：`grep -rn 'catch(() => {})' packages/*/*/src | wc -l` = 63（`src` 口径）；10 处空 `catch {}` 全在 tests（不属本条）。

---

### Issue 9 — 上帝文件：新增未立案 + 在案继续增长

- Type：Task；标签：`area/core`、`area/client`；优先级：P2；对应台账 M6

**Summary**

台账 M6 记的是 2026-08-17 的行数，现已显著失真：`continuation.ts` 已收敛（1569→550）可销案，但多数文件继续增长，且出现台账完全未载的新超大文件。

**Deliverables（按「新增/恶化」排序）**

| 文件 | 行数 | 台账记录 | 判断 |
|---|---|---|---|
| `packages/client/connection/src/client/fixture.ts` | 4052（`createFixtureWorld` 约 2172） | C1 记 ~1836 | 恶化 +336，测试夹具失控 |
| `packages/experimental/code-runtime-python/src/index.ts` | 2441（`execute` 自 :1157 起） | 无 | **新债**（`private: true` 实验包） |
| `packages/client/ui-trajectory/src/client/TrajectoryTable.tsx` | 3208（组件约 1406） | 无 | **新债**，且是全仓唯一 ≥40 空格深嵌套处 |
| `packages/typert/generator/src/analyzer.ts` | 3235 | M6 3113 / P2-6 3142 | 持续增长 |
| `packages/client/better-sidebar/src/client/state.ts` | 1900 | 无 | 新债，且是克隆中心 |
| `packages/client/better-sidebar/src/client/Sidebar.tsx` | 1775（组件约 1510） | 无 | 新债 |
| `packages/core/session/src/index.ts` | 1281 | M6 1157 | +124，在案文件里增幅最大 |
| `packages/core/tools/src/index.ts` | 1910 | M6 1955 | 略降 |
| `packages/core/tools/src/ptc.ts` | 678（`createRunCodeTool` 386） | M6 ~315 | 恶化 |
| `packages/acp/acp/src/index.ts` | 536（`apply` 341） | M6 310 | 恶化 |
| `packages/self-evolve/self-evolve-basic/src/index.ts` | 1853 | P2-6 1850 | 持平 |
| `packages/subagent/subagent/src/continuation.ts` | 550 | M6 1483 | **收敛，建议销案** |

- 逐个决定拆分方案并入 PR；生成文件（`extensions/tool-cordis/src/api-catalog.ts` 7843、`cordis-client-runner/src/client/slot-catalog.ts` 2714 等）不在范围内。
- 拆分优先级建议：`fixture.ts` 的 `createFixtureWorld` → `code-runtime-python`（新债）→ `analyzer.ts` → `core/session` → `ptc.ts`/`acp apply`。

**Evidence**：`wc -l` 于基线 `dc50e9045f`；`packages/*/*/src` 下 ≥1000 行文件 35 个、≥1200 行 19 个；src 内 ≥250 行函数 64 个，主体是客户端 React 组件。

---

### Issue 10 — 小工具复制回升：M1 覆盖范围重测

- Type：Task；标签：`area/util`；优先级：P2；对应台账 M1

**Summary**

台账 M1 把 8 个 helper 族标为「已收敛 / 0 剩余」。实测仍有本地副本，且出现了台账未登记的新族。jscpd 抓不到它们（`minTokens: 60`）。

**Deliverables**

| 族 | 权威定义 | 实测本地副本 |
|---|---|---|
| `isRecord` | `packages/util/value/src/index.ts:20` | 6 处：`client/file-upload/src/client/runtime.ts:357`（返回类型已漂移为 `Record<PropertyKey, unknown>`）、`client/ui-tool/.../ask-question-row.tsx:36`、`core/session/src/surface.ts:129`、`goal/goal/src/fold.ts:52`、`subprocess/subprocess-local/src/runner-protocol.ts:59`、`workflow/tool-ralph/src/index.ts:232`；另 apps 6 处、scripts 11 处 |
| `asRecord`（isRecord 的可空变体） | 无 | 5 处：`patent/patent-rule/src/runtime/RuleLoader.ts:49`（已导出）、`patent/patent-core/src/evidence/engine.ts:455`、`client/ui-chat/.../event-projection.ts:10`、`client/ui-chat/.../ContextBody.tsx:23`、`client/ui-trajectory/.../trajectory-event-projection.ts:10`；scripts 1 处 |
| `assertPositiveInteger` / `assertPositiveFinite` | `util/value/src/index.ts:33,49` | 5 处且签名三方漂移：`session/session-title/src/index.ts:192`（`value: number`）、`session-query/session-query-sqlite/src/index.ts:1068`（抛域错误，台账已列特例）、`subagent/subagent-acp/src/index.ts:78`（钉 timer 上限，台账特例）、`subagent/subagent/src/out-of-process.ts:73`（**三参导出**，台账未列）、`sandbox/sandbox-local/src/index.ts:194`（台账未列） |
| `errorMessage` 简化版 | `util/value/src/index.ts:145` | 4 处缺 hostile-proxy 兜底：`fs/fs-local/src/fsio.ts:37`、`client/ui-agent-preset/src/client/section-store.ts:26`、`test-support/self-evolve-eval/src/campaign/orchestrate.ts:397`、`api/workspace-controller/src/directory-picker.ts:183` |
| `toError` | `util/value/src/index.ts:169` | 2 处：`test-support/client-runtime/src/assembly/test-client.ts:128`、`test-support/remote-mock/src/streams.ts:194` |
| `isENOENT` / `isEEXIST` | `util/value/src/index.ts:115,127` | 4 处语义放宽（`as` cast 而非 `instanceof Error`）：`session-persistence-jsonl/src/index.ts:185`、`generation.ts:230`、`patent-teams/src/state.ts:294`（小写 `isEnoent`）；同包 `win32.ts:17` 已改 import 权威 → 同包自相矛盾 |
| `deepEqualJson` | `util/values/src/index.ts:191` | 1 处本地再实现：`core/session/src/surface.ts:351` `isDeepEqualJson`（有注释说明为浏览器安全，属重叠但可论证） |
| abort/超时 race | `util/timeout/src/index.ts:186` `abortable` | ≥4 份 `abortable` 副本（`lsp-stdio/src/abort.ts:36`、`api/gateway/src/client/remote-events.ts:331`、`llm/deepseek-llm-api-extensions/src/index.ts:51`、`web/web-search-deepseek/src/provider.ts:331`）+ 4 份 `waitWithAbort`；台账称 e2b `withinMs`/`waitWithSignet` 已消失，实测仍在 `subprocess-e2b/src/process.ts:83,143` |
| `isAbortError`（新族） | 无 | 5 处：`fs/fs-local/src/fsio.ts:32`、`experimental/inspector/.../network.ts:223`、`web/web-search-{exa,deepseek,perplexity}/src/provider.ts` |
| `hasExactKeys` / `sleep`（新族） | 无 | 4 处 / 9 处，见探查记录 |

**Deliverables**

- 对「已声明收敛」的族逐处收敛或**显式记录为有意的本地副本**（台账当前是错的「0 剩余」）。
- 新族（`asRecord`、`isAbortError`、`hasExactKeys`、`sleep`）评估是否下沉 `dsh-value` / `dsh-timeout`。
- 修订台账 M1 表，使其反映真实状态。

**Evidence**：`grep -rn '^(export )?(const|function) (isRecord|asRecord|assertPositive)'` 全仓计数；主会话逐条回读确认权威定义与副本签名。**注意**：`packages/util/value`（`dsh-value`）与 `packages/util/values`（`dsh-util-values`）是**有意分层**（后者 duplicate-install-safe，见 `.agents/notes/implemented/process/2026-08-26-published-dependency-faces.md`），不是重复包，不要合并。

---

### Issue 11 — 硬编码可调参数未收编（含新簇）

- Type：Task；标签：`area/session`、`area/core`；优先级：P2；对应台账 M8

**Summary**

台账 M8 的点名项**零修复**（行号普遍漂移），且扫描发现约 15 处未登记的新实例。

**Deliverables（台账点名项，行号已更新）**

- `core/tools/src/index.ts:657/749/765`：`maxParallelSubCalls` 的三处 `10`（JSDoc、解析回退、schema 默认）与 `core/agent-loop/src/constants.ts:6` 的 `DEFAULT_MAX_PARALLEL_TOOL_CALLS` 无共享绑定 —— 最高优先级的双份事实源。
- `subagent/subagent/src/list-children.ts:37` `COLD_READ_CONCURRENCY=4`（注释已声明网络化持久化出现时必须 promote）。
- `sdk/client/src/client.ts:30,33` `STDERR_TAIL_LIMIT=400` / `STREAM_SETTLE_MS=100`。
- `boot/app-boot/src/index.ts:618` `FAIL_LOUD_RELEASE_TIMEOUT_MS=2_000`。
- `acp/acp/src/index.ts:182` 版本号（另见 Issue 7）。
- `session-persistence-jsonl/src/index.ts:72` `ZSTD_DECODE_YIELD_INTERVAL_MS=500`。
- 前台超时默认值横向不对称：`shell/bash-local/src/index.ts:102` 与 `shell/pwsh-local/src/index.ts:128` = 120_000；`shell/tool-bash-persistent/src/index.ts:449`（+ `:458` 回退双源）= 300_000；`terminal/terminal-bash/src/config.ts:99` = 30_000；`e2b/e2b/src/index.ts:81` = 300_000。需要一份集中记录来源依据的说明。
- `preset/agent-presets/src/index.ts:55` 裸字符串 `SETTINGS_NAMESPACE='agent-presets'`；`shell/shell/src/index.ts:21` `SHELL_SETTINGS_NAMESPACE='shell'` 亦是裸字符串（**更正台账 M8 的描述**：真正用 `settingsNamespace('shell')` 的不是 shell seam）。

**新发现（台账未载）**

- `api/gateway/src/stream-server.ts:22` `MAX_MISSED_HEARTBEATS=2`（同包心跳间隔已是 Config，此阈值不是）。
- `api/session-controller/src/list.ts:22` `SEARCH_PROVIDER_CALL_LIMIT=100`、`src/types.ts:181` `SESSION_SEARCH_RESULT_LIMIT=20`（且 `client/connection/src/client/fixture.ts:49` 有镜像 `20`）。
- `session-persistence-jsonl/src/{storage.ts:36,index.ts:64,generation.ts:47,48,49,migration-verifier.ts:21}`：迁移批次/解码让出/切片/验证并发 6 处。
- `shell/tool-bash-persistent/src/index.ts:25,26` `SCROLLBACK_PAGE_LINES=1_000` / `POLL_INTERVAL_MS=25`。
- `experimental/tool-agent-team/src/index.ts:240`：`timeout_ms` 默认 30_000 与上下界 10_000/3_600_000 在描述、校验、回退三处硬编码。
- `browser/browser-backend/src/{ego-extractor.ts:95,99,browser-use-extractor.ts:109,111}`：`60_000` / `1_000_000` 跨文件两份 + JSDoc 第三处。
- `client/better-sidebar/src/fs-tree.ts:91` `SYMLINK_PROBE_CONCURRENCY=32`。
- `code-runtime/code-runtime-worker-thread/src/index.ts:63` `ELU_POLL_INTERVAL_MS=25`。
- `llm/llm-deepseek/src/adapter.ts:145` 与 `llm/llm-pi-ai/src/config.ts:46` 各自定义 `DEFAULT_STREAM_IDLE_TIMEOUT_MS=300_000`（台账 M10 已提及，归口 M8 或 M10 需明确）。

**Evidence**：主会话回读每条 `file:line`；`pnpm run test` 无关。合规对照（已是 Config 单源，列出以示区分）：`acp` 分页、`jobs-local` 并发、`hook-protocol` 超时、`attachment-local` 压缩并发、`tool-session-query` 搜索超时、`lsp-stdio` 上限组、`gateway` 心跳间隔。

---

### Issue 12 — 闭合联合缺 `assertNever`（26 处）

- Type：Task；标签：`area/core`、`area/client`；优先级：P3

**Summary**

AGENTS.md 要求闭合联合在 `switch` 末尾用 `assertNever` 收尾。审计点名的 2 处已修，但全仓仍有 26 处穷举 switch 无 `default`/`assertNever`。风险被 oxlint 削弱：`.oxlintrc.json:177` 启用了 `typescript/switch-exhaustiveness-check: error`（`considerDefaultExhaustiveForUnions: true`），成员扩充会在 lint 期失败。

**Deliverables**

- 返回 `void` 的静默面优先（新成员会静默穿过）：`api/session-controller/src/client/sessions/session.ts:637`、`client/ui-conversation/src/client/conversation/assembly.ts:108`、`experimental/inspector/.../value-codec.ts:277`、`.../network-store.ts:223`、`experimental/webworker-runtime/src/shell/{expand.ts:170,interpret.ts:308}`。
- 其余 20 处（如 `experimental/webworker-runtime/src/shell/expand.ts:52`、`interpret.ts:226`、`patent/patent-tools/src/tool/generate-patent-figure.ts:193,243,536`、`client/ui-trajectory/src/client/layout.ts:823` 等）逐处补 `assertNever`。
- 3 处 merge-extensible 联合的 `default` 缺 documented 注释：`compaction/compaction/src/tool-pairing.ts:30`、`interaction/permission-presets/src/index.ts:123`、`compaction/compaction-basic/src/summarizer.ts:196`。
- 复核 `.oxlintrc.json` 的 `considerDefaultExhaustiveForUnions: true` 是否与 AGENTS.md 的 assertNever 要求冲突；若冲突，择一为准并写进规则。

**Evidence**：全量扫描 26 处；主会话回读确认 4 处；规则配置见 `.oxlintrc.json:177-182`。

---

### Issue 13 — 组 README 包表缺 16 个包条目（10 个组）

- Type：Task；标签：`area/docs`；优先级：P3

**Summary**

各组的 `packages/<group>/README.md` 的 Packages 表未列全该组实际包。10 个组共缺 16 条（每个缺失包都有自己的 README，说明不是「尚未成包」）。`packages/README.md` 的组表已完整（P2-7 已收敛），但**组内**包表没有对应门禁，因此持续漂移。

**Deliverables**

- 补条目：`api/` ← `plugin-market-controller`；`bundle/` ← `self-evolve-app`；`client/` ← `synapse`、`ui-dockkit`、`ui-document-studio`、`ui-patent-teams`、`ui-plugin-market`、`ui-sidebar-documentpreview`、`ui-sidebar-right`；`core/` ← `prompt-cache`；`host/` ← `plugin-market`；`session/` ← `session-format-v2-to-v3`；`test-support/` ← `self-evolve-eval`；`util/` ← `contained-emit`、`value`；`web/` ← `synapse`。
- 双语配对（README.md 与 README.zh.md）同步。
- 建议加一条门禁：组 README 的包表必须覆盖该组全部含 `package.json` 的目录（当前无任何门禁或检查覆盖此事，`hygiene` 的 13 个叶门与 `doc-sync` 均不检查）。

**Evidence**：脚本比对 `packages/<group>/README.md` 的链接目标与 `packages/<group>/*/package.json` 目录集合；16 条缺失逐条 `grep -c` 为 0。

---

### Issue 14 — coverage 豁免清单理由错位残留

- Type：Task；标签：`area/tests`；优先级：P3

**Summary**

审计 P2-2 点名的 `packages/host/webserver/src/*` 已修正。复核 `vitest.config.ts` 的 98 条字面豁免后，仍有几处理由与目录性质不匹配。

**Deliverables**

- `vitest.config.ts:299,300`（`client/modules/src/client/system.ts`、`client/hmr/src/client/index.ts`）夹在 inspector 清单与「Web config-tree boot」注释之间，归属不明。
- `:338,339`（`client/ui-input-trigger/src/core/menu.ts`、`core/detect.ts`）与 `:343`（`test-support/client-runtime/src/translate.ts`）挂在「client-lane / browser-grade harness」TODO 下，但三者是纯 core/test-support 模块，不需要浏览器级 harness。
- `:347,348`（`packages/extensions/*/src/**/*.ts{,x}`）为通配条目且无独立理由。
- 逐条要么收窄到具体未覆盖文件、要么补自洽理由；有条件的话把「豁免必须带可核对理由」写成检查。

**Evidence**：主会话回读 `vitest.config.ts:294-350`；豁免总数 98 条 + 4 个条件展开清单。

---

### Issue 15 — 测试可靠性：重试语义、负载敏感、墙钟断言、静默跳过

- Type：Task；标签：`area/tests`；优先级：P2

**Summary**

四类可靠性问题叠加：唯一的重试会重跑断言失败；至少 1 例在并发下失败的用例；一批依赖墙钟上下界的断言；以及「无构建产物就静默通过」的跳过。审计 P2-5 提议的 nightly `--repeat`/`--shuffle` 竞态压测至今未落地。

**Deliverables**

- `vitest.e2e.config.ts:56` `retry: 2` 会重跑**任意**失败（含断言失败），注释却只归因共享 key 配额抖动 —— 收窄重试条件或写明覆盖范围。
- 负载敏感：`packages/client/better-sidebar/tests/cov-views-editor-host.client.spec.tsx`（本次全量跑失败 2 例、串行单跑通过，`treeWidth` meta 断言）与 `packages/boot/app-boot/tests/user-patches.spec.ts:412`（HMR，已有 loadavg 诊断）。
- 墙钟上下界断言族：`packages/client/better-sidebar/tests/cov-host-git.spec.ts:81`（强制 4s 下界）、`apps/cli/tests/profiles/headless/tests/ptc.e2e.ts:263`（5s 上界）、`packages/client/ui-primitives/tests/markdown.client.spec.tsx:472`（3s 上界）、`packages/experimental/code-runtime-python/tests/runtime.spec.ts`（10 处 elapsed 上下界）、`apps/desktop/tests/bridge-server.spec.ts`（约 20 处 20ms sleep）。
- 构建产物门控的静默跳过：`packages/experimental/webworker-runtime/tests/compile/transform-corpus.spec.ts:25`（无产物时 `context.skip`）。安全回归跳过已有改进：`sandbox-windows-acl/tests/runner.spec.ts:386` 现已发 `::warning::`，但该 job 非阻塞，warning 无消费方。
- 结论性条目：登记 `deepseek.e2e.ts:26` 的静态 `it.skip`（有理由注释，但与「全仓无条件 skip 为 0」的结论冲突），并把 P2-5 的 `--repeat`/`--shuffle` 竞态压测单独立项或正式关闭。

**Evidence**：本机全量 `pnpm run test` → 27696 passed / 3 failed；两例 EditorHost 串行重跑通过；台账 P2-5、审计 §4 已有同类记录。

---

### Issue 16 — 死导出与失效注释引用（含死导出无门禁）

- Type：Task；标签：`area/infra`、`area/docs`；优先级：P3；对应台账 L2

**Summary**

台账 L2 的三项已修，但同类问题仍在，且审计「knip 无死代码报告」的结论已失效：`hygiene` 的 13 个叶门里没有死导出检查，仓库现在没有任何无主导出门禁。

**Deliverables**

- 可确证零引用的导出：`packages/session/session-title-llm/src/index.ts:86` `SessionTitleLlmConfigSchema`、`packages/session-query/session-query-sqlite/src/index.ts:70` `SESSION_QUERY_SQLITE_PATH_KEY`（其字面量 `'launcherSessionQueryPath'` 只被 `scripts/gen-cordis-catalog.ts:165` 作为数据键引用）。
- 失效的注释引用：`packages/client/better-sidebar/src/client/chunks/editor.tsx:5` 与 `chunks/terminal.tsx:5` 引用不存在的 `docs/plans/2026-08-12-lazy-chunks-design.md`；`packages/client/better-sidebar/tests/plugin-shape.spec.ts:9` 引用不存在的 `packages/ui/jsonrpc`。
- 注意 `scripts/verify-doc-refs.ts` 的 `PATTERNS` 是 `['packages/**/*.ts']`，**不含 `.tsx`**，所以 `.tsx` 里的 `docs/...md` 引用完全没过门禁 —— 这是一个独立的门禁缺口，值得顺手补。
- 决定是否恢复死导出门禁（或明确「barrel 公共面不设门禁」并记录理由）。

**Evidence**：主会话回读两处死链与两处零引用导出；`grep -n PATTERNS scripts/verify-doc-refs.ts` 确认 `.tsx` 缺口；`hygieneLeafGates`（`scripts/run-gates.ts:694-716`）无 knip/死导出检查。

---

### Issue 17 — 无理由 lint 抑制残留

- Type：Task；标签：`area/core`、`area/tests`；优先级：P3

**Summary**

全仓 `oxlint-disable` 322 处、`eslint-disable` 13 处、`@ts-expect-error` 82 处，绝大多数有理由（`@ts-ignore`/`@ts-nocheck` 为 0，`as any` 在 src 为 0）。少数完全没有说明。

**Deliverables**

- `packages/compaction/compaction-basic/src/region.ts:130`：`oxlint-disable-next-line typescript/no-non-null-assertion` 无理由（同文件其余 10 处同类抑制亦多为无理由；`surfaceNodes[0]!` 的下界由上方长度检查保证，补一行说明即可）。
- `packages/core/tools/src/testing.ts:30`：`unbound-method` 抑制无任何说明。
- `packages/session-query/session-query/tests/observation.spec.ts:115`：`prefer-promise-reject-errors` 抑制无说明。
- 复核块注释覆盖边界（`core/tools/src/schema.ts:551-561` 一次块注释覆盖 6 处；`patent-teams/src/members.ts:365,367`；`region.ts:102,547` 的理由只解释了 `no-deprecated`）。

**Evidence**：主会话回读 `region.ts:126-134`（确认无理由）；审计 P2-3 已就 `region.ts` 的 7 处提出同类问题，至今未补。

---

### Issue 18 — 显式默认违规：查询执行路径内联 `??`

- Type：Task；标签：`area/api`；优先级：P3

**Summary**

AGENTS.md 要求默认值是一个显式的 `resolve(request): Spec` 步骤，而不是 `run()` 内部隐藏的 `?? default`。`packages/api/session-controller/src/history.ts` 两处在查询执行路径内直接兜底。

**Deliverables**

- `:103` 与 `:183` 的 `request.maxMessages ?? DEFAULT_MAX_MESSAGES` 收进一个显式解析函数（对照 `packages/shell/shell/src/index.ts:84` 的 request/spec 分割）。
- 复核同包的其它 `?? DEFAULT_*` 是否已被 `resolveXxx` 覆盖。

**Evidence**：主会话回读 `history.ts:100-106,180-186`；`core/agent-loop/src/index.ts:190`（`resolveMaxParallelToolCalls`）与 `acp/src/index.ts:463`（`resolveSessionListPageSize`）是合规样板。

---

### Issue 19 — 架构面：host→client peer 与 sdk/server 钉具体 provider

- Type：Task；标签：`area/infra`；优先级：P3

**Summary**

审计记录的「client ↔ host 组级 peer 互锁」已单向化（`packages/client/connection` 现在没有任何 host peer 依赖），但 host 侧仍 peer 客户端包；`sdk/server` 仍 peer 具体 provider。

**Deliverables**

- 重新定性并记录：`packages/host/directory-picker-auto/package.json:20` peer `client-ui-directory-picker-browse` / `-native`；`packages/host/frontend-static/package.json` peer `client-connection`。要么记录为有意（类型级 wire 依赖），要么下沉共享 wire 类型包。
- `packages/sdk/server/package.json:31` peer `@deepseek-ai/dsh-llm-deepseek` —— 装配面可接受但削弱 adapter 可替换性；确认是否需要保留，并在 README 记录理由。
- 复核 `packages/README.md` 中 util 组的自述措辞（`http-proxy` 的 `dsh-invariants` 实际在 `devDependencies`，组描述宜与实况一致）。

**Evidence**：`package.json` 的 peerDependencies 实测；包级依赖图的强连通分量计算为 0 环。

---

### Issue 20 — `docs/TECH_DEBT.md` 台账失真并与 issue 建立关联

- Type：Task；标签：`area/docs`；优先级：P1

**Summary**

台账最后实质性更新是 2026-08-28，实测已有 10 项收敛未销案、多个行号漂移、M1/M6/M8 的状态描述与实测不符（M1 声称「0 剩余」但仍有 11 处本地变体；M6 行数大面积过期）。台账是仓库唯一的技术债务事实源，失真会让后续工作按错误前提推进。

**Deliverables**

- 按本清单第 2 节更新收敛项（含 duplication 门禁、`translate.ts`、`packages/README.md` 组表、`self-evolve-benchmark` brand、`pty-manager`、`continuation.ts` 销案）。
- 为 H4/H5/M3/M4/M6/M8/M9/L3/L4 与新增项补「Issue 跟踪」列，指向本清单创建出的 issue 号。
- 修正 M8 关于 `settingsNamespace` 的错误描述、M1 的「0 剩余」结论、M6 的行数表。
- 跑 `pnpm run test:docs` 验证（一物理行一段、无死链）。

**Evidence**：本清单第 2 节的对照表；`wc -l docs/TECH_DEBT.md` = 257 行。

---

### Issue 21 — legacy shim 消费者验证与删除决策（M9）

- Type：Task；标签：`area/session`；优先级：P2；对应台账 M9

**Summary**

台账 M9 的决策是「保留，首个 tagged release 前复审」。`SESSION_FORMAT_VERSION` 已升到 2（见 `.agents/notes/implemented/process/2026-09-06-upstream-v0.1.3-alpha.1-sync.md`），比台账记录的前提更新了，应当重新验证消费者并给结论。

**Deliverables**

- 验证 `packages/api/remotes/src/agent-lookup.ts` 的 legacy agent-busy fence 是否仍有真实生产消费者（桌面已出货构建的磁盘会话日志）。
- 结论二选一：删除，或记录「保留到 `<条件>`」并把复审条件写进台账（避免又一次无期限保留）。

**Evidence**：台账 M9 原文；`SESSION_FORMAT_VERSION = 2` 现况。

---

### Issue 22 — `types.ts` 含运行时代码的规则例外未记录（L3）

- Type：Task；标签：`area/core`；优先级：P3；对应台账 L3

**Summary**

`packages/*/CLAUDE.md` 写明「`types.ts` 只放类型，不放运行时代码」，但 7+ 个包在 `types.ts` 里放 brand 函数与错误类（`fs/types.ts:24,43,196`、`web/types.ts:129`、`terminal/types.ts:18`、`subagent/types.ts:27`、`workflow/types.ts:20`、`shell/types.ts:13`、`compaction/types.ts:16`），并且迫使 `shell/types.ts` 之类文件 re-export 运行时符号。规则与系统性实践不一致。

**Deliverables**

- 二选一并落地：要么把 brand 函数/错误类移出 `types.ts`，要么在规则里显式记录「brand 构造函数与同包错误类例外」的边界条件。
- 复核 `shell/types.ts` 的 re-export 是否可改为从定义处导入。

**Evidence**：台账 L3 原始位置清单（行号沿用，未逐条重验）。

---

### Issue 23 — terminal seam 错误风格与同族不对称（L4）

- Type：Task；标签：`area/core`；优先级：P3；对应台账 L4

**Summary**

terminal seam 的错误风格与同族包不对称：同类包都带包名前缀，唯独它抛裸消息；同一类失败混用 `Error` 与 `TerminalError`；`kill()` 是唯一带硬编码默认参数的可选诊断字段。

**Deliverables**

- `packages/terminal/terminal/src/index.ts:126,160,236,245,285,324`：统一前缀与错误类型（`startSend` closing/exited 用裸 `Error`、`SEND_ACTIVE` 用 `TerminalError`）。
- `:285` `kill(owner, id, reason: string = 'model request')`：确认默认参数是否符合 seam 契约，否则改为必填或由规范层提供。

**Evidence**：台账 L4 原始清单；行号未重验（本轮未回读该文件，创建 issue 时以最新 `file:line` 为准）。

---

## 5. 不建 issue（复核后剔除，或有意权衡）

| 条目 | 为什么不计入 |
|---|---|
| `reason: 'unsupported'` 等「never-produced」联合变体（4 处声明） | **复核后证伪**：`control-types.ts:77` 的 JSDoc 明确写「`unsupported` is never produced; it remains in the union for consumers that route on it」，且同一词汇在 `api/session-controller/src/history.ts:364` 有真实生产者。属有意的消费者路由契约。 |
| `boot/app-boot/src/profile.ts:603,717` 「已声明但未安装的依赖静默跳过」 | 每处都有就地理由注释（「cannot be a loader-visible plugin; skip it rather than fail the whole boot」），且这是部分安装下的正常状态。属有记录的权衡，非缺陷。 |
| `dsh-value` 与 `dsh-util-values` 是两个重复包 | **复核后证伪**：`dsh-util-values` 是 `duplicateSafePackages` 成员（duplicate-install-safe 的 JSON/不可变值原语），`dsh-value` 在其上分层并 re-export `deepFreeze`。有 Agent Note 记录，不合并。 |
| `better-sidebar/src/pty-manager.ts` 注释指向错误来源 | 已修（现指向 `subprocess-local`）。 |
| `translate.ts` 缺 `assertNever` | 已修（`:171`）。 |
| `packages/README.md` 组表缺行 | 已修（56/56）。 |
| duplication 28 克隆 | 已修（0 克隆），且已进 CI。 |
| `util/http-proxy/tests/install.spec.ts:109` 超时 | **环境产物**：该用例要求 `origin.test` 快速 NXDOMAIN；本沙箱 DNS 被黑洞（`dns.lookup('origin.test')` 挂起 >6s 无返回）。非仓库债务，CI 拥有该信号。 |
| `packages/*/lib/**`、`.desktop-build/`、`release/`、`resources/` 内的标记 | 构建残留，非跟踪源码（首轮 grep 因此虚报 500+ 条）。 |
| 生成文件（`api-catalog.ts` 7843、`slot-catalog.ts` 2714 等） | 有 freshness gate，不计为上帝文件。 |
| 台账 L6 记录的有意权衡（调度器字符串键握手、credentials/settings 对称代码、json-schema realm 探测复制） | 已有论证，不建议改动。 |
| `packages/experimental/webworker-runtime` 的 no-op Node 内建 shim、`api/session-controller/src/client/scope.ts:45` 空函数 | 注释标注为有意。 |
| `python/` | 15 个跟踪 `.py` 文件：0 债务标记、0 `noqa`、0 `type: ignore`、0 bare `except`、1 处环境守卫 skip。本轮无条目。 |

## 6. 落地结果

- **标签**：新建 11 个 `area/*`（core、client、util、session、e2b、hooks、settings、api、tests、docs、infra）；另补建 taxonomy 的规范 `kind/doc`（fork 缺失，PR 需要）。
- **Issue**：24 条全部创建，编号 #78–#101（第 3 节表格已回写编号）。其中 H5（agent/session announcement 状态机双份分叉）在首批 23 条之外补建 —— 清单第 2 节把它列为「仍开放」，首批遗漏，复核源码确认仍在（session 侧多出 `appending`，已开始分叉）后补为 #101。
- **关联**：`docs/TECH_DEBT.md` 新增「2026-09-11 更新」小节与「台账条目 → Issue」关联表；`pnpm run test:docs` 17/17 通过。
- **PR**：[#102](https://github.com/xujian519/deepseek-harness/pull/102)（`chore/tech-debt-issue-tracking` → `master`，`kind/doc` + `area/docs`，正文声明 `Fixes #97`）。
- **未完成**：Project 的 Status/Priority 与原生 Issue Type 仍无法写入（证据见第 3 节偏差记录），待可用后回填。
