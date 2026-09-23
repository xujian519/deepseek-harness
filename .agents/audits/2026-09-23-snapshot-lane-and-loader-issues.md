# 快照车道与装载项问题 — Issue 清单（2026-09-23）

- 来源：专利域补扫描收尾时对「快照期望刷新范围」的摸底，以及对模型可见回归门禁可用性的复核。
- 基线：`master`（2026-09-23），工作树除 `docs/TECH_DEBT.md` 与本轮报告外无改动，`snapshots/` 与 `packages/bundle/` 未被本工作树改动。
- 前序：`.agents/audits/2026-09-23-patent-domain-followup-issues.md`（专利域 #231–#242）、`.agents/audits/2026-09-23-repo-scan.md`（同日的全仓扫描 #207–#230）。
- 关系：本文档两条**不属于专利域**，也不在 #207–#242 内。#243 覆盖整条快照车道；#244 是其中 2 例崩溃的直接原因，单独立项以便各自可验收（#243 的分类口径把这 2 例单列，不重复计入）。
- 编号：当前最大 issue 编号 #230（最大 PR #206）；issue 与 PR 共享序列，故下列编号为**预估**，实际以创建时分配为准。
- 证据形式：全部结论附命令输出或 `file:line`，且均由本轮复跑核实。凡未核实者列入文末「未纳入」清单，不进正文。

## 汇总

| 预估编号 | 标题 | Issue Type | Labels | 优先级 | 严重度 |
|---|---|---|---|---|---|
| #243 | 快照车道在 `master` 上红（47 例），模型可见回归检测当前不可用 | Task | kind/techdebt, area/infra, area/tests, area/session | P1 | 高 |
| #244 | sdk profile 重复装载 `ptc-runtime`，两个场景启动即失败 | Bug | kind/bug-fix, area/infra, area/tests | P2 | 中 |

---

### #243: 快照车道在 `master` 上红（47 例），模型可见回归检测当前不可用

````
P1 | 类型：Task | 来源：2026-09-23 快照门禁复核（本轮新发现，非专利域）

## Problem

`pnpm run test:snapshot`（keyless 回放，模型可见输出的回归门禁）在当前 `master` 上是红的，
失败面横跨 `sdk` / `headless` / `acp` 三条 profile：

```
 Test Files  3 failed | 1 passed (4)
      Tests  47 failed | 137 passed | 2 skipped (186)
```

后果是这条车道的判定能力归零：

1. **红灯恒亮**——49 例里混着「已提交期望过期」和「真缺陷」两类，维护者无法从红灯数量判断严重性，
   新增的漂移被既有噪声淹没。
2. **模型可见面失去端到端断言**——工具描述、工具参数 schema、系统提示这三类只进模型上下文的内容，
   在这条车道上没有可信信号；改动方只能退化为聚焦 spec，无法验证端到端组装结果。
3. **重录不能直接刷绿**（下面有实测）——`test:snapshot:refresh` 覆盖不到全部漂移来源，
   因此「跑一次 refresh 提交」这条常规出路在这里不成立。

本轮专利域修复计划（会改渲染文本与工具描述）正因此把验收降级为聚焦 spec + `typecheck`/`lint`。

## Evidence

命令（`master`，`snapshots/` 与 `packages/bundle/` 均未被工作树改动）：

```
$ pnpm run test:snapshot
 ❯ snapshots/sdk/sdk.snapshot.ts (22 tests | 3 failed) 22252ms
 ❯ snapshots/session/headless.snapshot.ts (145 tests | 35 failed | 2 skipped) 39062ms
 ❯ snapshots/acp/acp.snapshot.ts (16 tests | 9 failed) 240038ms
 Test Files  3 failed | 1 passed (4)
      Tests  47 failed | 137 passed | 2 skipped (186)
```

按失败签名逐例分类（本轮解析复跑日志）：

