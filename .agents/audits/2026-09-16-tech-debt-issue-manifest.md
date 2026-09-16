# 技术债务快速盘点与 Issue 清单（2026-09-16）

- 日期：2026-09-16；仓库 `xujian519/deepseek-harness`（fork，`origin`）
- 基线：分支 `sync/upstream-dsh-v0.1.6-alpha.1` HEAD（含上游 v0.1.6-alpha.1 合并 + 6 处 unit lane 修复）
- 前序基线：`master` 台账 09-15 节所依据的树（同日 fork 主干）
- 合并规模：3339 files changed, +785233 / −41925（几乎每个包组均被触及）
- 范围：`packages/`、`apps/`、`scripts/`；排除 `vendor/`（vendored，改动须走 sync 程序）与构建残留
- 方法：门禁实跑 + rg 模式扫描 + 台账逐条 HEAD 对账；不做 55k 行三组并行深读
- Issue tracker 现状：所有既有 Issue (#78–#132) 均已 CLOSED；新建从 #133 起

## 1. 门禁基线（本机实跑）

| 门禁 | 结果 | 备注 |
|---|---|---|
| `hygiene` | PASS 16/16 (21.64s) | 08-28 记红（vendor rescope 6 处 + onboarding-copy 6 条 + 3 client 包 peer+dev）已全部收敛 |
| `doc-sync` | PASS 43/43 (61.46s) | 09-13 记绿，保持 |
| `duplication` | PASS 0 clones / 2350 files / 479556 lines (273ms) | 09-11 记 0/462346；规模 +17210 行来自合并 |
| `typecheck` | PASS (~6 min 含 build:lib:host) | 两编译面均绿 |
| `lint` | PASS 0 warnings / 0 errors / 4830 files (24.9s) | 09-13 记 4489 文件；+341 来自合并 |
| `test:coverage` | 未跑 | 需全测 + build:native-system；CI 拥有该信号 |

## 2. 台账对账（`docs/TECH_DEBT.md` 开放项 → HEAD 状态）

### 已收敛（可销案）

| 台账条目 | HEAD 证据 | 收敛方式 |
|---|---|---|
| L5 `kick()` 空 catch | `agent.ts:229` 有注释「Reported failures and cancellation are contained at the driver boundary.」 | 注释补齐 |
| L5 desktop bridge-client 写路径泄漏 | `bridge-client.ts:179` catch 内调 `this.settle(id, pending, ...)` | 08-28 修复保持 |
| L5 identity 首启并发窗口 | `anonymous-user-id/src/index.ts:57-88` JSDoc 明写权衡与收敛保证 | 文档化 |
| M8 `agentInfo.version` 硬编码 | `acp/acp/src/index.ts:69` 读 `package.json`、`:195` 用 `AGENT_VERSION` | 09-12 #119 修复 |
| M8 `maxParallelSubCalls` 三处事实源 | `core/tools/src/index.ts:757` `DEFAULT_MAX_PARALLEL_SUB_CALLS`、`:761` `resolveMaxParallelSubCalls`、`:777` schema `.default(...)` | request/spec 模板收敛 |
| M10 acp `whenIdle()` 无 rejection 处理 | `acp/acp/src/session.ts:437` 改为 `await` + try/catch → `failures.push(...)` | 重构收敛 |
| M10 hooks 双桥镜像复制 | `hooks-codex/src/index.ts` 有 `/* jscpd:ignore-start */` + 明写理由；两桥功能集已有意分歧 | 成文裁定豁免 |
| hygiene 门禁 08-28 三簇红 | hygiene 16/16 PASS | 随合并修复 |

### 仍开放（行号漂移，内容不变）

| 台账条目 | 原行号 | HEAD 行号 | 备注 |
|---|---|---|---|
| L5 魔法哨兵 `resumeSessionId === ''` | `agent-loop/src/index.ts:281,357` | `:427`（合并为 `undefined \|\| === ''` 单处） | 仍缺 schema 边界归一化 |
| L5 `whenIdle()` 自旋 | `agent.ts:195-200` | `:211-215` | do-while 依赖引用换代隐式契约 |
| L5 `isAborted` 平凡包装 | `tools/index.ts:1889-1892` | `:1862-1864` | 仅 2 处调用，可内联 |
| L5 skill-filesystem abort listener | `skill-filesystem/src/index.ts:167` | `:172` | 台账已定性无害 |
| L5 llm-pi-ai 错误分类靠正则 | `stream.ts:31-70` | `:35-72`（XXX 注释保留） | 等上游能力 |
| L5 tool-todo 双 schema 库混用 | `tool-todo/src/index.ts:11-13` | `:9-10`（schemastery + zod 并存） | — |
| M6 better-sidebar `state.ts` | 1900 行 | 1900 行 | 缺证成理由 |
| M6 better-sidebar `Sidebar.tsx` | 1775 行 | 1775 行 | 缺证成理由 |
| M6 `core/tools/src/index.ts` | 1913 行 | **1932 行（+19）** | 恶化 |
| M6 `self-evolve-basic/src/index.ts` | 1857 行 | 1857 行 | 缺证成理由 |
| M10 sdk `settleStreams` 定时器泄漏 | `client.ts:444-449` | `:464-469` | race 获胜方不清 timer |
| M10 gateway 同构扫描循环 | `index.ts:117-134` / `:233-260` | `:272-287` / `:636-664` | 前 6 步完全同构 |
| M10 llm-deepseek vs llm-pi-ai 平行重建 | `DEFAULT_STREAM_IDLE_TIMEOUT_MS` 双份 | llm-deepseek 已集中到 `common/defaults.ts`；llm-pi-ai 仍内联 | 部分收敛 |

### 09-12 / 09-13 遗留（未核对，保持登记）

- 非严格插件 schema 静默吞掉拼错配置键（与 AGENTS.md「Misconfiguration fails loud」相悖）
- 覆盖率豁免其余约 90 条未逐条重审
- 中英指针集合不变量升格为 quick doc 叶门（#127 follow-up）
- keyless 快照层不在 fork CI 内

## 3. 新增发现（拟建 Issue）

| # | 标题 | 类型 | Labels | 优先级 | 证据锚点 |
|---|---|---|---|---|---|
| #168 | 上游合并带入 23 处空 `.catch(() => {})` 缺紧邻理由（#85 回归） | Task | kind/techdebt, area/infra | P2 | `ssh/ssh/src/*`(15)、`ssh/subprocess-ssh/src/index.ts`(6)、`ssh/fs-ssh/src/index.ts`(1)、`ptc-runtime-node`(1)、`browser-use-stagehand-native`(1) |
| #169 | `workspace.create(path, title?)` 的 `title` 参数已死 | Task | kind/cleanup, area/core | P3 | `workspace/workspace/src/index.ts:152-160` |
| #170 | sdk/client `settleStreams` race 获胜方不清 timer（M10 行号漂移） | Bug | kind/bug-fix, area/core | P3 | `sdk/client/src/client.ts:464-469` |
| #171 | api/gateway `collectSrcClaims` 与 `resolveSrcDescriptor` 同构扫描（M10 行号漂移） | Task | kind/techdebt, area/api | P3 | `api/gateway/src/index.ts:272-287` ↔ `:636-664` |

### 不建 Issue 的发现

- **L5 余项**（魔法哨兵、whenIdle 自旋、isAborted 包装、skill-filesystem listener、llm-pi-ai regex、tool-todo 双 schema）：台账已裁定「各自没有可独立评审的修复单元」，保持登记不立案。
- **M6 四候选**（better-sidebar ×2、core/tools、self-evolve-basic）：仍缺证成理由；core/tools +19 行不构成新切口。
- **TODO/FIXME/XXX 120 处**：精筛后约 30 处真债务 TODO，其中 4 处在 vendor/（不由本仓管理）、5 处 H4 `TODO(e2b-*)`（台账已定性为等上游）、其余为常规记账或已有 Issue 覆盖。`workspace/src/index.ts:152` 的 TODO 单独立案（第 2 条）。
- **types.ts 含运行时代码 20 处**：09-13 已改写规则为「声明本包接缝词汇」，hygiene/doc-sync 未报错说明符合新规则。

## 4. 各 Issue 正文草案

### Issue #168: 上游合并带入 23 处空 `.catch(() => {})` 缺紧邻理由（#85 回归）

```
P2 | 类型：Task | 来源：2026-09-16 快速盘点

## Problem

Issue #85 于 2026-09-12 关闭，当时 src 内 62 处空 `.catch(() => {})` 全部补齐紧邻理由。
上游 v0.1.6-alpha.1 合并带入新包组 `ssh/`（首次提交 2026-09-11）、
`ptc-runtime/`（09-12）、`experimental/browser-use-stagehand-native`（09-12），
其中 23 处空 catch 缺紧邻理由注释。

当前 src 总计 90 处空 catch：67 处带理由（含合并带入的 5 处合规站点）、23 处缺理由。

## Evidence

`ssh/ssh/src/index.ts`:157, 193, 220
`ssh/ssh/src/helper-processes.ts`:188, 195, 206, 231, 237, 245, 273, 362, 364, 415
`ssh/ssh/src/helper.ts`:243
`ssh/subprocess-ssh/src/index.ts`:111, 151, 280, 311, 313, 336
`ssh/fs-ssh/src/index.ts`:65
`ptc-runtime/ptc-runtime-node/src/index.ts`:175
`experimental/browser-use-stagehand-native/src/launch.ts`:37

## Suggested fix

按 #85 第二批（PR #118）确立的六种形态词汇逐处判定并补紧邻注释：
- 自身仍有消费方的 promise 上的未处理拒绝防护
- 没有观察者的 best-effort 工作
- 不得顶替主错误的清理
- 被弃置的请求或响应
- teardown 对正在终结的进程做 join
- 没有上报面的 dispose

无门禁自动检查该规则（#85 纯靠人工审计），本 Issue 为手动批次。

## Labels

kind/techdebt, area/infra
```

### Issue #169: `workspace.create(path, title?)` 的 `title` 参数已死

```
P3 | 类型：Task | 来源：2026-09-16 快速盘点

## Problem

`packages/workspace/workspace/src/index.ts:152-160` 的 TODO 明确记录：
`title` 参数失去最后一个生产调用方（gateway 的 create-by-name 分支已删除，
见 `.agents/notes/archived/simplification/2026-07-31-one-route-to-add-a-workspace.md`）。

当前 `create(path: string, title?: string)` 的 `title` 仅被转发到 `createCanonical`，
无任何生产路径传入非 undefined 值。

## Evidence

```ts
// packages/workspace/workspace/src/index.ts:152-160
// TODO: `title` lost its last production caller when the gateway's
// create-by-name branch was deleted
// (.agents/notes/archived/simplification/2026-07-31-one-route-to-add-a-workspace.md);
// drop the parameter with its @param clause and the `create(path, title?)`
// lines in this package's README pair.
async create(path: string, title?: string): Promise<Workspace> {
```

## Suggested fix

1. 删除 `title` 参数与 `@param title` JSDoc 行
2. `createCanonical` 内部若仍读 `title`，改为从 path basename 派生或硬编码 undefined
3. 更新 `packages/workspace/workspace/README.md` 与 `README.zh.md` 中的 `create(path, title?)` 签名
4. 删除该 TODO 注释

## Labels

kind/cleanup, area/core
```

### Issue #170: sdk/client `settleStreams` race 获胜方不清 timer

```
P3 | 类型：Bug | 来源：台账 M10，2026-09-16 对账确认仍开放

## Problem

`packages/sdk/client/src/client.ts:464-469` 的 `settleStreams()` 使用
`Promise.race([this.streamsSettled, setTimeout(100ms)])`。
当 `streamsSettled` 先 resolve 时，setTimeout 的 timer 不被清理也不 unref，
每次对已死 runtime 的 request 挂一个 100ms 未清定时器。

在高频 request 场景下（如批量 session 关闭），累积的 dangling timer
会延长 Node event loop 的活跃窗口。

## Evidence

```ts
// packages/sdk/client/src/client.ts:464-469
private settleStreams(): Promise<void> {
  return Promise.race([
    this.streamsSettled,
    new Promise<void>((resolve) => { setTimeout(resolve, STREAM_SETTLE_MS) }),
  ])
}
```

## Suggested fix

```ts
private settleStreams(): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, STREAM_SETTLE_MS)
    this.streamsSettled.then(() => { clearTimeout(timer); resolve() })
  })
}
```

或更简洁：用 `AbortSignal.timeout(STREAM_SETTLE_MS)` + `Promise.race` 并在 settled 后 abort。

## Labels

kind/bug-fix, area/core
```