| 类别 | 数量 | 场景 |
|---|---|---|
| `request header N` / `session 1 header N` 失配 | 33 | 32 例 headless + 1 例 sdk（`subagent-activation-limit`） |
| acp 用例 120s 超时 | 7 | `handshake`、`cancel`、`cancel-tool-calls`、`escalation-approved`、`escalation-rejected`、`fs-escalation-approved`、`image-compaction` |
| `system prompts` 失配 | 3 | `mcp-resources-ptc`、`ptc-node-read-only`、`ptc-node-workspace` |
| sdk `duplicate loader entry id: ptc-runtime` | 2 | `ptc-turn`、`tool-error-details`（见 #244） |
| acp `stdout.expected.jsonl` 失配 | 2 | `reject-extra-dirs`、`fs-same-mode` |

33 例 header 失配逐例读 diff 后落在两族模型可见改动上：

**族 1：todo 工具新增可选 `tags` 属性（20 例）** —— `subagent-activation-limit`、`background-confinement-failure`、
`browser-use-*`（3）、`computer-use-*`（2）、`deepseek-messages-system-prompt`、`deepseek-protocol-system-prompt`、
`foreground-confinement-timeout`、`mcp-resources`、`multimodal-spill-*`（2）、`plugin-manager`、`plugin-manager-mcp`、
`provider-cwd`、`ralph-loop`、`team-targets`、`workflow-confinement`、`workspace-dependencies`。

源码：

```ts
// packages/todo/tool-todo/src/index.ts:211
description: 'Optional short category labels (1-3, lowercase), e.g. ["docs"].',
```

引入改动：「feat(client): add the cross-session todo board tab with model-written tags」（2026-09-02）。

**族 2：shell 与子代理/后台任务工具描述改动（13 例）** —— 11 个专利场景、
`document-deliver`、`macos-tools-validation`。

源码（`tool-pwsh` 同形）：

```ts
// packages/shell/tool-bash/src/index.ts:98
' A foreground command that reaches its timeout is not killed: it moves to the background the same way, returning its job id and the output so far.'
// packages/shell/tool-bash/src/index.ts:410
'Timeout in milliseconds. The executor applies its configured default and cap; on expiry the command moves to the background as a job instead of being killed.'
```

差异形如（`patent-oa-response`）：

```
@@ -119,11 +119,11 @@
-             "description": "Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry.",
+             "description": "Timeout in milliseconds. The executor applies its configured default and cap; on expiry the command moves to the background as a job instead of being killed.",
```

引入改动：「feat(shell): converge on execute() and promote timed-out commands to jobs」（2026-08-26）。
其中 11 个专利场景与 `macos-tools-validation` 明确含 bash 描述与 `timeout` 参数文案改动；
`document-deliver` 只含子代理与后台任务工具的描述改动。

**3 例 `system prompts` 失配同属族 1**——生成式 TypeScript SDK 系统提示里内联了工具签名，
因此新增的 `tags?: string[]` 同时出现在提示正文：

```
@@ -184,18 +184,20 @@
+       /** Optional short category labels (1-3, lowercase), e.g. ["docs"]. */
+       tags?: string[];
```

**2 例 acp `stdout.expected.jsonl` 失配是版本串漂移**：

```
- {"jsonrpc":"2.0","id":1,...,"agentInfo":{"name":"deepseek-harness-acp","version":"0.1.5-rc.2"},...}
+ {"jsonrpc":"2.0","id":1,...,"agentInfo":{"name":"deepseek-harness-acp","version":"0.1.7-alpha.2"},...}
```

`fs-same-mode` 的期望写的是更旧的 `0.0.1`。版本值来自包清单：

```ts
// packages/acp/acp/src/index.ts:69
const { version: AGENT_VERSION } = createRequire(import.meta.url)('../package.json') as { version: string }
```

当前包版本为 `0.1.7-alpha.2`。**另有 6 个 acp 期望文件同样含旧版本串**
（`cancel`、`cancel-tool-calls`、`escalation-approved`、`escalation-rejected`、`fs-escalation-approved`、
`handshake`、`image-compaction`），它们当前因超时失败，版本漂移被超时掩盖。

### `test:snapshot:refresh` 无法刷绿（实测）

```
$ DSH_SNAPSHOT=refresh pnpm vitest run --config vitest.snapshot.config.ts -t patent
      Tests  6 failed | 5 passed | 174 skipped (185)
```

- refresh 只改写了 3 个**钉住期望的所有者** sidecar（`patent-deadline`、`patent-oa-response`、
  `patent-writing-patterns` 的 `tool-schemas.expected.json`），并新增 11 个未跟踪的 `session.v4.jsonl`；
- 11 个专利场景只刷绿 5 个；仍失败的 6 个（`patent-claim-chart`、`patent-infringement`、
  `patent-infringement-chain`、`patent-invalidation`、`patent-invalidation-chain`、`patent-oa-chain`）
  继续报 `request header 1`，diff 仍是 bash 与后台任务工具的**描述文本**。
- 即 refresh 只覆盖「钉住 sidecar」这一条路径，覆盖不到场景自身记录里的描述文本。

### 实验可还原性

refresh 实验的产物已全部还原（`git checkout -- snapshots/` + `git clean -fd snapshots/`），
与实验前 tar 备份逐条对账 **1566 = 1566 条目（含符号链接类型）完全一致**；
还原后 `pnpm run test:snapshot -t patent` 回到原 **11 failed | 175 skipped**。

## Suggested fix

分两步，且**必须按序**（先拆类，再重录）：

1. **先把两类失败拆开，让红=真缺陷**：
   - 2 例 sdk 崩溃按 #244 修（改动已实测通过）。
   - 7 例 acp 120s 超时先定性（成因本轮未核实，见「未纳入」）：属环境/时序则转 skip 或加显式超时预算；
     属真 bug 则保留红灯并单独立项。
2. **再按引入改动分组重录过期期望**，不要一次性 `refresh`：
   - 族 1（todo `tags`，23 例含 3 例系统提示）：重录 header 期望与对应 `system-prompt.expected.md`。
   - 族 2（shell/子代理描述，13 例）：重录 header 期望。
   - acp 版本串（2 例显性 + 6 例被超时掩盖）：把 `agentInfo.version` 改为跟随包清单，
     或至少逐文件对齐当前版本；前者需要在快照约定内确认是否允许替换。
   - 每次重录都要逐条 diff 人工确认「变化只来自两族已知改动」。

**风险**：重录会一并吞掉未知漂移。这是必须先做第 1 步的原因——否则重录会把真缺陷刷绿。

## 验收

- `pnpm run test:snapshot` 在 `master` 上绿；或剩余红灯每一条都有对应独立 issue 并标注「已知、已定性」。
- 负例验证一条：故意改一处模型可见文本 → 车道变红；回退 → 变绿。
- 重录 diff 逐条对照本 issue 列出的两族改动，无第三类变化。
````

---

### #244: sdk profile 重复装载 `ptc-runtime`，两个场景启动即失败

````
P2 | 类型：Bug | 来源：2026-09-23 快照门禁复核（本轮新发现，非专利域）

## Problem

`dsh --profile sdk` 的两个快照场景（`ptc-turn`、`tool-error-details`）回放时**启动即失败**
（约 190ms，远快于正常回放的 600–2600ms），原因是 profile 装载树里出现两条同 id 装载项。

```
dsh: startup failed: 1 required plugin did not activate
Failed plugins (1):
  include (required)
    Package: cordis:include
    TypeError: duplicate loader entry id: ptc-runtime
```

重复来自「基础 bundle 已声明 + 场景 patch 再插入一次」：

- 基础 bundle 现在自己声明该装载项：`packages/bundle/base/cordis.patch.yml:402-403`

  ```yaml
  - id: ptc-runtime
    name: '@deepseek-ai/dsh-ptc-runtime-node'
  ```

  （`apps/cli/composition.md:273` 的组成表同样列出 `ptc-runtime` → `@deepseek-ai/dsh-ptc-runtime-node`）