### Issue #171: api/gateway `collectSrcClaims` 与 `resolveSrcDescriptor` 同构扫描循环

```
P3 | 类型：Task | 来源：台账 M10，2026-09-16 对账确认仍开放（行号漂移）

## Problem

`packages/api/gateway/src/index.ts` 的两段循环（`:272-287` 与 `:636-664`）
前 6 步完全同构：

1. `Object.entries(this.ctx.reflect.props)`
2. `definition.type !== 'service'` → continue
3. `this.ctx.get(serviceKey)` → receiver
4. `isObject(receiver)` → continue
5. `originalOf(receiver)` → original
6. `Reflect.get(original, 'typertRemote')` → binding/value

只在最后一步分叉：`collectSrcClaims` 收集 endpoint 字符串到 Set；
`resolveSrcDescriptor` 按 namespace+method 过滤并构造 InvocationDescriptor。

## Evidence

```ts
// :272-287 collectSrcClaims
for (const [serviceKey, definition] of Object.entries(this.ctx.reflect.props)) {
  if (definition.type !== 'service') continue
  const receiver = this.ctx.get(serviceKey) as unknown
  if (!isObject(receiver)) continue
  const original = originalOf(receiver)
  const binding = Reflect.get(original, 'typertRemote') as unknown
  if (!isObject(binding) || typeof Reflect.get(binding, 'namespace') !== 'string') continue
  ...
}