- 场景 patch 又插入同一 id：`snapshots/sdk/ptc-turn/runtime.cordis.yml`、`snapshots/sdk/tool-error-details/runtime.cordis.yml`

  ```yaml
  - insert:
      - id: ptc-runtime
        name: '@deepseek-ai/dsh-ptc-runtime-node'
  ```

这两条 patch 写在基础 bundle 声明该装载项之前（2026-09-06、2026-09-12）。上游改动
「fix(workflow): execute orchestration in the sandboxed PTC runtime」（2026-09-13）
把该装载项加进基础 bundle，场景 patch 随即成为冗余，并被 loader 的重复 id 拒绝拦下。

影响面限于快照夹具（`runtime.cordis.yml` 不进产品配置），但这两个场景本应覆盖的断言
（`ptc-turn` 的 `run_code` 工具可见性与 `tool/ptc-dispatch` 事件序列、`tool-error-details` 的结构化拒绝明细）
在当前 CI 里**没有任何覆盖**——失败发生在建立连接之前。

## Evidence

回放输出（两例同形）：

```
FAIL  snapshots/sdk/sdk.snapshot.ts > TypeScript SDK snapshots over the jsonrpc runtime > replays ptc-turn through dsh --profile sdk
TransportClosedError: dsh profile "sdk": JSON-RPC input closed
exit code: 1
stderr tail:
dsh: startup failed: 1 required plugin did not activate
Failed plugins (1):
  include (required)
    Package: cordis:include
    TypeError: duplicate loader entry id: ptc-runtime
        at validate (vendor/loader/lib/index.js:93:29)
        at EntryGroup.update (vendor/loader/lib/index.js:99:3)
        at [cordis.init] (packages/boot/app-boot/lib/index.js:183:19)
```

拒绝点：

```ts
// vendor/loader/src/config/group.ts:76
if (seen.has(id)) throw new TypeError(`duplicate loader entry id: ${id}`)
```

引入顺序（`git log -S` 与 `git merge-base --is-ancestor` 核实）：

| 时间 | 改动 | 事件 |
|---|---|---|
| 2026-09-06 | 「Cover PTC dispatches through explicit TypeScript SDK profile patch」 | 场景 patch 首次插入 `ptc-runtime` |
| 2026-09-12 | 「refactor(ptc): align runtime packages and services with PTC naming」 | patch 随包名重构更新 |
| 2026-09-13 | 上游「fix(workflow): execute orchestration in the sandboxed PTC runtime」 | 把 `ptc-runtime` 加进基础 bundle，场景 patch 变冗余 |

## Suggested fix（已实测通过）

删掉场景 patch 里的冗余装载项。两种改法都实测通过：

1. **推荐**：`snapshots/sdk/ptc-turn/runtime.cordis.yml` 除该插入行外没有其它内容，
   直接删除该文件，并从 `snapshots/sdk/sdk.snapshot.ts:133` 的 `patches` 列表移除该行；
   `snapshots/sdk/tool-error-details/runtime.cordis.yml` 只保留 `structured-denial-fixture` 行。
2. 保守：保留文件，把插入行删空（`- insert: []`）。

实测结果（两种改法一致）：

```
$ pnpm vitest run --config vitest.snapshot.config.ts -t "replays (ptc-turn|tool-error-details) through dsh --profile sdk"
 ✓ replays ptc-turn through dsh --profile sdk  606ms
 ✓ replays tool-error-details through dsh --profile sdk  590ms
 Tests  2 passed | 184 skipped (186)
```

基础 bundle 已装载 Node PTC 提供方（未 `disabled`），删掉场景 patch 后 `ptc-turn` 的
`expectedTools: { run_code: … }` 与 `tool/ptc-dispatch` 断言仍然成立，无需其它改动。