// :636-664 resolveSrcDescriptor
for (const [serviceKey, definition] of Object.entries(this.ctx.reflect.props)) {
  if (definition.type !== 'service') continue
  const receiver = this.ctx.get(serviceKey) as unknown
  if (!isObject(receiver)) continue
  const original = originalOf(receiver)
  const value = Reflect.get(original, 'typertRemote') as unknown
  if (value === undefined) continue
  ...
}
```

## Suggested fix

抽取 `private *iterateRemoteServices(): Generator<{ original, binding, serviceKey }>` 生成器，
两个消费方各自只写分叉逻辑。或抽取 `findRemoteService(namespace, method)` 合并两步。

## Labels

kind/techdebt, area/api
```

## 5. 台账待更新（Phase 7 写回 `docs/TECH_DEBT.md`）

- 新增 `## 2026-09-16 更新（快速盘点 + 上游 v0.1.6-alpha.1 合并后对账）` 一节
- 销案：L5 kick() 空 catch、L5 desktop bridge-client、L5 identity 首启并发、M8 agentInfo.version、M8 maxParallelSubCalls、M10 acp whenIdle、M10 hooks 双桥、hygiene 08-28 三簇红
- 行号漂移更新：L5 余项、M6 四候选、M10 settleStreams/gateway
- 新增 Issue 对照：#168 ↔ 空 catch 回归、#169 ↔ workspace title、#170 ↔ settleStreams、#171 ↔ gateway 同构
- 遗留声明：coverage 未跑、L5/M6 不立案理由保持、09-12/09-13 遗留保持登记