**风险**：低。仅动快照夹具。若将来基础 bundle 移除该装载项，`ptc-turn` 会因缺少 `ctx.ptcRuntime` 失败——
这正是应当被发现的信号，不是回归。

## 验收

- 两个场景回放通过，且 `ptc-turn` 的 `run_code` 工具可见性与 PTC 派发事件断言仍在（不是被 skip 掉）。
- 负例验证：把 `ptc-runtime` 插入行重新加回任一场景 patch，对应场景重新以
  `duplicate loader entry id: ptc-runtime` 失败。
- 全仓 `rg 'id: ptc-runtime' snapshots/` 不再出现与基础 bundle 重复的插入。
````

---

## 如何提交

编号为预估，创建时以实际分配为准。建议先建标签对应的 Issue Type（Bug / Task），再批量提交。

每条正文位于 `### #<编号>` 标题之后、包在 4 个反引号的围栏内（围栏本身不是正文）。
逐条取正文并提交：

```sh
# 取单条正文（把 243 换成目标编号）
python3 - 243 > /tmp/issue-243.md <<'PY'
import re, sys, pathlib
fence = '`' * 4
doc = pathlib.Path('.agents/audits/2026-09-23-snapshot-lane-and-loader-issues.md').read_text()
n = sys.argv[1]
m = re.search(rf'^### #{n}:.*?\n{fence}\n(.*?)\n{fence}', doc, re.M | re.S)
assert m, f'issue {n} not found'
print(m.group(1))
PY

# 提交（标题取 `### #243: ` 之后的文本）
gh issue create --title "<标题>" --body-file /tmp/issue-243.md \
  --label kind/techdebt --label area/infra --label area/tests --label area/session
```

正文已含 `P? | 类型 | 来源` 首行与 `## Problem` / `## Evidence` / `## Suggested fix` / `## 验收` 四段，
可直接粘贴，无需改写。标签对应见汇总表：

| 类型 | Labels | 编号 |
|---|---|---|
| Task | kind/techdebt, area/infra, area/tests, area/session | #243 |
| Bug | kind/bug-fix, area/infra, area/tests | #244 |

**与既有 issue 的关系**：`#243` 与 #208 / #223 / #238 同属「门禁看不见某条链路」，
但它是其中最直接的一条——门禁整车道的判定能力归零；`#244` 与 #210 / #212 / #214 同属「装载期与声明契约」，
区别是它已在 CI 表现为崩溃而非静默漂移。`#243` 的修复会顺带重置专利域场景的期望，
因此专利域各批（批次 3/4）应在 `#243` 之后重跑一次快照车道确认。

## 未纳入本文档的项（未独立复核，不进正文）

1. **7 例 acp 120s 超时的成因**：本轮只确认了失败形态（`Test timed out in 120000ms`）与
   它们同时掩盖了 6 个期望文件的版本串漂移，未定位是环境/时序还是产品缺陷。
2. **refresh 只刷绿 5/11 的机制细节**：本轮确认了「只改写钉住 sidecar」这一层
   （3 个 pin 所有者文件被改写、11 个 `session.v4.jsonl` 新增），但未追踪
   `restorePinnedToolSchemas` 对同 class 的 6 个场景为何仍不生效。
3. **`SESSION_FORMAT_VERSION = 4` 与已提交 `session.v3.jsonl` 的关系**（`packages/core/session/src/types.ts:89`）：
   refresh 会写入新的 `session.v4.jsonl` 世代而不改名已提交世代，按 `snapshots/AGENTS.md` 属预期；
   但它是否与当前 47 例失败相关，本轮未测得分歧（失败签名全部落在期望失配与超时上）。

## 验收

- 本文档为分析产出，`snapshots/`、`packages/bundle/`、`packages/` 均无改动；
  验证性实验（refresh 与 patch 删除）的产物已还原，与实验前备份逐条对账一致（见 #243「实验可还原性」）。
- 每条正文的证据块均由本轮命令输出或代码原文核实；`file:line` 对应 2026-09-23 的 `master`。
